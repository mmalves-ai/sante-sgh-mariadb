// Referência do empenho no pedido de compra e no título a pagar, com a exportação para o ente (C3-025, 07-FIN linha 132;
// decisão 26/11: a execução orçamentária — programa de trabalho, função, teto, empenho e liquidação — fica no sistema
// contábil único do ente, o SIAFIC do Decreto 10.540/2020, pelo MCASP; o hospital só guarda a referência do empenho que
// recebeu e devolve ao ente o que foi pedido e faturado contra ele). Regras puras; a porta própria grava o que decidem.
//   - O vínculo só vale com empenho em vigor (emitido ou parcial), do mesmo credor do pedido ou do título.
//   - Pedido cancelado, reprovado ou encerrado não recebe empenho; título cancelado também não.
//   - A soma dos títulos ligados ao empenho (os cancelados não contam) não passa do valor empenhado.
//   - A exportação lista, por título ligado, o empenho, o credor, o pedido e o documento, em CSV com ponto e vírgula.
import { type RecusaSuprimentos, recusa, reais } from './recusa.js';

export const SITUACOES_EMPENHO_EM_VIGOR = ['emitido', 'parcial'] as const;
export const SITUACOES_PEDIDO_SEM_EMPENHO = ['cancelado', 'reprovado', 'encerrado'] as const;

export interface EmpenhoReferido {
  readonly situacao: string;
  readonly credor: number;
  readonly valorTotal: number;
}

function conferirEmpenhoEmVigor(e: EmpenhoReferido, credor: number): RecusaSuprimentos | null {
  if (!(SITUACOES_EMPENHO_EM_VIGOR as readonly string[]).includes(e.situacao))
    return recusa('empenho-fora-de-vigor', 'Só o empenho emitido ou parcial pode ser referido.', ['empenho']);
  if (e.credor !== credor)
    return recusa('empenho-credor-diferente', 'O credor do empenho é outro fornecedor.', ['empenho']);
  return null;
}

/** O pedido de compra pode receber a referência do empenho? */
export function conferirVinculoPedidoEmpenho(
  empenho: EmpenhoReferido,
  pedido: { readonly situacao: string; readonly fornecedor: number },
): RecusaSuprimentos | null {
  if ((SITUACOES_PEDIDO_SEM_EMPENHO as readonly string[]).includes(pedido.situacao))
    return recusa('pedido-sem-empenho', 'Pedido cancelado, reprovado ou encerrado não recebe empenho.', [
      'pedido',
    ]);
  return conferirEmpenhoEmVigor(empenho, pedido.fornecedor);
}

/** O título a pagar pode receber a referência do empenho? `jaReferido` é a soma dos outros títulos ligados a ele. */
export function conferirVinculoTituloEmpenho(
  empenho: EmpenhoReferido,
  titulo: { readonly situacao: string; readonly credor: number | null; readonly valorLiquido: number },
  jaReferido: number,
): RecusaSuprimentos | null {
  if (titulo.situacao === 'cancelado')
    return recusa('titulo-cancelado', 'Título cancelado não recebe empenho.', ['titulo']);
  const r = conferirEmpenhoEmVigor(empenho, titulo.credor ?? -1);
  if (r) return r;
  if (reais(jaReferido + titulo.valorLiquido) > reais(empenho.valorTotal))
    return recusa(
      'empenho-sem-saldo',
      `Os títulos ligados somariam ${reais(jaReferido + titulo.valorLiquido).toFixed(2)}, acima do empenho de ${reais(empenho.valorTotal).toFixed(2)}.`,
      ['titulo'],
    );
  return null;
}

/** Saldo do empenho ainda não referido por título (nunca negativo). */
export const saldoReferenciaEmpenho = (valorTotal: number, referido: number): number =>
  Math.max(0, reais(valorTotal - referido));

export interface LinhaExportacaoEmpenho {
  readonly empenho: string;
  readonly emitidoEm: string;
  readonly fonteRecurso: string;
  readonly naturezaDespesa: string | null;
  readonly valorEmpenho: number;
  readonly credorDocumento: string | null;
  readonly credorNome: string;
  readonly pedido: string | null;
  readonly titulo: string | null;
  readonly documento: string | null;
  readonly emissaoDocumento: string | null;
  readonly valorTitulo: number | null;
  readonly situacaoTitulo: string | null;
}

export const CABECALHO_EXPORTACAO_EMPENHO = [
  'empenho',
  'emitido_em',
  'fonte_recurso',
  'natureza_despesa',
  'valor_empenho',
  'credor_documento',
  'credor_nome',
  'pedido',
  'titulo',
  'documento',
  'emissao_documento',
  'valor_titulo',
  'situacao_titulo',
] as const;

const campo = (v: string | number | null): string => {
  if (v === null) return '';
  const s = typeof v === 'number' ? v.toFixed(2) : v.replace(/[\r\n]+/g, ' ');
  return /[;"]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

/** O arquivo para o ente: cabeçalho e uma linha por título ligado (ou pelo empenho, quando ainda não há título). */
export function exportacaoEmpenhoCsv(linhas: readonly LinhaExportacaoEmpenho[]): string {
  const corpo = linhas.map((l) =>
    [
      l.empenho,
      l.emitidoEm,
      l.fonteRecurso,
      l.naturezaDespesa,
      l.valorEmpenho,
      l.credorDocumento,
      l.credorNome,
      l.pedido,
      l.titulo,
      l.documento,
      l.emissaoDocumento,
      l.valorTitulo,
      l.situacaoTitulo,
    ]
      .map(campo)
      .join(';'),
  );
  return [CABECALHO_EXPORTACAO_EMPENHO.join(';'), ...corpo].join('\r\n') + '\r\n';
}
