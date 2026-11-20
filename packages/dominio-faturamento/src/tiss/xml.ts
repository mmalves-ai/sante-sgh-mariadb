// XML da mensagem TISS montado como árvore e serializado de forma canônica (sem conteúdo misto, sem
// espaço entre elementos), em ISO-8859-1, que é a codificação declarada pelo Padrão TISS. Texto fora do
// ISO-8859-1 é recusado (nunca trocado em silêncio), como o codec CP1252 do adaptador.

export interface Elemento {
  readonly nome: string;
  readonly filhos: readonly No[];
}
export type No = Elemento | string;

export const NAMESPACE_TISS = 'http://www.ans.gov.br/padroes/tiss/schemas';
export const PREFIXO = 'ans';

export class ErroXmlTiss extends Error {
  override readonly name = 'ErroXmlTiss';
}

/** Elemento com filhos; valores nulos ou vazios (campo opcional ausente) são omitidos. */
export function el(nome: string, ...filhos: readonly (No | null | undefined | false)[]): Elemento {
  return {
    nome,
    filhos: filhos.filter((f): f is No => f !== null && f !== undefined && f !== false && f !== ''),
  };
}

/** Elemento folha só se houver valor (campo opcional). */
export function opcional(nome: string, valor: string | number | null | undefined): Elemento | null {
  if (valor === null || valor === undefined || valor === '') return null;
  return el(nome, String(valor));
}

export function escapar(texto: string): string {
  return texto.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

export function desescapar(texto: string): string {
  return texto
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n: string) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n: string) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&amp;/g, '&');
}

function conferirLatin1(texto: string): void {
  for (const ch of texto) {
    const c = ch.codePointAt(0)!;
    if (c > 0xff || (c >= 0x7f && c <= 0x9f) || (c < 0x20 && c !== 0x09 && c !== 0x0a && c !== 0x0d)) {
      throw new ErroXmlTiss(
        `Caractere fora do ISO-8859-1 no XML TISS: U+${c.toString(16).toUpperCase().padStart(4, '0')}.`,
      );
    }
  }
}

function serializarNo(no: No, raiz: boolean): string {
  if (typeof no === 'string') {
    conferirLatin1(no);
    return escapar(no);
  }
  const atributo = raiz ? ` xmlns:${PREFIXO}="${NAMESPACE_TISS}"` : '';
  return `<${PREFIXO}:${no.nome}${atributo}>${no.filhos.map((f) => serializarNo(f, false)).join('')}</${PREFIXO}:${no.nome}>`;
}

export function serializar(raiz: Elemento): string {
  return `<?xml version="1.0" encoding="ISO-8859-1"?>${serializarNo(raiz, true)}`;
}

/** Texto em bytes ISO-8859-1 (recusa caractere fora da faixa). */
export function latin1(texto: string): Uint8Array {
  conferirLatin1(texto.replace(/[\r\n\t]/g, ' '));
  return Uint8Array.from(texto, (ch) => ch.codePointAt(0)!);
}

/** Valores de texto dos nós, em ordem de documento. */
export function textos(no: No): string[] {
  return typeof no === 'string' ? [no] : no.filhos.flatMap(textos);
}
