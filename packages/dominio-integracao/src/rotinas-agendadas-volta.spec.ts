// Regras do registro das voltas do worker (01-SIS L95): o que vira histórico, a próxima execução e a suspensão.
import { describe, expect, it } from 'vitest';
import {
  conferirSuspensao,
  destinoDaVolta,
  INTERVALO_MARCACAO_SEGUNDOS,
  proximaExecucaoPorIntervalo,
} from './rotinas-agendadas.js';

const T = new Date('2026-11-25T10:00:00Z');
const zero = { lidos: 0, gravados: 0, rejeitados: 0 };

describe('destino da volta', () => {
  it('falha, avisos, volume e acionamento manual vão ao histórico', () => {
    expect(destinoDaVolta({ situacao: 'falhou', volumes: zero, disparo: 'agendado' }, T, T)).toBe(
      'historico',
    );
    expect(
      destinoDaVolta({ situacao: 'concluida_com_avisos', volumes: zero, disparo: 'agendado' }, T, T),
    ).toBe('historico');
    expect(
      destinoDaVolta({ situacao: 'concluida', volumes: { ...zero, gravados: 1 }, disparo: 'agendado' }, T, T),
    ).toBe('historico');
    expect(destinoDaVolta({ situacao: 'concluida', volumes: zero, disparo: 'manual' }, T, T)).toBe(
      'historico',
    );
  });

  it('volta vazia só marca a rotina viva, no máximo a cada intervalo de marcação', () => {
    const v = { situacao: 'concluida' as const, volumes: zero, disparo: 'agendado' as const };
    expect(destinoDaVolta(v, null, T)).toBe('marcar');
    expect(destinoDaVolta(v, new Date(T.getTime() - 60_000), T)).toBe('nada');
    expect(destinoDaVolta(v, new Date(T.getTime() - INTERVALO_MARCACAO_SEGUNDOS * 1000), T)).toBe('marcar');
  });
});

describe('próxima execução e suspensão', () => {
  it('próxima pelo intervalo; sem intervalo, sem previsão', () => {
    expect(proximaExecucaoPorIntervalo(T, 60)?.toISOString()).toBe('2026-11-25T10:01:00.000Z');
    expect(proximaExecucaoPorIntervalo(T, null)).toBeNull();
    expect(proximaExecucaoPorIntervalo(T, 0)).toBeNull();
  });

  it('suspende a não suspensa e retoma só a suspensa (volta ociosa)', () => {
    expect(conferirSuspensao('ociosa', 'suspender')).toEqual({ situacao: 'suspensa' });
    expect(conferirSuspensao('com_falha', 'suspender')).toEqual({ situacao: 'suspensa' });
    expect(conferirSuspensao('suspensa', 'suspender')).toMatchObject({ recusa: 'rotina-suspensa' });
    expect(conferirSuspensao('suspensa', 'retomar')).toEqual({ situacao: 'ociosa' });
    expect(conferirSuspensao('ociosa', 'retomar')).toMatchObject({ recusa: 'rotina-nao-suspensa' });
  });
});
