// Conector PSC (regras 1 e 10; DOC-ICP-17.01 v3.0, item 6.4): PKCE S256 (vetor da RFC 7636), endereço de autorização,
// corpos das chamadas (só hashes) e a conferência das respostas do provedor. Sem rede: o simulador é do construtor.
import { describe, expect, it } from 'vitest';
import {
  conferirAssinaturas,
  conferirToken,
  corpoAssinatura,
  corpoTroca,
  desafioDe,
  enderecoAutorizacao,
  escopoDoLote,
  gerarEstado,
  gerarPkce,
} from './psc-oauth.js';
import { CPF_TESTE_A, CPF_TESTE_B } from './certificados-teste.spec-util.js';
import { OID_SHA256 } from './oids.js';

const cfg = {
  uriBase: 'https://psc.exemplo.invalid/v0/',
  clientId: 'cliente-sgh',
  retorno: 'https://sgh.exemplo.invalid/api/assinatura/retorno',
};
const fixo = (n: number) => new Uint8Array(n).fill(7);
const H = 'ab'.repeat(32);
const agora = new Date('2026-10-24T12:00:00Z');

describe('PKCE e state', () => {
  it('desafio S256 do vetor de teste da RFC 7636 (apêndice B)', () => {
    expect(desafioDe('dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk')).toBe(
      'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM',
    );
  });
  it('verificador de 43 caracteres base64url; state opaco; aleatórios diferentes a cada chamada', () => {
    const p = gerarPkce(fixo);
    expect(p.verificador).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(p.desafio).toBe(desafioDe(p.verificador));
    expect(p.metodo).toBe('S256');
    expect(gerarEstado(fixo)).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(gerarPkce().verificador).not.toBe(gerarPkce().verificador);
  });
});

describe('autorização', () => {
  it('um documento: single_signature; lote: multi_signature com a quantidade', () => {
    expect(escopoDoLote(1)).toBe('single_signature');
    expect(escopoDoLote(20)).toBe('multi_signature');
    const pkce = gerarPkce(fixo);
    const u = new URL(
      enderecoAutorizacao(cfg, { estado: 'e'.repeat(43), pkce, documentos: 20, validadeSeg: 900 }),
    );
    expect(u.origin + u.pathname).toBe('https://psc.exemplo.invalid/v0/oauth/authorize');
    expect(Object.fromEntries(u.searchParams)).toEqual({
      response_type: 'code',
      client_id: 'cliente-sgh',
      redirect_uri: cfg.retorno,
      scope: 'multi_signature',
      state: 'e'.repeat(43),
      code_challenge: pkce.desafio,
      code_challenge_method: 'S256',
      lifetime: '900',
      num_signatures: '20',
    });
    const um = new URL(
      enderecoAutorizacao(cfg, { estado: 'e'.repeat(43), pkce, documentos: 1, validadeSeg: 60 }),
    );
    expect(um.searchParams.has('num_signatures')).toBe(false);
  });
  it('provedor sem https ou sem /v0: recusa', () => {
    const pkce = gerarPkce(fixo);
    expect(() =>
      enderecoAutorizacao(
        { ...cfg, uriBase: 'http://psc.exemplo.invalid/v0' },
        { estado: 'e', pkce, documentos: 1, validadeSeg: 1 },
      ),
    ).toThrow();
    expect(() =>
      enderecoAutorizacao(
        { ...cfg, uriBase: 'https://psc.exemplo.invalid/v1' },
        { estado: 'e', pkce, documentos: 1, validadeSeg: 1 },
      ),
    ).toThrow();
  });
});

