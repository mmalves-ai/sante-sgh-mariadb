import { describe, expect, it } from 'vitest';
import {
  conferirLoginNovo,
  mensagemFalhaLogin,
  mesmoLogin,
  parecidosNaCaixa,
  TAMANHO_LOGIN,
  usuarioDaGravacao,
} from './login.js';

describe('login é a chave (regra 2)', () => {
  it('confere sem corrigir', () => {
    expect(conferirLoginNovo('')).toBe('vazio');
    expect(conferirLoginNovo('x'.repeat(TAMANHO_LOGIN + 1))).toBe('longo');
    expect(conferirLoginNovo('x'.repeat(TAMANHO_LOGIN))).toBeNull();
    expect(conferirLoginNovo(' SINT')).toBe('espacos-nas-pontas');
    expect(conferirLoginNovo('SINT ')).toBe('espacos-nas-pontas');
    expect(conferirLoginNovo('SINT USUARIO')).toBe('espaco-interno');
    expect(conferirLoginNovo('JOÃO')).toBe('caractere-invalido');
    expect(conferirLoginNovo('sint.usuario_2@x-y')).toBeNull();
  });
  it('mensagens de produto para cada falha', () => {
    for (const f of [
      'vazio',
      'longo',
      'espacos-nas-pontas',
      'espaco-interno',
      'caractere-invalido',
    ] as const) {
      const m = mensagemFalhaLogin(f);
      expect(m.length).toBeGreaterThan(5);
      expect(m).not.toMatch(/spdata|legado|sistema atual/i);
    }
  });
  it('comparação exata e sensível a maiúsculas', () => {
    expect(mesmoLogin('HALAI', 'HALAI')).toBe(true);
    expect(mesmoLogin('hal-ai', 'HALAI')).toBe(false);
    expect(mesmoLogin('Sint', 'SINT')).toBe(false);
    expect(mesmoLogin(null, 'SINT')).toBe(false);
    expect(mesmoLogin('SINT', undefined)).toBe(false);
  });
  it('avisa os parecidos na caixa (são outros usuários)', () => {
    expect(parecidosNaCaixa('joao', ['JOAO', 'Joao', 'joao', 'MARIA'])).toEqual(['JOAO', 'Joao']);
  });
  it('as colunas USUARIO* recebem o login de quem opera', () => {
    expect(usuarioDaGravacao({ login: 'SINT.GESTOR' })).toBe('SINT.GESTOR');
    expect(() => usuarioDaGravacao({ login: '' })).toThrow(/login de quem opera/);
  });
});
