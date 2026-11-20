// Tempos do centro cirúrgico (regra 7): HHMM, duração, instantes sem fuso e datas impossíveis.
import { describe, expect, it } from 'vitest';
import {
  dataImpossivel,
  deMinutosAbsolutos,
  diaDoInstante,
  duracaoEntre,
  duracaoTexto,
  duracaoValida,
  ErroTempoCirurgia,
  formatarHhmm,
  hhmmDeMinutos,
  instanteValido,
  lerInstante,
  minutosAbsolutos,
  minutosDeHhmm,
  somarMinutos,
} from './tempo.js';

describe('HHMM e duração', () => {
  it('converte minutos e HHMM nos dois sentidos', () => {
    expect(hhmmDeMinutos(90)).toBe('0130');
    expect(minutosDeHhmm('0130')).toBe(90);
    expect(minutosDeHhmm('2460')).toBeNull();
    expect(minutosDeHhmm(null)).toBeNull();
    expect(formatarHhmm('0905')).toBe('09:05');
    expect(formatarHhmm('xx')).toBe('');
    expect(() => hhmmDeMinutos(1440)).toThrow(ErroTempoCirurgia);
  });
  it('duração em HHMM de CCCADCIR e entre duas horas (passa da meia-noite)', () => {
    expect(duracaoTexto(150)).toBe('0230');
    expect(() => duracaoTexto(0)).toThrow(/Duração/);
    expect(duracaoValida(1439)).toBe(true);
    expect(duracaoValida(1440)).toBe(false);
    expect(duracaoEntre('0800', '0930')).toBe(90);
    expect(duracaoEntre('2330', '0030')).toBe(60);
    expect(duracaoEntre('0800', '0800')).toBeNull();
    expect(duracaoEntre('08', '0900')).toBeNull();
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
  it('data impossível do legado (ano 3203, 1899) fica fora da conta', () => {
    expect(dataImpossivel('3203-10-02 08:00')).toBe(true);
    expect(dataImpossivel('1899-12-30 00:00')).toBe(true);
    expect(dataImpossivel('2026-11-03 07:30')).toBe(false);
    expect(dataImpossivel('xxxx')).toBe(true);
  });
});
