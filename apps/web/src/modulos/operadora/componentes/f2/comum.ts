// Apoio das telas da cobrança da operadora (M56, etapa 3, F2): valores em reais para a tela, a competência de hoje e a
// conversão dos campos de texto (reusa a da F1) e o devido da baixa na data (a regra do domínio).
import { encargosNaData, type Encargos } from '@sgh/dominio-operadora';

export { dataBr, numeroDe } from '../f1/comum.js';

/** R$ sem o símbolo: 1234.5 → "1.234,50". */
export function reais(v: number | null | undefined): string {
  if (v === null || v === undefined) return '';
  return v.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/** AAAA-MM em MM/AAAA. */
export function competenciaBr(c: string | null | undefined): string {
  return c && /^\d{4}-\d{2}$/.test(c) ? `${c.slice(5, 7)}/${c.slice(0, 4)}` : (c ?? '');
}

/** A competência da data (AAAA-MM-DD → AAAA-MM), somada de meses. */
export function competenciaDe(data: string, meses = 0): string {
  const [a, m] = data.split('-').map(Number) as [number, number];
  const d = new Date(Date.UTC(a, m - 1 + meses, 1));
  return d.toISOString().slice(0, 7);
}

/** R$ com o símbolo: 1234.5 → "R$ 1.234,50". */
export function brl(v: number | null | undefined): string {
  return v === null || v === undefined ? '' : `R$ ${reais(v)}`;
}

/**
 * O devido da baixa na data escolhida, pela mesma regra do servidor (`encargosNaData` do domínio): o valor com a multa
 * e os juros daquela data, ou só o valor com a dispensa. `calculados` são os encargos da data antes da dispensa (a tela
 * mostra o que está sendo dispensado).
 */
export function devidoDaBaixa(
  valor: number,
  vencimento: string,
  pagoEm: string | null,
  dispensar: boolean,
): { multa: number; juros: number; devido: number; calculados: Encargos } {
  const calculados =
    pagoEm && /^\d{4}-\d{2}-\d{2}$/.test(pagoEm)
      ? encargosNaData(valor, vencimento, pagoEm)
      : { multa: 0, juros: 0, total: 0 };
  const multa = dispensar ? 0 : calculados.multa;
  const juros = dispensar ? 0 : calculados.juros;
  return { multa, juros, devido: Math.round((valor + multa + juros) * 100) / 100, calculados };
}

/** O devido como o campo do valor pago espera (1234.5 → "1234,50"). */
export function valorDoCampo(v: number): string {
  return reais(v).replace(/\./g, '');
}
