// Regra 1 do M55: OS com prioridade e SLA, abertura do seu setor, equipamento crítico parado com alerta ao setor e ao
// recurso de agenda (bloqueio só pela operação que existe) e o ciclo da OS. Dados sintéticos.
import { SLA_PADRAO } from '@sgh/contratos';
import { describe, expect, it } from 'vitest';
import {
  aceiteVencido,
  acoesDisponiveis,
  alertaDeParada,
  custoDaOs,
  osAberta,
  planejarAbertura,
  planejarAcao,
  prazoDaEtapa,
  prazosDaOs,
  type EquipamentoParaOs,
  type OsParaAcao,
  type PedidoAbertura,
  type QuemAge,
} from './os.js';

const monitor: EquipamentoParaOs = {
  id: 11,
  situacao: 'ativo',
  criticidade: 'critica',
  centroCusto: 30,
  recurso: { tipo: 'agendaConsulta', id: 501 },
};

describe('prazo (SLA)', () => {
  it('no prazo, perto de vencer (último quarto) e vencido', () => {
    expect(prazoDaEtapa('2026-10-20T08:00', 4, null, '2026-10-20T08:30')).toEqual({
      limite: '2026-10-20T12:00',
      situacao: 'noPrazo',
      restanteMinutos: 210,
    });
    expect(prazoDaEtapa('2026-10-20T08:00', 4, null, '2026-10-20T11:00').situacao).toBe('emRisco');
    expect(prazoDaEtapa('2026-10-20T08:00', 4, null, '2026-10-20T12:01')).toMatchObject({
      situacao: 'vencido',
      restanteMinutos: -1,
    });
  });

  it('cumprida no prazo ou fora dele; SLA inválido falha', () => {
    expect(prazoDaEtapa('2026-10-20T08:00', 1, '2026-10-20T09:00', '2026-10-21T00:00')).toEqual({
      limite: '2026-10-20T09:00',
      situacao: 'cumprido',
      restanteMinutos: null,
    });
    expect(prazoDaEtapa('2026-10-20T08:00', 1, '2026-10-20T09:01', '2026-10-21T00:00').situacao).toBe(
      'descumprido',
    );
    expect(() => prazoDaEtapa('2026-10-20T08:00', 0, null, '2026-10-20T08:00')).toThrow();
  });

  it('os dois prazos pela prioridade, atravessando a meia-noite', () => {
    const p = prazosDaOs(
      {
        registro: '2026-10-20T23:30',
        prioridade: 'emergencia',
        assumidaEm: '2026-10-21T00:10',
        concluidaEm: null,
        situacao: 'emAtendimento',
      },
      SLA_PADRAO,
      '2026-10-21T02:45',
    );
    expect(p.atendimento.situacao).toBe('cumprido');
    expect(p.solucao).toEqual({ limite: '2026-10-21T03:30', situacao: 'emRisco', restanteMinutos: 45 });
  });

  it('cancelada para o relógio no cancelamento', () => {
    const p = prazosDaOs(
      {
        registro: '2026-10-20T08:00',
        prioridade: 'alta',
        assumidaEm: null,
        concluidaEm: null,
        situacao: 'cancelada',
      },
      SLA_PADRAO,
      '2026-10-25T08:00',
      '2026-10-20T09:00',
    );
    expect(p.atendimento.situacao).toBe('noPrazo');
    expect(p.solucao.restanteMinutos).toBe(23 * 60);
  });
});

describe('abertura do seu setor', () => {
  const base: PedidoAbertura = {
    natureza: 'corretiva',
    centroCusto: 30,
    centrosDoUsuario: [30, 31],
    centrosAtivos: [30, 31, 40],
    equipamento: monitor,
    equipamentoParado: true,
    abertasDoEquipamento: [9, 3],
  };

  it('abre com a parada, o alerta do crítico e o aviso das OS já abertas do equipamento', () => {
    expect(planejarAbertura(base)).toEqual({
      ok: true,
      registraParada: true,
      alerta: {
        equipamento: 11,
        centroCusto: 30,
        recurso: { tipo: 'agendaConsulta', id: 501 },
        operacaoBloqueio: 'agenda.bloquearHorarios',
      },
      possiveisDuplicadas: [3, 9],
    });
  });

  it('usuário sem setor no cadastro abre para qualquer setor ativo (lista vazia = sem restrição)', () => {
    const r = planejarAbertura({ ...base, centrosDoUsuario: [], centroCusto: 40, equipamentoParado: false });
    expect(r).toMatchObject({ ok: true, registraParada: false, alerta: null });
  });

  it.each([
    [{ natureza: 'preventiva' as const }, 'natureza-nao-abre'],
    [{ centroCusto: 99 }, 'setor-inativo'],
    [{ centroCusto: 40 }, 'setor-nao-permitido'],
    [{ equipamento: null }, 'sem-equipamento'],
    [{ equipamento: { ...monitor, situacao: 'desativado' as const } }, 'equipamento-desativado'],
  ])('recusa %o com %s', (extra, codigo) => {
    expect(planejarAbertura({ ...base, ...extra })).toMatchObject({ ok: false, recusa: codigo });
  });

  it('predial sem equipamento abre sem parada', () => {
    expect(planejarAbertura({ ...base, natureza: 'predial', equipamento: null })).toMatchObject({
      ok: true,
      registraParada: false,
      alerta: null,
    });
  });
});

