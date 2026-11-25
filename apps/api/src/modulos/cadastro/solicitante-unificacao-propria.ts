// Unificação de solicitante externo duplicado no banco próprio (F3.1, 02-CAD linha 20). A regra é a do domínio
// (@sgh/dominio-cadastro, solicitante/unificacao): o cadastro absorvido NÃO é apagado e nenhum registro clínico é
// alterado (atendimento, pedido de exame, autorização e receita continuam com o cadastro da época). O absorvido fica
// inativo, com o ponteiro para o cadastro que continua (`sucessor_solicitante_externo_id`); os cadastros que já
// tinham sido unificados nele passam a apontar para o novo, para não haver cadeia; os códigos nas fontes pagadoras
// passam ao que continua só onde ele não tem código. Desfazer devolve o ponteiro e reativa o cadastro.
// Gravação pelo executor: trilha (com o motivo) e idempotência na mesma transação.
import {
  codigosNaUnificacao,
  errosDesfazerUnificacao,
  errosUnificacao,
  type SolicitanteNaUnificacao,
} from '@sgh/dominio-cadastro';
import { definirOperacao, ErroOperacao, type Leitor, recusa, type TxOperacao } from '@sgh/nucleo';
import { z } from 'zod';
import type { RegistroTrilhaTela } from './tipos.js';

const idPos = z.number().int().positive();
const bool = (v: unknown): boolean => v === true || v === 1 || v === '1';
const num = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v));

const MENSAGENS: Record<string, [string, string]> = {
  'mesmo-cadastro': ['Escolha outro cadastro: não se unifica um solicitante nele mesmo.', 'absorvido'],
  'absorvido-ja-unificado': ['Este cadastro já foi unificado em outro.', 'absorvido'],
  'mantido-unificado': [
    'O cadastro que continua já foi unificado em outro: unifique no cadastro que responde hoje.',
    'mantido',
  ],
  'mantido-inativo': ['O cadastro que continua está inativo: reative-o antes de unificar.', 'mantido'],
  'motivo-curto': ['Escreva o motivo com ao menos 10 letras.', 'motivo'],
  'nao-unificado': ['Este cadastro não está unificado em outro.', 'absorvido'],
};
function recusarErros(erros: readonly string[]): void {
  if (!erros.length) return;
  throw recusa(erros[0]!, erros.map((e) => MENSAGENS[e]?.[0] ?? e).join(' '), {
    campos: [...new Set(erros.map((e) => MENSAGENS[e]?.[1] ?? e))],
  });
}
const naoAchado = () =>
  new ErroOperacao(404, 'Solicitante-inexistente', 'Não encontrado', 'Solicitante não encontrado.');

const esquemaUnificar = z
  .object({
    /** Cadastro que continua. */
    mantido: idPos,
    /** Cadastro duplicado, que fica inativo com o ponteiro. */
    absorvido: idPos,
    /** Versão do absorvido que a tela leu. */
    versao: idPos,
    motivo: z.string().max(200),
  })
  .strict();
export type EntradaUnificarSolicitante = z.infer<typeof esquemaUnificar>;

const esquemaDesfazer = z.object({ absorvido: idPos, versao: idPos, motivo: z.string().max(200) }).strict();
export type EntradaDesfazerUnificacaoSolicitante = z.infer<typeof esquemaDesfazer>;

async function travar(tx: TxOperacao, ids: readonly number[]) {
  const linhas = await tx.consultarParaAtualizar(
    `SELECT id, versao, ativo, sucessor_solicitante_externo_id FROM solicitante_externo
      WHERE id IN (${ids.map(() => '?').join(', ')}) AND excluido_em IS NULL ORDER BY id`,
    ids,
  );
  return new Map(
    linhas.map((r) => [
      Number(r['id']),
      {
        id: Number(r['id']),
        versao: Number(r['versao']),
        ativo: bool(r['ativo']),
        sucessor: num(r['sucessor_solicitante_externo_id']),
      } satisfies SolicitanteNaUnificacao & { versao: number },
    ]),
  );
}

const limpo = (m: string) => m.replace(/\s+/g, ' ').trim();

