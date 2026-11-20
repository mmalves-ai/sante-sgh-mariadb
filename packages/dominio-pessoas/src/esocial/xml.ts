// Montagem do XML dos eventos do eSocial (M53-F5): uma árvore pequena e a serialização determinística (sem recuo, UTF-8,
// atributos na ordem dada). Elemento opcional sem valor some da árvore: `el()` devolve null quando o conteúdo é null,
// undefined, texto vazio ou lista sem filhos, e a serialização ignora os nulos. A ordem dos filhos é a da sequência do
// XSD (quem monta o evento segue o leiaute).

export interface NoXml {
  readonly nome: string;
  readonly atributos: readonly (readonly [string, string])[];
  readonly filhos: readonly NoXml[];
  readonly texto: string | null;
}

export type ConteudoXml = string | number | null | undefined | readonly (NoXml | null | undefined | false)[];

/** Elemento; null quando não há o que gravar (o opcional sai do XML). */
export function el(
  nome: string,
  conteudo: ConteudoXml,
  atributos: Readonly<Record<string, string>> = {},
): NoXml | null {
  const attrs = Object.entries(atributos);
  if (conteudo === null || conteudo === undefined) return null;
  if (typeof conteudo === 'string' || typeof conteudo === 'number') {
    const texto = String(conteudo);
    if (texto === '') return null;
    return { nome, atributos: attrs, filhos: [], texto };
  }
  const filhos = conteudo.filter((f): f is NoXml => !!f);
  if (filhos.length === 0) return null;
  return { nome, atributos: attrs, filhos, texto: null };
}

/** Elemento obrigatório (erro de programação se vier vazio: quem monta confere os dados antes). */
export function obrig(
  nome: string,
  conteudo: ConteudoXml,
  atributos: Readonly<Record<string, string>> = {},
): NoXml {
  const n = el(nome, conteudo, atributos);
  if (!n) throw new Error(`Elemento obrigatório vazio: ${nome}.`);
  return n;
}

const escaparTexto = (t: string) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const escaparAtributo = (t: string) => escaparTexto(t).replace(/"/g, '&quot;');

export function serializarNo(n: NoXml): string {
  const attrs = n.atributos.map(([k, v]) => ` ${k}="${escaparAtributo(v)}"`).join('');
  if (n.texto !== null) return `<${n.nome}${attrs}>${escaparTexto(n.texto)}</${n.nome}>`;
  return `<${n.nome}${attrs}>${n.filhos.map(serializarNo).join('')}</${n.nome}>`;
}

/** O documento com a declaração XML (UTF-8). */
export const serializarDocumento = (raiz: NoXml): string =>
  `<?xml version="1.0" encoding="UTF-8"?>${serializarNo(raiz)}`;

/** Valor monetário do leiaute (centavos → "1234.56"). */
export function decimalDeCentavos(centavos: number): string {
  const sinal = centavos < 0 ? '-' : '';
  const a = Math.abs(Math.round(centavos));
  return `${sinal}${Math.floor(a / 100)}.${String(a % 100).padStart(2, '0')}`;
}

/** Texto do leiaute: espaços colapsados e cortado no tamanho do campo (nunca termina em espaço). */
export function textoCampo(t: string | null | undefined, max: number): string | null {
  if (t === null || t === undefined) return null;
  const limpo = t.replace(/\s+/g, ' ').trim().slice(0, max).trim();
  return limpo === '' ? null : limpo;
}
