// CPFs sintéticos (base 123456789 → 12345678909), nunca de pessoa real.
import { describe, expect, it } from 'vitest';
import { cpfDoLegado, cpfParaFiltro, mascararCpf } from './cpf.js';

describe('CPF do colaborador', () => {
  it('lê o número do outro sistema com zeros à esquerda; 0, vazio e nulo são "sem CPF"', () => {
    expect(cpfDoLegado(12345678909)).toBe('12345678909');
    expect(cpfDoLegado(1234567890)).toBe('01234567890');
    expect(cpfDoLegado(BigInt(12345678909))).toBe('12345678909');
    expect(cpfDoLegado('123.456.789-09')).toBe('12345678909');
    for (const v of [0, null, undefined, '', 100_000_000_000, Number.NaN]) expect(cpfDoLegado(v)).toBeNull();
  });

  it('mascara deixando só os 5 últimos dígitos', () => {
    expect(mascararCpf('12345678909')).toBe('***.***.789-09');
    expect(mascararCpf('1234567890')).toBe('***.***.678-90');
    expect(mascararCpf(null)).toBeNull();
  });

  it('o filtro exato é numérico e recusa o inválido', () => {
    expect(cpfParaFiltro('123.456.789-09')).toBe(12345678909);
    expect(() => cpfParaFiltro('123.456.789-00')).toThrow('CPF inválido.');
  });
});
