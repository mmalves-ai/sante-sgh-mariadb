// Tempos do centro cirúrgico (regra 7): hora do dia "HH:MM", duração, instantes sem fuso e datas impossíveis.
import { describe, expect, it } from 'vitest';
import {
  dataImpossivel,
  deMinutosAbsolutos,
  diaDoInstante,
  duracaoEntre,
  duracaoTexto,
  duracaoValida,
  ErroTempoCirurgia,
  horaDeMinutos,
  instanteValido,
  lerInstante,
  minutosAbsolutos,
  minutosDaHora,
  somarMinutos,
} from './tempo.js';

describe('hora do dia e duração', () => {
  it('converte minutos e "HH:MM" nos dois sentidos', () => {
    expect(horaDeMinutos(90)).toBe('01:30');
    expect(minutosDaHora('01:30')).toBe(90);
    expect(minutosDaHora('24:60')).toBeNull();
    expect(minutosDaHora('0130')).toBeNull();
    expect(minutosDaHora(null)).toBeNull();
    expect(() => horaDeMinutos(1440)).toThrow(ErroTempoCirurgia);
  });
  it('duração em "HH:MM" e entre duas horas (passa da meia-noite)', () => {
    expect(duracaoTexto(150)).toBe('02:30');
    expect(() => duracaoTexto(0)).toThrow(/Duração/);
    expect(duracaoValida(1439)).toBe(true);
    expect(duracaoValida(1440)).toBe(false);
    expect(duracaoEntre('08:00', '09:30')).toBe(90);
    expect(duracaoEntre('23:30', '00:30')).toBe(60);
    expect(duracaoEntre('08:00', '08:00')).toBeNull();
    expect(duracaoEntre('08', '09:00')).toBeNull();
  });
});

describe('instantes', () => {
  it('lê, valida, soma e devolve o dia', () => {
    expect(lerInstante('2026-11-03 07:30')).toEqual({ ano: 2026, mes: 11, dia: 3, hora: 7, minuto: 30 });
    expect(instanteValido('2026-02-30 07:30')).toBe(false);
    expect(instanteValido('2026-11-03T07:30')).toBe(false);
    expect(somarMinutos('2026-11-03 23:30', 45)).toBe('2026-11-04 00:15');
    expect(deMinutosAbsolutos(minutosAbsolutos('2026-11-03 07:30'))).toBe('2026-11-03 07:30');
    expect(diaDoInstante('2026-11-03 07:30')).toBe('2026-11-03');
  });
  it('data impossível (ano 3203, 1899) fica fora da conta', () => {
    expect(dataImpossivel('3203-10-02 08:00')).toBe(true);
    expect(dataImpossivel('1899-12-30 00:00')).toBe(true);
    expect(dataImpossivel('2026-11-03 07:30')).toBe(false);
    expect(dataImpossivel('xxxx')).toBe(true);
  });
});
