// Cofre (ICP-06), agente local A1/A3 (regra 1), DER e numeração SNCR (regra 10) do M49.
import { describe, expect, it } from 'vitest';
import { conferirRespostaAgente, criarDesafio } from './agente-local.js';
import {
  camposComSegredoEmClaro,
  lerReferenciaCofre,
  mascararCpf,
  referenciaCofre,
  situacaoSegredo,
} from './cofre.js';
import { CPF_TESTE_A } from './certificados-teste.spec-util.js';
import { ErroDer, inteiroPequeno, lerDer, oid, oidDeBytes, sequencia, tlv } from './der.js';
import { oidValido } from './oids.js';

const agora = new Date('2026-10-24T12:00:00Z');
const H1 = 'a'.repeat(64);
const H2 = 'b'.repeat(64);

describe('cofre', () => {
  it('referência ida e volta; código inválido recusa', () => {
    const r = referenciaCofre('pc', 'psc-teste', 'client-secret');
    expect(r).toBe('cofre:psc/pc/psc-teste/client-secret');
    expect(lerReferenciaCofre(r)).toEqual({ hospital: 'pc', provedor: 'psc-teste', tipo: 'client-secret' });
    // O mesmo código em outro estabelecimento é outra referência (o segredo de um nunca serve ao outro).
    expect(referenciaCofre('hs', 'psc-teste', 'client-secret')).not.toBe(r);
    expect(lerReferenciaCofre('cofre:outro/x')).toBeNull();
    // A referência antiga, sem o estabelecimento, não vale mais.
    expect(lerReferenciaCofre('cofre:psc/psc-teste/client-secret')).toBeNull();
    expect(() => referenciaCofre('pc', 'PSC', 'client-secret')).toThrow();
    expect(() => referenciaCofre('PC/x', 'psc', 'client-secret')).toThrow();
  });
  it('a tela vê definido ou não definido', () => {
    expect(situacaoSegredo(true)).toBe('definido');
    expect(situacaoSegredo(false)).toBe('nao-definido');
  });
  it('a guarda acha segredo em claro em campo sensível, inclusive aninhado; referência e vazio passam', () => {
    expect(
      camposComSegredoEmClaro({
        clientId: 'publico',
        clientSecret: 'valor-em-claro',
        tls: { senhaPfx: 'x', certificado: 'cofre:psc/pc/psc-teste/certificado-servico' },
        token: '',
        chaveRef: 'cofre:psc/pc/psc-teste/client-secret',
        tentativas: 3,
      }),
    ).toEqual(['clientSecret', 'tls.senhaPfx']);
    expect(camposComSegredoEmClaro(null)).toEqual([]);
  });
  it('CPF mascarado mostra só o meio', () => {
    expect(mascararCpf(CPF_TESTE_A)).toBe(`***.${CPF_TESTE_A.slice(3, 6)}.${CPF_TESTE_A.slice(6, 9)}-**`);
  });
});

describe('agente local (A1/A3)', () => {
  it('desafio com os hashes, prazo e nonce; resposta certa confere', () => {
    const d = criarDesafio([H1, H2], agora, 120, (n) => new Uint8Array(n).fill(1));
    expect(d.desafio).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(d.expiraEm.toISOString()).toBe('2026-10-24T12:02:00.000Z');
    const r = conferirRespostaAgente(
      d,
      {
        desafio: d.desafio,
        assinaturas: [
          { hash: H2, assinatura: 'B' },
          { hash: H1, assinatura: 'A' },
        ],
      },
      agora,
    );
    expect(r.ok && r.porHash.get(H1)).toBe('A');
  });
  it('desafio errado, vencido ou hashes diferentes: recusa', () => {
    const d = criarDesafio([H1], agora, 60);
    expect(
      conferirRespostaAgente(d, { desafio: 'x', assinaturas: [{ hash: H1, assinatura: 'A' }] }, agora),
    ).toEqual({ ok: false, motivo: 'desafio-divergente' });
    expect(
      conferirRespostaAgente(
        d,
        { desafio: d.desafio, assinaturas: [{ hash: H1, assinatura: 'A' }] },
        new Date(agora.getTime() + 61_000),
      ),
    ).toEqual({
      ok: false,
      motivo: 'desafio-expirado',
    });
    expect(
      conferirRespostaAgente(d, { desafio: d.desafio, assinaturas: [{ hash: H2, assinatura: 'A' }] }, agora),
    ).toEqual({ ok: false, motivo: 'hashes-divergentes' });
    expect(
      conferirRespostaAgente(
        d,
        {
          desafio: d.desafio,
          assinaturas: [
            { hash: H1, assinatura: 'A' },
            { hash: H1, assinatura: 'B' },
          ],
        },
        agora,
      ),
    ).toEqual({ ok: false, motivo: 'hashes-divergentes' });
  });
  it('desafio vazio, com hash inválido ou repetido: erro', () => {
    expect(() => criarDesafio([], agora, 60)).toThrow();
    expect(() => criarDesafio(['zz'], agora, 60)).toThrow();
    expect(() => criarDesafio([H1, H1], agora, 60)).toThrow();
  });
});

describe('DER', () => {
  it('OID ida e volta, inclusive arcos grandes', () => {
    for (const o of ['2.16.76.1.3.1', '1.2.840.113549.1.9.16.1.4', '2.5.29.17'])
      expect(oidDeBytes(lerDer(oid(o)).conteudo)).toBe(o);
    expect(oidValido('2.16.76.1.3.1')).toBe(true);
    expect(oidValido('3.1')).toBe(false);
    expect(() => oid('x')).toThrow(ErroDer);
  });
  it('tamanho longo e recusas de DER malformado', () => {
    const grande = sequencia(tlv(0x04, new Uint8Array(300)));
    expect(lerDer(grande).filhos![0]!.conteudo).toHaveLength(300);
    expect(() => lerDer(Uint8Array.of(0x30, 0x80))).toThrow(ErroDer);
    expect(() => lerDer(Uint8Array.of(0x1f, 0x01, 0x00))).toThrow(ErroDer);
    expect(() => lerDer(Uint8Array.of(0x30))).toThrow(ErroDer);
    expect(() => lerDer(Uint8Array.of(0x30, 0x82, 0x01))).toThrow(ErroDer);
    expect(() => lerDer(Uint8Array.of(0x02, 0x01, 0x01, 0x00))).toThrow(ErroDer);
    expect(() => oidDeBytes(new Uint8Array(0))).toThrow(ErroDer);
    expect(() => inteiroPequeno(-1)).toThrow(ErroDer);
    expect(lerDer(inteiroPequeno(0)).conteudo).toEqual(Uint8Array.of(0));
  });
});
