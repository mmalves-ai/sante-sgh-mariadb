// Impressora por estação de trabalho e reimpressão controlada no banco próprio (01-ADM L79), pelo Executor (trilha,
// saída e idempotência na mesma transação). Vincular: a estação passa a usar a impressora na finalidade (com
// preferência opcional por usuário); o vínculo anterior deixa de ser o padrão, nunca é apagado. Reimprimir: grava o
// registro da reimpressão com motivo do catálogo, complemento, número da via, destino e a impressora resolvida
// pela estação (ou pelo padrão do estabelecimento). As regras ficam em `@sgh/dominio-documento` (impressao/estacao.ts).
import {
  conferirVinculoEstacao,
  escolherImpressora,
  MENSAGEM_IMPRESSAO,
  planoReimpressao,
  viasAnterioresDaReimpressao,
  type CandidatoImpressora,
  type RecusaImpressao,
} from '@sgh/dominio-documento';
import { definirOperacao, recusa, type TxOperacao } from '@sgh/nucleo';
import { z } from 'zod';

const num = (v: unknown): number => Number(v);
const bool = (v: unknown): boolean => v === true || num(v) === 1;
const recusar = (r: RecusaImpressao) => recusa(r, MENSAGEM_IMPRESSAO[r]);
const id = z.number().int().positive();

export const esquemaVincularEstacaoImpressora = z
  .object({ estacao: id, finalidade: id, impressora: id, usuario: id.nullable().optional() })
  .strict();

/**
 * O que pode ser reimpresso e onde o próprio documento diz quantas vias já saíram (a prova da 1ª impressão). Lista
 * fechada: nome de tabela nunca vem livre da entrada; toda tabela daqui tem estabelecimento_id e excluido_em.
 */
const VIAS_DO_DOCUMENTO = {
  documento_prontuario: 'vias_impressas',
  documento_emitido: '1',
  recibo: 'vias_impressas',
  etiqueta_identificacao: 'impressoes',
  etiqueta_amostra_apoio: 'GREATEST(impressoes, impresso_em IS NOT NULL)',
  amostra_biologica: '(etiqueta_impressa_em IS NOT NULL)',
  prescricao: '(impressa_em IS NOT NULL)',
  laudo_internacao_sus: '(impresso_em IS NOT NULL)',
} as const;
type EntidadeReimpressao = keyof typeof VIAS_DO_DOCUMENTO;
const ENTIDADES_REIMPRESSAO = Object.keys(VIAS_DO_DOCUMENTO) as [
  EntidadeReimpressao,
  ...EntidadeReimpressao[],
];

export const esquemaRegistrarReimpressao = z
  .object({
    entidade: z.enum(ENTIDADES_REIMPRESSAO),
    entidadeId: id,
    documentoEmitido: id.optional(),
    motivo: id,
    complemento: z.string().max(500).optional(),
    finalidade: id.optional(),
    estacao: id.optional(),
    impressora: id.optional(),
    destino: z.enum(['impressora', 'pdf', 'email']).default('impressora'),
    quantidade: z.number().int().min(1).max(99).default(1),
  })
  .strict();

async function estacaoDoEstabelecimento(
  tx: TxOperacao,
  estacao: number,
): Promise<{ estabelecimento: number; unidade: number | null } | null> {
  const e = await tx.uma(
    `SELECT estabelecimento_id, unidade_assistencial_id FROM estacao_trabalho
      WHERE id = ? AND estabelecimento_id = ? AND ativo AND excluido_em IS NULL`,
    [estacao, tx.contexto.estabelecimento],
  );
  if (!e) return null;
  const u = e['unidade_assistencial_id'];
  return { estabelecimento: num(e['estabelecimento_id']), unidade: u === null ? null : num(u) };
}

