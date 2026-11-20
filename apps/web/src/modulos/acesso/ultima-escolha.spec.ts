import { describe, expect, it } from 'vitest';
import { escolhaInicial, lembrarEscolha, ultimaEscolha } from './ultima-escolha.js';

describe('última escolha do seletor', () => {
  it('lembra só o código e tolera armazenamento ausente ou que lança', () => {
    const mapa = new Map<string, string>();
    const arm = {
      setItem: (k: string, v: string) => void mapa.set(k, v),
      getItem: (k: string) => mapa.get(k) ?? null,
    };
    lembrarEscolha('bb', arm);
    expect(ultimaEscolha(arm)).toBe('bb');
    const quebrado = {
      setItem: () => {
        throw new Error('bloqueado');
      },
      getItem: () => {
        throw new Error('bloqueado');
      },
    };
    expect(() => lembrarEscolha('aa', quebrado)).not.toThrow();
    expect(ultimaEscolha(quebrado)).toBeNull();
    expect(ultimaEscolha(null)).toBeNull();
  });
  it('escolha inicial: pedida > lembrada > primeira disponível; ignora indisponível', () => {
    const d = [{ codigo: 'aa' }, { codigo: 'bb' }];
    expect(escolhaInicial(d, 'bb', 'aa')).toBe('bb');
    expect(escolhaInicial(d, null, 'bb')).toBe('bb');
    expect(escolhaInicial(d, 'zz', 'yy')).toBe('aa');
    expect(escolhaInicial([], null, null)).toBe('');
  });
});
