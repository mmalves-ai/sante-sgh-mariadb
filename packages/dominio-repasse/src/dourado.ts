// Regra 2 do M33: comparador do teste dourado. O motor recalcula os itens da apuração gravada pelo outro sistema
// (FCINTEGRPA, valor faturado com valor: 3.914 itens, R$ 508.581,47 no pc) e compara item a item com o gravado; cada
// divergência sai classificada por causa, sem dado pessoal (IDs e valores agregados). A meta vem do parâmetro
// repasse.douradoMetaPct (padrão 97%, a aprovar até a DP-33).
import type { CausaDivergenciaRepasse, LinhaGravadaRepasse } from '@sgh/contratos';
import type { MemoriaCalculo } from './calculo.js';

/** A linha gravada vem da leitura do legado (contrato LinhaGravadaRepasse). */
export type LinhaGravada = LinhaGravadaRepasse;

export interface ResultadoDourado {
  readonly total: number;
  readonly iguais: number;
  /** Acerto em % com 2 casas. */
  readonly acertoPct: number;
  readonly atingeMeta: boolean;
  readonly porCausa: Readonly<Partial<Record<CausaDivergenciaRepasse, number>>>;
  /** Soma gravada e recalculada (parcelas do total do relatório). */
  readonly gravadoCentavos: number;
  readonly recalculadoCentavos: number;
  /** Até 20 itens por causa, para investigar (só IDs). */
  readonly exemplos: Readonly<Partial<Record<CausaDivergenciaRepasse, readonly number[]>>>;
}

export function causaDivergencia(
  g: LinhaGravada,
  m: MemoriaCalculo | undefined,
): CausaDivergenciaRepasse | null {
  if (!m || m.pendencia === 'sem-regra') return 'sem-regra-no-novo';
  if (m.pendencia) return 'item-sem-base';
  // O critério é o valor (a ficha: "chegar ao mesmo valor"); regra diferente com o mesmo valor conta como igual.
  if (m.valorCentavos === g.valorCentavos) return null;
  if (g.regra === null) return 'sem-regra-no-legado';
  if (m.regra !== g.regra) return 'regra-diferente';
  if (m.adicional) return 'adicional';
  if (m.percentual === 0) return 'valor-fixo';
  if (Math.abs(m.percentual - g.percentual) > 0.005) return 'percentual-diferente';
  if (Math.abs(m.valorCentavos - g.valorCentavos) <= 1) return 'arredondamento';
  return 'base-diferente';
}

export function compararDourado(
  gravadas: readonly LinhaGravada[],
  recalculadas: readonly MemoriaCalculo[],
  metaPct: number,
): ResultadoDourado {
  const por = new Map(recalculadas.map((m) => [m.item, m]));
  const porCausa: Partial<Record<CausaDivergenciaRepasse, number>> = {};
  const exemplos: Partial<Record<CausaDivergenciaRepasse, number[]>> = {};
  let iguais = 0;
  let gravado = 0;
  let recalculado = 0;
  for (const g of gravadas) {
    const m = por.get(g.item);
    gravado += g.valorCentavos;
    recalculado += m && !m.pendencia ? m.valorCentavos : 0;
    const c = causaDivergencia(g, m);
    if (c === null) {
      iguais += 1;
      continue;
    }
    porCausa[c] = (porCausa[c] ?? 0) + 1;
    const lista = (exemplos[c] ??= []);
    if (lista.length < 20) lista.push(g.item);
  }
  const total = gravadas.length;
  const acertoPct = total ? Math.round((10_000 * iguais) / total) / 100 : 0;
  return {
    total,
    iguais,
    acertoPct,
    atingeMeta: total > 0 && acertoPct >= metaPct,
    porCausa,
    gravadoCentavos: gravado,
    recalculadoCentavos: recalculado,
    exemplos,
  };
}
