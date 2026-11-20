// Vigência de preço (ficha do M12, regra 1; cap-11 §11.3; cap-06a §6.2; sante-api: src/services/valores.js;
// SPVLRPRO do legado): vale o último valor com data menor ou igual à data-base. Datas de calendário no
// formato AAAA-MM-DD (texto: a comparação lexical é a cronológica). A sentinela do Delphi (1899-12-30) é
// "sem data" e nunca vale como vigência.
import { DATA_SENTINELA } from '@sgh/contratos';

const FORMATO = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Data de calendário real no formato AAAA-MM-DD (sem conferir a faixa de anos). */
export function dataDeCalendario(d: string): boolean {
  const m = FORMATO.exec(d);
  if (!m) return false;
  const [ano, mes, dia] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const x = new Date(Date.UTC(ano, mes - 1, dia));
  return x.getUTCFullYear() === ano && x.getUTCMonth() === mes - 1 && x.getUTCDate() === dia;
}

/** Data utilizável como vigência: calendário real, não é a sentinela e o ano está entre 1900 e 2100. */
export function dataDeVigencia(d: string | null | undefined): boolean {
  if (!d || d === DATA_SENTINELA || !dataDeCalendario(d)) return false;
  const ano = Number(d.slice(0, 4));
  return ano >= 1900 && ano <= 2100;
}

export interface ComData {
  /** AAAA-MM-DD. */
  readonly data: string;
}

/** A vigência que vale na data-base: a de maior data ≤ data-base (sentinela e datas inválidas ignoradas). */
export function vigenteEm<T extends ComData>(lista: readonly T[], dataBase: string): T | null {
  let melhor: T | null = null;
  for (const v of lista) {
    if (!dataDeVigencia(v.data) || v.data > dataBase) continue;
    if (!melhor || v.data > melhor.data) melhor = v;
  }
  return melhor;
}

/** A primeira vigência posterior à data-base (vigência futura já gravada), ou null. */
export function proximaVigencia<T extends ComData>(lista: readonly T[], dataBase: string): T | null {
  let melhor: T | null = null;
  for (const v of lista) {
    if (!dataDeVigencia(v.data) || v.data <= dataBase) continue;
    if (!melhor || v.data < melhor.data) melhor = v;
  }
  return melhor;
}

/** As vigências em ordem decrescente de data, marcando a que vale na data-base. */
export function linhaDoTempo<T extends ComData>(
  lista: readonly T[],
  dataBase: string,
): (T & { readonly vigente: boolean; readonly futura: boolean; readonly invalida: boolean })[] {
  const atual = vigenteEm(lista, dataBase);
  return [...lista]
    .sort((a, b) => (a.data < b.data ? 1 : a.data > b.data ? -1 : 0))
    .map((v) => ({
      ...v,
      vigente: v === atual,
      futura: dataDeVigencia(v.data) && v.data > dataBase,
      invalida: !dataDeVigencia(v.data),
    }));
}
