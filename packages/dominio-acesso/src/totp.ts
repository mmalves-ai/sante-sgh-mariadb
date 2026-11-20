// TOTP (RFC 6238) para o segundo fator opcional (ficha do M05, regra 10; DP-45 sem biometria). Regra pura:
// só node:crypto, sem rede nem banco. O segredo em si é cifrado em envelope e guardado em SGH_ pelo
// adaptador; aqui ficam a geração do código e a verificação com janela de tolerância.
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

const ALFABETO_BASE32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

/** Gera um segredo base32 (padrão: 20 bytes, como o Google Authenticator). */
export function gerarSegredoBase32(bytes = 20): string {
  return paraBase32(randomBytes(bytes));
}

export function paraBase32(buf: Buffer): string {
  let bits = 0;
  let valor = 0;
  let saida = '';
  for (const b of buf) {
    valor = (valor << 8) | b;
    bits += 8;
    while (bits >= 5) {
      saida += ALFABETO_BASE32[(valor >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) saida += ALFABETO_BASE32[(valor << (5 - bits)) & 31];
  return saida;
}

export function deBase32(texto: string): Buffer {
  const limpo = texto.toUpperCase().replace(/=+$/, '').replace(/\s/g, '');
  let bits = 0;
  let valor = 0;
  const bytes: number[] = [];
  for (const c of limpo) {
    const i = ALFABETO_BASE32.indexOf(c);
    if (i === -1) throw new Error('Segredo base32 inválido.');
    valor = (valor << 5) | i;
    bits += 5;
    if (bits >= 8) {
      bytes.push((valor >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(bytes);
}

export interface OpcoesTotp {
  readonly passoSegundos: number;
  readonly digitos: number;
}
export const TOTP_PADRAO: OpcoesTotp = { passoSegundos: 30, digitos: 6 };

/** Código TOTP para um instante (ms), com SHA-1 (o algoritmo que os aplicativos usam por padrão). */
export function codigoTotp(segredoBase32: string, agoraMs: number, opcoes: OpcoesTotp = TOTP_PADRAO): string {
  const contador = Math.floor(agoraMs / 1000 / opcoes.passoSegundos);
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64BE(BigInt(contador));
  const hmac = createHmac('sha1', deBase32(segredoBase32)).update(buf).digest();
  const deslocamento = hmac[hmac.length - 1]! & 0xf;
  const binario =
    ((hmac[deslocamento]! & 0x7f) << 24) |
    (hmac[deslocamento + 1]! << 16) |
    (hmac[deslocamento + 2]! << 8) |
    hmac[deslocamento + 3]!;
  return (binario % 10 ** opcoes.digitos).toString().padStart(opcoes.digitos, '0');
}

/**
 * O passo (contador da RFC 6238) que o código confere, aceitando ±1 passo (tolerância de relógio), em tempo
 * constante; null: não confere. Quem chama guarda o último passo aceito por conta e recusa passo menor ou
 * igual (RFC 6238 §5.2: o mesmo código não vale duas vezes).
 */
export function passoTotpConferido(
  segredoBase32: string,
  codigo: string,
  agoraMs: number,
  opcoes: OpcoesTotp = TOTP_PADRAO,
): number | null {
  const limpo = codigo.trim();
  if (!new RegExp(`^\\d{${opcoes.digitos}}$`).test(limpo)) return null;
  const passoMs = opcoes.passoSegundos * 1000;
  const contador = Math.floor(agoraMs / passoMs);
  let conferido: number | null = null;
  for (const d of [-1, 0, 1]) {
    const esperado = codigoTotp(segredoBase32, agoraMs + d * passoMs, opcoes);
    const a = Buffer.from(esperado);
    const b = Buffer.from(limpo);
    if (a.length === b.length && timingSafeEqual(a, b) && conferido === null) conferido = contador + d;
  }
  return conferido;
}

/** Verifica o código aceitando ±1 passo (tolerância de relógio), em tempo constante. */
export function verificarTotp(
  segredoBase32: string,
  codigo: string,
  agoraMs: number,
  opcoes: OpcoesTotp = TOTP_PADRAO,
): boolean {
  return passoTotpConferido(segredoBase32, codigo, agoraMs, opcoes) !== null;
}

/** URI otpauth:// para o QR Code (sem segredo em log; o chamador decide onde exibir). */
export function uriOtpauth(
  rotulo: string,
  emissor: string,
  segredoBase32: string,
  opcoes: OpcoesTotp = TOTP_PADRAO,
): string {
  const p = new URLSearchParams({
    secret: segredoBase32,
    issuer: emissor,
    algorithm: 'SHA1',
    digits: String(opcoes.digitos),
    period: String(opcoes.passoSegundos),
  });
  return `otpauth://totp/${encodeURIComponent(emissor)}:${encodeURIComponent(rotulo)}?${p.toString()}`;
}
