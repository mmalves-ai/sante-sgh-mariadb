// Regra 7 do M32 (cap-06b §6.8; ref 01 §2.5): a classificação gerencial (grupo, subgrupo e item gerencial) é gravada
// só na parcela 1, com o centro 0, e mostrada como valendo para o documento inteiro; o rateio por centro de custo fica
// à parte, no rateio do documento.
import { centavos, iguaisEmCentavos, recusaFin, type RecusaFinanceiro, reais } from './recusa.js';

export interface ClassificacaoGerencial {
  readonly grupo: number;
  readonly subgrupo: number;
  readonly item: number;
}

export const classificacaoTexto = (c: ClassificacaoGerencial): string => `${c.grupo}.${c.subgrupo}.${c.item}`;

/** O centro de custo gravado na classificação gerencial (0 em 100% do perfil). */
export const CDC_GRAVADO = 0;
/** Tipo do lançamento gerencial: 0 = despesa do título a pagar, 1 = receita do título a receber, 4 = movimento (visto). */
export const TP_LAN_PAGAR = 0;
export const TP_LAN_RECEBER = 1;

export interface LinhaRateio {
  readonly centroCusto: number;
  readonly percentual: number;
}

export interface RateioCalculado {
  readonly centroCusto: number;
  readonly percentual: number;
  readonly valor: number;
}

/** O rateio soma 100%, sem centro repetido; o valor de cada centro em centavos, a última leva a diferença. */
export function calcularRateio(
  linhas: readonly LinhaRateio[],
  total: number,
): { ok: true; rateio: RateioCalculado[] } | { ok: false; recusa: RecusaFinanceiro } {
  if (linhas.length === 0) return { ok: true, rateio: [] };
  const vistos = new Set<number>();
  for (const l of linhas) {
    if (vistos.has(l.centroCusto))
      return {
        ok: false,
        recusa: recusaFin('rateio-repetido', 'Centro de custo repetido no rateio.', ['rateio']),
      };
    vistos.add(l.centroCusto);
    if (!(l.percentual > 0))
      return {
        ok: false,
        recusa: recusaFin('rateio-sem-percentual', 'Cada centro precisa de percentual.', ['rateio']),
      };
  }
  const soma = linhas.reduce((s, l) => s + l.percentual, 0);
  if (Math.abs(soma - 100) > 0.0001)
    return {
      ok: false,
      recusa: recusaFin('rateio-nao-fecha', `O rateio soma ${soma}%: precisa somar 100%.`, ['rateio']),
    };
  let acumulado = 0;
  const rateio = linhas.map((l, i) => {
    const valor =
      i === linhas.length - 1 ? centavos(total - acumulado) : centavos((total * l.percentual) / 100);
    acumulado = centavos(acumulado + valor);
    return { centroCusto: l.centroCusto, percentual: l.percentual, valor };
  });
  return { ok: true, rateio };
}

/** Conferência do rateio gravado: os valores somam o documento. */
export function conferirSomaRateio(
  rateio: readonly RateioCalculado[],
  total: number,
): RecusaFinanceiro | null {
  const soma = rateio.reduce((s, r) => s + r.valor, 0);
  return rateio.length === 0 || iguaisEmCentavos(soma, total)
    ? null
    : recusaFin('rateio-nao-soma', `O rateio soma ${reais(soma)} e o documento vale ${reais(total)}.`, [
        'rateio',
      ]);
}

/** Na parcela diferente de 1 a classificação mostrada é a do documento (a da parcela 1). */
export function classificacaoMostrada(
  parcela: number,
  doDocumento: ClassificacaoGerencial | null,
): { classificacao: ClassificacaoGerencial | null; valeParaDocumento: boolean } {
  return { classificacao: doDocumento, valeParaDocumento: parcela !== 1 || doDocumento !== null };
}
