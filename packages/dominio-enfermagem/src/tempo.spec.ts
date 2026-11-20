// Horas locais em texto (sem fuso) usadas pelas regras da beira do leito.
import { describe, expect, it } from 'vitest';
import {
  dataDe,
  deMinutos,
  diferencaMinutos,
  ErroHora,
  minutos,
  minutosDoDia,
  somarMinutos,
} from './tempo.js';

describe('tempo local', () => {
  it('converte, soma e compara minutos', () => {
    expect(deMinutos(minutos('2026-10-22T10:30'))).toBe('2026-10-22T10:30');
    expect(somarMinutos('2026-10-22T23:30', 45)).toBe('2026-10-23T00:15');
    expect(diferencaMinutos('2026-10-22T10:00', '2026-10-22T11:01')).toBe(61);
    expect(minutos('2026-10-22T10:30:59')).toBe(minutos('2026-10-22T10:30'));
    expect(minutosDoDia('0730')).toBe(450);
    expect(minutosDoDia('07:30')).toBe(450);
    expect(dataDe('2026-10-22T10:30')).toBe('2026-10-22');
  });
  it('recusa o formato errado', () => {
    expect(() => minutos('22/10/2026')).toThrow(ErroHora);
    expect(() => minutosDoDia('25:00')).toThrow(ErroHora);
  });
});
