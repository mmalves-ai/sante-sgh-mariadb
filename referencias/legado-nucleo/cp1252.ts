// CP1252 sem perda (cap-10 §10.2 e §10.7): o banco é charset NONE e o texto foi gravado pelo Delphi em
// CP1252. A tabela é a do WHATWG (TextDecoder 'windows-1252'): os 5 bytes que o CP1252 não define
// (0x81, 0x8D, 0x8F, 0x90, 0x9D) viram os controles C1 de mesmo número, e não U+FFFD. Assim os 256 bytes
// vão e voltam iguais, inclusive os de texto UTF-8 gravado por integração (Á = C3 81), que o codec
// reconhece e marca (spike do M02: o 'win1252' do iconv-lite perde esses 5 bytes; ADR 0010).
import iconv from 'iconv-lite';

/** Os 256 caracteres, na ordem dos bytes. */
export const TABELA_CP1252: string = new TextDecoder('windows-1252').decode(
  Uint8Array.from({ length: 256 }, (_, i) => i),
);

/** Bytes que o CP1252 não define (mapeados para C1 de mesmo número). */
export const BYTES_INDEFINIDOS_CP1252: readonly number[] = [0x81, 0x8d, 0x8f, 0x90, 0x9d];

const PARA_BYTE = new Map<number, number>();
for (let i = 0; i < 256; i++) PARA_BYTE.set(TABELA_CP1252.charCodeAt(i), i);

/**
 * Nome da codificação registrada no iconv-lite e passada ao driver em `charSetForNONE`.
 * O iconv-lite canoniza o nome (minúsculas, sem hífen), por isso a chave é só alfanumérica.
 */
export const CODIFICACAO_NONE = 'sghcp1252';

let registrada = false;
/** Registra a codificação sem perda no iconv-lite (o mesmo módulo que o driver usa). Idempotente. */
export function registrarCodificacaoNone(): string {
  if (!registrada) {
    iconv.encodingExists('win1252'); // força o carregamento da tabela de codificações do iconv-lite
    const tabela = (iconv as unknown as { encodings: Record<string, unknown> | null }).encodings;
    if (!tabela) throw new Error('iconv-lite sem tabela de codificações');
    tabela[CODIFICACAO_NONE] = { type: '_sbcs', chars: TABELA_CP1252 };
    registrada = true;
  }
  return CODIFICACAO_NONE;
}

/** O caractere existe no CP1252 (inclui os 5 C1 que representam bytes indefinidos)? */
export function caractereCp1252(c: string): boolean {
  return c.length === 1 && PARA_BYTE.has(c.charCodeAt(0));
}

/** Primeiro caractere fora do CP1252, ou null. Percorre por ponto de código (emoji conta como um). */
export function foraDoCp1252(texto: string): string | null {
  for (const c of texto) if (!caractereCp1252(c)) return c;
  return null;
}

export class ErroCp1252 extends Error {
  override readonly name = 'ErroCp1252';
}

/** Texto → bytes CP1252. Nunca troca em silêncio: caractere fora da tabela é erro. */
export function codificarCp1252(texto: string): Buffer {
  const saida = Buffer.alloc(texto.length);
  for (let i = 0; i < texto.length; i++) {
    const b = PARA_BYTE.get(texto.charCodeAt(i));
    if (b === undefined) throw new ErroCp1252('Texto com caractere fora do CP1252.');
    saida[i] = b;
  }
  return saida;
}

/** Bytes CP1252 → texto (sem perda). */
export function decodificarCp1252(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += TABELA_CP1252[b];
  return s;
}
