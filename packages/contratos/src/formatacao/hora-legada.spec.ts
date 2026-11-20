import { describe, expect, it } from 'vitest';
import { ErroValidacao, falhaDe } from '../validacao/erro.js';
import { classificarHora, esquemaHoraLegada, formatarHoraLegada, paraHhmm } from './hora-legada.js';

// Casos da sante-api (test/utils-sgh.test.js: toHHMM e formatHora), reescritos com valores sintéticos.
describe('hora legada HHMM', () => {
  it('normaliza HH:MM, HHMM, H:MM e HMM para quatro dígitos', () => {
    expect(paraHhmm('08:00')).toBe('0800');
    expect(paraHhmm('0800')).toBe('0800');
    expect(paraHhmm('8:00')).toBe('0800');
    expect(paraHhmm('800')).toBe('0800');
    expect(paraHhmm('1630')).toBe('1630');
    expect(paraHhmm(' 23:59 ')).toBe('2359');
    expect(paraHhmm('00:00')).toBe('0000');
  });

  it('recusa fora da faixa e formato inválido', () => {
    expect(() => paraHhmm('25:00')).toThrow(/fora do intervalo/);
    expect(() => paraHhmm('12:60')).toThrow(/fora do intervalo/);
    expect(() => paraHhmm('abc')).toThrow(/Hora inválida/);
    expect(() => paraHhmm('8:0')).toThrow(/Hora inválida/);
    expect(() => paraHhmm('08:00:00')).toThrow(/Hora inválida/);
    expect(() => paraHhmm('')).toThrow(/Hora inválida/);
  });

  it('o contrato carrega HHMM, nunca "08:01" (que quebra o trigger)', () => {
    expect(esquemaHoraLegada.parse('08:01')).toBe('0801');
    expect(esquemaHoraLegada.safeParse('24:00').success).toBe(false);
  });

  it('exibe HH:MM e trata vazios', () => {
    expect(formatarHoraLegada('1000')).toBe('10:00');
    expect(formatarHoraLegada('0805')).toBe('08:05');
    expect(formatarHoraLegada('805')).toBe('08:05');
    expect(formatarHoraLegada('08:00')).toBe('08:00');
    expect(formatarHoraLegada('')).toBeNull();
    expect(formatarHoraLegada(null)).toBeNull();
    expect(formatarHoraLegada(undefined)).toBeNull();
  });
});

describe('hora legada: código de validação e exibição de valor inválido', () => {
  it('o erro carrega código e parâmetros para a tela traduzir', () => {
    expect(() => paraHhmm('abc')).toThrow(ErroValidacao);
    try {
      paraHhmm('25:00');
    } catch (e) {
      expect(falhaDe(e)).toEqual({ codigo: 'hora.fora-do-intervalo', parametros: { entrada: '25:00' } });
    }
    try {
      paraHhmm('x');
    } catch (e) {
      expect(falhaDe(e)?.codigo).toBe('hora.formato');
    }
    expect(falhaDe(new Error('x'))).toBeNull();
  });

  it('classificarHora: válida, vazia e inválida (sem "corrigir")', () => {
    expect(classificarHora('0830')).toEqual({ tipo: 'valida', texto: '08:30' });
    expect(classificarHora('830')).toEqual({ tipo: 'valida', texto: '08:30' });
    expect(classificarHora('8:30')).toEqual({ tipo: 'valida', texto: '08:30' });
    expect(classificarHora(' ')).toEqual({ tipo: 'vazia' });
    expect(classificarHora(null)).toEqual({ tipo: 'vazia' });
    expect(classificarHora('2575')).toEqual({ tipo: 'invalida', bruto: '2575' });
    expect(classificarHora('08300')).toEqual({ tipo: 'invalida', bruto: '08300' });
    expect(classificarHora('ab:cd')).toEqual({ tipo: 'invalida', bruto: 'ab:cd' });
  });
});
