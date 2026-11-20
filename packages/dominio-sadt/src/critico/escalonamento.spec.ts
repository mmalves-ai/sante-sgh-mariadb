// Regra 7 (ficha do M26): valor crítico pela faixa aprovada, aviso em menos de 1 minuto, escalonamento sem ciência.
import { describe, expect, it } from 'vitest';
import {
  elementosCriticos,
  type FaixaCritica,
  indicadoresCriticos,
  nivelDoAviso,
  noPrazo,
  proximoEscalonamento,
  segundosAteAviso,
  valorCritico,
} from './escalonamento.js';

const potassio: FaixaCritica = { elemento: 1, abaixoDe: 2.5, acimaDe: 6.5, prazoMinutos: 30, ativo: true };

describe('valor crítico (regra 7)', () => {
  it('pela faixa ativa do elemento, com limite estrito', () => {
    expect(valorCritico(7.1, potassio)).toBe(true);
    expect(valorCritico(2.4, potassio)).toBe(true);
    expect(valorCritico(6.5, potassio)).toBe(false);
    expect(valorCritico(4, potassio)).toBe(false);
    expect(valorCritico(null, potassio)).toBe(false);
    expect(valorCritico(9, { ...potassio, ativo: false })).toBe(false);
    expect(valorCritico(9, null)).toBe(false);
    expect(valorCritico(9, { ...potassio, abaixoDe: null })).toBe(true);
  });

  it('os elementos críticos do resultado', () => {
    expect(
      elementosCriticos(
        [
          { elemento: 1, numerico: 7.2 },
          { elemento: 2, numerico: 200 },
          { elemento: 1, numerico: null },
        ],
        [potassio],
      ),
    ).toEqual([{ elemento: 1, valor: 7.2, prazoMinutos: 30 }]);
  });

  it('escalonamento: responsável, plantonista depois do prazo, supervisor depois do dobro', () => {
    const emitidoEm = '2026-10-22T10:00:00.000Z';
    expect(nivelDoAviso({ emitidoEm, prazoMinutos: 30, agora: '2026-10-22T10:29:00.000Z' })).toBe(0);
    expect(nivelDoAviso({ emitidoEm, prazoMinutos: 30, agora: '2026-10-22T10:30:00.000Z' })).toBe(1);
    expect(nivelDoAviso({ emitidoEm, prazoMinutos: 30, agora: '2026-10-22T11:05:00.000Z' })).toBe(2);
    expect(
      nivelDoAviso({
        emitidoEm,
        prazoMinutos: 30,
        agora: '2026-10-22T12:00:00.000Z',
        cienciaEm: '2026-10-22T10:10:00.000Z',
      }),
    ).toBe(0);
    expect(proximoEscalonamento({ emitidoEm, prazoMinutos: 30, nivel: 0 })).toBe('2026-10-22T10:30:00.000Z');
    expect(proximoEscalonamento({ emitidoEm, prazoMinutos: 30, nivel: 1 })).toBe('2026-10-22T11:00:00.000Z');
    expect(proximoEscalonamento({ emitidoEm, prazoMinutos: 30, nivel: 2 })).toBeNull();
  });

  it('ciência no prazo, segundos até o aviso e os indicadores com as parcelas', () => {
    const emitidoEm = '2026-10-22T10:00:00.000Z';
    expect(noPrazo({ emitidoEm, prazoMinutos: 30, cienciaEm: '2026-10-22T10:20:00.000Z' })).toBe(true);
    expect(noPrazo({ emitidoEm, prazoMinutos: 30, cienciaEm: '2026-10-22T10:40:00.000Z' })).toBe(false);
    expect(noPrazo({ emitidoEm, prazoMinutos: 30, cienciaEm: null })).toBe(false);
    expect(segundosAteAviso('2026-10-22T09:59:20.000Z', emitidoEm)).toBe(40);
    expect(segundosAteAviso('2026-10-22T10:00:05.000Z', emitidoEm)).toBe(0);
    expect(
      indicadoresCriticos([
        { emitidoEm, prazoMinutos: 30, cienciaEm: '2026-10-22T10:10:00.000Z' },
        { emitidoEm, prazoMinutos: 30, cienciaEm: '2026-10-22T10:50:00.000Z' },
        { emitidoEm, prazoMinutos: 30, cienciaEm: null },
      ]),
    ).toEqual({ total: 3, noPrazo: 1, comCiencia: 2, mediaMinutos: 30 });
    expect(indicadoresCriticos([])).toEqual({ total: 0, noPrazo: 0, comCiencia: 0, mediaMinutos: null });
  });
});
