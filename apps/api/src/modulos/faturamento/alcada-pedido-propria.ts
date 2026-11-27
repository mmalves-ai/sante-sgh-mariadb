// Pedido e aprovação pela alçada do faturamento (F3.7, 06-FAT linha 38, C1-135), só com o banco próprio. No molde dos
// ajustes da conta (conta-ajustes-propria.ts): quem pede grava o pedido pendente; outro usuário, com a alçada vigente
// do documento (alcada_aprovacao do tipo fat_*) para aquele valor, aprova ou recusa; o fluxo do documento consome a
// aprovação uma vez só. Documentos: reabertura da competência com contas apresentadas (fechamento da competência),
// aceite da glosa (item glosado) e cancelamento da conta (conta do paciente). As regras (quem pede não aprova, faixa
// por valor e cargo) são do domínio, por conferirAlcadaFaturamentoNoBanco.
import { DOCUMENTOS_ALCADA_FATURAMENTO, type DocumentoAlcadaFaturamento } from '@sgh/dominio-faturamento';
import { definirOperacao, recusa, type Executor, type Leitor, type TxOperacao } from '@sgh/nucleo';
import { z } from 'zod';
import { conferirAlcadaFaturamentoNoBanco } from './parametros-faturamento-propria.js';

type Linha = Record<string, unknown>;
const n = (v: unknown) => Number(v ?? 0);
const nn = (v: unknown) => (v === null || v === undefined ? null : Number(v));
const TABELA = 'pedido_alcada_faturamento';

/** A tabela de cada documento e se ela é do estabelecimento (para conferir a referência do pedido). */
const REFERENCIA: Readonly<
  Record<DocumentoAlcadaFaturamento, { tabela: string; doEstabelecimento: boolean }>
> = {
  fat_reabertura_competencia: { tabela: 'fechamento_competencia_fonte_pagadora', doEstabelecimento: true },
  fat_aceite_glosa: { tabela: 'glosa_item', doEstabelecimento: false },
  fat_cancelamento_conta: { tabela: 'conta_hospitalar', doEstabelecimento: true },
};

const documentoValido = (d: string): d is DocumentoAlcadaFaturamento =>
  (DOCUMENTOS_ALCADA_FATURAMENTO as readonly string[]).includes(d);

const esquemaPedir = z.object({
  documento: z.string().max(40),
  referencia: z.number().int().positive(),
  valor: z.number().nonnegative().max(9_999_999_999_999),
  motivo: z.string().trim().min(3).max(250),
});
const esquemaDecidir = z.object({
  pedido: z.number().int().positive(),
  aprovar: z.boolean(),
  motivo: z.string().trim().max(250).optional(),
});

export const opPedirAlcadaFaturamento = definirOperacao({
  nome: 'faturamento.alcada.pedir',
  tabelas: [TABELA],
  entrada: esquemaPedir,
  async gravar(tx, e, ctx) {
    const est = ctx.estabelecimento;
    if (est === null || est === undefined)
      throw recusa('sem-estabelecimento', 'Escolha o estabelecimento da sessão.');
    if (ctx.usuario === null || ctx.usuario === undefined)
      throw recusa('sem-usuario', 'O pedido é de um usuário identificado.');
    if (!documentoValido(e.documento))
      throw recusa('documento-invalido', 'Documento do faturamento sem alçada.', { campos: ['documento'] });
    const ref = REFERENCIA[e.documento];
    const existe = await tx.uma<Linha>(
      `SELECT id FROM ${ref.tabela} WHERE id = ? AND excluido_em IS NULL${ref.doEstabelecimento ? ' AND estabelecimento_id = ?' : ''}`,
      ref.doEstabelecimento ? [e.referencia, est] : [e.referencia],
    );
    if (!existe)
      throw recusa('referencia-inexistente', 'O documento do pedido não existe neste estabelecimento.', {
        campos: ['referencia'],
      });
    const aberto = await tx.consultarParaAtualizar<Linha>(
      `SELECT id FROM ${TABELA} WHERE estabelecimento_id = ? AND documento = ? AND referencia_id = ?
          AND situacao IN ('pendente','aprovado') AND excluido_em IS NULL`,
      [est, e.documento, e.referencia],
    );
    if (aberto.length)
      throw recusa('pedido-em-aberto', 'Já há um pedido pendente ou aprovado para este documento.');
    const agora = new Date();
    const id = await tx.incluir(TABELA, {
      estabelecimento_id: est,
      documento: e.documento,
      referencia_tabela: ref.tabela,
      referencia_id: e.referencia,
      valor: e.valor,
      motivo: e.motivo,
      situacao: 'pendente',
      solicitado_por_usuario_id: ctx.usuario,
      solicitado_em: agora,
    });
    return { pedido: id, situacao: 'pendente' };
  },
  alvo: (_e, r) => ({ tabela: TABELA, id: n(r['pedido']) }),
  trilha: (e) => ({
    motivo: e.motivo,
    dados: { documento: e.documento, referencia: e.referencia, valor: e.valor },
  }),
});

