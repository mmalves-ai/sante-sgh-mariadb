// DER mínimo (ITU-T X.690) para o motor de assinatura (M49): ler o certificado ICP-Brasil (SubjectAltName, KeyUsage,
// políticas) e montar o pedido de carimbo do tempo (RFC 3161). Só o que o motor usa: TLV de tamanho definido, OID,
// INTEGER, OCTET STRING, BOOLEAN, SEQUENCE e marcas de contexto. Nada de rede nem de chave privada.

export const MARCA = {
  booleano: 0x01,
  inteiro: 0x02,
  bitString: 0x03,
  octetos: 0x04,
  nulo: 0x05,
  oid: 0x06,
  utf8: 0x0c,
  imprimivel: 0x13,
  ia5: 0x16,
  sequencia: 0x30,
  conjunto: 0x31,
} as const;

/** Nó lido: marca, conteúdo e, quando construído, os filhos. */
export interface NoDer {
  readonly marca: number;
  readonly conteudo: Uint8Array;
  readonly filhos: readonly NoDer[] | null;
}

const construido = (marca: number) => (marca & 0x20) !== 0;

export class ErroDer extends Error {}

function lerTamanho(b: Uint8Array, i: number): { tamanho: number; proximo: number } {
  const p = b[i];
  if (p === undefined) throw new ErroDer('DER truncado (tamanho).');
  if (p < 0x80) return { tamanho: p, proximo: i + 1 };
  const n = p & 0x7f;
  if (n === 0 || n > 4) throw new ErroDer('DER com tamanho indefinido ou grande demais.');
  let t = 0;
  for (let k = 0; k < n; k++) {
    const x = b[i + 1 + k];
    if (x === undefined) throw new ErroDer('DER truncado (tamanho longo).');
    t = t * 256 + x;
  }
  return { tamanho: t, proximo: i + 1 + n };
}

function lerUm(b: Uint8Array, i: number): { no: NoDer; proximo: number } {
  const marca = b[i];
  if (marca === undefined) throw new ErroDer('DER truncado (marca).');
  if ((marca & 0x1f) === 0x1f) throw new ErroDer('Marca DER de número alto não suportada.');
  const { tamanho, proximo } = lerTamanho(b, i + 1);
  const fim = proximo + tamanho;
  if (fim > b.length) throw new ErroDer('DER truncado (conteúdo).');
  const conteudo = b.subarray(proximo, fim);
  return {
    no: { marca, conteudo, filhos: construido(marca) ? lerTodos(conteudo) : null },
    proximo: fim,
  };
}

function lerTodos(b: Uint8Array): NoDer[] {
  const r: NoDer[] = [];
  let i = 0;
  while (i < b.length) {
    const { no, proximo } = lerUm(b, i);
    r.push(no);
    i = proximo;
  }
  return r;
}

/** Lê um único elemento DER que ocupa o buffer inteiro. */
export function lerDer(b: Uint8Array): NoDer {
  const { no, proximo } = lerUm(b, 0);
  if (proximo !== b.length) throw new ErroDer('Sobra depois do elemento DER.');
  return no;
}

export function oidDeBytes(c: Uint8Array): string {
  if (c.length === 0) throw new ErroDer('OID vazio.');
  const partes: number[] = [];
  let v = 0;
  for (const x of c) {
    v = v * 128 + (x & 0x7f);
    if ((x & 0x80) === 0) {
      partes.push(v);
      v = 0;
    }
  }
  const [p0, ...resto] = partes as [number, ...number[]];
  const a = p0 < 40 ? 0 : p0 < 80 ? 1 : 2;
  return [a, p0 - a * 40, ...resto].join('.');
}

export function textoDe(no: NoDer): string {
  return new TextDecoder('utf-8').decode(no.conteudo);
}

// ── Codificação ────────────────────────────────────────────────────────────────────────────────────────────

function tamanhoDer(n: number): Uint8Array {
  if (n < 0x80) return Uint8Array.of(n);
  const bytes: number[] = [];
  for (let x = n; x > 0; x = Math.floor(x / 256)) bytes.unshift(x % 256);
  return Uint8Array.of(0x80 | bytes.length, ...bytes);
}

export function concatenar(...partes: readonly Uint8Array[]): Uint8Array {
  const total = partes.reduce((s, p) => s + p.length, 0);
  const r = new Uint8Array(total);
  let i = 0;
  for (const p of partes) {
    r.set(p, i);
    i += p.length;
  }
  return r;
}

export function tlv(marca: number, conteudo: Uint8Array): Uint8Array {
  return concatenar(Uint8Array.of(marca), tamanhoDer(conteudo.length), conteudo);
}

export const sequencia = (...filhos: readonly Uint8Array[]) => tlv(MARCA.sequencia, concatenar(...filhos));
export const octetos = (b: Uint8Array) => tlv(MARCA.octetos, b);
export const booleano = (v: boolean) => tlv(MARCA.booleano, Uint8Array.of(v ? 0xff : 0x00));
export const nulo = () => tlv(MARCA.nulo, new Uint8Array(0));
/** Marca de contexto [n]; construída (EXPLICIT ou SEQUENCE implícita) por padrão. */
export const contexto = (n: number, conteudo: Uint8Array, construida = true) =>
  tlv(0x80 | (construida ? 0x20 : 0) | n, conteudo);
export const texto = (marca: number, s: string) => tlv(marca, new TextEncoder().encode(s));

export function oid(s: string): Uint8Array {
  if (!/^[0-2](\.\d+)+$/.test(s)) throw new ErroDer(`OID inválido: ${s}`);
  const [a, b, ...resto] = s.split('.').map(Number) as [number, number, ...number[]];
  const arcos = [a * 40 + b, ...resto];
  const bytes: number[] = [];
  for (const arco of arcos) {
    const grupo: number[] = [arco % 128];
    for (let x = Math.floor(arco / 128); x > 0; x = Math.floor(x / 128)) grupo.unshift((x % 128) | 0x80);
    bytes.push(...grupo);
  }
  return tlv(MARCA.oid, Uint8Array.from(bytes));
}

/** INTEGER sem sinal (bytes big-endian): zero à esquerda quando o bit alto está ligado. */
export function inteiroSemSinal(b: Uint8Array): Uint8Array {
  let i = 0;
  while (i < b.length - 1 && b[i] === 0) i++;
  const v = b.subarray(i);
  const corpo =
    v.length === 0 ? Uint8Array.of(0) : (v[0]! & 0x80) !== 0 ? concatenar(Uint8Array.of(0), v) : v;
  return tlv(MARCA.inteiro, corpo);
}

export const inteiroPequeno = (n: number) => {
  if (!Number.isInteger(n) || n < 0 || n > 0x7fffffff) throw new ErroDer('Inteiro fora da faixa.');
  const bytes: number[] = [];
  for (let x = n; x > 0; x = Math.floor(x / 256)) bytes.unshift(x % 256);
  return inteiroSemSinal(Uint8Array.from(bytes.length ? bytes : [0]));
};

export const hex = (b: Uint8Array) => Buffer.from(b).toString('hex');
export const deHex = (s: string) => Uint8Array.from(Buffer.from(s, 'hex'));
