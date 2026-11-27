// F3.7 (06-FAT linha 12): a conta parcial por período usada no faturamento, com regra no domínio.
// - Cada item da conta cai num período pela data em que foi realizado; o período do mesmo tipo de lançamento do item
//   vale sobre o período geral (tipo nulo). O item fora de qualquer período fica "sem período", à vista na tela.
// - O resumo por período e competência soma os itens que cobram (o estornado e o transferido saem) e lista as guias
//   TISS em que eles estão: a internação longa é apresentada em faixas, cada uma na sua competência (prática TISS).
// - Fechamento parcial por faixa: o período fecha na ordem (o anterior do mesmo escopo fecha antes), só com a conta
//   aberta e com ao menos um item. Fechado, ele não aceita lançamento com data dentro da faixa nem é retirado.
// - Reabertura com motivo, de trás para a frente (o seguinte do mesmo escopo reabre antes), e nunca com guia do período
//   já num lote TISS. Nada se apaga: o motivo vai à trilha.
import { contaEditavel, type Erros } from './complementos.js';

export interface PeriodoFaixa {
  readonly id: number;
  readonly inicio: string; // ISO data e hora (relógio do hospital)
  readonly fim: string;
  readonly competencia: string; // primeiro dia do mês
  readonly tipoLancamentoId: number | null;
  readonly fechado: boolean;
}

export interface ItemDoPeriodo {
  readonly id: number;
  readonly realizadoEm: string;
  readonly tipoLancamentoId: number | null;
  readonly valorTotal: number;
  readonly guiaTissId: number | null;
  readonly situacao: string;
}

/** Situações do item que não cobram (não entram no resumo do período). */
export const SITUACOES_ITEM_SEM_COBRANCA = ['estornado', 'transferido'] as const;
const cobra = (i: ItemDoPeriodo) => !(SITUACOES_ITEM_SEM_COBRANCA as readonly string[]).includes(i.situacao);

const ms = (iso: string) => new Date(iso).getTime();
const dentro = (p: Pick<PeriodoFaixa, 'inicio' | 'fim'>, iso: string) =>
  ms(p.inicio) <= ms(iso) && ms(iso) <= ms(p.fim);
const mesmoEscopo = (a: PeriodoFaixa, b: PeriodoFaixa) => a.tipoLancamentoId === b.tipoLancamentoId;

/** O período em que o item cai: o do tipo de lançamento do item vale sobre o geral; nulo quando fora de todos. */
export function periodoDoItem(
  periodos: readonly PeriodoFaixa[],
  item: Pick<ItemDoPeriodo, 'realizadoEm' | 'tipoLancamentoId'>,
): PeriodoFaixa | null {
  const candidatos = periodos.filter(
    (p) =>
      dentro(p, item.realizadoEm) &&
      (p.tipoLancamentoId === null || p.tipoLancamentoId === item.tipoLancamentoId),
  );
  return candidatos.find((p) => p.tipoLancamentoId !== null) ?? candidatos[0] ?? null;
}

export interface ResumoFaixa {
  readonly itens: number;
  readonly valor: number;
  readonly guias: number[];
}
export interface ResumoPeriodo extends ResumoFaixa {
  readonly periodoId: number;
  readonly competencia: string;
  readonly fechado: boolean;
}

const r2 = (v: number) => Math.round(v * 100) / 100;
function somar(itens: readonly ItemDoPeriodo[]): ResumoFaixa {
  const guias = [...new Set(itens.map((i) => i.guiaTissId).filter((g): g is number => g !== null))].sort(
    (a, b) => a - b,
  );
  return { itens: itens.length, valor: r2(itens.reduce((s, i) => s + i.valorTotal, 0)), guias };
}

/** Itens, valor e guias de cada período (e o que ficou sem período), só com os itens que cobram. */
export function resumoPorPeriodo(
  periodos: readonly PeriodoFaixa[],
  itens: readonly ItemDoPeriodo[],
): {
  periodos: ResumoPeriodo[];
  semPeriodo: ResumoFaixa;
  porCompetencia: Array<ResumoFaixa & { competencia: string }>;
} {
  const doPeriodo = new Map<number, ItemDoPeriodo[]>(periodos.map((p) => [p.id, []]));
  const sem: ItemDoPeriodo[] = [];
  for (const i of itens.filter(cobra)) {
    const p = periodoDoItem(periodos, i);
    if (p) doPeriodo.get(p.id)!.push(i);
    else sem.push(i);
  }
  const porComp = new Map<string, ItemDoPeriodo[]>();
  for (const p of periodos)
    porComp.set(p.competencia, [...(porComp.get(p.competencia) ?? []), ...doPeriodo.get(p.id)!]);
  return {
    periodos: periodos.map((p) => ({
      periodoId: p.id,
      competencia: p.competencia,
      fechado: p.fechado,
      ...somar(doPeriodo.get(p.id)!),
    })),
    semPeriodo: somar(sem),
    porCompetencia: [...porComp.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([competencia, is]) => ({ competencia, ...somar(is) })),
  };
}