export const opDecidirAlcadaFaturamento = definirOperacao({
  nome: 'faturamento.alcada.decidir',
  tabelas: [TABELA],
  entrada: esquemaDecidir,
  async gravar(tx, e, ctx) {
    const est = ctx.estabelecimento;
    if (est === null || est === undefined)
      throw recusa('sem-estabelecimento', 'Escolha o estabelecimento da sessão.');
    const [p] = await tx.consultarParaAtualizar<Linha>(
      `SELECT id, versao, documento, valor, situacao, solicitado_por_usuario_id FROM ${TABELA}
        WHERE id = ? AND estabelecimento_id = ? AND excluido_em IS NULL`,
      [e.pedido, est],
    );
    if (!p) throw recusa('pedido-inexistente', 'Pedido de alçada não encontrado neste estabelecimento.');
    if (p['situacao'] !== 'pendente') throw recusa('pedido-decidido', 'Este pedido já foi decidido.');
    const solicitante = n(p['solicitado_por_usuario_id']);
    if (ctx.usuario === null || ctx.usuario === undefined || ctx.usuario === solicitante)
      throw recusa('quem-pede-nao-aprova', 'Quem pede não aprova: peça a outro usuário com a alçada.');
    let nivel: number | null = null;
    if (e.aprovar) {
      const r = await conferirAlcadaFaturamentoNoBanco(
        tx,
        est,
        String(p['documento']),
        n(p['valor']),
        solicitante,
        ctx.usuario,
      );
      if (!r.pode) throw recusa('fora-da-alcada', r.motivo ?? 'Fora da sua alçada.');
      nivel = r.nivel;
    } else if (!e.motivo || e.motivo.length < 3)
      throw recusa('motivo-obrigatorio', 'Informe o motivo da recusa.', { campos: ['motivo'] });
    await tx.alterar(TABELA, n(p['id']), n(p['versao']), {
      situacao: e.aprovar ? 'aprovado' : 'recusado',
      decidido_por_usuario_id: ctx.usuario,
      decidido_em: new Date(),
      nivel_alcada: nivel,
      motivo_decisao: e.motivo ?? null,
    });
    return { pedido: n(p['id']), situacao: e.aprovar ? 'aprovado' : 'recusado', nivel };
  },
  alvo: (_e, r) => ({ tabela: TABELA, id: n(r['pedido']) }),
  trilha: (e) => ({ dados: { aprovar: e.aprovar, motivo: e.motivo ?? null } }),
});

/**
 * O fluxo do documento consome a aprovação (na mesma transação dele): exige um pedido aprovado para a referência, com
 * valor aprovado que cubra o valor de agora, e o marca como usado (vale uma vez). Sem ele, recusa dizendo o que fazer.
 * A operação que chama declara `pedido_alcada_faturamento` nas suas tabelas.
 */
