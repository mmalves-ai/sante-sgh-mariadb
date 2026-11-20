import { describe, expect, it } from 'vitest';
import { dataBr, horaBr, horaDoContrato, pctBr, somarDias } from './formato.js';

describe('formatos da agenda', () => {
  it('data e hora para a tela', () => {
    expect(dataBr('2026-10-21')).toBe('21/10/2026');
    expect(dataBr(null)).toBe('');
    expect(dataBr('x')).toBe('x');
    expect(horaBr('0815')).toBe('08:15');
    expect(horaBr('08:15')).toBe('08:15');
    expect(horaBr('')).toBe('');
    expect(horaBr('8')).toBe('8');
  });
  it('hora digitada para o contrato', () => {
    expect(horaDoContrato('08:15')).toBe('0815');
    expect(horaDoContrato('815')).toBe('0815');
    expect(horaDoContrato('2400')).toBeNull();
    expect(horaDoContrato('1260')).toBeNull();
    expect(horaDoContrato('ab')).toBeNull();
    expect(horaDoContrato(undefined)).toBeNull();
  });
  it('soma de dias e percentual', () => {
    expect(somarDias('2026-10-31', 1)).toBe('2026-11-01');
    expect(pctBr(12.345)).toBe('12,3');
  });
});
