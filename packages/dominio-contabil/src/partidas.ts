// Regra 5 (SPED contábil; cap-07 §7.2, "Balancete"): partidas dobradas. Débitos = créditos em cada lançamento e no
// período, com as parcelas mostradas (o balancete imprime a soma de débitos, a de créditos e a diferença).
import type { LancamentoGerado, PartidaGerada } from '@sgh/contratos';

export interface Equilibrio {
  readonly debitos: number;
  readonly creditos: number;
  readonly diferenca: number;
  readonly equilibrado: boolean;
  /** Parcelas (centavos) na ordem das partidas, para imprimir a conta. */
  readonly parcelasDebito: readonly number[];
  readonly parcelasCredito: readonly number[];
}

export function equilibrio(partidas: readonly PartidaGerada[]): Equilibrio {
  const pd = partidas.filter((p) => p.lado === 'D').map((p) => p.valorCentavos);
  const pc = partidas.filter((p) => p.lado === 'C').map((p) => p.valorCentavos);
  const debitos = pd.reduce((s, x) => s + x, 0);
  const creditos = pc.reduce((s, x) => s + x, 0);
  return {
    debitos,
    creditos,
    diferenca: debitos - creditos,
    equilibrado: debitos === creditos,
    parcelasDebito: pd,
    parcelasCredito: pc,
  };
}

/** Problemas do lançamento: desequilíbrio, valor zero ou negativo, um lado só. */
export function problemasDoLancamento(partidas: readonly PartidaGerada[]): string[] {
  const r: string[] = [];
  if (!partidas.some((p) => p.lado === 'D') || !partidas.some((p) => p.lado === 'C'))
    r.push('O lançamento precisa de débito e de crédito.');
  if (partidas.some((p) => !Number.isInteger(p.valorCentavos) || p.valorCentavos <= 0))
    r.push('Toda partida tem valor positivo em centavos.');
  const e = equilibrio(partidas);
  if (!e.equilibrado)
    r.push(
      `Débitos (${e.debitos}) diferentes dos créditos (${e.creditos}): diferença de ${e.diferenca} centavos.`,
    );
  return r;
}

/** Equilíbrio do período: soma de todos os lançamentos, com a parcela de cada um. */
export function equilibrioDoPeriodo(lancamentos: readonly LancamentoGerado[]): Equilibrio & {
  readonly porLancamento: readonly {
    readonly chave: string;
    readonly debitos: number;
    readonly creditos: number;
  }[];
} {
  const porLancamento = lancamentos.map((l) => {
    const e = equilibrio(l.partidas);
    return { chave: l.chave, debitos: e.debitos, creditos: e.creditos };
  });
  const debitos = porLancamento.reduce((s, x) => s + x.debitos, 0);
  const creditos = porLancamento.reduce((s, x) => s + x.creditos, 0);
  return {
    debitos,
    creditos,
    diferenca: debitos - creditos,
    equilibrado: debitos === creditos,
    parcelasDebito: porLancamento.map((x) => x.debitos),
    parcelasCredito: porLancamento.map((x) => x.creditos),
    porLancamento,
  };
}
