// Casos de sante-api: test/busca-por-cpf.test.js, reescritos com CPFs sintéticos (nenhum de pessoa real).
import { describe, expect, it } from 'vitest';
import { cpfDoLegado, cpfParaGravar, cpfValido, formatarCpf, mascararCpf } from './cpf.js';

describe('CPF (regra 2)', () => {
  it('aceita o dígito verificador certo, com ou sem máscara', () => {
    expect(cpfValido('90000000175')).toBe(true);
    expect(cpfValido('900.000.001-75')).toBe(true);
    expect(cpfValido('123.456.789-09')).toBe(true);
  });
  it('recusa dígito errado, tamanho errado e sequências repetidas (00000000000 não é CPF)', () => {
    expect(cpfValido('90000000176')).toBe(false);
    expect(cpfValido('9000000017')).toBe(false);
    expect(cpfValido('00000000000')).toBe(false);
    expect(cpfValido('11111111111')).toBe(false);
    expect(cpfValido('')).toBe(false);
  });
  it('lê o número do legado com os zeros à esquerda; zero e vazio são "sem CPF"', () => {
    expect(cpfDoLegado(19100)).toBe('00000019100');
    expect(cpfDoLegado('19100')).toBe('00000019100');
    expect(cpfDoLegado(90000000175)).toBe('90000000175');
    expect(cpfDoLegado(BigInt(90000000175))).toBe('90000000175');
    expect(cpfDoLegado(0)).toBeNull();
    expect(cpfDoLegado(null)).toBeNull();
    expect(cpfDoLegado(undefined)).toBeNull();
    expect(cpfDoLegado('')).toBeNull();
    expect(cpfDoLegado(1e12)).toBeNull();
  });
  it('mostra 11 dígitos formatados e mascara em lista', () => {
    expect(formatarCpf('19100')).toBe('000.000.191-00');
    expect(mascararCpf('90000000175')).toBe('***.***.001-75');
    expect(mascararCpf(null)).toBeNull();
  });
  it('grava no tipo numérico do legado e recusa o inválido', () => {
    expect(cpfParaGravar('000.000.191-00')).toBe(19100);
    expect(() => cpfParaGravar('11111111111')).toThrow(/inválido/);
  });
});
