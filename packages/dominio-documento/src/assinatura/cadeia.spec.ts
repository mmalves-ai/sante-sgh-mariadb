// Validação criptográfica no servidor (regra 3) sobre a ICP sintética do simulador: cadeia até a raiz configurada,
// LCR assinada e com o revogado, assinatura crua do hash e o token do carimbo do tempo (RFC 3161). Nenhum certificado
// real; o CPF é sintético.
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  conferirAssinaturaHash,
  conferirLcr,
  conferirTokenCarimbo,
  enderecosLcr,
  lerPedidoCarimbo,
  serieDoCertificado,
  verificarCadeia,
} from './cadeia.js';
import { conferirCarimbo, lerRespostaCarimbo, pedidoCarimbo } from './carimbo.js';
import { cpfDoCertificado, lerCertificado } from './certificado.js';
import { CPF_TESTE_A } from './certificados-teste.spec-util.js';
import { deHex, hex } from './der.js';
import {
  assinarHashRsa,
  carimbarSintetico,
  carimboRecusadoSintetico,
  criarRaizSintetica,
  emitirLcrSintetica,
  emitirSintetico,
} from './icp-sintetica.js';
import { tipoPelaPolitica } from './oids.js';

const agora = new Date('2026-10-24T12:00:00Z');
const raiz = criarRaizSintetica(agora);
const outraRaiz = criarRaizSintetica(agora, 'OUTRA RAIZ SINTETICA');
const titular = emitirSintetico(raiz, { cpf: CPF_TESTE_A, lcr: 'http://127.0.0.1:1/lcr.crl' }, agora);
const act = emitirSintetico(raiz, { cpf: null, carimbo: true }, agora);
const hash = Uint8Array.from(createHash('sha256').update('documento sintético').digest());

describe('certificado da ICP sintética', () => {
  it('é lido pelo leitor do motor: CPF, A3, uso da chave e o endereço da LCR', () => {
    const c = lerCertificado(titular.certificado);
    expect(cpfDoCertificado(c)).toBe(CPF_TESTE_A);
    expect(tipoPelaPolitica(c.politicas)).toBe('A3');
    expect(c.usoDaChave).toEqual({ assinaturaDigital: true, naoRepudio: true });
    expect(enderecosLcr(titular.certificado)).toEqual(['http://127.0.0.1:1/lcr.crl']);
    expect(enderecosLcr(raiz.certificado)).toEqual([]);
    expect(serieDoCertificado(titular.certificado)).toBe(c.serie);
    expect(serieDoCertificado(titular.certificado)).toBe(hex(titular.serie));
  });
});

describe('cadeia', () => {
  it('chega à raiz configurada; outra raiz não serve', () => {
    const ok = verificarCadeia(titular.certificado, [], [raiz.certificado], agora);
    expect(ok.situacao).toBe('ok');
    expect(verificarCadeia(titular.certificado, [], [outraRaiz.certificado], agora)).toEqual({
      situacao: 'invalida',
      motivo: 'sem-raiz',
    });
    expect(verificarCadeia(Uint8Array.of(1, 2, 3), [], [raiz.certificado], agora).situacao).toBe('invalida');
  });

  it('sobe por um intermediário (AC de segundo nível) e recusa elo fora da vigência', () => {
    const intermediaria = criarRaizSintetica(agora, 'AC INTERMEDIARIA SINTETICA');
    // A "intermediária" é autoassinada aqui; um titular dela só fecha a cadeia se ela for raiz confiável.
    const t2 = emitirSintetico(intermediaria, { cpf: CPF_TESTE_A }, agora);
    expect(verificarCadeia(t2.certificado, [], [intermediaria.certificado], agora).situacao).toBe('ok');
    expect(verificarCadeia(t2.certificado, [intermediaria.certificado], [raiz.certificado], agora)).toEqual({
      situacao: 'invalida',
      motivo: 'sem-raiz',
    });
    const depois = new Date(agora.getTime() + 20 * 365 * 86_400_000);
    expect(verificarCadeia(titular.certificado, [], [raiz.certificado], depois)).toEqual({
      situacao: 'invalida',
      motivo: 'elo-fora-da-vigencia',
    });
  });
});

