import { describe, expect, it } from 'vitest';
import {
  conferirCredencialMensageria,
  efeitoDaResposta,
  type EventoMensagem,
  pedidosDosEventos,
} from './mensagens-paciente-eventos.js';

const agora = new Date('2026-11-25T12:00:00Z');
const h = (horas: number) => new Date(agora.getTime() + horas * 3_600_000);
const ev = (p: Partial<EventoMensagem> & Pick<EventoMensagem, 'tipo' | 'entidadeId'>): EventoMensagem => ({
  pacienteId: 7,
  ocorridoEm: h(-1),
  referenciaEm: null,
  valores: { data: '26/11/2026' },
  ...p,
});

describe('pedidosDosEventos (disparo automático pelos eventos)', () => {
  const regras = [
    { id: 1, gatilho: 'agendamento_criado' as const, antecedenciaMinutos: null },
    { id: 2, gatilho: 'lembrete_agendamento' as const, antecedenciaMinutos: 1440 },
    { id: 3, gatilho: 'resultado_liberado' as const, antecedenciaMinutos: null },
    { id: 4, gatilho: 'alta' as const, antecedenciaMinutos: null },
    { id: 5, gatilho: 'manual' as const, antecedenciaMinutos: null },
  ];

  it('marcação criada, véspera, resultado e alta geram o pedido da regra do gatilho', () => {
    const r = pedidosDosEventos(
      regras,
      [
        ev({ tipo: 'marcacao', entidadeId: 10, referenciaEm: h(30) }),
        ev({ tipo: 'resultado', entidadeId: 20 }),
        ev({ tipo: 'alta', entidadeId: 30 }),
      ],
      new Set(),
      agora,
    );
    expect(r.map((x) => `${x.regraId}:${x.entidade}:${x.entidadeId}`)).toEqual([
      '1:marcacao_horario:10',
      '2:marcacao_horario:10',
      '3:resultado_exame:20',
      '4:alta_hospitalar:30',
    ]);
    expect(r[1]!.referenciaEm).toEqual(h(30));
    expect(r[2]!.referenciaEm).toBeNull();
  });

  it('não pede duas vezes pela mesma regra e entidade; o gatilho manual nunca dispara', () => {
    const r = pedidosDosEventos(
      regras,
      [ev({ tipo: 'alta', entidadeId: 30 })],
      new Set(['4:alta_hospitalar:30']),
      agora,
    );
    expect(r).toEqual([]);
  });

  it('fora do prazo: evento velho, consulta passada e véspera longe demais ficam de fora', () => {
    const r = pedidosDosEventos(
      regras,
      [
        ev({ tipo: 'resultado', entidadeId: 21, ocorridoEm: h(-72) }),
        ev({ tipo: 'marcacao', entidadeId: 11, referenciaEm: h(-1) }),
        ev({ tipo: 'marcacao', entidadeId: 12, referenciaEm: h(24 * 5) }),
      ],
      new Set(),
      agora,
    );
    // A marcação 12 (daqui a 5 dias) gera só o aviso de criada; o lembrete espera a véspera.
    expect(r.map((x) => `${x.regraId}:${x.entidadeId}`)).toEqual(['1:12']);
  });
});

describe('efeitoDaResposta (resposta do paciente na marcação ligada)', () => {
  const base = {
    entidade: 'marcacao_horario',
    significadoMarcacao: 'aguardando',
    consultaJaPassou: false,
  };
  it('confirmado confirma a presença; cancelar e remarcar abrem o pedido para a equipe', () => {
    expect(efeitoDaResposta({ ...base, interpretada: 'confirmado' }).acao).toBe('confirmar_presenca');
    expect(efeitoDaResposta({ ...base, interpretada: 'cancelado' }).acao).toBe('pedir_cancelamento');
    expect(efeitoDaResposta({ ...base, interpretada: 'reagendar' }).acao).toBe('pedir_reagendamento');
    expect(
      efeitoDaResposta({ ...base, significadoMarcacao: 'confirmada', interpretada: 'cancelado' }).acao,
    ).toBe('pedir_cancelamento');
  });
  it('sem efeito: outra entidade, resposta não reconhecida, consulta passada, marcação cancelada ou já confirmada', () => {
    expect(efeitoDaResposta({ ...base, entidade: 'alta_hospitalar', interpretada: 'confirmado' }).acao).toBe(
      'nenhum',
    );
    expect(efeitoDaResposta({ ...base, interpretada: 'outro' }).acao).toBe('nenhum');
    expect(efeitoDaResposta({ ...base, consultaJaPassou: true, interpretada: 'confirmado' }).acao).toBe(
      'nenhum',
    );
    expect(
      efeitoDaResposta({ ...base, significadoMarcacao: 'cancelada', interpretada: 'confirmado' }).acao,
    ).toBe('nenhum');
    expect(
      efeitoDaResposta({ ...base, significadoMarcacao: 'confirmada', interpretada: 'confirmado' }).acao,
    ).toBe('nenhum');
  });
});

describe('conferirCredencialMensageria', () => {
  const ok = {
    categoriaSistema: 'mensageria',
    sistemaAtivo: true,
    situacaoCliente: 'ativo',
    restritoA: null,
    estabelecimento: 3,
    usuarioTecnico: 9,
    escopos: ['mensagem.paciente'],
  };
  it('aceita a credencial completa e recusa cada falta', () => {
    expect(conferirCredencialMensageria(ok)).toEqual([]);
    expect(
      conferirCredencialMensageria({
        ...ok,
        categoriaSistema: 'triagem',
        restritoA: 4,
        usuarioTecnico: null,
        escopos: [],
      }).map((e) => e.codigo),
    ).toEqual(['nao-e-mensageria', 'outro-estabelecimento', 'sem-usuario-tecnico', 'fora-do-escopo']);
  });
});
