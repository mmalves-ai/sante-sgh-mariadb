// Validador de entrada CP1252 (ADR 0008; cap-10 §10.7; BRIEF §4.2): o mesmo na tela e no servidor.
// O banco do legado é charset NONE com texto CP1252: o que não existe no CP1252 não pode ser gravado.
// - recusa emoji e caracteres fora do CP1252, com mensagem clara;
// - mantém aspas curvas, travessão e reticência tipográfica (existem no CP1252);
// - espaço especial colado (sem quebra, fino, ideográfico…) vira espaço comum; caracteres invisíveis
//   de largura zero saem; acento decomposto (colado do Mac) é recomposto (NFC);
// - símbolo fora da tabela recebe troca proposta (">=" para "≥"), nunca aplicada em silêncio;
// - limite em bytes igual ao tamanho da coluna (no CP1252, 1 caractere = 1 byte).
import { z } from 'zod';

const TABELA = new TextDecoder('windows-1252').decode(Uint8Array.from({ length: 256 }, (_, i) => i));
// Aceitos: os imprimíveis do CP1252 e tabulação/quebra de linha. Os controles C0/C1 (inclusive os 5
// bytes que o CP1252 não define) não são digitáveis e são recusados.
const ACEITOS = new Set(
  [...TABELA].filter((c) => {
    const n = c.charCodeAt(0);
    return n === 0x09 || n === 0x0a || n === 0x0d || (n >= 0x20 && n !== 0x7f && !(n >= 0x80 && n <= 0x9f));
  }),
);

const ESPACOS = /[\u00a0\u1680\u2000-\u200a\u202f\u205f\u3000]/g;
const INVISIVEIS = /[\u200b-\u200d\u2060\ufeff]/g;

/** Trocas propostas para símbolos fora do CP1252 (a pessoa decide; nada é trocado em silêncio). */
export const TROCAS_CP1252: Readonly<Record<string, string>> = Object.freeze({
  '≥': '>=',
  '≤': '<=',
  '≠': '<>',
  '≈': '~',
  '→': '->',
  '←': '<-',
  '↑': '^',
  '−': '-',
  '‐': '-',
  '‑': '-',
  '′': "'",
  '″': '"',
  '⁄': '/',
  '℃': '°C',
  '⅓': '1/3',
  '⅔': '2/3',
  '⅛': '1/8',
  '⁴': '^4',
  '√': 'raiz de ',
  '∞': 'infinito',
  '✓': 'OK',
  '✔': 'OK',
  Ω: 'ohm',
  α: 'alfa',
  β: 'beta',
  γ: 'gama',
  δ: 'delta',
  Δ: 'delta',
});

/** Normalização aplicada antes de validar (é a forma que vai ao banco). */
export function normalizarTextoCp1252(texto: string): string {
  return texto.normalize('NFC').replace(INVISIVEIS, '').replace(ESPACOS, ' ');
}

const EMOJI = /\p{Extended_Pictographic}/u;

export interface ProblemaCp1252 {
  readonly caractere: string;
  readonly posicao: number;
  readonly troca: string | null;
  readonly mensagem: string;
}

/** Problemas do texto já normalizado (vazio: texto aceito). Percorre por ponto de código. */
export function problemasCp1252(texto: string): ProblemaCp1252[] {
  const problemas: ProblemaCp1252[] = [];
  let posicao = 0;
  for (const c of texto) {
    posicao++;
    if (ACEITOS.has(c)) continue;
    const troca = TROCAS_CP1252[c] ?? null;
    const codigo = `U+${(c.codePointAt(0) ?? 0).toString(16).toUpperCase().padStart(4, '0')}`;
    const mensagem = EMOJI.test(c)
      ? `Emoji não é aceito (posição ${posicao}). Remova-o.`
      : troca !== null
        ? `O símbolo “${c}” não é aceito (posição ${posicao}). Use “${troca}”.`
        : `O caractere ${codigo} não é aceito (posição ${posicao}).`;
    problemas.push({ caractere: c, posicao, troca, mensagem });
  }
  return problemas;
}

/**
 * Texto para coluna legada de `max` bytes. Use em todo campo de texto que vai ao banco do legado
 * (tela e servidor importam este mesmo validador de @sgh/contratos).
 */
export function textoCp1252(max: number) {
  if (!Number.isInteger(max) || max < 1) throw new Error('textoCp1252: tamanho inválido.');
  return z
    .string()
    .overwrite(normalizarTextoCp1252)
    .superRefine((texto, ctx) => {
      for (const p of problemasCp1252(texto).slice(0, 5)) {
        ctx.addIssue({
          code: 'custom',
          message: p.mensagem,
          params: { caractere: p.caractere, troca: p.troca },
        });
      }
      if (texto.length > max) {
        ctx.addIssue({
          code: 'custom',
          message: `Máximo de ${max} caracteres (o campo tem ${texto.length}).`,
          params: { maximo: max },
        });
      }
    });
}
