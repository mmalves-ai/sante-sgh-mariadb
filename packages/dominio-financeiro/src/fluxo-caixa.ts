// Fluxo de caixa realizado e projetado (M32; ficha, seções 4 e 7; regra 11): o realizado é o movimento e as baixas
// nas datas; o projetado são os títulos em aberto pela data prevista de pagamento (o vencimento, quando não há
// outra), o recebível de convênio ajustado pela glosa histórica (itens com retorno, regra 12) e pelo atraso médio
// do convênio. Agregado por dia, semana ou mês; o saldo inicial é o último saldo bancário fechado mais o realizado.
import { centavos, diasEntre, somarDias } from '@sgh/contratos/regras-financeiro';

export type Agrupamento = 'dia' | 'semana' | 'mes';

export interface LancamentoFluxo {
  readonly data: string;
  readonly valor: number;
  /** entrada (+) ou saída (−). */
  readonly sentido: 'entrada' | 'saida';
  readonly origem: 'movimento' | 'pagar' | 'receber';
  readonly realizado: boolean;
  /** Convênio do título a receber (para a glosa e o atraso históricos). */
  readonly convenio?: number;
}

export interface HistoricoConvenio {
  readonly convenio: number;
  /** Taxa de glosa histórica (0 a 1) sobre o cobrado dos itens baixados. */
  readonly taxaGlosa: number;
  /** Atraso médio, em dias, entre o vencimento e o recebimento. */
  readonly atrasoMedioDias: number;
}

/** O recebível projetado: valor × (1 − glosa histórica) na data + atraso médio do convênio. */
export function projetarRecebivel(
  l: LancamentoFluxo,
  historicos: ReadonlyMap<number, HistoricoConvenio>,
): LancamentoFluxo {
  if (l.realizado || l.origem !== 'receber' || l.convenio === undefined) return l;
  const h = historicos.get(l.convenio);
  if (!h) return l;
  return {
    ...l,
    valor: centavos(l.valor * (1 - Math.min(1, Math.max(0, h.taxaGlosa)))),
    data: somarDias(l.data, Math.max(0, Math.round(h.atrasoMedioDias))),
  };
}

/** A chave do período: o dia, a segunda-feira da semana ou o mês. */
export function chavePeriodo(data: string, a: Agrupamento): string {
  if (a === 'dia') return data.slice(0, 10);
  if (a === 'mes') return data.slice(0, 7);
  const d = new Date(`${data.slice(0, 10)}T12:00:00Z`);
  const dow = (d.getUTCDay() + 6) % 7;
  return somarDias(data.slice(0, 10), -dow);
}

export interface LinhaFluxo {
  readonly periodo: string;
  readonly entradasRealizadas: number;
  readonly saidasRealizadas: number;
  readonly entradasProjetadas: number;
  readonly saidasProjetadas: number;
  readonly saldo: number;
}

/** O fluxo agregado: cada período com as parcelas (realizado e projetado) e o saldo acumulado. */
export function montarFluxo(
  saldoInicial: number,
  lancamentos: readonly LancamentoFluxo[],
  a: Agrupamento,
  historicos: ReadonlyMap<number, HistoricoConvenio> = new Map(),
): LinhaFluxo[] {
  const porPeriodo = new Map<string, { er: number; sr: number; ep: number; sp: number }>();
  for (const bruto of lancamentos) {
    const l = projetarRecebivel(bruto, historicos);
    const k = chavePeriodo(l.data, a);
    const x = porPeriodo.get(k) ?? { er: 0, sr: 0, ep: 0, sp: 0 };
    if (l.realizado && l.sentido === 'entrada') x.er += l.valor;
    else if (l.realizado) x.sr += l.valor;
    else if (l.sentido === 'entrada') x.ep += l.valor;
    else x.sp += l.valor;
    porPeriodo.set(k, x);
  }
  let saldo = saldoInicial;
  return [...porPeriodo.entries()]
    .sort(([a1], [b1]) => a1.localeCompare(b1))
    .map(([periodo, x]) => {
      saldo = centavos(saldo + x.er - x.sr + x.ep - x.sp);
      return {
        periodo,
        entradasRealizadas: centavos(x.er),
        saidasRealizadas: centavos(x.sr),
        entradasProjetadas: centavos(x.ep),
        saidasProjetadas: centavos(x.sp),
        saldo,
      };
    });
}

/** O horizonte da projeção (padrão 90 dias, a validação humana pede 90). */
export function dentroDoHorizonte(hoje: string, data: string, dias = 90): boolean {
  const d = diasEntre(hoje, data);
  return d >= -3650 && d <= dias;
}
