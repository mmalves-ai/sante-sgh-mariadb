// Credencial do cliente de integração (M34; ficha, seção 6: "segredo só como hash"; cap-12 §12.3, Segurança): o
// identificador do cliente e o segredo são gerados aqui; o segredo sai UMA vez na resposta e no banco fica só o resumo
// scrypt com sal (o mesmo segredo nunca é guardado nem registrado em log). A conferência é em tempo constante.
import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';

const N = 16_384;
const R = 8;
const P = 1;

export function novaCredencial(codigo: string): { clienteId: string; segredo: string } {
  return {
    clienteId: `${codigo.slice(0, 40)}.${randomBytes(6).toString('hex')}`,
    segredo: randomBytes(32).toString('base64url'),
  };
}

export function resumoDoSegredo(segredo: string): string {
  const sal = randomBytes(16);
  const h = scryptSync(segredo, sal, 32, { N, r: R, p: P });
  return `scrypt$${N}$${R}$${P}$${sal.toString('base64url')}$${h.toString('base64url')}`;
}

export function segredoConfere(segredo: string, resumo: string): boolean {
  const m = /^scrypt\$(\d+)\$(\d+)\$(\d+)\$([A-Za-z0-9_-]+)\$([A-Za-z0-9_-]+)$/.exec(resumo);
  if (!m) return false;
  const [, n, r, p, sal, hash] = m;
  const esperado = Buffer.from(hash!, 'base64url');
  const h = scryptSync(segredo, Buffer.from(sal!, 'base64url'), esperado.length, {
    N: Number(n),
    r: Number(r),
    p: Number(p),
  });
  return h.length === esperado.length && timingSafeEqual(h, esperado);
}

/** Basic <base64(cliente:segredo)> → as duas partes (null se fora do formato). */
export function lerAutorizacaoBasica(cabecalho: unknown): { clienteId: string; segredo: string } | null {
  if (typeof cabecalho !== 'string' || !cabecalho.startsWith('Basic ')) return null;
  const t = Buffer.from(cabecalho.slice(6).trim(), 'base64').toString('utf8');
  const i = t.indexOf(':');
  if (i < 1) return null;
  const clienteId = t.slice(0, i);
  const segredo = t.slice(i + 1);
  if (!/^[a-z0-9.-]{3,64}$/.test(clienteId) || segredo.length < 16 || segredo.length > 200) return null;
  return { clienteId, segredo };
}
