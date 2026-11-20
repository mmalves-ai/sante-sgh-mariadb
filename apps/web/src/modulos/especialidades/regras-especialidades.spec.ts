import { describe, expect, it } from 'vitest';
import {
  agoraCivil,
  dataLonga,
  diasDoTexto,
  horariosDoTexto,
  horasEntre,
  instanteCurto,
  leitoTexto,
  numero,
  pontoNoGrafico,
} from './regras-especialidades.js';

describe('regras de tela das especialidades', () => {
  it('textos do leito, do instante, da data e do número', () => {
    expect(leitoTexto({ bloco: 'CO', acomodacao: '01', leito: 'A' })).toBe('CO 01 A');
    expect(instanteCurto('2026-10-25T09:45')).toBe('25/10 09:45');
    expect(instanteCurto(null)).toBe('');
    expect(dataLonga('2026-10-25')).toBe('25/10/2026');
    expect(dataLonga(undefined)).toBe('');
    expect(numero(1.82, 2)).toBe('1,82');
    expect(numero(null)).toBe('');
    expect(agoraCivil(new Date(2026, 9, 5, 7, 3))).toBe('2026-10-05T07:03');
  });
  it('os horários e os dias digitados', () => {
    expect(horariosDoTexto('9:00, 12:00;15:00  ')).toEqual(['09:00', '12:00', '15:00']);
    expect(diasDoTexto('1, 8 15 x 0')).toEqual([1, 8, 15]);
  });
  it('o gráfico do partograma: 0 h e 0 cm embaixo à esquerda; 12 h e 10 cm em cima à direita; fora da escala, na borda', () => {
    expect(pontoNoGrafico(0, 0)).toEqual({ x: 0, y: 240 });
    expect(pontoNoGrafico(12, 10)).toEqual({ x: 480, y: 0 });
    expect(pontoNoGrafico(6, 5)).toEqual({ x: 240, y: 120 });
    expect(pontoNoGrafico(20, 12)).toEqual({ x: 480, y: 0 });
    expect(horasEntre('2026-10-25T10:00', '2026-10-25T14:30')).toBe(4.5);
  });
});
