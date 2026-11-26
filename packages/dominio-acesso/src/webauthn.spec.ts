import { describe, expect, it } from 'vitest';
import {
  conferirCadastroCredencial,
  conferirLimiteDispositivos,
  conferirValidacaoCredencial,
  ErroWebAuthn,
  gerarDesafioWebAuthn,
  normalizarNomeDispositivo,
  opcoesCadastroCredencial,
  servidorDaUrlPublica,
} from './webauthn.js';
import { AutenticadorWebAuthnSimulado } from './webauthn-simulado.js';

const SERVIDOR = 'hospital.exemplo';
const ORIGEM = 'https://hospital.exemplo';
const exp = (desafio: string) => ({ desafio, origens: [ORIGEM], servidor: SERVIDOR });
const codigo = (f: () => unknown): string | null => {
  try {
    f();
    return null;
  } catch (e) {
    return e instanceof ErroWebAuthn ? e.codigo : `outro:${String(e)}`;
  }
};

describe('WebAuthn: chave do dispositivo como segundo fator', () => {
  for (const alg of [-7, -8] as const) {
    it(`cadastra e valida (algoritmo ${alg}); o contador anda`, () => {
      const a = new AutenticadorWebAuthnSimulado(alg);
      const d1 = gerarDesafioWebAuthn();
      const c = conferirCadastroCredencial(a.cadastrar(d1, ORIGEM, SERVIDOR), exp(d1));
      expect(c).toMatchObject({
        idCredencial: a.idCredencial,
        algoritmo: alg,
        contador: 0,
        formatoAtestado: 'none',
      });
      expect(c.verificacaoUsuario).toBe(true);
      const d2 = gerarDesafioWebAuthn();
      const v = conferirValidacaoCredencial(a.validar(d2, ORIGEM, SERVIDOR), exp(d2), c);
      expect(v.contador).toBe(1);
    });
  }

  it('recusa desafio, origem, servidor e tipo trocados', () => {
    const a = new AutenticadorWebAuthnSimulado();
    const d = gerarDesafioWebAuthn();
    const r = a.cadastrar(d, ORIGEM, SERVIDOR);
    expect(codigo(() => conferirCadastroCredencial(r, exp(gerarDesafioWebAuthn())))).toBe(
      'desafio-incorreto',
    );
    expect(
      codigo(() => conferirCadastroCredencial(a.cadastrar(d, 'https://golpe.exemplo', SERVIDOR), exp(d))),
    ).toBe('origem-incorreta');
    expect(codigo(() => conferirCadastroCredencial(a.cadastrar(d, ORIGEM, 'golpe.exemplo'), exp(d)))).toBe(
      'servidor-incorreto',
    );
    const c = conferirCadastroCredencial(r, exp(d));
    const v = a.validar(d, ORIGEM, SERVIDOR);
    expect(codigo(() => conferirCadastroCredencial({ ...r, dadosCliente: v.dadosCliente }, exp(d)))).toBe(
      'tipo-incorreto',
    );
    expect(codigo(() => conferirValidacaoCredencial(v, exp(d), c))).toBeNull();
  });

  it('exige a biometria/PIN do dispositivo', () => {
    const a = new AutenticadorWebAuthnSimulado();
    a.verificaUsuario = false;
    const d = gerarDesafioWebAuthn();
    expect(codigo(() => conferirCadastroCredencial(a.cadastrar(d, ORIGEM, SERVIDOR), exp(d)))).toBe(
      'sem-verificacao-usuario',
    );
  });

  it('recusa assinatura de outra chave e contador que regrediu', () => {
    const a = new AutenticadorWebAuthnSimulado(-7, 10);
    const outra = new AutenticadorWebAuthnSimulado(-7, 50);
    const d = gerarDesafioWebAuthn();
    const c = conferirCadastroCredencial(a.cadastrar(d, ORIGEM, SERVIDOR), exp(d));
    expect(codigo(() => conferirValidacaoCredencial(outra.validar(d, ORIGEM, SERVIDOR), exp(d), c))).toBe(
      'assinatura-invalida',
    );
    const ok = conferirValidacaoCredencial(a.validar(d, ORIGEM, SERVIDOR), exp(d), c);
    expect(ok.contador).toBe(11);
    expect(
      codigo(() =>
        conferirValidacaoCredencial(a.validar(d, ORIGEM, SERVIDOR, false), exp(d), {
          ...c,
          contador: ok.contador,
        }),
      ),
    ).toBe('contador-regrediu');
  });

  it('recusa resposta malformada sem estourar', () => {
    const d = gerarDesafioWebAuthn();
    expect(
      codigo(() =>
        conferirCadastroCredencial({ idCredencial: 'x', dadosCliente: '!!', objetoAtestado: '' }, exp(d)),
      ),
    ).toBe('resposta-malformada');
    const a = new AutenticadorWebAuthnSimulado();
    const r = a.cadastrar(d, ORIGEM, SERVIDOR);
    expect(
      codigo(() =>
        conferirCadastroCredencial({ ...r, objetoAtestado: r.objetoAtestado.slice(0, 40) }, exp(d)),
      ),
    ).toBe('resposta-malformada');
  });

  it('nome do dispositivo, limite por conta, opções e servidor da URL', () => {
    expect(normalizarNomeDispositivo('  Celular   do posto ')).toBe('Celular do posto');
    expect(codigo(() => normalizarNomeDispositivo(''))).toBe('nome-invalido');
    expect(codigo(() => conferirLimiteDispositivos(9))).toBeNull();
    expect(codigo(() => conferirLimiteDispositivos(10))).toBe('limite-dispositivos');
    const o = opcoesCadastroCredencial({
      desafio: 'abc',
      servidor: SERVIDOR,
      nomeServidor: 'Sistema',
      idUsuario: 'dQ',
      login: 'maria',
      nomeExibicao: 'Maria',
      existentes: ['x1'],
    });
    expect(o.attestation).toBe('none');
    expect(o.authenticatorSelection.userVerification).toBe('required');
    expect(o.pubKeyCredParams.map((p) => p.alg)).toEqual([-7, -8, -257]);
    expect(servidorDaUrlPublica('https://h.exemplo:5310/x')).toEqual({
      servidor: 'h.exemplo',
      origem: 'https://h.exemplo:5310',
    });
  });
});
