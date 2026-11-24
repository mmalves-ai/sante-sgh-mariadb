// Mapa de trabalho da bancada (F3.5, 05-SADT linha 8): os exames a digitar distribuídos pela bancada do exame (o
// modelo de mapa do setor diz em que bancada cada exame roda), os urgentes primeiro, os lotes pelo limite do modelo e
// os exames retidos à vista, com o motivo, fora da contagem do lote. Regra pura: a porta lê, o domínio decide.

/** O exame pedido no mapa: o id do item, o exame do catálogo e a urgência. */
export interface ExameNoMapa {
  readonly id: number;
  readonly exame: { readonly id: number | null };
  readonly urgente: boolean;
}

/** A bancada de um exame do catálogo pelo modelo de mapa (a menor ordem vence quando há mais de um modelo). */
export interface BancadaDoExame {
  readonly exame: number;
  readonly bancada: number;
  readonly nome: string;
  readonly limite: number | null;
  readonly ordem: number;
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
  readonly urgentes: number;
  /** Exames por lote no modelo de mapa (nulo: lote único). */
  readonly limite: number | null;
  /** Lotes de trabalho que os exames a processar (não retidos) ocupam. */
  readonly lotes: number;
  readonly exames: E[];
  readonly retidos: { readonly exame: number; readonly motivo: string }[];
}

export const NOME_SEM_BANCADA = 'Sem bancada';

/** Distribui os exames pelas bancadas: urgentes primeiro, retidos marcados e fora do lote, "Sem bancada" no fim. */
export function distribuirPorBancada<E extends ExameNoMapa>(
  exames: readonly E[],
  bancadas: readonly BancadaDoExame[],
  retencoes: readonly Retencao[],
): BancadaDistribuida<E>[] {
  const doExame = new Map<number, BancadaDoExame>();
  for (const b of [...bancadas].sort((a, b) => a.ordem - b.ordem || a.bancada - b.bancada))
    if (!doExame.has(b.exame)) doExame.set(b.exame, b);
  const retido = new Map(retencoes.map((r) => [r.item, r.motivo]));
  const grupos = new Map<number | null, { nome: string; limite: number | null; exames: E[] }>();
  for (const e of exames) {
    const b = e.exame.id === null ? undefined : doExame.get(e.exame.id);
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
    const retidos = ordenados
      .filter((e) => retido.has(e.id))
      .map((e) => ({ exame: e.id, motivo: retido.get(e.id)! }));
    const aProcessar = ordenados.length - retidos.length;
    const limite = g.limite !== null && g.limite > 0 ? g.limite : null;
    return {
      codigo,
      nome: g.nome,
      urgentes: ordenados.filter((e) => e.urgente).length,
      limite,
      lotes: aProcessar === 0 ? 0 : limite === null ? 1 : Math.ceil(aProcessar / limite),
      exames: ordenados,
      retidos,
    };
  });
  return saida.sort((a, b) =>
    a.codigo === null ? 1 : b.codigo === null ? -1 : a.nome.localeCompare(b.nome, 'pt-BR'),
  );
}

export type RecusaRetencao = 'motivo-curto' | 'exame-fechado' | 'ja-retido' | 'nao-retido' | 'sem-bancada';

/** As situações do exame pedido que ainda estão na bancada (pode reter ou soltar). */
export const SITUACOES_NA_BANCADA: readonly string[] = ['solicitado', 'coletado', 'em_analise'];

/** Confere a retenção (reter=true) ou a volta à fila (reter=false) do exame na bancada. */
export function conferirRetencao(a: {
  readonly reter: boolean;
  readonly motivo: string | null;
  readonly situacaoExame: string;
  readonly retidoAgora: boolean;
  readonly temBancada: boolean;
}): RecusaRetencao | null {
  if (!SITUACOES_NA_BANCADA.includes(a.situacaoExame)) return 'exame-fechado';
  if (a.reter) {
    if ((a.motivo ?? '').trim().length < 5) return 'motivo-curto';
    if (a.retidoAgora) return 'ja-retido';
    if (!a.temBancada) return 'sem-bancada';
    return null;
  }
  return a.retidoAgora ? null : 'nao-retido';
}

export const MENSAGEM_RETENCAO: Readonly<Record<RecusaRetencao, string>> = {
  'motivo-curto': 'Informe o motivo da retenção (ao menos 5 letras).',
  'exame-fechado': 'O exame já saiu da bancada (liberado, cancelado ou com resultado fechado).',
  'ja-retido': 'O exame já está retido.',
  'nao-retido': 'O exame não está retido.',
  'sem-bancada': 'O exame não tem bancada no modelo de mapa do setor: cadastre a bancada antes de reter.',
};
