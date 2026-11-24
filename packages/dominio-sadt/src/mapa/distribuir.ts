// Mapa de trabalho da bancada (F3.5, 05-SADT linha 8): os exames a digitar distribuídos pela bancada do exame (o
// modelo de mapa do setor do exame pedido diz em que bancada ele roda), os urgentes primeiro, os lotes pelo limite do
// modelo e os exames retidos à parte, com o motivo, fora da contagem do lote e dos urgentes. Regra pura: a porta lê
// as bancadas candidatas (só do setor do exame pedido, no estabelecimento da sessão), o domínio escolhe e distribui.

/** O exame pedido no mapa: o id do item, o exame do catálogo e a urgência. */
export interface ExameNoMapa {
  readonly id: number;
  readonly exame: { readonly id: number | null };
  readonly urgente: boolean;
}

/**
 * Bancada candidata de um exame pedido: um modelo de mapa ativo do setor do exame pedido que contém o exame do
 * catálogo, com a bancada ativa do mesmo setor. A porta só lê candidatas do estabelecimento da sessão.
 */
export interface BancadaDoItem {
  readonly item: number;
  readonly bancada: number;
  readonly nome: string;
  readonly limite: number | null;
  /** O modelo de mapa (id): critério de escolha quando o setor tem mais de um modelo com o exame. */
  readonly modelo: number;
}

/** O exame pedido retido na bancada, com o motivo. */
export interface Retencao {
  readonly item: number;
  readonly motivo: string;
}

export interface BancadaDistribuida<E extends ExameNoMapa> {
  /** A bancada (id); nulo para os exames sem bancada no modelo de mapa. */
  readonly codigo: number | null;
  readonly nome: string;
  /** Urgentes a processar (os retidos ficam fora). */
  readonly urgentes: number;
  /** Exames por lote no modelo de mapa (nulo: lote único). */
  readonly limite: number | null;
  /** Lotes de trabalho que os exames a processar (não retidos) ocupam. */
  readonly lotes: number;
  /** Os exames a processar, urgentes primeiro (os retidos não entram). */
  readonly exames: E[];
  /** Os retidos, com o motivo: fora da fila até serem soltos. */
  readonly retidos: (E & { readonly motivo: string })[];
}

export const NOME_SEM_BANCADA = 'Sem bancada';

/**
 * Escolhe a bancada do exame pedido entre as candidatas. Regra explícita: o modelo de mapa mais antigo do setor (menor
 * id) vence; no empate, a menor bancada. Sem candidata, nulo ("Sem bancada").
 */
export function escolherBancada(candidatas: readonly BancadaDoItem[]): BancadaDoItem | null {
  let melhor: BancadaDoItem | null = null;
  for (const b of candidatas)
    if (
      melhor === null ||
      b.modelo < melhor.modelo ||
      (b.modelo === melhor.modelo && b.bancada < melhor.bancada)
    )
      melhor = b;
  return melhor;
}

/** Distribui os exames pelas bancadas: urgentes primeiro, retidos à parte e fora do lote, "Sem bancada" no fim. */
export function distribuirPorBancada<E extends ExameNoMapa>(
  exames: readonly E[],
  bancadas: readonly BancadaDoItem[],
  retencoes: readonly Retencao[],
): BancadaDistribuida<E>[] {
  const porItem = new Map<number, BancadaDoItem[]>();
  for (const b of bancadas) porItem.set(b.item, [...(porItem.get(b.item) ?? []), b]);
  const retido = new Map(retencoes.map((r) => [r.item, r.motivo]));
  const grupos = new Map<number | null, { nome: string; limite: number | null; exames: E[] }>();
  for (const e of exames) {
    const b = escolherBancada(porItem.get(e.id) ?? []);
    const k = b?.bancada ?? null;
    const g = grupos.get(k) ?? { nome: b?.nome ?? NOME_SEM_BANCADA, limite: b?.limite ?? null, exames: [] };
    g.exames.push(e);
    grupos.set(k, g);
  }
  const saida = [...grupos].map(([codigo, g]) => {
    // Estável: dentro da urgência, a ordem de chegada que a porta leu.
    const ordenados = g.exames
      .map((e, i) => ({ e, i }))
      .sort((a, b) => Number(b.e.urgente) - Number(a.e.urgente) || a.i - b.i)
      .map((x) => x.e);
    const aProcessar = ordenados.filter((e) => !retido.has(e.id));
    const retidos = ordenados
      .filter((e) => retido.has(e.id))
      .map((e) => ({ ...e, motivo: retido.get(e.id)! }));
    const limite = g.limite !== null && g.limite > 0 ? g.limite : null;
    const n = aProcessar.length;
    return {
      codigo,
      nome: g.nome,
      urgentes: aProcessar.filter((e) => e.urgente).length,
      limite,
      lotes: n === 0 ? 0 : limite === null ? 1 : Math.ceil(n / limite),
      exames: aProcessar,
      retidos,
    };
  });
  return saida.sort((a, b) =>
    a.codigo === null ? 1 : b.codigo === null ? -1 : a.nome.localeCompare(b.nome, 'pt-BR'),
  );
}

export type RecusaRetencao = 'motivo-curto' | 'exame-fechado' | 'ja-retido' | 'nao-retido' | 'sem-bancada';

/** A situação do exame pedido que o mapa mostra (a digitar): só ela pode ser retida. */
export const SITUACOES_NA_BANCADA: readonly string[] = ['em_analise'];

/**
 * Confere a retenção (reter=true) ou a volta à fila (reter=false) do exame na bancada. Reter só o exame que está no
 * mapa (em análise). Soltar vale em qualquer situação do exame: assim a retenção de um exame cancelado (ou que saiu da
 * bancada por outro caminho) sempre se fecha.
 */
export function conferirRetencao(a: {
  readonly reter: boolean;
  readonly motivo: string | null;
  readonly situacaoExame: string;
  readonly retidoAgora: boolean;
  readonly temBancada: boolean;
}): RecusaRetencao | null {
  if (!a.reter) return a.retidoAgora ? null : 'nao-retido';
  if (!SITUACOES_NA_BANCADA.includes(a.situacaoExame)) return 'exame-fechado';
  if ((a.motivo ?? '').trim().length < 5) return 'motivo-curto';
  if (a.retidoAgora) return 'ja-retido';
  if (!a.temBancada) return 'sem-bancada';
  return null;
}

/**
 * O efeito da retenção sobre o exame: o retido não recebe resultado nem é liberado até ser solto na bancada. A
 * digitação e a liberação do banco chamam esta regra (05-SADT linha 10) antes de gravar.
 */
export function conferirAvancoDoRetido(retido: boolean): 'exame-retido' | null {
  return retido ? 'exame-retido' : null;
}

export const MENSAGEM_RETENCAO: Readonly<Record<RecusaRetencao | 'exame-retido', string>> = {
  'motivo-curto': 'Informe o motivo da retenção (ao menos 5 letras).',
  'exame-fechado': 'Só o exame em análise na bancada pode ser retido.',
  'ja-retido': 'O exame já está retido.',
  'nao-retido': 'O exame não está retido.',
  'sem-bancada': 'O exame não tem bancada no modelo de mapa do setor: cadastre a bancada antes de reter.',
  'exame-retido': 'O exame está retido na bancada: solte-o no mapa de trabalho antes de digitar ou liberar.',
};