/** Fechamento parcial do período: conta aberta, período aberto, anterior do mesmo escopo fechado e algum item. */
export function validarFechamentoPeriodo(
  conta: { readonly situacao: string },
  periodo: PeriodoFaixa,
  periodos: readonly PeriodoFaixa[],
  itensQueCobram: number,
): Erros {
  const erros: Erros = {};
  if (!contaEditavel(conta.situacao))
    erros['conta'] = 'A conta não está aberta: reabra-a para fechar um período.';
  if (periodo.fechado) erros['periodo'] = 'O período já está fechado.';
  else {
    const anterior = periodos.find(
      (p) =>
        p.id !== periodo.id && mesmoEscopo(p, periodo) && !p.fechado && ms(p.inicio) < ms(periodo.inicio),
    );
    if (anterior) erros['periodo'] = 'Feche antes o período anterior: a conta parcial é faturada em ordem.';
    else if (itensQueCobram <= 0)
      erros['itens'] = 'O período não tem item lançado: não há o que faturar nesta faixa.';
  }
  return erros;
}

/** Reabertura do período: com motivo, o seguinte do mesmo escopo reaberto antes e nenhuma guia dele em lote. */
export function validarReaberturaPeriodo(
  conta: { readonly situacao: string },
  periodo: PeriodoFaixa,
  periodos: readonly PeriodoFaixa[],
  guiasEmLote: number,
  motivo: string,
): Erros {
  const erros: Erros = {};
  if (motivo.trim().length < 5) erros['motivo'] = 'Informe o motivo (ao menos 5 letras).';
  if (!contaEditavel(conta.situacao))
    erros['conta'] = 'A conta não está aberta: reabra-a para reabrir um período.';
  if (!periodo.fechado) erros['periodo'] = 'O período não está fechado.';
  else if (
    periodos.some(
      (p) => p.id !== periodo.id && mesmoEscopo(p, periodo) && p.fechado && ms(p.inicio) > ms(periodo.inicio),
    )
  )
    erros['periodo'] = 'Reabra antes o período seguinte: a reabertura vai do último para o primeiro.';
  else if (guiasEmLote > 0)
    erros['periodo'] = 'Há guia deste período num lote TISS gerado: retire-a do lote antes de reabrir.';
  return erros;
}

/** Retirada do período: o fechado não sai (reabra antes). */
export function validarRetiradaPeriodo(periodo: Pick<PeriodoFaixa, 'fechado'>): Erros {
  return periodo.fechado ? { periodo: 'O período está fechado: reabra-o antes de retirar.' } : {};
}

/** Lançamento numa data e tipo: recusado quando cai num período fechado (devolve o período, ou nulo se aceita). */
export function periodoFechadoDoLancamento(
  periodos: readonly PeriodoFaixa[],
  item: Pick<ItemDoPeriodo, 'realizadoEm' | 'tipoLancamentoId'>,
): PeriodoFaixa | null {
  return (
    periodos.find(
      (p) =>
        p.fechado &&
        dentro(p, item.realizadoEm) &&
        (p.tipoLancamentoId === null || p.tipoLancamentoId === item.tipoLancamentoId),
    ) ?? null
  );
}

/** Uma guia do lote TISS da conta repartida por período fechado (decisão 58 do dono, 27/11). */
export interface GuiaDoPeriodo {
  /** O período fechado da guia; nulo na guia do que sobra (itens fora de qualquer período fechado). */
  readonly periodo: PeriodoFaixa | null;
  readonly itens: readonly number[];
  readonly inicio: string;
  readonly fim: string;
}

/**
 * Lote TISS por período (decisão 58): a conta com período fechado vai ao lote com uma guia por período fechado (só os
 * itens que caem nele, com as datas da faixa) e uma guia com o que sobra (do fim do último período fechado ao fim da
 * conta). Período fechado sem item não gera guia. Sem período fechado, uma guia só, com as datas da conta (como antes).
 */
export function guiasPorPeriodoFechado(
  periodos: readonly PeriodoFaixa[],
  itens: readonly Pick<ItemDoPeriodo, 'id' | 'realizadoEm' | 'tipoLancamentoId'>[],
  conta: { readonly inicio: string; readonly fim: string },
): GuiaDoPeriodo[] {
  const fechados = periodos.filter((p) => p.fechado);
  if (!fechados.length) return [{ periodo: null, itens: itens.map((i) => i.id), ...conta }];
  const porPeriodo = new Map<number, number[]>();
  const resto: Pick<ItemDoPeriodo, 'id' | 'realizadoEm'>[] = [];
  for (const i of itens) {
    const p = periodoDoItem(periodos, i);
    if (p?.fechado) porPeriodo.set(p.id, [...(porPeriodo.get(p.id) ?? []), i.id]);
    else resto.push(i);
  }
  const guias: GuiaDoPeriodo[] = [...fechados]
    .sort((a, b) => ms(a.inicio) - ms(b.inicio) || a.id - b.id)
    .filter((p) => porPeriodo.has(p.id))
    .map((p) => ({ periodo: p, itens: porPeriodo.get(p.id) ?? [], inicio: p.inicio, fim: p.fim }));
  if (resto.length) {
    const corte = fechados.reduce((m, p) => (ms(p.fim) > ms(m) ? p.fim : m), fechados[0]!.fim);
    const depois = resto.every((i) => ms(i.realizadoEm) > ms(corte)) && ms(corte) > ms(conta.inicio);
    guias.push({
      periodo: null,
      itens: resto.map((i) => i.id),
      inicio: depois ? corte : conta.inicio,
      fim: conta.fim,
    });
  }
  return guias;
}
