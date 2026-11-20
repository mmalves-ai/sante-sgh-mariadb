// MD5 (RFC 1321) em TypeScript puro: o hash do epílogo da mensagem TISS é MD5 em hexadecimal (Componente
// de Comunicação do Padrão TISS). Regra pura, sem node:crypto (o domínio também roda no navegador).

const S = [
  7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9,
  14, 20, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15,
  21, 6, 10, 15, 21,
];
const K = Array.from({ length: 64 }, (_, i) => Math.floor(Math.abs(Math.sin(i + 1)) * 2 ** 32) >>> 0);

export function md5Hex(dados: Uint8Array): string {
  const tamanhoBits = dados.length * 8;
  const comPreenchimento = (((dados.length + 8) >>> 6) + 1) << 6;
  const m = new Uint8Array(comPreenchimento);
  m.set(dados);
  m[dados.length] = 0x80;
  const visao = new DataView(m.buffer);
  visao.setUint32(comPreenchimento - 8, tamanhoBits >>> 0, true);
  visao.setUint32(comPreenchimento - 4, Math.floor(tamanhoBits / 2 ** 32), true);
  let a0 = 0x67452301;
  let b0 = 0xefcdab89;
  let c0 = 0x98badcfe;
  let d0 = 0x10325476;
  for (let bloco = 0; bloco < comPreenchimento; bloco += 64) {
    let a = a0;
    let b = b0;
    let c = c0;
    let d = d0;
    for (let i = 0; i < 64; i++) {
      let f: number;
      let g: number;
      if (i < 16) {
        f = (b & c) | (~b & d);
        g = i;
      } else if (i < 32) {
        f = (d & b) | (~d & c);
        g = (5 * i + 1) % 16;
      } else if (i < 48) {
        f = b ^ c ^ d;
        g = (3 * i + 5) % 16;
      } else {
        f = c ^ (b | ~d);
        g = (7 * i) % 16;
      }
      const t = d;
      d = c;
      c = b;
      const soma = (a + f + K[i]! + visao.getUint32(bloco + g * 4, true)) >>> 0;
      b = (b + ((soma << S[i]!) | (soma >>> (32 - S[i]!)))) >>> 0;
      a = t;
    }
    a0 = (a0 + a) >>> 0;
    b0 = (b0 + b) >>> 0;
    c0 = (c0 + c) >>> 0;
    d0 = (d0 + d) >>> 0;
  }
  const saida = new DataView(new ArrayBuffer(16));
  [a0, b0, c0, d0].forEach((v, i) => saida.setUint32(i * 4, v, true));
  return [...new Uint8Array(saida.buffer)].map((x) => x.toString(16).padStart(2, '0')).join('');
}
