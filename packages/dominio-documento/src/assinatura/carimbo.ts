// Carimbo do tempo (M49; regra 3: AD-RT; RFC 3161; DOC-ICP-11/12): o pedido à autoridade de carimbo do tempo (ACT)
// leva só o hash da assinatura, com um nonce; a resposta tem de devolver o MESMO hash e o MESMO nonce, com status
// concedido. A assinatura da ACT sobre o token e a cadeia dela são conferidas pelo serviço isolado (validacao.ts);
// aqui, o pedido em DER e a leitura do TSTInfo, puros.
import {
  booleano,
  ErroDer,
  inteiroPequeno,
  inteiroSemSinal,
  lerDer,
  MARCA,
  nulo,
  octetos,
  oid,
  oidDeBytes,
  sequencia,
  textoDe,
  type NoDer,
} from './der.js';
import { OID_SHA256 } from './oids.js';

const OID_SIGNED_DATA = '1.2.840.113549.1.7.2';
const OID_TST_INFO = '1.2.840.113549.1.9.16.1.4';

/** TimeStampReq (RFC 3161 §2.4.1): versão 1, imprint SHA-256, política opcional, nonce e certReq verdadeiro. */
export function pedidoCarimbo(hashSha256: Uint8Array, nonce: Uint8Array, politica?: string): Uint8Array {
  if (hashSha256.length !== 32) throw new ErroDer('O carimbo pede o hash SHA-256 (32 bytes).');
  if (nonce.length < 8 || nonce.length > 32) throw new ErroDer('Nonce de 8 a 32 bytes.');
  return sequencia(
    inteiroPequeno(1),
    sequencia(sequencia(oid(OID_SHA256), nulo()), octetos(hashSha256)),
    ...(politica ? [oid(politica)] : []),
    inteiroSemSinal(nonce),
    booleano(true),
  );
}

export interface CarimboLido {
  /** PKIStatus: 0 concedido, 1 concedido com mudanças; o resto é recusa. */
  readonly status: number;
  readonly politica: string;
  readonly algoritmo: string;
  readonly hash: Uint8Array;
  readonly serie: string;
  readonly em: Date;
  readonly nonce: string | null;
}

const exigir = (n: NoDer | undefined, o: string): NoDer => {
  if (!n) throw new ErroDer(`Resposta do carimbo malformada: ${o}.`);
  return n;
};
const filhosDe = (n: NoDer | undefined, o: string) => {
  const f = exigir(n, o).filhos;
  if (!f) throw new ErroDer(`Resposta do carimbo malformada: ${o}.`);
  return f;
};
const hexInt = (n: NoDer) =>
  Buffer.from(n.conteudo)
    .toString('hex')
    .replace(/^(00)+(?=..)/, '');

function tempoGeneralizado(n: NoDer): Date {
  const m = textoDe(n).match(/^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})(?:\.(\d{1,3}))?Z$/);
  if (n.marca !== 0x18 || !m) throw new ErroDer('genTime do carimbo fora do formato.');
  return new Date(
    Date.UTC(+m[1]!, +m[2]! - 1, +m[3]!, +m[4]!, +m[5]!, +m[6]!, Number((m[7] ?? '0').padEnd(3, '0'))),
  );
}

/** Lê o TimeStampResp: status e, quando há token, o TSTInfo (política, imprint, série, hora e nonce). */
export function lerRespostaCarimbo(der: Uint8Array): CarimboLido | { readonly status: number } {
  const [statusInfo, token] = filhosDe(lerDer(der), 'TimeStampResp');
  const status = Number.parseInt(hexInt(exigir(filhosDe(statusInfo, 'PKIStatusInfo')[0], 'status')), 16);
  if (!token) return { status };
  const [tipo, conteudo] = filhosDe(token, 'ContentInfo');
  if (oidDeBytes(exigir(tipo, 'contentType').conteudo) !== OID_SIGNED_DATA)
    throw new ErroDer('O token do carimbo não é SignedData.');
  const signed = filhosDe(filhosDe(conteudo, 'content')[0], 'SignedData');
  const encap = filhosDe(signed[2], 'EncapsulatedContentInfo');
  if (oidDeBytes(exigir(encap[0], 'eContentType').conteudo) !== OID_TST_INFO)
    throw new ErroDer('O conteúdo do token não é TSTInfo.');
  const octs = exigir(filhosDe(encap[1], 'eContent')[0], 'eContent');
  if (octs.marca !== MARCA.octetos) throw new ErroDer('eContent sem OCTET STRING.');
  const tst = filhosDe(lerDer(octs.conteudo), 'TSTInfo');
  const [, politica, imprint, serie, em, ...resto] = tst;
  const [alg, hash] = filhosDe(imprint, 'MessageImprint');
  const nonce = resto.find((n) => n.marca === MARCA.inteiro);
  return {
    status,
    politica: oidDeBytes(exigir(politica, 'policy').conteudo),
    algoritmo: oidDeBytes(exigir(filhosDe(alg, 'hashAlgorithm')[0], 'algoritmo').conteudo),
    hash: exigir(hash, 'hashedMessage').conteudo,
    serie: hexInt(exigir(serie, 'serialNumber')),
    em: tempoGeneralizado(exigir(em, 'genTime')),
    nonce: nonce ? hexInt(nonce) : null,
  };
}

export type ConferenciaCarimbo =
  | { readonly ok: true; readonly em: Date; readonly serie: string }
  | {
      readonly ok: false;
      readonly motivo:
        'recusado-pela-act' | 'hash-divergente' | 'nonce-divergente' | 'algoritmo' | 'fora-do-tempo';
    };

/**
 * A resposta é do NOSSO pedido: status concedido, mesmo hash, mesmo nonce, SHA-256 e hora plausível (até `folgaMs`
 * do relógio do servidor; o relógio vem do NTP do servidor, cap-08).
 */
export function conferirCarimbo(
  r: CarimboLido | { readonly status: number },
  pedido: { readonly hash: Uint8Array; readonly nonce: Uint8Array },
  agora: Date,
  folgaMs = 5 * 60_000,
): ConferenciaCarimbo {
  if (!('hash' in r) || (r.status !== 0 && r.status !== 1)) return { ok: false, motivo: 'recusado-pela-act' };
  if (r.algoritmo !== OID_SHA256) return { ok: false, motivo: 'algoritmo' };
  if (Buffer.compare(Buffer.from(r.hash), Buffer.from(pedido.hash)) !== 0)
    return { ok: false, motivo: 'hash-divergente' };
  const esperado = Buffer.from(pedido.nonce)
    .toString('hex')
    .replace(/^(00)+(?=..)/, '');
  if (r.nonce !== esperado) return { ok: false, motivo: 'nonce-divergente' };
  if (Math.abs(r.em.getTime() - agora.getTime()) > folgaMs) return { ok: false, motivo: 'fora-do-tempo' };
  return { ok: true, em: r.em, serie: r.serie };
}
