import { describe, expect, it } from 'vitest';
import { dataHoraBr, idade } from './formato.js';

describe('formatação do prontuário', () => {
  it('data e hora em pt-BR', () => {
    expect(dataHoraBr('2024-05-01T09:30')).toBe('01/05/2024 09:30');
    expect(dataHoraBr('2024-05-01')).toBe('01/05/2024');
    expect(dataHoraBr(null)).toBe('');
    expect(dataHoraBr('x')).toBe('x');
  });
  it('idade pelo nascimento', () => {
    const hoje = new Date(2026, 9, 20);
    expect(idade('1980-02-03', hoje)).toBe(46);
    expect(idade('1980-12-03', hoje)).toBe(45);
    expect(idade(null, hoje)).toBeNull();
    expect(idade('2100-01-01', hoje)).toBeNull();
  });
});
