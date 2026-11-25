// Regras do registro das voltas do worker (01-SIS L95): o que vira histórico, a próxima execução e a suspensão.
import { describe, expect, it } from 'vitest';
import {
  conferirAlcanceRotina,
  conferirSuspensao,
  parametrosDaRotina,
  rotinaSuspensivel,
  visaoDoEstabelecimento,
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

describe('suspensão e alcance da rotina do cliente', () => {
  it('rotina não suspensível recusa suspender, mas a já suspensa se retoma', () => {
    expect(conferirSuspensao('ociosa', 'suspender', false)).toEqual({
      recusa: 'rotina-nao-suspensivel',
      mensagem: expect.stringContaining('não se suspende'),
    });
    expect(conferirSuspensao('suspensa', 'retomar', false)).toEqual({ situacao: 'ociosa' });
    expect(conferirSuspensao('ociosa', 'suspender')).toEqual({ situacao: 'suspensa' });
  });

  it('parâmetros guardados dizem se a rotina aceita suspensão (ausente ou ilegível: aceita)', () => {
    expect(parametrosDaRotina({ permiteSuspensao: false })).toEqual({ suspensivel: false });
    expect(parametrosDaRotina({})).toEqual({ suspensivel: true });
    expect(rotinaSuspensivel('{"suspensivel":false}')).toBe(false);
    expect(rotinaSuspensivel({ suspensivel: false })).toBe(false);
    expect(rotinaSuspensivel(null)).toBe(true);
    expect(rotinaSuspensivel('{quebrado')).toBe(true);
  });

  it('rotina do cliente inteiro só com o alcance do cliente', () => {
    expect(conferirAlcanceRotina(true, false)).toBe('rotina-do-cliente');
    expect(conferirAlcanceRotina(true, true)).toBeNull();
    expect(conferirAlcanceRotina(false, false)).toBeNull();
  });

  it('sem o alcance do cliente, as etapas de outros estabelecimentos somem e os volumes são os que ficaram', () => {
    const etapas = [
      { nome: 'est_a', lidos: 1, gravados: 2, rejeitados: 0 },
      { nome: 'est_b', lidos: 5, gravados: 7, rejeitados: 1 },
    ];
    const total = { lidos: 6, gravados: 9, rejeitados: 1 };
    expect(visaoDoEstabelecimento(total, etapas, new Set(['est_b']))).toEqual({
      volumes: { lidos: 1, gravados: 2, rejeitados: 0 },
      etapas: [etapas[0]],
    });
    expect(visaoDoEstabelecimento(total, etapas, new Set(['est_c']))).toEqual({ volumes: total, etapas });
  });
});
