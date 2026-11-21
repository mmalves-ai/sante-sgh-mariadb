import { describe, expect, it } from 'vitest';
import { falhaDe } from '../validacao/erro.js';
import {
  dataHoraParaInstante,
  esquemaHora,
  esquemaInstante,
  horaParaMinutos,
  instanteParaDataHora,
  instanteParaHora,
  lerHoraDigitada,
  minutosParaHora,
} from './hora.js';

describe('hora neutra HH:MM', () => {
  it('o esquema aceita só HH:MM de 00:00 a 23:59', () => {
    expect(esquemaHora.parse('08:30')).toBe('08:30');
    expect(esquemaHora.parse('23:59')).toBe('23:59');
    for (const x of ['0830', '8:30', '24:00', '12:60', '', '08:30:00'])
      expect(esquemaHora.safeParse(x).success).toBe(false);
  });

  it('lê o digitado e devolve HH:MM, com código de erro para a tela', () => {
    expect(lerHoraDigitada('8:30')).toBe('08:30');
    expect(lerHoraDigitada('0830')).toBe('08:30');
    expect(lerHoraDigitada('830')).toBe('08:30');
    expect(lerHoraDigitada(' 23:59 ')).toBe('23:59');
    expect(lerHoraDigitada('  ')).toBeNull();
    const codigo = (e: string) => {
      try {
        lerHoraDigitada(e);
        return null;
      } catch (erro) {
        return falhaDe(erro)?.codigo;
      }
    };
    expect(codigo('25:00')).toBe('hora.fora-do-intervalo');
    expect(codigo('12:60')).toBe('hora.fora-do-intervalo');
    expect(codigo('abc')).toBe('hora.formato');
    expect(codigo('08300')).toBe('hora.formato');
  });

  it('converte de e para minutos do dia', () => {
    expect(horaParaMinutos('00:00')).toBe(0);
    expect(horaParaMinutos('08:30')).toBe(510);
    expect(horaParaMinutos('23:59')).toBe(1439);
    expect(minutosParaHora(510)).toBe('08:30');
    expect(minutosParaHora(0)).toBe('00:00');
    expect(minutosParaHora(1439)).toBe('23:59');
    expect(() => minutosParaHora(1440)).toThrow(/fora do dia/);
    expect(() => minutosParaHora(-1)).toThrow();
    expect(() => minutosParaHora(1.5)).toThrow();
    expect(() => horaParaMinutos('8:30')).toThrow(/HH:MM/);
    for (let m = 0; m < 1440; m += 7) expect(horaParaMinutos(minutosParaHora(m))).toBe(m);
  });
});

describe('instante com o fuso do estabelecimento', () => {
  it('data e hora locais viram instante UTC e voltam', () => {
    expect(dataHoraParaInstante('2026-11-21', '08:30', 'America/Sao_Paulo')).toBe('2026-11-21T11:30:00.000Z');
    expect(dataHoraParaInstante('2026-11-21', '22:15', 'America/Manaus')).toBe('2026-11-22T02:15:00.000Z');
    expect(dataHoraParaInstante('2026-11-21', '08:30', 'UTC')).toBe('2026-11-21T08:30:00.000Z');
    expect(instanteParaDataHora('2026-11-21T11:30:00.000Z', 'America/Sao_Paulo')).toEqual({
      data: '2026-11-21',
      hora: '08:30',
    });
    expect(instanteParaDataHora('2026-11-22T02:15:00Z', 'America/Manaus')).toEqual({
      data: '2026-11-21',
      hora: '22:15',
    });
    expect(instanteParaHora('2026-11-21T08:30:00-03:00')).toBe('08:30');
  });

  it('respeita o horário de verão do fuso (inverno e verão em Nova York)', () => {
    expect(dataHoraParaInstante('2026-01-15', '09:00', 'America/New_York')).toBe('2026-01-15T14:00:00.000Z');
    expect(dataHoraParaInstante('2026-07-15', '09:00', 'America/New_York')).toBe('2026-07-15T13:00:00.000Z');
    expect(instanteParaHora('2026-07-15T13:00:00Z', 'America/New_York')).toBe('09:00');
  });

  it('recusa entrada malformada', () => {
    expect(() => dataHoraParaInstante('21/11/2026', '08:30')).toThrow(/AAAA-MM-DD/);
    expect(() => dataHoraParaInstante('2026-11-21', '0830')).toThrow(/HH:MM/);
    expect(() => instanteParaHora('2026-11-21 08:30')).toThrow(/Instante inválido/);
    expect(esquemaInstante.safeParse('2026-11-21T08:30:00').success).toBe(false);
    expect(esquemaInstante.safeParse('2026-11-21T08:30:00-03:00').success).toBe(true);
  });
});
