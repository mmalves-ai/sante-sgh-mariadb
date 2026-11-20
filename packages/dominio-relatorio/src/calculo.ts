// Cálculo dos indicadores (M16; regra 11): cada valor sai com o numerador e o denominador; o mês corrente vem
// marcado como parcial (regra 14); a comparação é com o mesmo mês do ano anterior; a meta vem do parâmetro e a
// situação segue a polaridade da ficha.
import type { BaseMensal, FichaIndicador, SituacaoMeta, ValorIndicador } from '@sgh/contratos';

/** Arredonda a duas casas sem o ruído do ponto flutuante. */
export function arredondar(v: number, casas = 2): number {
  const f = 10 ** casas;
  return Math.round((v + Number.EPSILON) * f) / f;
}

/** Valor do indicador numa base (null sem denominador). */
export function valorDe(ficha: FichaIndicador, base: BaseMensal): ValorIndicador {
  const numerador = base.grandezas[ficha.numerador.grandeza];
  const denominador = ficha.denominador ? base.grandezas[ficha.denominador.grandeza] : null;
  const valor =
    denominador === null
      ? numerador
      : denominador > 0
        ? arredondar((numerador / denominador) * ficha.fator)
        : null;
  return { periodo: base.periodo, numerador, denominador, valor, parcial: base.parcial };
}

export function serieDe(ficha: FichaIndicador, bases: readonly BaseMensal[]): ValorIndicador[] {
  return bases.map((b) => valorDe(ficha, b));
}

/** Meta do texto do parâmetro ("85", "85,5", "85.5"; "sem meta" ou inválido = null). */
export function metaDoTexto(texto: string | null | undefined): number | null {
  const t = (texto ?? '').trim().replace(',', '.');
  if (!/^-?\d+(?:\.\d+)?$/.test(t)) return null;
  return Number(t);
}

/** Situação do valor diante da meta, pela polaridade da ficha. */
export function situacaoDaMeta(
  ficha: FichaIndicador,
  meta: number | null,
  valor: number | null,
): SituacaoMeta {
  if (valor === null) return 'sem-valor';
  if (meta === null) return 'sem-meta';
  if (ficha.polaridade === 'maior-melhor') return valor >= meta ? 'na-meta' : 'fora-da-meta';
  if (ficha.polaridade === 'menor-melhor') return valor <= meta ? 'na-meta' : 'fora-da-meta';
  return 'sem-meta';
}

/** O último valor que não é parcial (o "último mês fechado"), ou o último que houver. */
export function ultimoFechado(valores: readonly ValorIndicador[]): ValorIndicador | null {
  for (let k = valores.length - 1; k >= 0; k--) if (!valores[k]!.parcial) return valores[k]!;
  return valores.at(-1) ?? null;
}

/** Linhas da planilha exportada (separador ";", vírgula decimal, como a planilha em português abre). */
export function planilhaDaSerie(ficha: FichaIndicador, valores: readonly ValorIndicador[]): string {
  const num = (v: number | null) => (v === null ? '' : String(v).replace('.', ','));
  const cabecalho = [
    'periodo',
    ficha.numerador.descricao,
    ficha.denominador?.descricao ?? '',
    `${ficha.nome} (${ficha.formula})`,
    'parcial',
  ].map((c) => `"${c.replaceAll('"', '""')}"`);
  const linhas = valores.map((v) =>
    [v.periodo, num(v.numerador), num(v.denominador), num(v.valor), v.parcial ? 'sim' : 'não'].join(';'),
  );
  return [cabecalho.join(';'), ...linhas].join('\r\n') + '\r\n';
}
