// Referência do empenho no pedido de compra e no título a pagar, com a exportação para o ente (C3-025, 07-FIN linha 132).
// Decisão 26/11: o Sante não executa o orçamento público (programa de trabalho, função, teto, empenho e liquidação ficam
// no sistema contábil único do ente, Decreto 10.540/2020, pelo MCASP); guarda só a referência do empenho recebido (a
// tabela empenho, emitida em ata-empenho.ts) no pedido (pedido_compra.empenho_id) e no título (titulo_pagar.empenho_id) e
// devolve ao ente, em CSV, o que foi pedido e faturado contra cada empenho. A regra pura mora em
// `@sgh/contratos/regras-suprimentos` (referencia-empenho); aqui ficam a gravação (pela PortaAtaEmpenhoPropria, no
// Executor do núcleo: versão conferida, trilha na mesma transação, Idempotency-Key) e as leituras.
import {
  conferirVinculoPedidoEmpenho,
  conferirVinculoTituloEmpenho,
  type EmpenhoReferido,
  exportacaoEmpenhoCsv,
  type LinhaExportacaoEmpenho,
  type RecusaSuprimentos,
  saldoReferenciaEmpenho,
} from '@sgh/contratos/regras-suprimentos';
import { type Linha, recusa, type TxOperacao } from '@sgh/nucleo';
import { z } from 'zod';
import { ErroProblema } from '../../problema.filter.js';

export const OPERACAO_REFERIR_PEDIDO = 'suprimentos.empenho.referir-pedido';
export const OPERACAO_REFERIR_TITULO = 'suprimentos.empenho.referir-titulo';
export const TABELAS_REFERIR_PEDIDO = ['pedido_compra', 'empenho'] as const;
export const TABELAS_REFERIR_TITULO = ['titulo_pagar', 'empenho'] as const;

export const esquemaReferenciaEmpenho = z
  .object({ id: z.number().int().positive(), versao: z.number().int().positive() })
  .strict();
export type EntradaReferenciaEmpenho = z.infer<typeof esquemaReferenciaEmpenho>;

const dataIso = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
export const esquemaPeriodoExportacao = z
  .object({ inicio: dataIso, fim: dataIso })
  .strict()
  .refine((p) => p.fim >= p.inicio, { message: 'O fim vem depois do início.', path: ['fim'] });

export interface ReferenciaPedidoVisao {
  readonly id: number;
  readonly numero: string;
  readonly situacao: string;
}
export interface ReferenciaTituloVisao {
  readonly id: number;
  readonly numero: string;
  readonly documento: string;
  readonly valorLiquido: number;
  readonly situacao: string;
}
export interface ReferenciasEmpenhoVisao {
  readonly empenho: number;
  readonly numero: string;
  readonly valorTotal: number;
  readonly referido: number;
  readonly saldo: number;
  readonly pedidos: readonly ReferenciaPedidoVisao[];
  readonly titulos: readonly ReferenciaTituloVisao[];
}
export interface CandidatoReferencia {
  readonly id: number;
  readonly rotulo: string;
  readonly versao: number;
  readonly valor: number | null;
}
export interface CandidatosReferenciaVisao {
  readonly pedidos: readonly CandidatoReferencia[];
  readonly titulos: readonly CandidatoReferencia[];
}
export type ResultadoReferencia = {
  readonly id: number;
  readonly numero: string;
  readonly itens: number;
  readonly valorTotal: number;
};

type Leitor = {
  consultar<T extends Linha = Linha>(sql: string, p?: readonly unknown[]): Promise<T[]>;
  uma<T extends Linha = Linha>(sql: string, p?: readonly unknown[]): Promise<T | null>;
};

const n = (v: unknown) => Number(v ?? 0);
const t = (v: unknown) => (v === null || v === undefined ? '' : String(v));
const tn = (v: unknown) => (v === null || v === undefined || v === '' ? null : String(v));
const dia = (v: unknown): string =>
  v instanceof Date
    ? `${v.getFullYear()}-${String(v.getMonth() + 1).padStart(2, '0')}-${String(v.getDate()).padStart(2, '0')}`
    : t(v).slice(0, 10);

function recusar(r: RecusaSuprimentos | null): void {
  if (r) throw recusa(r.codigo, r.mensagem, r.campos ? { campos: [...r.campos] } : undefined);
}
const naoEncontrado = (o: string) =>
  new ErroProblema('nao-encontrado', 404, `${o} não encontrado`, `O ${o.toLowerCase()} não existe.`);

/** A soma dos títulos não cancelados ligados ao empenho, menos o título informado. */
const SQL_REFERIDO = `SELECT COALESCE(SUM(valor_liquido), 0) AS v FROM titulo_pagar
   WHERE empenho_id = ? AND excluido_em IS NULL AND situacao <> 'cancelado' AND id <> ?`;