describe('troca do código e pedido de assinatura', () => {
  it('a troca leva o verificador do PKCE e o valor do cofre, no corpo (nunca na URL)', () => {
    const t = corpoTroca(cfg, {
      codigo: 'c0d',
      verificador: 'v'.repeat(43),
      segredo: 'valor-ficticio-do-cofre',
    });
    expect(t.endereco).toBe('https://psc.exemplo.invalid/v0/oauth/token');
    const q = new URLSearchParams(t.corpo);
    expect(q.get('grant_type')).toBe('authorization_code');
    expect(q.get('code_verifier')).toBe('v'.repeat(43));
    expect(q.get('client_secret')).toBe('valor-ficticio-do-cofre');
    expect(t.endereco).not.toContain('ficticio');
  });
  it('a assinatura leva só o hash em base64, o OID do SHA-256 e o formato RAW', () => {
    const a = corpoAssinatura(cfg, [{ id: '10', alias: 'Atestado', hashHex: H }]);
    expect(a.endereco).toBe('https://psc.exemplo.invalid/v0/oauth/signature');
    expect(a.corpo.hashes).toEqual([
      {
        id: '10',
        alias: 'Atestado',
        hash: Buffer.from(H, 'hex').toString('base64'),
        hash_algorithm: OID_SHA256,
        signature_format: 'RAW',
      },
    ]);
    expect(() => corpoAssinatura(cfg, [])).toThrow();
    expect(() => corpoAssinatura(cfg, [{ id: '1', alias: 'x', hashHex: 'zz' }])).toThrow();
  });
});

describe('respostas do provedor', () => {
  it('token: aceita o do escopo pedido; recusa escopo ou titular divergente e resposta malformada', () => {
    const ok = {
      access_token: 't0k',
      token_type: 'Bearer',
      expires_in: 600,
      scope: 'multi_signature',
      authorized_identification_type: 'CPF',
      authorized_identification: CPF_TESTE_A,
    };
    const r = conferirToken(ok, { escopo: 'multi_signature', cpf: CPF_TESTE_A }, agora);
    expect(r).toEqual({ ok: true, token: 't0k', expiraEm: new Date('2026-10-24T12:10:00Z') });
    expect(
      conferirToken(
        { ...ok, scope: 'single_signature' },
        { escopo: 'multi_signature', cpf: CPF_TESTE_A },
        agora,
      ),
    ).toEqual({ ok: false, motivo: 'escopo-divergente' });
    expect(conferirToken(ok, { escopo: 'multi_signature', cpf: CPF_TESTE_B }, agora)).toEqual({
      ok: false,
      motivo: 'titular-divergente',
    });
    expect(
      conferirToken({ access_token: '', expires_in: 1 }, { escopo: 'single_signature', cpf: null }, agora).ok,
    ).toBe(false);
    expect(conferirToken(null, { escopo: 'single_signature', cpf: null }, agora).ok).toBe(false);
    // Sem escopo nem titular na resposta: aceita (o certificado ainda passa pela regra 2).
    expect(
      conferirToken(
        { access_token: 'x', expires_in: 60 },
        { escopo: 'single_signature', cpf: CPF_TESTE_A },
        agora,
      ).ok,
    ).toBe(true);
  });
  it('assinaturas: uma para cada ID pedido; falta, sobra ou repetição recusam', () => {
    const sig = Buffer.from([1, 2, 3]).toString('base64');
    const r = conferirAssinaturas(
      {
        certificate_alias: 'cert',
        signatures: [
          { id: '1', raw_signature: sig },
          { id: '2', raw_signature: sig },
        ],
      },
      ['1', '2'],
    );
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect([...r.assinaturas.keys()]).toEqual(['1', '2']);
      expect(r.certificado).toBe('cert');
    }
    expect(conferirAssinaturas({ signatures: [{ id: '1', raw_signature: sig }] }, ['1', '2'])).toEqual({
      ok: false,
      motivo: 'faltou-assinatura',
    });
    expect(conferirAssinaturas({ signatures: [{ id: '3', raw_signature: sig }] }, ['1'])).toEqual({
      ok: false,
      motivo: 'assinatura-a-mais',
    });
    expect(
      conferirAssinaturas(
        {
          signatures: [
            { id: '1', raw_signature: sig },
            { id: '1', raw_signature: sig },
          ],
        },
        ['1'],
      ),
    ).toEqual({
      ok: false,
      motivo: 'assinatura-a-mais',
    });
    expect(conferirAssinaturas({ signatures: [{ id: '1', raw_signature: '%%' }] }, ['1'])).toEqual({
      ok: false,
      motivo: 'resposta-invalida',
    });
    expect(conferirAssinaturas({ signatures: 'x' }, ['1'])).toEqual({
      ok: false,
      motivo: 'resposta-invalida',
    });
    expect(conferirAssinaturas(undefined, ['1'])).toEqual({ ok: false, motivo: 'resposta-invalida' });
  });
});