const operacaoVincularEstacao = definirOperacao({
  nome: 'impressao.vincular_estacao',
  tabelas: ['estacao_impressora'],
  entrada: esquemaVincularEstacaoImpressora,
  async gravar(tx, e) {
    const est = await estacaoDoEstabelecimento(tx, e.estacao);
    const imp = await tx.uma('SELECT estabelecimento_id, ativo FROM impressora WHERE id = ?', [e.impressora]);
    const fin = await tx.uma('SELECT ativo FROM finalidade_impressao WHERE id = ?', [e.finalidade]);
    // A preferência por usuário só vale para quem tem vínculo vigente com o estabelecimento da estação.
    const usuarioVinculado =
      e.usuario === undefined || e.usuario === null
        ? null
        : !!(await tx.uma(
            `SELECT 1 AS ok FROM usuario_estabelecimento
              WHERE usuario_id = ? AND estabelecimento_id = ? AND excluido_em IS NULL
                AND vigencia_inicio <= CURDATE() AND (vigencia_fim IS NULL OR vigencia_fim >= CURDATE())`,
            [e.usuario, tx.contexto.estabelecimento],
          ));
    const r = conferirVinculoEstacao({
      estacaoEstabelecimento: est?.estabelecimento ?? null,
      impressora: imp ? { estabelecimento: num(imp['estabelecimento_id']), ativa: bool(imp['ativo']) } : null,
      finalidadeAtiva: fin ? bool(fin['ativo']) : null,
      usuarioVinculado,
    });
    if (r) throw recusar(r);
    const usuario = e.usuario ?? null;
    const atuais = await tx.consultarParaAtualizar(
      `SELECT id, versao, impressora_id, padrao FROM estacao_impressora
        WHERE estacao_trabalho_id = ? AND finalidade_impressao_id = ? AND usuario_chave = ? AND excluido_em IS NULL`,
      [e.estacao, e.finalidade, usuario ?? 0],
    );
    let vinculo: number | null = null;
    for (const a of atuais) {
      const mesma = num(a['impressora_id']) === e.impressora;
      if (mesma) vinculo = num(a['id']);
      if (mesma !== bool(a['padrao']))
        await tx.alterar('estacao_impressora', num(a['id']), num(a['versao']), { padrao: mesma });
    }
    vinculo ??= await tx.incluir('estacao_impressora', {
      estacao_trabalho_id: e.estacao,
      finalidade_impressao_id: e.finalidade,
      impressora_id: e.impressora,
      usuario_id: usuario,
      padrao: true,
    });
    return { id: vinculo, anteriores: atuais.filter((a) => num(a['impressora_id']) !== e.impressora).length };
  },
  alvo: (_e, r) => ({ tabela: 'estacao_impressora', id: r.id }),
  eventos: (_e, r) => [{ tipo: 'impressao.estacao.vinculada', carga: { id: r.id } }],
  trilha: (e, r) => ({
    dados: {
      estacao: e.estacao,
      finalidade: e.finalidade,
      impressora: e.impressora,
      anteriores: r.anteriores,
    },
  }),
});

/** Candidatas da estação e do estabelecimento para a finalidade (só impressoras ativas contam no domínio). */
async function candidatas(
  tx: TxOperacao,
  estacao: number | null,
  finalidade: number,
): Promise<CandidatoImpressora[]> {
  const c: CandidatoImpressora[] = [];
  if (estacao !== null)
    for (const l of await tx.consultar(
      `SELECT ei.impressora_id, ei.usuario_id, ei.padrao, i.ativo FROM estacao_impressora ei
         JOIN impressora i ON i.id = ei.impressora_id
        WHERE ei.estacao_trabalho_id = ? AND ei.finalidade_impressao_id = ? AND ei.excluido_em IS NULL`,
      [estacao, finalidade],
    ))
      c.push({
        impressora: num(l['impressora_id']),
        origem: 'estacao',
        usuario: l['usuario_id'] === null ? null : num(l['usuario_id']),
        padrao: bool(l['padrao']),
        ativa: bool(l['ativo']),
      });
  for (const l of await tx.consultar(
    `SELECT f.impressora_id, f.unidade_assistencial_id, f.ativo AND i.ativo AS ativo
       FROM impressora_finalidade_estabelecimento f JOIN impressora i ON i.id = f.impressora_id
      WHERE f.estabelecimento_id = ? AND f.finalidade_impressao_id = ?`,
    [tx.contexto.estabelecimento, finalidade],
  ))
    c.push({
      impressora: num(l['impressora_id']),
      origem: 'estabelecimento',
      unidade: l['unidade_assistencial_id'] === null ? null : num(l['unidade_assistencial_id']),
      ativa: bool(l['ativo']),
    });
  return c;
}

