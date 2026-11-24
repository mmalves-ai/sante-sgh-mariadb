// A chave de cifra do CPF pelo ambiente: a variável preferida, a chave mestra, o formato e o erro que diz o que falta
// (só o nome da variável, nunca o valor).
import { ErroOperacao } from '@sgh/nucleo';
import { describe, expect, it } from 'vitest';
import {
  cifraCpfAusente,
  cifraDasPortas,
  diagnosticoChaveCpf,
  erroChaveCpfAusente,
} from './chave-cpf-ausente.js';
import { CifraCpf } from './cifra-cpf.js';

const HEX = 'ab'.repeat(32);
const B64 = Buffer.alloc(32, 7).toString('base64');

const problema = (fn: () => unknown) => {
  try {
    fn();
  } catch (e) {
    return e instanceof ErroOperacao ? e : null;
  }
  return null;
};

describe('chave de cifra do CPF pelo ambiente', () => {
  it('sem variável: diz as duas variáveis e o formato', () => {
    const d = diagnosticoChaveCpf({});
    expect(d.chave).toBeNull();
    expect(d.variavel).toBeNull();
    expect(d.falta).toContain('PESSOAS_CHAVE_CPF');
    expect(d.falta).toContain('PLATAFORMA_CHAVE_MESTRA');
    expect(d.falta).toContain('32 bytes');
  });

  it('a chave própria tem preferência; a mestra vale na falta dela (a vazia não esconde a outra)', () => {
    expect(diagnosticoChaveCpf({ PESSOAS_CHAVE_CPF: HEX, PLATAFORMA_CHAVE_MESTRA: B64 })).toMatchObject({
      variavel: 'PESSOAS_CHAVE_CPF',
      falta: null,
    });
    const d = diagnosticoChaveCpf({ PESSOAS_CHAVE_CPF: '  ', PLATAFORMA_CHAVE_MESTRA: B64 });
    expect(d.variavel).toBe('PLATAFORMA_CHAVE_MESTRA');
    expect(d.chave?.equals(Buffer.alloc(32, 7))).toBe(true);
    expect(diagnosticoChaveCpf({ PESSOAS_CHAVE_CPF: HEX }).chave?.length).toBe(32);
    expect(
      diagnosticoChaveCpf({ PLATAFORMA_CHAVE_MESTRA: Buffer.alloc(32, 9).toString('base64url') }).chave
        ?.length,
    ).toBe(32);
  });

  it('chave inválida (tamanho ou caracteres): diz qual variável, nunca o valor', () => {
    for (const v of ['curta', Buffer.alloc(16).toString('base64'), `${HEX}00`, 'não é base64 nem hex!']) {
      const d = diagnosticoChaveCpf({ PLATAFORMA_CHAVE_MESTRA: v });
      expect(d.chave).toBeNull();
      expect(d.variavel).toBe('PLATAFORMA_CHAVE_MESTRA');
      expect(d.falta).toContain('PLATAFORMA_CHAVE_MESTRA é inválida');
      expect(d.falta).not.toContain(v);
    }
  });

  it('a cifra ausente recusa toda chamada com 503 chave-cpf-ausente e o que falta', () => {
    const c = cifraCpfAusente('Falta X');
    for (const f of [() => c.hmac('1'), () => c.cifrar('1'), () => c.decifrar('v1.a.b.c')]) {
      const e = problema(f);
      expect(e?.problema.status).toBe(503);
      expect(e?.problema.codigo).toBe('chave-cpf-ausente');
      expect(e?.problema.detail).toBe('Falta X');
    }
    expect(erroChaveCpfAusente('y').problema.codigo).toBe('chave-cpf-ausente');
  });

  it('cifraDasPortas: a entregue vale; sem ela, a que recusa com o diagnóstico do ambiente', () => {
    const real = new CifraCpf(Buffer.alloc(32, 1));
    expect(cifraDasPortas(real, {})).toBe(real);
    const e = problema(() => cifraDasPortas(null, {}).hmac('1'));
    expect(e?.problema.detail).toContain('PESSOAS_CHAVE_CPF');
    const t = problema(() => cifraDasPortas(null, { PESSOAS_CHAVE_CPF: HEX }).cifrar('1'));
    expect(t?.problema.detail).toContain('configuração de teste sem cifra');
  });
});
