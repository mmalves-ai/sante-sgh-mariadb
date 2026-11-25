// Referência da senha do servidor Firebird do cliente no cofre (obra carga-painel, ADR 0010).
import { describe, expect, it } from 'vitest';
import { lerReferenciaCofre, lerReferenciaCofreConector, referenciaCofreConector } from './cofre.js';

describe('referência de cofre do conector', () => {
  it('monta e lê a referência da senha do servidor do cliente', () => {
    const r = referenciaCofreConector('prontocardio');
    expect(r).toBe('cofre:conector/prontocardio/firebird-senha');
    expect(lerReferenciaCofreConector(r)).toEqual({ cliente: 'prontocardio', tipo: 'firebird-senha' });
    expect(lerReferenciaCofre(r)).toBeNull();
  });

  it('recusa código fora do padrão, caminho e outro tipo de segredo', () => {
    for (const c of ['', 'A', 'x', '1abc', 'a/b', '../x', 'a b'])
      expect(() => referenciaCofreConector(c)).toThrow();
    for (const r of [
      'cofre:conector/prontocardio/outra',
      'cofre:conector/../firebird-senha',
      'cofre:conector/prontocardio/firebird-senha/x',
      'env:FB_SENHA',
    ])
      expect(lerReferenciaCofreConector(r)).toBeNull();
  });
});
