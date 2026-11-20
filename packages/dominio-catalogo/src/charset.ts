// Conversão para CP1252 (ficha do M13, regra 7; cap-10 §10.7): a fonte oficial em UTF-8 vai ao banco em
// CP1252. O que não existe no CP1252 aparece na VALIDAÇÃO com a troca proposta (nunca em silêncio): a tabela
// de trocas do contrato (">=" para "≥"), depois a letra sem o acento combinado ("ő" → "o") e, por fim, "?".
// A pessoa vê cada troca antes de aprovar; a publicação grava o texto já trocado.
import { normalizarTextoCp1252, problemasCp1252, TROCAS_CP1252 } from '@sgh/contratos';

export interface TrocaCp1252 {
  readonly caractere: string;
  readonly troca: string;
  readonly posicao: number;
}

export interface TextoConvertido {
  readonly texto: string;
  readonly trocas: readonly TrocaCp1252[];
}

/** Sem o acento combinado (NFD sem as marcas), se a letra base existir no CP1252. */
function semAcento(c: string): string | null {
  const base = c.normalize('NFD').replace(/\p{M}/gu, '');
  return base !== c && base.length > 0 && problemasCp1252(base).length === 0 ? base : null;
}

/** Texto pronto para o CP1252 e as trocas feitas (para a validação mostrar). */
export function converterParaCp1252(entrada: string): TextoConvertido {
  const texto = normalizarTextoCp1252(entrada);
  const problemas = problemasCp1252(texto);
  if (problemas.length === 0) return { texto, trocas: [] };
  const trocas: TrocaCp1252[] = [];
  let saida = '';
  let posicao = 0;
  const ruins = new Set(problemas.map((p) => p.posicao));
  for (const c of texto) {
    posicao++;
    if (!ruins.has(posicao)) {
      saida += c;
      continue;
    }
    const troca = TROCAS_CP1252[c] ?? semAcento(c) ?? (/[\t\r\n]/.test(c) ? ' ' : '?');
    trocas.push({ caractere: c, troca, posicao });
    saida += troca;
  }
  return { texto: saida, trocas };
}

/** Tamanho em bytes no CP1252 (1 caractere = 1 byte depois da conversão). */
export function bytesCp1252(texto: string): number {
  return [...texto].length;
}

/** Descrição curta das trocas para a coluna "motivo" da validação. */
export function descreverTrocas(campo: string, trocas: readonly TrocaCp1252[]): string {
  const lista = trocas
    .slice(0, 3)
    .map((t) => `"${t.caractere}" → "${t.troca}"`)
    .join(', ');
  return `${campo}: troca proposta ${lista}${trocas.length > 3 ? ` (e mais ${trocas.length - 3})` : ''}`;
}
