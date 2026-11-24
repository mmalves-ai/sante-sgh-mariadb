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

export const esquemaRegistrarReimpressao = z
  .object({
    entidade: z
      .string()
      .regex(/^[a-z][a-z0-9_]{1,63}$/)
      .max(64),
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
    const r = conferirVinculoEstacao({
      estacaoEstabelecimento: est?.estabelecimento ?? null,
      impressora: imp ? { estabelecimento: num(imp['estabelecimento_id']), ativa: bool(imp['ativo']) } : null,
      finalidadeAtiva: fin ? bool(fin['ativo']) : null,
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
    const [ultima] = await tx.consultarParaAtualizar(
      `SELECT MAX(via) AS via FROM registro_reimpressao
        WHERE entidade = ? AND entidade_id = ? AND estabelecimento_id = ?`,
      [e.entidade, e.entidadeId, ctx.estabelecimento],
    );
    // A 1ª impressão é a via 1; sem reimpressão anterior, a reimpressão é a via 2.
    const viasAnteriores = ultima && ultima['via'] !== null ? num(ultima['via']) : 1;
    const p = planoReimpressao({
      viasAnteriores,
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

/** Receitas da impressão ligadas no banco próprio (o mapa OPERACOES da fonte própria as soma). */
export const OPERACOES_IMPRESSAO_PROPRIA = {
  'impressao.vincularEstacao': operacaoVincularEstacao,
  'impressao.registrarReimpressao': operacaoRegistrarReimpressao,
} as const;

export const NOMES_OPERACOES_IMPRESSAO_PROPRIA = Object.keys(OPERACOES_IMPRESSAO_PROPRIA);
