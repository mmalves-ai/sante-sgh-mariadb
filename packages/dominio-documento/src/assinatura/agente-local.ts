// Agente local para A1/A3 (M49; regra 1; ICP-01): o certificado em arquivo (A1) ou em token/cartão (A3) assina no
// computador do profissional, pelo agente local (o mesmo modelo do QZ Tray do M09: o navegador fala com o agente em
// localhost). O servidor manda um DESAFIO com os hashes, um nonce e o prazo; o agente devolve uma assinatura por hash
// e o certificado público. A chave privada nunca sai do agente; o documento nunca sai do servidor.
import { randomBytes } from 'node:crypto';

export interface DesafioAgente {
  readonly desafio: string;
  readonly hashes: readonly string[];
  readonly criadoEm: Date;
  readonly expiraEm: Date;
}

export function criarDesafio(
  hashes: readonly string[],
  agora: Date,
  validadeSeg: number,
  aleatorio: (n: number) => Uint8Array = randomBytes,
): DesafioAgente {
  if (hashes.length === 0) throw new Error('Desafio sem hash.');
  for (const h of hashes) if (!/^[0-9a-f]{64}$/.test(h)) throw new Error('Hash SHA-256 inválido.');
  if (new Set(hashes).size !== hashes.length) throw new Error('Hash repetido no desafio.');
  return {
    desafio: Buffer.from(aleatorio(32)).toString('base64url'),
    hashes: [...hashes],
    criadoEm: agora,
    expiraEm: new Date(agora.getTime() + validadeSeg * 1000),
  };
}

export type ConferenciaAgente =
  | { readonly ok: true; readonly porHash: ReadonlyMap<string, string> }
  | { readonly ok: false; readonly motivo: 'desafio-divergente' | 'desafio-expirado' | 'hashes-divergentes' };

/** A resposta é do desafio certo, dentro do prazo, e assina exatamente os hashes pedidos (nem mais, nem menos). */
export function conferirRespostaAgente(
  d: DesafioAgente,
  r: { readonly desafio: string; readonly assinaturas: readonly { hash: string; assinatura: string }[] },
  agora: Date,
): ConferenciaAgente {
  if (r.desafio !== d.desafio) return { ok: false, motivo: 'desafio-divergente' };
  if (agora.getTime() > d.expiraEm.getTime()) return { ok: false, motivo: 'desafio-expirado' };
  const m = new Map(r.assinaturas.map((a) => [a.hash, a.assinatura]));
  if (m.size !== r.assinaturas.length || m.size !== d.hashes.length || d.hashes.some((h) => !m.has(h)))
    return { ok: false, motivo: 'hashes-divergentes' };
  return { ok: true, porHash: m };
}