describe('equipamento crítico parado', () => {
  it('só a criticidade crítica alerta; sala cirúrgica e agenda de exames ficam só com o alerta', () => {
    expect(alertaDeParada({ ...monitor, criticidade: 'alta' })).toBeNull();
    expect(
      alertaDeParada({ ...monitor, recurso: { tipo: 'salaCirurgica', id: 2 } })?.operacaoBloqueio,
    ).toBeNull();
    expect(
      alertaDeParada({ ...monitor, recurso: { tipo: 'agendaExame', id: 7 } })?.operacaoBloqueio,
    ).toBeNull();
    expect(alertaDeParada({ ...monitor, recurso: null })).toEqual({
      equipamento: 11,
      centroCusto: 30,
      recurso: null,
      operacaoBloqueio: null,
    });
  });
});

describe('ciclo da OS', () => {
  const tecnico: QuemAge = { login: 'tecnico.sintetico', podeAtender: true, podeEncerrar: true };
  const solicitante: QuemAge = { login: 'SOLICITANTE.SINTETICO', podeAtender: false, podeEncerrar: false };
  const os = (extra: Partial<OsParaAcao> = {}): OsParaAcao => ({
    situacao: 'aberta',
    solicitante: 'solicitante.sintetico',
    tecnico: null,
    concluidaEm: null,
    temParadaAberta: false,
    ...extra,
  });
  const agora = '2026-10-22T10:00';

  it('assumir, esperar peça, voltar ao atendimento e concluir', () => {
    expect(planejarAcao({ os: os(), acao: 'assumir', quem: tecnico, agora, horasAceite: 72 })).toEqual({
      ok: true,
      para: 'emAtendimento',
    });
    const em = os({ situacao: 'emAtendimento', tecnico: 'tecnico.sintetico' });
    expect(
      planejarAcao({
        os: em,
        acao: 'andamento',
        para: 'aguardandoPeca',
        quem: tecnico,
        agora,
        horasAceite: 72,
      }),
    ).toEqual({
      ok: true,
      para: 'aguardandoPeca',
    });
    expect(
      planejarAcao({
        os: { ...em, situacao: 'aguardandoPeca' },
        acao: 'andamento',
        quem: tecnico,
        agora,
        horasAceite: 72,
      }),
    ).toEqual({ ok: true, para: 'emAtendimento' });
    expect(planejarAcao({ os: em, acao: 'concluir', quem: tecnico, agora, horasAceite: 72 })).toEqual({
      ok: true,
      para: 'concluida',
    });
  });

  it('andamento recusa a mesma situação e as finais; concluir com parada pede a volta ao uso', () => {
    const em = os({ situacao: 'emAtendimento' });
    expect(
      planejarAcao({
        os: em,
        acao: 'andamento',
        para: 'emAtendimento',
        quem: tecnico,
        agora,
        horasAceite: 72,
      }),
    ).toMatchObject({
      recusa: 'mesma-situacao',
    });
    expect(
      planejarAcao({ os: em, acao: 'andamento', para: 'encerrada', quem: tecnico, agora, horasAceite: 72 }),
    ).toMatchObject({
      recusa: 'situacao-nao-permite',
    });
    expect(
      planejarAcao({
        os: { ...em, temParadaAberta: true },
        acao: 'concluir',
        quem: tecnico,
        agora,
        horasAceite: 72,
      }),
    ).toMatchObject({ recusa: 'sem-volta-ao-uso' });
    expect(
      planejarAcao({
        os: { ...em, temParadaAberta: true },
        acao: 'concluir',
        quem: tecnico,
        agora,
        voltaAoUso: agora,
        horasAceite: 72,
      }),
    ).toMatchObject({ ok: true });
  });

  it('o solicitante aceita ou recusa (reabre); a manutenção só encerra depois do prazo do aceite', () => {
    const c = os({ situacao: 'concluida', concluidaEm: '2026-10-20T10:00' });
    expect(planejarAcao({ os: c, acao: 'encerrar', quem: solicitante, agora, horasAceite: 72 })).toEqual({
      ok: true,
      para: 'encerrada',
    });
    expect(planejarAcao({ os: c, acao: 'reabrir', quem: solicitante, agora, horasAceite: 72 })).toEqual({
      ok: true,
      para: 'emAtendimento',
    });
    expect(planejarAcao({ os: c, acao: 'reabrir', quem: tecnico, agora, horasAceite: 72 })).toMatchObject({
      recusa: 'so-o-solicitante',
    });
    expect(planejarAcao({ os: c, acao: 'encerrar', quem: tecnico, agora, horasAceite: 72 })).toMatchObject({
      recusa: 'aceite-ainda-no-prazo',
    });
    expect(
      planejarAcao({ os: c, acao: 'encerrar', quem: tecnico, agora: '2026-10-23T10:00', horasAceite: 72 }),
    ).toEqual({
      ok: true,
      para: 'encerrada',
    });
    expect(
      planejarAcao({
        os: c,
        acao: 'encerrar',
        quem: { ...tecnico, podeEncerrar: false },
        agora,
        horasAceite: 72,
      }),
    ).toMatchObject({ recusa: 'sem-permissao' });
  });

  it('cancelar: a manutenção sempre; o solicitante só a aberta; nada sai das finais', () => {
    expect(
      planejarAcao({ os: os(), acao: 'cancelar', quem: solicitante, agora, horasAceite: 72 }),
    ).toMatchObject({ ok: true });
    expect(
      planejarAcao({
        os: os({ situacao: 'emAtendimento' }),
        acao: 'cancelar',
        quem: solicitante,
        agora,
        horasAceite: 72,
      }),
    ).toMatchObject({ recusa: 'sem-permissao' });
    expect(
      planejarAcao({
        os: os({ situacao: 'emAtendimento' }),
        acao: 'cancelar',
        quem: tecnico,
        agora,
        horasAceite: 72,
      }),
    ).toMatchObject({ ok: true });
    expect(
      planejarAcao({
        os: os({ situacao: 'encerrada' }),
        acao: 'cancelar',
        quem: tecnico,
        agora,
        horasAceite: 72,
      }),
    ).toMatchObject({
      recusa: 'situacao-nao-permite',
    });
    expect(
      planejarAcao({ os: os(), acao: 'assumir', quem: solicitante, agora, horasAceite: 72 }),
    ).toMatchObject({
      recusa: 'sem-permissao',
    });
    expect(
      planejarAcao({
        os: os({ situacao: 'emAtendimento' }),
        acao: 'andamento',
        quem: solicitante,
        agora,
        horasAceite: 72,
      }),
    ).toMatchObject({ recusa: 'sem-permissao' });
    expect(
      planejarAcao({
        os: os({ situacao: 'emAtendimento' }),
        acao: 'concluir',
        quem: solicitante,
        agora,
        horasAceite: 72,
      }),
    ).toMatchObject({ recusa: 'sem-permissao' });
  });

  it('ações disponíveis para cada um', () => {
    expect(acoesDisponiveis(os(), solicitante, agora, 72)).toEqual(['cancelar']);
    expect(acoesDisponiveis(os(), tecnico, agora, 72)).toEqual(['assumir', 'cancelar']);
    expect(acoesDisponiveis(os({ situacao: 'emAtendimento' }), tecnico, agora, 72)).toEqual([
      'andamento',
      'concluir',
      'cancelar',
    ]);
    const c = os({ situacao: 'concluida', concluidaEm: '2026-10-22T09:00' });
    expect(acoesDisponiveis(c, solicitante, agora, 72)).toEqual(['encerrar', 'reabrir']);
    expect(acoesDisponiveis(c, tecnico, agora, 72)).toEqual([]);
  });

  it('aceite vencido, OS aberta e custo com as parcelas', () => {
    expect(aceiteVencido(null, agora, 1)).toBe(false);
    expect(aceiteVencido('2026-10-22T09:00', agora, 1)).toBe(true);
    expect(osAberta('aguardandoTerceiro')).toBe(true);
    expect(osAberta('concluida')).toBe(false);
    expect(custoDaOs({ pecas: 10.1, maoDeObra: 20.2, terceiros: 0 })).toEqual({
      pecas: 10.1,
      maoDeObra: 20.2,
      terceiros: 0,
      total: 30.3,
    });
  });
});
