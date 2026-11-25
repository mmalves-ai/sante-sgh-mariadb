// Lote de trabalho da bancada (F3.5, 05-SADT linha 8): o lote materializado. A bancada abre o lote com os exames em
// análise que ainda não estão num lote em andamento, na ordem do mapa (urgentes primeiro; dentro da urgência, a ordem
// de chegada), até o limite do modelo de mapa; cada exame recebe a sequência e a posição no suporte (a estante de
// tubos). Fechar o lote marca como processado o exame que já saiu da análise e devolve à fila o que ficou pendente
// (ele entra no próximo lote); o retido continua retido até ser solto no mapa. Regra pura: a porta lê e grava.

/** O exame em análise na bancada, candidato ao lote, na ordem de chegada que a porta leu. */
export interface CandidatoAoLote {
  readonly item: number;
  readonly urgente: boolean;
  readonly amostra: number | null;
}

export interface ExameMontadoNoLote {
  readonly item: number;
  readonly amostra: number | null;
  readonly sequencia: number;
  readonly posicaoSuporte: string;
}

/** A posição no suporte: a própria sequência, com três dígitos (o lugar do tubo na estante). */
export function posicaoNoSuporte(sequencia: number): string {
  return String(sequencia).padStart(3, '0');
}

/**
 * Monta o lote: urgentes primeiro, estável dentro da urgência, cortado no limite do modelo de mapa (nulo ou não
 * positivo: lote único com todos). `aPartirDe` é a última sequência já usada no lote (0 no lote novo).
 */
export function montarLote(
  candidatos: readonly CandidatoAoLote[],
  limite: number | null,
  aPartirDe = 0,
): ExameMontadoNoLote[] {
  const vistos = new Set<number>();
  const ordenados = candidatos
    .filter((c) => (vistos.has(c.item) ? false : (vistos.add(c.item), true)))
    .map((c, i) => ({ c, i }))
    .sort((a, b) => Number(b.c.urgente) - Number(a.c.urgente) || a.i - b.i)
    .map((x) => x.c);
  const teto = limite !== null && limite > 0 ? limite : ordenados.length;
  return ordenados.slice(0, teto).map((c, i) => ({
    item: c.item,
    amostra: c.amostra,
    sequencia: aPartirDe + i + 1,
    posicaoSuporte: posicaoNoSuporte(aPartirDe + i + 1),
  }));
}

export type RecusaLote =
  'bancada-inexistente' | 'sem-exames' | 'analista-inexistente' | 'lote-inexistente' | 'lote-encerrado';

/** Situações do lote em andamento (aceita fechar; os seus exames pendentes não entram em outro lote). */
export const LOTE_EM_ANDAMENTO: readonly string[] = ['aberto', 'em_processamento'];

/** Confere a abertura do lote da bancada. */
export function conferirAberturaDoLote(a: {
  readonly bancadaExiste: boolean;
  readonly analistaExiste: boolean;
  readonly candidatos: number;
}): RecusaLote | null {
  if (!a.bancadaExiste) return 'bancada-inexistente';
  if (!a.analistaExiste) return 'analista-inexistente';
  if (a.candidatos <= 0) return 'sem-exames';
  return null;
}

/** Só o lote em andamento fecha (o fechado e o cancelado não mudam mais). */
export function conferirFechamentoDoLote(situacao: string | null): RecusaLote | null {
  if (situacao === null) return 'lote-inexistente';
  return LOTE_EM_ANDAMENTO.includes(situacao) ? null : 'lote-encerrado';
}

/** A impressão vale para o lote em andamento e para o fechado (a reimpressão fica na trilha); o cancelado não. */
export function conferirImpressaoDoLote(situacao: string | null): RecusaLote | null {
  if (situacao === null) return 'lote-inexistente';
  return situacao === 'cancelado' ? 'lote-encerrado' : null;
}

export type SituacaoItemLote = 'pendente' | 'processado' | 'retido' | 'repetir' | 'cancelado';

/** Situações do exame pedido que provam que a bancada o processou (tem resultado). */
export const EXAME_COM_RESULTADO: readonly string[] = [
  'resultado_digitado',
  'revisado',
  'liberado',
  'entregue',
];
/** Situações do exame pedido que o tiram do lote sem resultado. */
export const EXAME_DESFEITO: readonly string[] = ['cancelado', 'recusado'];

/**
 * O destino de cada exame no fechamento do lote. Só o pendente muda: vira "processado" quando o exame já tem
 * resultado (digitado, revisado, liberado ou entregue), "cancelado" quando o exame foi cancelado ou recusado, e
 * continua "pendente" nos demais casos (ainda em análise, ou de volta à coleta: sai do lote fechado e entra no
 * próximo quando estiver em análise). Retido, a repetir, processado e cancelado ficam como estão.
 */
export function situacaoNoFechamento(item: SituacaoItemLote, situacaoExame: string): SituacaoItemLote {
  if (item !== 'pendente') return item;
  if (EXAME_DESFEITO.includes(situacaoExame)) return 'cancelado';
  return EXAME_COM_RESULTADO.includes(situacaoExame) ? 'processado' : 'pendente';
}

export const MENSAGEM_LOTE: Readonly<Record<RecusaLote, string>> = {
  'bancada-inexistente': 'A bancada não existe neste estabelecimento.',
  'sem-exames': 'Não há exame em análise fora de lote nesta bancada.',
  'analista-inexistente': 'O analista informado não existe.',
  'lote-inexistente': 'O lote de trabalho não existe neste estabelecimento.',
  'lote-encerrado': 'O lote de trabalho já foi encerrado.',
};