export async function consumirAprovacaoAlcada(
  tx: Pick<TxOperacao, 'consultarParaAtualizar' | 'alterar'>,
  est: number,
  documento: DocumentoAlcadaFaturamento,
  referencia: number,
  valorAtual: number,
): Promise<number> {
  const [p] = await tx.consultarParaAtualizar<Linha>(
    `SELECT id, versao, valor FROM ${TABELA}
      WHERE estabelecimento_id = ? AND documento = ? AND referencia_id = ? AND situacao = 'aprovado'
        AND excluido_em IS NULL ORDER BY id DESC LIMIT 1`,
    [est, documento, referencia],
  );
  if (!p)
    throw recusa(
      'alcada-pendente',
      'Este documento passa pela alçada do faturamento: peça a aprovação em Faturamento > Aprovações de alçada e espere outro usuário aprovar.',
    );
  if (valorAtual > n(p['valor']) + 0.005)
    throw recusa(
      'alcada-valor-mudou',
      `O valor mudou desde a aprovação (aprovado ${n(p['valor']).toFixed(2)}, agora ${valorAtual.toFixed(2)}): peça de novo.`,
    );
  await tx.alterar(TABELA, n(p['id']), n(p['versao']), { situacao: 'usado', usado_em: new Date() });
  return n(p['id']);
}

export interface PedidoAlcadaLido {
  readonly id: number;
  readonly documento: string;
  readonly referencia: number;
  readonly valor: number;
  readonly motivo: string;
  readonly situacao: string;
  readonly solicitante: number;
  readonly solicitanteNome: string | null;
  readonly solicitadoEm: string;
  readonly decisor: number | null;
  readonly decisorNome: string | null;
  readonly decididoEm: string | null;
  readonly nivel: number | null;
  readonly motivoDecisao: string | null;
}

const iso = (v: unknown) => (v instanceof Date ? v.toISOString() : v ? String(v) : null);

/** Os pedidos do estabelecimento (os pendentes primeiro), opcionalmente de uma situação. */
export async function listarPedidosAlcada(
  l: Pick<Leitor, 'consultar'>,
  est: number,
  situacao: string | null,
): Promise<PedidoAlcadaLido[]> {
  const r = await l.consultar<Linha>(
    `SELECT p.id, p.documento, p.referencia_id, p.valor, p.motivo, p.situacao, p.solicitado_por_usuario_id,
            us.nome AS solicitante_nome, p.solicitado_em, p.decidido_por_usuario_id, ud.nome AS decisor_nome,
            p.decidido_em, p.nivel_alcada, p.motivo_decisao
       FROM ${TABELA} p
       LEFT JOIN usuario us ON us.id = p.solicitado_por_usuario_id
       LEFT JOIN usuario ud ON ud.id = p.decidido_por_usuario_id
      WHERE p.estabelecimento_id = ? AND p.excluido_em IS NULL AND (? IS NULL OR p.situacao = ?)
      ORDER BY p.situacao = 'pendente' DESC, p.id DESC`,
    [est, situacao, situacao],
    { teto: 200 },
  );
  return r.map((x) => ({
    id: n(x['id']),
    documento: String(x['documento']),
    referencia: n(x['referencia_id']),
    valor: n(x['valor']),
    motivo: String(x['motivo']),
    situacao: String(x['situacao']),
    solicitante: n(x['solicitado_por_usuario_id']),
    solicitanteNome: x['solicitante_nome'] ? String(x['solicitante_nome']) : null,
    solicitadoEm: iso(x['solicitado_em']) ?? '',
    decisor: nn(x['decidido_por_usuario_id']),
    decisorNome: x['decisor_nome'] ? String(x['decisor_nome']) : null,
    decididoEm: iso(x['decidido_em']),
    nivel: nn(x['nivel_alcada']),
    motivoDecisao: x['motivo_decisao'] ? String(x['motivo_decisao']) : null,
  }));
}

const executar = async (
  executor: Executor,
  op: unknown,
  ctx: Parameters<Executor['executar']>[3],
  entrada: unknown,
): Promise<Record<string, unknown>> =>
  (await executor.executar(op as Parameters<Executor['executar']>[0], ctx.cliente, entrada, ctx))
    .resultado as Record<string, unknown>;

export const pedirAlcadaFaturamento = (
  executor: Executor,
  ctx: Parameters<Executor['executar']>[3],
  entrada: unknown,
) => executar(executor, opPedirAlcadaFaturamento, ctx, entrada);

export const decidirAlcadaFaturamento = (
  executor: Executor,
  ctx: Parameters<Executor['executar']>[3],
  entrada: unknown,
) => executar(executor, opDecidirAlcadaFaturamento, ctx, entrada);
