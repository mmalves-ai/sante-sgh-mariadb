import { describe, expect, it } from 'vitest';
import {
  apresentarData,
  apresentarHora,
  colunasDaLargura,
  compararLinkId,
  linkIdDaOrdem,
  linkIdPai,
  nivelDaOrdem,
} from './layout.js';

describe('layout em grade de 12 colunas (regra 4)', () => {
  it.each([
    [744, 12],
    [700, 12],
    [350, 6],
    [160, 3],
    [135, 2],
    [10, 1],
    [699, 11],
    [undefined, 12],
    [0, 12],
    [Number.NaN, 12],
  ])('largura %s → %s colunas', (largura, colunas) => {
    expect(colunasDaLargura(largura)).toBe(colunas);
  });

  it('ordem do legado vira linkId em até 6 níveis', () => {
    expect(linkIdDaOrdem('010102')).toBe('01.01.02');
    expect(linkIdDaOrdem(' 01 ')).toBe('01');
    expect(linkIdDaOrdem('010203040506')).toBe('01.02.03.04.05.06');
    expect(nivelDaOrdem('0102030405')).toBe(5);
    expect(() => linkIdDaOrdem('01020304050607')).toThrow(/6 níveis/);
    expect(() => linkIdDaOrdem('012')).toThrow(/pares/);
    expect(() => linkIdDaOrdem('0a')).toThrow(/pares/);
    expect(linkIdPai('01.02.03')).toBe('01.02');
    expect(linkIdPai('01')).toBeNull();
  });

  it('ordena pela árvore (pai antes do filho, numérico por nível)', () => {
    const ids = ['01.10', '01.02.01', '02', '01', '01.02'];
    expect([...ids].sort(compararLinkId)).toEqual(['01', '01.02', '01.02.01', '01.10', '02']);
    expect(compararLinkId('01.02', '01.02')).toBe(0);
  });

  it('sentinela 1899-12-30 vira vazio e HHMM vira HH:MM só na apresentação', () => {
    expect(apresentarData('1899-12-30')).toBe('');
    expect(apresentarData('30/12/1899')).toBe('');
    expect(apresentarData('2026-10-19')).toBe('19/10/2026');
    expect(apresentarData('19/10/2026')).toBe('19/10/2026');
    expect(apresentarData(null)).toBe('');
    expect(apresentarHora('0830')).toBe('08:30');
    expect(apresentarHora('2359')).toBe('23:59');
    expect(apresentarHora('2460')).toBe('2460');
    expect(apresentarHora(undefined)).toBe('');
  });
});