const operacaoRegistrarReimpressao = definirOperacao({
  nome: 'impressao.registrar_reimpressao',
  tabelas: ['registro_reimpressao'],
  entrada: esquemaRegistrarReimpressao,
  async gravar(tx, e, ctx) {
    const m = await tx.uma('SELECT ativo, exige_complemento FROM motivo_reimpressao WHERE id = ?', [
      e.motivo,
    ]);
    // O documento existe neste estabelecimento e diz quantas vias já saíram (a 1ª impressão tem de existir).
    const doc = await tx.uma(
      `SELECT ${VIAS_DO_DOCUMENTO[e.entidade]} AS vias FROM ${e.entidade}
        WHERE id = ? AND estabelecimento_id = ? AND excluido_em IS NULL`,
      [e.entidadeId, ctx.estabelecimento],
    );
    if (!doc) throw recusar('documento-inexistente');
    let viasDoDocumento = num(doc['vias']) || 0;
    if (e.documentoEmitido !== undefined) {
      const de = await tx.uma(
        'SELECT 1 AS ok FROM documento_emitido WHERE id = ? AND estabelecimento_id = ? AND excluido_em IS NULL',
        [e.documentoEmitido, ctx.estabelecimento],
      );
      if (!de) throw recusar('documento-emitido-inexistente');
      viasDoDocumento = Math.max(viasDoDocumento, 1);
    }
    if (e.finalidade !== undefined) {
      const fin = await tx.uma('SELECT ativo FROM finalidade_impressao WHERE id = ?', [e.finalidade]);
      if (!fin) throw recusar('finalidade-inexistente');
      if (!bool(fin['ativo'])) throw recusar('finalidade-inativa');
    }
    const [ultima] = await tx.consultarParaAtualizar(
      `SELECT MAX(via) AS via FROM registro_reimpressao
        WHERE entidade = ? AND entidade_id = ? AND estabelecimento_id = ?`,
      [e.entidade, e.entidadeId, ctx.estabelecimento],
    );
    const p = planoReimpressao({
      viasAnteriores: viasAnterioresDaReimpressao({
        ultimaViaRegistrada: ultima && ultima['via'] !== null ? num(ultima['via']) : null,
        viasDoDocumento,
      }),
      motivo: m ? { ativo: bool(m['ativo']), exigeComplemento: bool(m['exige_complemento']) } : null,
      complemento: e.complemento ?? null,
    });
    if ('recusa' in p) throw recusar(p.recusa);
    let estacao: number | null = null;
    let unidade: number | null = null;
    if (e.estacao !== undefined) {
      const est = await estacaoDoEstabelecimento(tx, e.estacao);
      if (!est) throw recusar('estacao-inexistente');
      estacao = e.estacao;
      unidade = est.unidade;
    }
    let impressora: number | null = e.impressora ?? null;
    if (impressora !== null) {
      const imp = await tx.uma('SELECT estabelecimento_id, ativo FROM impressora WHERE id = ?', [impressora]);
      if (!imp) throw recusar('impressora-inexistente');
      if (num(imp['estabelecimento_id']) !== ctx.estabelecimento)
        throw recusar('impressora-de-outro-estabelecimento');
      if (!bool(imp['ativo'])) throw recusar('impressora-inativa');
    } else if (e.destino === 'impressora' && e.finalidade !== undefined) {
      impressora =
        escolherImpressora(await candidatas(tx, estacao, e.finalidade), { usuario: ctx.usuario, unidade })
          ?.impressora ?? null;
    }
    const agora = new Date();
    const idRegistro = await tx.incluir('registro_reimpressao', {
      estabelecimento_id: ctx.estabelecimento,
      documento_emitido_id: e.documentoEmitido ?? null,
      entidade: e.entidade,
      entidade_id: e.entidadeId,
      motivo_reimpressao_id: e.motivo,
      motivo_texto: p.complemento,
      via: p.via,
      quantidade: e.quantidade,
      destino: e.destino,
      estacao_trabalho_id: estacao,
      impressora_id: impressora,
      operacao: 'inclusao',
      dados: JSON.stringify({ finalidade: e.finalidade ?? null }),
      ocorrido_em: agora,
      usuario_id: ctx.usuario,
    });
    return { id: idRegistro, via: p.via, impressora };
  },
  alvo: (_e, r) => ({ tabela: 'registro_reimpressao', id: r.id }),
  eventos: (_e, r) => [{ tipo: 'impressao.reimpressao.registrada', carga: { id: r.id, via: r.via } }],
  trilha: (e, r) => ({ motivo: e.complemento ?? null, dados: { entidade: e.entidade, via: r.via } }),
});