async function empenhoTravado(
  tx: TxOperacao,
  est: number,
  empenho: number,
): Promise<EmpenhoReferido & { numero: string }> {
  const e = (
    await tx.consultarParaAtualizar<Linha>(
      `SELECT numero_empenho, situacao, empresa_fornecedora_id, valor_total FROM empenho
        WHERE id = ? AND estabelecimento_id = ? AND excluido_em IS NULL`,
      [empenho, est],
    )
  )[0];
  if (!e) throw naoEncontrado('Empenho');
  return {
    numero: t(e['numero_empenho']),
    situacao: t(e['situacao']),
    credor: n(e['empresa_fornecedora_id']),
    valorTotal: n(e['valor_total']),
  };
}

export async function referirPedido(
  tx: TxOperacao,
  est: number,
  empenho: number,
  x: EntradaReferenciaEmpenho,
): Promise<ResultadoReferencia> {
  const e = await empenhoTravado(tx, est, empenho);
  const p = await tx.uma<Linha>(
    `SELECT situacao, empresa_fornecedora_id FROM pedido_compra
      WHERE id = ? AND estabelecimento_id = ? AND excluido_em IS NULL`,
    [x.id, est],
  );
  if (!p) throw naoEncontrado('Pedido');
  recusar(
    conferirVinculoPedidoEmpenho(e, {
      situacao: t(p['situacao']),
      fornecedor: n(p['empresa_fornecedora_id']),
    }),
  );
  await tx.alterar('pedido_compra', x.id, x.versao, { empenho_id: empenho });
  const c = await tx.uma<Linha>(
    'SELECT COUNT(*) AS q FROM pedido_compra WHERE empenho_id = ? AND excluido_em IS NULL',
    [empenho],
  );
  return { id: x.id, numero: e.numero, itens: n(c?.['q']), valorTotal: e.valorTotal };
}

export async function referirTitulo(
  tx: TxOperacao,
  est: number,
  empenho: number,
  x: EntradaReferenciaEmpenho,
): Promise<ResultadoReferencia> {
  const e = await empenhoTravado(tx, est, empenho);
  const ti = await tx.uma<Linha>(
    `SELECT situacao, empresa_fornecedora_id, valor_liquido FROM titulo_pagar
      WHERE id = ? AND estabelecimento_id = ? AND excluido_em IS NULL`,
    [x.id, est],
  );
  if (!ti) throw naoEncontrado('Título');
  const ja = n((await tx.uma<Linha>(SQL_REFERIDO, [empenho, x.id]))?.['v']);
  const valor = n(ti['valor_liquido']);
  recusar(
    conferirVinculoTituloEmpenho(
      e,
      {
        situacao: t(ti['situacao']),
        credor: ti['empresa_fornecedora_id'] === null ? null : n(ti['empresa_fornecedora_id']),
        valorLiquido: valor,
      },
      ja,
    ),
  );
  await tx.alterar('titulo_pagar', x.id, x.versao, { empenho_id: empenho });
  return { id: x.id, numero: e.numero, itens: 1, valorTotal: Math.round((ja + valor) * 100) / 100 };
}

export async function lerReferencias(
  l: Leitor,
  est: number,
  empenho: number,
): Promise<ReferenciasEmpenhoVisao> {
  const e = await l.uma<Linha>(
    'SELECT numero_empenho, valor_total FROM empenho WHERE id = ? AND estabelecimento_id = ? AND excluido_em IS NULL',
    [empenho, est],
  );
  if (!e) throw naoEncontrado('Empenho');
  const pedidos = await l.consultar<Linha>(
    `SELECT id, ano, numero, situacao FROM pedido_compra
      WHERE empenho_id = ? AND estabelecimento_id = ? AND excluido_em IS NULL ORDER BY ano, numero`,
    [empenho, est],
  );
  const titulos = await l.consultar<Linha>(
    `SELECT id, numero, numero_documento, valor_liquido, situacao FROM titulo_pagar
      WHERE empenho_id = ? AND estabelecimento_id = ? AND excluido_em IS NULL ORDER BY data_emissao, id`,
    [empenho, est],
  );
  const referido =
    Math.round(
      titulos.filter((x) => t(x['situacao']) !== 'cancelado').reduce((s, x) => s + n(x['valor_liquido']), 0) *
        100,
    ) / 100;
  return {
    empenho,
    numero: t(e['numero_empenho']),
    valorTotal: n(e['valor_total']),
    referido,
    saldo: saldoReferenciaEmpenho(n(e['valor_total']), referido),
    pedidos: pedidos.map((p) => ({
      id: n(p['id']),
      numero: `${t(p['ano'])}/${t(p['numero'])}`,
      situacao: t(p['situacao']),
    })),
    titulos: titulos.map((x) => ({
      id: n(x['id']),
      numero: t(x['numero']),
      documento: t(x['numero_documento']),
      valorLiquido: n(x['valor_liquido']),
      situacao: t(x['situacao']),
    })),
  };
}