export const opUnificarSolicitante = (t: RegistroTrilhaTela) =>
  definirOperacao({
    nome: 'cadastro.solicitante.unificar',
    tabelas: ['solicitante_externo', 'solicitante_externo_fonte_pagadora'],
    entrada: esquemaUnificar,
    acao: 'operacao',
    async gravar(tx, e) {
      if (e.mantido === e.absorvido) recusarErros(['mesmo-cadastro']);
      const s = await travar(tx, [e.mantido, e.absorvido]);
      const mantido = s.get(e.mantido);
      const absorvido = s.get(e.absorvido);
      if (!mantido || !absorvido) throw naoAchado();
      recusarErros(errosUnificacao({ mantido, absorvido, motivo: e.motivo }));

      // Códigos por fonte pagadora: o que continua herda só onde não tem linha (nem inativa, nem excluída: a chave
      // única do par não deixa repetir). As linhas do absorvido ficam como estão.
      const codigos = await tx.consultar(
        `SELECT solicitante_externo_id, fonte_pagadora_id, codigo_na_fonte, ativo, excluido_em
           FROM solicitante_externo_fonte_pagadora WHERE solicitante_externo_id IN (?, ?)`,
        [e.mantido, e.absorvido],
      );
      const de = (dono: number, soVivos: boolean) =>
        codigos
          .filter(
            (c) => Number(c['solicitante_externo_id']) === dono && (!soVivos || c['excluido_em'] === null),
          )
          .map((c) => ({
            fonte: Number(c['fonte_pagadora_id']),
            codigo: String(c['codigo_na_fonte']),
            ativo: bool(c['ativo']) && c['excluido_em'] === null,
          }));
      const { herdar, divergentes } = codigosNaUnificacao(de(e.mantido, false), de(e.absorvido, true));
      for (const c of herdar)
        await tx.incluir('solicitante_externo_fonte_pagadora', {
          solicitante_externo_id: e.mantido,
          fonte_pagadora_id: c.fonte,
          codigo_na_fonte: c.codigo,
          ativo: true,
        });

      // Sem cadeia: quem já estava unificado no absorvido passa a apontar para o que continua.
      const anteriores = await tx.consultarParaAtualizar(
        `SELECT id, versao FROM solicitante_externo
          WHERE sucessor_solicitante_externo_id = ? AND excluido_em IS NULL ORDER BY id`,
        [e.absorvido],
      );
      for (const a of anteriores)
        await tx.alterar('solicitante_externo', Number(a['id']), Number(a['versao']), {
          sucessor_solicitante_externo_id: e.mantido,
        });

      const agora = (await tx.uma<{ n: unknown; d: unknown }>('SELECT NOW(3) AS n, CURRENT_DATE AS d', []))!;
      await tx.alterar('solicitante_externo', e.absorvido, e.versao, {
        sucessor_solicitante_externo_id: e.mantido,
        unificado_em: agora.n,
        unificado_por: tx.contexto.usuario ?? null,
        ativo: false,
        ...(absorvido.ativo ? { data_inativacao: agora.d } : {}),
      });
      return {
        id: e.mantido,
        absorvido: e.absorvido,
        codigosHerdados: herdar.length,
        fontesDivergentes: divergentes.length,
        reapontados: anteriores.length,
      };
    },
    alvo: (e) => ({ tabela: 'solicitante_externo', id: e.absorvido }),
    trilha: (e, r) => ({
      dados: {
        ...((t.dadosDepois ?? {}) as Record<string, unknown>),
        mantido: e.mantido,
        absorvido: e.absorvido,
        codigosHerdados: r.codigosHerdados,
        reapontados: r.reapontados,
      },
      motivo: limpo(e.motivo),
    }),
  });

