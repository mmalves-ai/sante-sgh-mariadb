import { describe, expect, it } from 'vitest';
import { dataDe, dataHoraDe, diaRelativo, horaDe, horaDigitadaParaLocal, minutosOu } from './formato.js';

describe('formato da recepção', () => {
  it('mostra a hora e a data como vieram do banco', () => {
    expect(horaDe('2026-10-21T08:05:09')).toBe('08:05');
    expect(horaDe('14:30')).toBe('14:30');
    expect(horaDe(null)).toBe('—');
    expect(dataDe('2026-10-21T08:05:09')).toBe('21/10/2026');
    expect(dataDe('x')).toBe('—');
    expect(dataHoraDe('2026-10-21T08:05:09')).toBe('21/10/2026 08:05');
    expect(dataHoraDe(undefined)).toBe('—');
  });
  it('minutos com vírgula e o dia relativo', () => {
    expect(minutosOu(12.345, 'sem')).toBe('12,3 min');
    expect(minutosOu(null, 'sem')).toBe('sem');
    expect(diaRelativo('2026-10-01', -1)).toBe('2026-09-30');
    expect(diaRelativo('2026-10-21', 0)).toBe('2026-10-21');
  });
});

describe('horaDigitadaParaLocal (M44, etapa 3)', () => {
  it('a hora no dia do relógio; depois da hora do relógio, o dia anterior', () => {
    expect(horaDigitadaParaLocal('2026-10-24T10:20:00', '1008')).toBe('2026-10-24T10:08');
    expect(horaDigitadaParaLocal('2026-10-24T10:20:00', '10:20')).toBe('2026-10-24T10:20');
    expect(horaDigitadaParaLocal('2026-10-24T00:05:00', '23:55')).toBe('2026-10-23T23:55');
    expect(horaDigitadaParaLocal('2026-10-24T10:20:00', '8:05')).toBe('2026-10-24T08:05');
  });
  it('hora inválida ou vazia é recusada (nunca vira outra hora)', () => {
    expect(() => horaDigitadaParaLocal('2026-10-24T10:20:00', '25:00')).toThrow();
    expect(() => horaDigitadaParaLocal('2026-10-24T10:20:00', '')).toThrow();
  });
});