/** Pedidos e títulos do mesmo credor ainda sem empenho, pelo termo (número do pedido, do título ou do documento). */
export async function lerCandidatos(
  l: Leitor,
  est: number,
  empenho: number,
  termo: string,
): Promise<CandidatosReferenciaVisao> {
  const e = await l.uma<Linha>(
    'SELECT empresa_fornecedora_id FROM empenho WHERE id = ? AND estabelecimento_id = ? AND excluido_em IS NULL',
    [empenho, est],
  );
  if (!e) throw naoEncontrado('Empenho');
  const credor = n(e['empresa_fornecedora_id']);
  const q = `%${termo.trim().slice(0, 30)}%`;
  const pedidos = await l.consultar<Linha>(
    `SELECT id, ano, numero, data_pedido, versao FROM pedido_compra
      WHERE estabelecimento_id = ? AND empresa_fornecedora_id = ? AND empenho_id IS NULL AND excluido_em IS NULL
        AND situacao NOT IN ('cancelado','reprovado','encerrado') AND CONCAT(ano, '/', numero) LIKE ?
      ORDER BY data_pedido DESC, id DESC LIMIT 30`,
    [est, credor, q],
  );
  const titulos = await l.consultar<Linha>(
    `SELECT id, numero, numero_documento, valor_liquido, versao FROM titulo_pagar
      WHERE estabelecimento_id = ? AND empresa_fornecedora_id = ? AND empenho_id IS NULL AND excluido_em IS NULL
        AND situacao <> 'cancelado' AND (numero LIKE ? OR numero_documento LIKE ?)
      ORDER BY data_emissao DESC, id DESC LIMIT 30`,
    [est, credor, q, q],
  );
  return {
    pedidos: pedidos.map((p) => ({
      id: n(p['id']),
      rotulo: `${t(p['ano'])}/${t(p['numero'])} · ${dia(p['data_pedido'])}`,
      versao: n(p['versao']),
      valor: null,
    })),
    titulos: titulos.map((x) => ({
      id: n(x['id']),
      rotulo: `${t(x['numero'])} · ${t(x['numero_documento'])}`,
      versao: n(x['versao']),
      valor: n(x['valor_liquido']),
    })),
  };
}

/** O CSV para o ente: os empenhos emitidos no período, uma linha por título ligado (ou só o empenho, sem título). */
export async function lerExportacao(l: Leitor, est: number, inicio: string, fim: string): Promise<string> {
  const linhas = await l.consultar<Linha>(
    `SELECT e.numero_empenho, e.emitido_em, e.fonte_recurso, e.natureza_despesa, e.valor_total,
            ef.cnpj, ef.razao_social, tp.numero AS titulo, tp.numero_documento, tp.data_emissao, tp.valor_liquido,
            tp.situacao AS situacao_titulo,
            (SELECT CONCAT(pc.ano, '/', pc.numero) FROM pedido_compra pc
              WHERE pc.empenho_id = e.id AND pc.excluido_em IS NULL ORDER BY pc.ano, pc.numero LIMIT 1) AS pedido
       FROM empenho e
       JOIN empresa_fornecedora ef ON ef.id = e.empresa_fornecedora_id
       LEFT JOIN titulo_pagar tp ON tp.empenho_id = e.id AND tp.excluido_em IS NULL
      WHERE e.estabelecimento_id = ? AND e.excluido_em IS NULL AND e.emitido_em BETWEEN ? AND ?
      ORDER BY e.emitido_em, e.numero_empenho, tp.data_emissao, tp.id`,
    [est, inicio, fim],
  );
  return exportacaoEmpenhoCsv(
    linhas.map((r): LinhaExportacaoEmpenho => ({
      empenho: t(r['numero_empenho']),
      emitidoEm: dia(r['emitido_em']),
      fonteRecurso: t(r['fonte_recurso']),
      naturezaDespesa: tn(r['natureza_despesa']),
      valorEmpenho: n(r['valor_total']),
      credorDocumento: tn(r['cnpj']),
      credorNome: t(r['razao_social']),
      pedido: tn(r['pedido']),
      titulo: tn(r['titulo']),
      documento: tn(r['numero_documento']),
      emissaoDocumento:
        r['data_emissao'] === null || r['data_emissao'] === undefined ? null : dia(r['data_emissao']),
      valorTitulo:
        r['valor_liquido'] === null || r['valor_liquido'] === undefined ? null : n(r['valor_liquido']),
      situacaoTitulo: tn(r['situacao_titulo']),
    })),
  );
}
