// Código da etiqueta de dose (ficha do M29, seção 5, "Etiqueta"; cap-09 §9.8): DataMatrix GS1 com o GTIN do item (AI
// 01) quando o cadastro tem o código de barras de 13 ou 14 dígitos, senão o código interno do item (AI 91, de uso da
// empresa), a validade (AI 17, AAMMDD), o lote (AI 10) e o número da dose como série (AI 21, sempre por último, para a
// leitura no aceite conferir pelo fim). O separador GS (FNC1, \u001d) fecha os campos de tamanho variável.
// Só IDs do outro sistema e dados do produto: nada do paciente no código.

export const GS = '\u001d';

/** O GTIN-14 de um código de barras de 8, 12, 13 ou 14 dígitos com o dígito verificador correto; senão null. */
export function gtin14(barras: string | null | undefined): string | null {
  const b = (barras ?? '').trim();
  if (!/^(\d{8}|\d{12}|\d{13}|\d{14})$/.test(b)) return null;
  const g = b.padStart(14, '0');
  const digitos = g.split('').map(Number);
  const dv = digitos.pop()!;
  const soma = digitos.reverse().reduce((s, d, i) => s + d * (i % 2 === 0 ? 3 : 1), 0);
  return (10 - (soma % 10)) % 10 === dv ? g : null;
}

/** A série da dose (AI 21): D + o identificador da dose dispensada. */
export const serieDaDose = (dose: number): string => `D${dose}`;

/**
 * O conteúdo do DataMatrix GS1 da dose. `legivel` é a forma com os AI entre parênteses (para a tela e o teste); `dado`
 * é o que vai ao código (FNC1 inicial pelo ^FD do ZPL com `_1`, separadores GS nos campos variáveis).
 */
export function codigoEtiquetaDose(d: {
  dose: number;
  item: number;
  barras: string | null;
  lote: string | null;
  /** AAAA-MM-DD. */
  validade: string | null;
}): { dado: string; legivel: string; serie: string } {
  if (!Number.isSafeInteger(d.dose) || d.dose <= 0) throw new Error('Dose inválida para a etiqueta.');
  const partes: { ai: string; valor: string; variavel: boolean }[] = [];
  const g = gtin14(d.barras);
  if (g) partes.push({ ai: '01', valor: g, variavel: false });
  else partes.push({ ai: '91', valor: `IT${d.item}`, variavel: true });
  if (d.validade && /^\d{4}-\d{2}-\d{2}$/.test(d.validade))
    partes.push({ ai: '17', valor: d.validade.slice(2).replace(/-/g, ''), variavel: false });
  const lote = (d.lote ?? '').replace(/[^A-Za-z0-9./-]/g, '').slice(0, 20);
  if (lote) partes.push({ ai: '10', valor: lote, variavel: true });
  const serie = serieDaDose(d.dose);
  partes.push({ ai: '21', valor: serie, variavel: true });
  let dado = '';
  partes.forEach((p, i) => {
    dado += p.ai + p.valor;
    if (p.variavel && i < partes.length - 1) dado += GS;
  });
  return { dado, legivel: partes.map((p) => `(${p.ai})${p.valor}`).join(''), serie };
}

/** As formas aceitas no aceite por leitura: o dado inteiro, o legível e a série (o leitor pode cortar o início). */
export function etiquetasAceitas(c: ReturnType<typeof codigoEtiquetaDose>): string[] {
  return [c.dado, c.legivel, `21${c.serie}`];
}
