// Vigência dos valores (ficha do M30, regra 9; cap-11 §11.3; `sante-api: test/valores.test.js`, casos reescritos com
// dados sintéticos): vale o último valor com data menor ou igual à data-base (hoje, sempre a data do lançamento). A data
// sentinela (anterior a 1900) nunca é vigência.

export interface ValorDatado<T = number> {
  /** AAAA-MM-DD. */
  readonly data: string;
  readonly valor: T;
}

/** O valor vigente na data-base (null: nenhum valor até a data). */
export function vigenteNaData<T>(
  valores: readonly ValorDatado<T>[],
  dataBase: string,
): ValorDatado<T> | null {
  let melhor: ValorDatado<T> | null = null;
  for (const v of valores) {
    const d = v.data.slice(0, 10);
    if (d < '1900-01-01' || d > dataBase.slice(0, 10)) continue;
    if (!melhor || d > melhor.data.slice(0, 10)) melhor = v;
  }
  return melhor;
}

/** A data-base do item: a data do lançamento (DP-33.5 decide se muda; padrão de mercado, POL-1). */
export function dataBaseDoItem(item: { readonly data: string }): string {
  return item.data.slice(0, 10);
}
