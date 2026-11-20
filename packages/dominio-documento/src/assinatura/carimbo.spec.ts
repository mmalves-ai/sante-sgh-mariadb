// Carimbo do tempo (regra 3, AD-RT; RFC 3161): o pedido em DER e a conferência da resposta (status, hash, nonce,
// algoritmo e hora). Respostas sintéticas montadas com o codificador do motor.
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { conferirCarimbo, lerRespostaCarimbo, pedidoCarimbo } from './carimbo.js';
import {
  contexto,
  deHex,
  ErroDer,
  hex,
  inteiroPequeno,
  inteiroSemSinal,
  lerDer,
  nulo,
  octetos,
  oid,
  oidDeBytes,
  sequencia,
  texto,
  tlv,
} from './der.js';
import { OID_SHA256 } from './oids.js';

const hash = Uint8Array.from(createHash('sha256').update('documento sintético').digest());
const nonce = deHex('8f00112233445566');
const agora = new Date('2026-10-24T12:00:00Z');

function resposta(
  o: { status?: number; hash?: Uint8Array; nonce?: Uint8Array | null; em?: string; alg?: string } = {},
) {
  const tst = sequencia(
    inteiroPequeno(1),
    oid('2.16.76.1.10.1'),
    sequencia(sequencia(oid(o.alg ?? OID_SHA256), nulo()), octetos(o.hash ?? hash)),
    inteiroSemSinal(deHex('0a0b')),
    texto(0x18, o.em ?? '20261024120001.5Z'),
    ...(o.nonce === null ? [] : [inteiroSemSinal(o.nonce ?? nonce)]),
  );
  const signed = sequencia(
    inteiroPequeno(3),
    tlv(0x31, sequencia(oid(OID_SHA256), nulo())),
    sequencia(oid('1.2.840.113549.1.9.16.1.4'), contexto(0, octetos(tst))),
  );
  const token = sequencia(oid('1.2.840.113549.1.7.2'), contexto(0, signed));
  return sequencia(sequencia(inteiroPequeno(o.status ?? 0)), token);
}

describe('pedido de carimbo', () => {
  it('monta o TimeStampReq com versão 1, imprint SHA-256, nonce e certReq', () => {
    const der = pedidoCarimbo(hash, nonce, '2.16.76.1.10.1');
    const [versao, imprint, politica, n, certReq] = lerDer(der).filhos!;
    expect(versao!.conteudo).toEqual(Uint8Array.of(1));
    expect(oidDeBytes(imprint!.filhos![0]!.filhos![0]!.conteudo)).toBe(OID_SHA256);
    expect(hex(imprint!.filhos![1]!.conteudo)).toBe(hex(hash));
    expect(oidDeBytes(politica!.conteudo)).toBe('2.16.76.1.10.1');
    // Bit alto do nonce ligado: o INTEGER ganha o zero à esquerda (sem sinal).
    expect(hex(n!.conteudo)).toBe(`00${hex(nonce)}`);
    expect(certReq!.conteudo).toEqual(Uint8Array.of(0xff));
    expect(lerDer(pedidoCarimbo(hash, nonce)).filhos).toHaveLength(4);
  });
  it('recusa hash que não é SHA-256 e nonce curto', () => {
    expect(() => pedidoCarimbo(hash.subarray(0, 20), nonce)).toThrow(ErroDer);
    expect(() => pedidoCarimbo(hash, Uint8Array.of(1, 2))).toThrow(ErroDer);
  });
});

describe('resposta do carimbo', () => {
  it('lê o TSTInfo e confere: mesmo hash, mesmo nonce, hora plausível', () => {
    const r = lerRespostaCarimbo(resposta());
    expect(r).toMatchObject({ status: 0, politica: '2.16.76.1.10.1', serie: '0a0b' });
    expect('em' in r && r.em.toISOString()).toBe('2026-10-24T12:00:01.500Z');
    expect(conferirCarimbo(r, { hash, nonce }, agora)).toMatchObject({ ok: true, serie: '0a0b' });
  });
  it('status de recusa sem token: recusado pela ACT', () => {
    const r = lerRespostaCarimbo(sequencia(sequencia(inteiroPequeno(2))));
    expect(r).toEqual({ status: 2 });
    expect(conferirCarimbo(r, { hash, nonce }, agora)).toEqual({ ok: false, motivo: 'recusado-pela-act' });
  });
  it('hash, nonce, algoritmo ou hora diferentes: recusa', () => {
    const outro = Uint8Array.from(createHash('sha256').update('outro').digest());
    expect(conferirCarimbo(lerRespostaCarimbo(resposta({ hash: outro })), { hash, nonce }, agora)).toEqual({
      ok: false,
      motivo: 'hash-divergente',
    });
    expect(
      conferirCarimbo(
        lerRespostaCarimbo(resposta({ nonce: deHex('01020304050607') })),
        { hash, nonce },
        agora,
      ),
    ).toEqual({
      ok: false,
      motivo: 'nonce-divergente',
    });
    expect(conferirCarimbo(lerRespostaCarimbo(resposta({ nonce: null })), { hash, nonce }, agora)).toEqual({
      ok: false,
      motivo: 'nonce-divergente',
    });
    expect(
      conferirCarimbo(lerRespostaCarimbo(resposta({ alg: '1.3.14.3.2.26' })), { hash, nonce }, agora),
    ).toEqual({ ok: false, motivo: 'algoritmo' });
    expect(
      conferirCarimbo(lerRespostaCarimbo(resposta({ em: '20261024110000Z' })), { hash, nonce }, agora),
    ).toEqual({ ok: false, motivo: 'fora-do-tempo' });
  });
  it('token que não é SignedData ou genTime fora do formato: erro de leitura', () => {
    const ruim = sequencia(sequencia(inteiroPequeno(0)), sequencia(oid('1.2.3'), contexto(0, sequencia())));
    expect(() => lerRespostaCarimbo(ruim)).toThrow(ErroDer);
    expect(() => lerRespostaCarimbo(resposta({ em: '2026-10-24' }))).toThrow(ErroDer);
  });
});
