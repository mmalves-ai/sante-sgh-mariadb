import { describe, expect, it } from 'vitest';
import {
  conferirHorarioNaSala,
  conferirTransicao,
  estadoDaSituacao,
  type HorarioPedido,
  type SalaDaAgenda,
  SITUACOES_AGENDAMENTO_MODELO,
  situacaoDoEstado,
} from './agenda-modelo.js';
import { ESTADOS_AGENDAMENTO } from './estados.js';

const sala: SalaDaAgenda = {
  id: 1,
  preparoMin: 0,
  duracaoMinimaMin: null,
  intervaloMinimoMin: null,
  procedimentosVedados: [],
};
const pedido = (x: Partial<HorarioPedido> = {}): HorarioPedido => ({
  id: 0,
  sala: 1,
  inicio: '2030-01-10 10:00',
  duracaoMin: 60,
  limpezaMin: 0,
  procedimentos: [7],
  preparoMinimoMin: 0,
  agora: '2030-01-09 08:00',
  anterior: null,
  excecao: false,
  ...x,
});
const ocupada = (id: number, inicio: string, duracaoMin = 60, intervaloMin = 0) => ({
  id,
  sala: 1,
  inicio,
  duracaoMin,
  intervaloMin,
});

describe('situação do modelo ↔ estado da tela', () => {
  it('toda situação do modelo tem estado; o código desconhecido devolve null', () => {
    for (const s of SITUACOES_AGENDAMENTO_MODELO) expect(estadoDaSituacao(s)).not.toBeNull();
    expect(estadoDaSituacao('agendado')).toBe('confirmado');
    expect(estadoDaSituacao('em_andamento')).toBe('em-sala');
    expect(estadoDaSituacao('no_bloco')).toBe('no-bloco');
    expect(estadoDaSituacao('inexistente')).toBeNull();
  });
  it('cada estado da tela vai a uma situação que volta ao mesmo estado (inclusive "no bloco")', () => {
    for (const e of ESTADOS_AGENDAMENTO) expect(estadoDaSituacao(situacaoDoEstado(e))).toBe(e);
    expect(situacaoDoEstado('no-bloco')).toBe('no_bloco');
  });
  it('a transição confere a situação vista e a regra dos estados', () => {
    expect(conferirTransicao('agendado', 'em-sala', 'confirmado')).toBeNull();
    expect(conferirTransicao('cancelado', 'solicitado', 'suspenso')).toBe('estado-mudou');
    expect(conferirTransicao('realizado', 'solicitado', null)).toBe('transicao-invalida');
    expect(conferirTransicao('cancelado', 'cancelado', null)).toBeNull();
    expect(conferirTransicao('xyz', 'cancelado', null)).toBe('situacao-desconhecida');
  });
});

describe('regras de horário na sala', () => {
  it('recusa o horário no passado e o mesmo horário da remarcação', () => {
    expect(conferirHorarioNaSala(pedido({ inicio: '2030-01-09 08:00' }), sala, []).recusa?.codigo).toBe(
      'horario-passado',
    );
    expect(
      conferirHorarioNaSala(pedido({ anterior: { sala: 1, inicio: '2030-01-10 10:00' } }), sala, []).recusa
        ?.codigo,
    ).toBe('mesmo-horario');
  });
  it('recusa o procedimento vedado e a duração abaixo do mínimo da sala', () => {
    expect(conferirHorarioNaSala(pedido(), { ...sala, procedimentosVedados: [7] }, []).recusa?.codigo).toBe(
      'procedimento-vedado-na-sala',
    );
    expect(
      conferirHorarioNaSala(pedido({ duracaoMin: 20 }), { ...sala, duracaoMinimaMin: 30 }, []).recusa?.codigo,
    ).toBe('duracao-abaixo-do-minimo');
  });
  it('conta o preparo da sala, o intervalo mínimo, o parâmetro e a limpeza de cada lado', () => {
    const antes = [ocupada(5, '2030-01-10 08:30', 60)];
    expect(conferirHorarioNaSala(pedido(), sala, antes).recusa).toBeNull();
    expect(conferirHorarioNaSala(pedido(), { ...sala, preparoMin: 31 }, antes).recusa?.codigo).toBe(
      'sala-ocupada',
    );
    expect(conferirHorarioNaSala(pedido(), { ...sala, intervaloMinimoMin: 31 }, antes).recusa?.codigo).toBe(
      'sala-ocupada',
    );
    expect(conferirHorarioNaSala(pedido({ preparoMinimoMin: 31 }), sala, antes).recusa?.codigo).toBe(
      'sala-ocupada',
    );
    expect(
      conferirHorarioNaSala(pedido(), sala, [ocupada(5, '2030-01-10 08:30', 60, 31)]).recusa?.codigo,
    ).toBe('sala-ocupada');
    expect(
      conferirHorarioNaSala(pedido({ limpezaMin: 31 }), sala, [ocupada(5, '2030-01-10 11:30')]).recusa
        ?.codigo,
    ).toBe('sala-ocupada');
  });
  it('a exceção de urgência libera o conflito, mas não o mesmo minuto; a própria cirurgia fica fora', () => {
    const r = conferirHorarioNaSala(pedido({ excecao: true }), sala, [ocupada(5, '2030-01-10 10:30')]);
    expect(r.recusa).toBeNull();
    expect(r.conflitos.map((c) => c.com)).toEqual([5]);
    expect(
      conferirHorarioNaSala(pedido({ excecao: true }), sala, [ocupada(5, '2030-01-10 10:00')]).recusa?.codigo,
    ).toBe('sala-ocupada');
    expect(
      conferirHorarioNaSala(pedido({ id: 5 }), sala, [ocupada(5, '2030-01-10 10:00')]).recusa,
    ).toBeNull();
  });
});
