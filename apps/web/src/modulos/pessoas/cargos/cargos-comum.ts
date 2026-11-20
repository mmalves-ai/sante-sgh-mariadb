// Comuns da tela "Cargos e salários" (W0-06, parte 4b): o valor em reais digitado (1.234,56) vira centavos para o
// contrato, e os centavos voltam formatados; a quantidade do quadro só aceita inteiro positivo.

/** "1.234,56", "1234,5", "1234" → centavos; null quando o texto não é um valor em reais válido e positivo. */
export function centavosDe(texto: string): number | null {
  const t = texto.replace(/^R\$\s*/i, '').trim();
  if (!/^\d{1,3}(\.\d{3})*(,\d{1,2})?$|^\d+(,\d{1,2})?$/.test(t)) return null;
  const [inteiro = '', fracao = ''] = t.replace(/\./g, '').split(',');
  const v = Number(inteiro) * 100 + Number(fracao.padEnd(2, '0'));
  return v > 0 ? v : null;
}

const MOEDA = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
/** Centavos → "R$ 1.234,56". */
export const reais = (centavos: number): string => MOEDA.format(centavos / 100).replace(/\u00a0/g, ' ');

/** Quantidade do quadro de vagas: inteiro de 1 a 9999; null fora disso. */
export function quantidadeDe(texto: string): number | null {
  const t = texto.trim();
  if (!/^\d{1,4}$/.test(t)) return null;
  const n = Number(t);
  return n >= 1 ? n : null;
}
