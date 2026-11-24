// Participação por membro da equipe: horas dentro da sala, saída depois da entrada, percentual padrão da função.
import { describe, expect, it } from 'vitest';
import { conferirParticipacao, minutosDepois, PERCENTUAL_PADRAO_FUNCAO } from './participacao.js';

const sala = { entrada: '15:50', saida: '17:30' };
const nada = { entrada: null, saida: null, percentual: null };

describe('participação no ato', () => {
  it('sem horas: o ato inteiro, com o percentual padrão da função', () => {
    expect(conferirParticipacao('auxiliar1', nada, sala)).toEqual({
      ok: true,
      valor: { entradaMin: null, saidaMin: null, percentual: 30 },
    });
    expect(conferirParticipacao('anestesista', nada, sala)).toMatchObject({ valor: { percentual: null } });
    expect(PERCENTUAL_PADRAO_FUNCAO['cirurgiao']).toBe(100);
  });
  it('troca de anestesista no meio do ato: entrada e saída em minutos desde a entrada do paciente', () => {
    expect(
      conferirParticipacao('anestesista', { entrada: '16:20', saida: '17:30', percentual: null }, sala),
    ).toEqual({ ok: true, valor: { entradaMin: 30, saidaMin: 100, percentual: null } });
  });
  it('percentual informado prevalece sobre o padrão', () => {
    expect(conferirParticipacao('auxiliar2', { ...nada, percentual: 25 }, sala)).toMatchObject({
      valor: { percentual: 25 },
    });
  });
  it('recusa hora fora da sala, saída antes da entrada e percentual fora de 0 a 100', () => {
    expect(conferirParticipacao('cirurgiao', { ...nada, entrada: '15:00' }, sala)).toMatchObject({
      ok: false,
      campo: 'entrada',
    });
    expect(conferirParticipacao('cirurgiao', { ...nada, saida: '18:00' }, sala)).toMatchObject({
      ok: false,
      campo: 'saida',
    });
    expect(
      conferirParticipacao('cirurgiao', { entrada: '16:40', saida: '16:10', percentual: null }, sala),
    ).toMatchObject({ ok: false, campo: 'saida' });
    expect(conferirParticipacao('cirurgiao', { ...nada, percentual: 120 }, sala)).toMatchObject({
      ok: false,
      campo: 'percentual',
    });
  });
  it('ato que vira a meia-noite', () => {
    expect(minutosDepois('23:30', '00:15')).toBe(45);
    expect(
      conferirParticipacao(
        'auxiliar1',
        { entrada: '23:40', saida: '00:20', percentual: null },
        {
          entrada: '23:30',
          saida: '01:00',
        },
      ),
    ).toEqual({ ok: true, valor: { entradaMin: 10, saidaMin: 50, percentual: 30 } });
  });
});