export const esquemaDefinirPadraoEstabelecimento = z
  .object({
    finalidade: id,
    impressora: id,
    unidade: id.nullable().optional(),
    copias: z.number().int().min(1).max(99).default(1),
  })
  .strict();

/**
 * Padrão do estabelecimento (ou de uma unidade) por finalidade: a impressora que sai quando a estação não tem vínculo.
 * Um escopo por finalidade e unidade; trocar a impressora altera a linha (versão e trilha), nunca apaga.
 */
const operacaoDefinirPadraoEstabelecimento = definirOperacao({
  nome: 'impressao.definir_padrao_estabelecimento',
  tabelas: ['impressora_finalidade_estabelecimento'],
  entrada: esquemaDefinirPadraoEstabelecimento,
  async gravar(tx, e, ctx) {
    const unidade = e.unidade ?? null;
    if (unidade !== null) {
      const u = await tx.uma(
        'SELECT 1 AS ok FROM unidade_assistencial WHERE id = ? AND estabelecimento_id = ? AND excluido_em IS NULL',
        [unidade, ctx.estabelecimento],
      );
      if (!u) throw recusa('unidade-inexistente', 'Unidade não encontrada neste estabelecimento.');
    }
    const imp = await tx.uma('SELECT estabelecimento_id, ativo FROM impressora WHERE id = ?', [e.impressora]);
    const fin = await tx.uma('SELECT ativo FROM finalidade_impressao WHERE id = ?', [e.finalidade]);
    const r = conferirVinculoEstacao({
      estacaoEstabelecimento: ctx.estabelecimento,
      impressora: imp ? { estabelecimento: num(imp['estabelecimento_id']), ativa: bool(imp['ativo']) } : null,
      finalidadeAtiva: fin ? bool(fin['ativo']) : null,
    });
    if (r) throw recusar(r);
    const [atual] = await tx.consultarParaAtualizar(
      `SELECT id, versao FROM impressora_finalidade_estabelecimento
        WHERE estabelecimento_id = ? AND finalidade_impressao_id = ? AND unidade_chave = ?`,
      [ctx.estabelecimento, e.finalidade, unidade ?? 0],
    );
    if (atual) {
      await tx.alterar('impressora_finalidade_estabelecimento', num(atual['id']), num(atual['versao']), {
        impressora_id: e.impressora,
        copias: e.copias,
        ativo: true,
      });
      return { id: num(atual['id']) };
    }
    return {
      id: await tx.incluir('impressora_finalidade_estabelecimento', {
        estabelecimento_id: ctx.estabelecimento,
        finalidade_impressao_id: e.finalidade,
        unidade_assistencial_id: unidade,
        impressora_id: e.impressora,
        copias: e.copias,
      }),
    };
  },
  alvo: (_e, r) => ({ tabela: 'impressora_finalidade_estabelecimento', id: r.id }),
  eventos: (_e, r) => [{ tipo: 'impressao.padrao.definido', carga: { id: r.id } }],
  trilha: (e) => ({
    dados: { finalidade: e.finalidade, impressora: e.impressora, unidade: e.unidade ?? null },
  }),
});

/** Receitas da impressão ligadas no banco próprio (o mapa OPERACOES da fonte própria as soma). */
export const OPERACOES_IMPRESSAO_PROPRIA = {
  'impressao.vincularEstacao': operacaoVincularEstacao,
  'impressao.registrarReimpressao': operacaoRegistrarReimpressao,
  'impressao.definirPadraoEstabelecimento': operacaoDefinirPadraoEstabelecimento,
} as const;

export const NOMES_OPERACOES_IMPRESSAO_PROPRIA = Object.keys(OPERACOES_IMPRESSAO_PROPRIA);
