// F7, 07-FIN linha 78: o código de barras do boleto (44 dígitos, padrão FEBRABAN) desenhado como intercalado 2 de 5
// (ITF): cada par de dígitos vira cinco barras (o primeiro dígito) intercaladas com cinco espaços (o segundo), entre a
// guarda de início (estreita, estreita) e a de fim (larga, estreita). Barra larga = 3 estreitas. A tela desenha as
// barras em SVG para a impressão e o PDF, sem biblioteca de fora.
const PADROES: readonly string[] = [
  'nnwwn',
  'wnnnw',
  'nwnnw',
  'wwnnn',
  'nnwnw',
  'wnwnn',
  'nwwnn',
  'nnnww',
  'wnnwn',
  'nwnwn',
];
export const LARGURA_LARGA = 3;

export interface BarrasItf {
  /** Posição e largura de cada barra preta, em módulos estreitos. */
  readonly barras: readonly { readonly x: number; readonly largura: number }[];
  readonly largura: number;
}

/** Barras do ITF; null quando a entrada não tem só dígitos em quantidade par. */
export function barrasItf(digitos: string): BarrasItf | null {
  if (!/^\d+$/.test(digitos) || digitos.length % 2 !== 0) return null;
  const elementos: { preta: boolean; largura: number }[] = [];
  const pino = (preta: boolean, larga: boolean) =>
    elementos.push({ preta, largura: larga ? LARGURA_LARGA : 1 });
  // Guarda de início: barra, espaço, barra, espaço, todos estreitos.
  pino(true, false);
  pino(false, false);
  pino(true, false);
  pino(false, false);
  for (let i = 0; i < digitos.length; i += 2) {
    const b = PADROES[Number(digitos[i])] as string;
    const e = PADROES[Number(digitos[i + 1])] as string;
    for (let k = 0; k < 5; k++) {
      pino(true, b[k] === 'w');
      pino(false, e[k] === 'w');
    }
  }
  // Guarda de fim: barra larga, espaço estreito, barra estreita.
  pino(true, true);
  pino(false, false);
  pino(true, false);
  const barras: { x: number; largura: number }[] = [];
  let x = 0;
  for (const el of elementos) {
    if (el.preta) barras.push({ x, largura: el.largura });
    x += el.largura;
  }
  return { barras, largura: x };
}

/** A linha digitável em blocos para leitura (5.5 5.6 5.6 1 14), como vem impressa no boleto. */
export function linhaDigitavelFormatada(linha: string): string {
  const d = linha.replace(/\D/g, '');
  if (d.length !== 47) return linha;
  return `${d.slice(0, 5)}.${d.slice(5, 10)} ${d.slice(10, 15)}.${d.slice(15, 21)} ${d.slice(21, 26)}.${d.slice(
    26,
    32,
  )} ${d.slice(32, 33)} ${d.slice(33)}`;
}
