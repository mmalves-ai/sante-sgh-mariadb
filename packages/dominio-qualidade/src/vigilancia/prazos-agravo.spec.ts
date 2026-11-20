// Prazo da notificação compulsória (regra 3: agravo imediato em 24 h; semanal em 7 dias). Contas escritas no teste.
import { describe, expect, it } from 'vitest';
import {
  AVISO_AGRAVO_HORAS,
  estadoPrazoAgravo,
  horasAtePrazo,
  notificadoComAtraso,
  prazoDoAgravo,
} from './prazos-agravo.js';

describe('prazo do agravo', () => {
  it('imediata: 24 horas corridas do gatilho, atravessando o fim de semana e a virada do mês', () => {
    // Sábado 31/10/2026 22:15 + 24 h = domingo 01/11/2026 22:15.
    expect(prazoDoAgravo('imediata', '2026-10-31T22:15')).toBe('2026-11-01T22:15:00');
  });
  it('semanal: 7 dias corridos (168 h), com segundos no gatilho', () => {
    // 27/10/2026 08:30:10 + 7 dias = 03/11/2026 08:30:10 (feriado de 02/11 não muda: dias corridos).
    expect(prazoDoAgravo('semanal', '2026-10-27T08:30:10')).toBe('2026-11-03T08:30:10');
  });
  it('horas até o prazo, para baixo (e negativas depois dele)', () => {
    expect(horasAtePrazo('2026-10-28T08:30:00', '2026-10-27T08:30')).toBe(24);
    expect(horasAtePrazo('2026-10-28T08:30:00', '2026-10-28T07:31')).toBe(0);
    // 30 minutos depois do prazo: -0,5 h para baixo = -1.
    expect(horasAtePrazo('2026-10-28T08:30:00', '2026-10-28T09:00')).toBe(-1);
  });
});

describe('estado do prazo', () => {
  const prazo = '2026-10-28T08:30:00';
  it('aberto: no prazo, vencendo (6 h na imediata, 24 h na semanal) e vencido', () => {
    expect(AVISO_AGRAVO_HORAS).toEqual({ imediata: 6, semanal: 24 });
    // Faltam 7 h > 6 h.
    expect(estadoPrazoAgravo('imediata', prazo, '2026-10-28T01:30', 'aberto')).toEqual({
      estado: 'noPrazo',
      horasRestantes: 7,
    });
    // Faltam exatamente 6 h: já é "vencendo".
    expect(estadoPrazoAgravo('imediata', prazo, '2026-10-28T02:30', 'aberto').estado).toBe('vencendo');
    // Na semanal, faltar 7 h é "vencendo" (menos de 24 h).
    expect(estadoPrazoAgravo('semanal', prazo, '2026-10-28T01:30', 'aberto').estado).toBe('vencendo');
    expect(estadoPrazoAgravo('semanal', prazo, '2026-10-27T08:29', 'aberto').estado).toBe('noPrazo');
    // 1 minuto depois: vencido, -1 h.
    expect(estadoPrazoAgravo('imediata', prazo, '2026-10-28T08:31', 'aberto')).toEqual({
      estado: 'vencido',
      horasRestantes: -1,
    });
    // No minuto exato do prazo ainda não venceu.
    expect(estadoPrazoAgravo('imediata', prazo, '2026-10-28T08:30', 'aberto').estado).toBe('vencendo');
  });
  it('notificado é cumprido; descartado não tem prazo', () => {
    expect(estadoPrazoAgravo('imediata', prazo, '2026-11-30T00:00', 'notificado')).toEqual({
      estado: 'cumprido',
      horasRestantes: null,
    });
    expect(estadoPrazoAgravo('semanal', prazo, '2026-11-30T00:00', 'descartado')).toEqual({
      estado: 'naoSeAplica',
      horasRestantes: null,
    });
  });
  it('atraso da notificação', () => {
    expect(notificadoComAtraso(prazo, '2026-10-28T08:30')).toBe(false);
    expect(notificadoComAtraso(prazo, '2026-10-28T08:31')).toBe(true);
  });
});