export const opDesfazerUnificacaoSolicitante = (t: RegistroTrilhaTela) =>
  definirOperacao({
    nome: 'cadastro.solicitante.desfazer-unificacao',
    tabelas: ['solicitante_externo'],
    entrada: esquemaDesfazer,
    acao: 'operacao',
    async gravar(tx, e) {
      const absorvido = (await travar(tx, [e.absorvido])).get(e.absorvido);
      if (!absorvido) throw naoAchado();
      recusarErros(errosDesfazerUnificacao({ absorvido, motivo: e.motivo }));
      const mantido = absorvido.sucessor!;
      // Os registros clínicos nunca saíram do cadastro: basta devolver o ponteiro e reativar. Os códigos que o outro
      // cadastro herdou ficam com ele (são dele desde a unificação e podem ter sido usados em guia).
      await tx.alterar('solicitante_externo', e.absorvido, e.versao, {
        sucessor_solicitante_externo_id: null,
        unificado_em: null,
        unificado_por: null,
        ativo: true,
        data_inativacao: null,
      });
      return { id: e.absorvido, mantido };
    },
    alvo: (e) => ({ tabela: 'solicitante_externo', id: e.absorvido }),
    trilha: (e, r) => ({
      dados: {
        ...((t.dadosDepois ?? {}) as Record<string, unknown>),
        mantido: r.mantido,
        absorvido: e.absorvido,
      },
      motivo: limpo(e.motivo),
    }),
  });

export interface UnificacaoDoSolicitante {
  /** Cadastro em que este foi unificado (o que continua), ou null. */
  unificadoEm: { id: number; nome: string; registro: string; quando: string | null } | null;
  /** Cadastros unificados neste, com quantos atendimentos seguem ligados a cada um (nenhum é alterado). */
  absorvidos: {
    id: number;
    versao: number;
    nome: string;
    registro: string;
    quando: string | null;
    atendimentos: number;
  }[];
}

const SQL = `SELECT s.id, s.versao, s.nome, cc.sigla AS conselho, uf.sigla AS uf, s.numero_conselho,
       DATE_FORMAT(s.unificado_em, '%Y-%m-%d') AS quando
  FROM solicitante_externo s JOIN conselho_classe cc ON cc.id = s.conselho_classe_id
  JOIN unidade_federativa uf ON uf.id = s.conselho_unidade_federativa_id WHERE s.excluido_em IS NULL`;
const registro = (r: Record<string, unknown>) =>
  `${String(r['conselho'])} ${String(r['numero_conselho'])}/${String(r['uf'])}`;

/** Lado da unificação na ficha: para onde este cadastro foi e quem foi unificado nele. */
export async function lerUnificacaoDoSolicitante(l: Leitor, id: number): Promise<UnificacaoDoSolicitante> {
  const eu = await l.uma(
    `SELECT sucessor_solicitante_externo_id AS sucessor, DATE_FORMAT(unificado_em, '%Y-%m-%d') AS quando
       FROM solicitante_externo WHERE id = ? AND excluido_em IS NULL`,
    [id],
  );
  const sucessor = eu ? num(eu['sucessor']) : null;
  const para = sucessor === null ? null : await l.uma(`${SQL} AND s.id = ?`, [sucessor]);
  const abs = await l.consultar(
    `${SQL} AND s.sucessor_solicitante_externo_id = ? ORDER BY s.unificado_em DESC, s.id`,
    [id],
  );
  const contagens = abs.length
    ? await l.consultar(
        `SELECT solicitante_externo_id AS s, COUNT(*) AS n FROM atendimento
          WHERE solicitante_externo_id IN (${abs.map(() => '?').join(', ')}) GROUP BY solicitante_externo_id`,
        abs.map((a) => Number(a['id'])),
      )
    : [];
  const porId = new Map(contagens.map((c) => [Number(c['s']), Number(c['n'])]));
  return {
    unificadoEm: para
      ? {
          id: Number(para['id']),
          nome: String(para['nome']),
          registro: registro(para),
          quando: eu?.['quando'] ? String(eu['quando']) : null,
        }
      : null,
    absorvidos: abs.map((a) => ({
      id: Number(a['id']),
      versao: Number(a['versao']),
      nome: String(a['nome']),
      registro: registro(a),
      quando: a['quando'] ? String(a['quando']) : null,
      atendimentos: porId.get(Number(a['id'])) ?? 0,
    })),
  };
}