describe('LCR', () => {
  it('assinada pela raiz, vigente e com o revogado', () => {
    const lcr = emitirLcrSintetica(raiz, [hex(titular.serie)], agora);
    const r = conferirLcr(lcr, raiz.certificado, agora);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.lcr.revogados.has(serieDoCertificado(titular.certificado))).toBe(true);
    const vazia = conferirLcr(emitirLcrSintetica(raiz, [], agora), raiz.certificado, agora);
    expect(vazia.ok && vazia.lcr.revogados.size).toBe(0);
  });

  it('recusa assinatura de outro emissor, LCR vencida e bytes quebrados', () => {
    const lcr = emitirLcrSintetica(raiz, [], agora, 1);
    expect(conferirLcr(lcr, outraRaiz.certificado, agora)).toEqual({ ok: false, motivo: 'assinatura' });
    expect(conferirLcr(lcr, raiz.certificado, new Date(agora.getTime() + 2 * 3_600_000))).toEqual({
      ok: false,
      motivo: 'vencida',
    });
    expect(conferirLcr(Uint8Array.of(0x30, 0), raiz.certificado, agora)).toEqual({
      ok: false,
      motivo: 'malformada',
    });
  });
});

describe('assinatura crua do hash', () => {
  it('confere só com o mesmo hash e a chave do certificado', () => {
    const sig = assinarHashRsa(titular.chave, hash);
    expect(conferirAssinaturaHash(titular.certificado, hash, sig)).toBe(true);
    const outro = Uint8Array.from(createHash('sha256').update('outro').digest());
    expect(conferirAssinaturaHash(titular.certificado, outro, sig)).toBe(false);
    expect(conferirAssinaturaHash(act.certificado, hash, sig)).toBe(false);
    expect(conferirAssinaturaHash(titular.certificado, hash, Uint8Array.of(1))).toBe(false);
    expect(conferirAssinaturaHash(Uint8Array.of(1), hash, sig)).toBe(false);
    expect(conferirAssinaturaHash(titular.certificado, Uint8Array.of(1), sig)).toBe(false);
  });
});

describe('carimbo do tempo', () => {
  const nonce = deHex('0102030405060708');
  const pedido = pedidoCarimbo(hash, nonce);

  it('a ACT sintética responde ao pedido; o token confere (resumo, assinatura e cadeia da ACT)', () => {
    const lido = lerPedidoCarimbo(pedido);
    expect(hex(lido.hash)).toBe(hex(hash));
    const resp = carimbarSintetico(act, raiz.nome, lido, agora);
    const r = lerRespostaCarimbo(resp);
    expect(conferirCarimbo(r, { hash, nonce }, agora).ok).toBe(true);
    expect(conferirTokenCarimbo(resp, [raiz.certificado], [], agora).ok).toBe(true);
    expect(conferirTokenCarimbo(resp, [outraRaiz.certificado], [], agora)).toEqual({
      ok: false,
      motivo: 'cadeia-act',
    });
  });

  it('recusa token adulterado e resposta sem token', () => {
    const resp = Uint8Array.from(carimbarSintetico(act, raiz.nome, lerPedidoCarimbo(pedido), agora));
    // Troca um byte do hash dentro do TSTInfo: o resumo assinado deixa de bater.
    const i = Buffer.from(resp).indexOf(Buffer.from(hash));
    resp[i] = resp[i]! ^ 0xff;
    expect(conferirTokenCarimbo(resp, [raiz.certificado], [], agora)).toEqual({
      ok: false,
      motivo: 'resumo-divergente',
    });
    expect(conferirTokenCarimbo(carimboRecusadoSintetico(), [raiz.certificado], [], agora).ok).toBe(false);
    expect(lerRespostaCarimbo(carimboRecusadoSintetico())).toEqual({ status: 2 });
  });
});
