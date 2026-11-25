import { describe, expect, it } from 'vitest';
import {
  cargaDevolucaoRegulacao,
  conferirCancelamentoRegulacao,
  conferirConclusaoRegulacao,
  conferirRecebimentoRegulacao,
  conferirRespostaRegulacao,
  ordenarRecebidosRegulacao,
  prioridadeListaEsperaDe,
  prioridadePedidoLeitoDe,
} from './regulacao-entrada.js';

const agora = new Date('2026-11-25T12:00:00Z');
const base = {
  numero: 'REG-2026-0001',
  tipo: 'internacao',
  prioridade: 'eletivo',
  solicitadoEm: new Date('2026-11-25T10:00:00Z'),
  agora,
  resumoClinico: null,
};

describe('recebimento do pedido da central', () => {
  it('aceita o pedido completo e normaliza o número em maiúsculas', () => {
    expect(conferirRecebimentoRegulacao(base)).toEqual([]);
    expect(conferirRecebimentoRegulacao({ ...base, numero: 'reg-01/26' })).toEqual([]);
  });
  it('recusa número fora do formato, tipo e prioridade desconhecidos e data futura', () => {
    const p = conferirRecebimentoRegulacao({
      ...base,
      numero: 'A 1',
      tipo: 'visita',
      prioridade: 'alta',
      solicitadoEm: new Date('2026-11-25T13:00:00Z'),
    });
    expect(p.map((x) => x.campo)).toEqual(['numero', 'tipo', 'prioridade', 'solicitadoEm']);
  });
  it('exige o resumo clínico na emergência e na urgência', () => {
    expect(conferirRecebimentoRegulacao({ ...base, prioridade: 'urgente' }).map((x) => x.campo)).toEqual([
      'resumoClinico',
    ]);
    expect(
      conferirRecebimentoRegulacao({
        ...base,
        prioridade: 'emergencia',
        resumoClinico: 'Dor torácica há 2 horas, estável.',
      }),
    ).toEqual([]);
  });
});

describe('resposta ao pedido recebido', () => {
  const r = {
    situacao: 'solicitada',
    tipo: 'internacao',
    decisao: 'aceitar' as const,
    motivo: null,
    complemento: null,
    especialidade: null,
  };
  it('aceitar a internação autoriza sem lista de espera', () => {
    expect(conferirRespostaRegulacao(r)).toEqual({
      ok: true,
      situacao: 'autorizada',
      listaEspera: false,
      pedidoLeito: true,
      encerra: false,
      texto: 'Pedido aceito',
    });
  });
  it('aceitar consulta, exame ou cirurgia exige a especialidade e entra na lista de espera', () => {
    const sem = conferirRespostaRegulacao({ ...r, tipo: 'cirurgia' });
    expect(sem.ok).toBe(false);
    expect(conferirRespostaRegulacao({ ...r, tipo: 'consulta', especialidade: 7 })).toMatchObject({
      ok: true,
      listaEspera: true,
    });
  });
  it('recusar exige o motivo padronizado e o complemento no motivo "outro"', () => {
    expect(conferirRespostaRegulacao({ ...r, decisao: 'recusar' })).toMatchObject({
      ok: false,
      problemas: [{ campo: 'motivo' }],
    });
    expect(
      conferirRespostaRegulacao({ ...r, decisao: 'recusar', motivo: 'outro', complemento: 'curto' }),
    ).toMatchObject({ ok: false, problemas: [{ campo: 'complemento' }] });
    expect(conferirRespostaRegulacao({ ...r, decisao: 'recusar', motivo: 'sem_leito_compativel' })).toEqual({
      ok: true,
      situacao: 'negada',
      listaEspera: false,
      pedidoLeito: false,
      encerra: true,
      texto: 'Sem leito compatível disponível',
    });
  });
  it('não aceita motivo de recusa no aceite nem responde pedido já respondido', () => {
    expect(conferirRespostaRegulacao({ ...r, motivo: 'outro' }).ok).toBe(false);
    expect(conferirRespostaRegulacao({ ...r, situacao: 'autorizada' })).toMatchObject({
      ok: false,
      problemas: [{ campo: 'situacao' }],
    });
    expect(conferirRespostaRegulacao({ ...r, situacao: 'em_analise' }).ok).toBe(true);
  });
});

describe('fila, lista de espera e devolução', () => {
  it('ordena os que pedem resposta por prioridade e antiguidade; os respondidos depois, do mais recente', () => {
    const f = ordenarRecebidosRegulacao([
      { id: 1, situacao: 'autorizada', prioridade: 'emergencia', solicitadoEm: '2026-11-25T08:00:00Z' },
      { id: 2, situacao: 'solicitada', prioridade: 'eletivo', solicitadoEm: '2026-11-25T07:00:00Z' },
      { id: 3, situacao: 'solicitada', prioridade: 'urgente', solicitadoEm: '2026-11-25T09:00:00Z' },
      { id: 4, situacao: 'em_analise', prioridade: 'urgente', solicitadoEm: '2026-11-25T08:30:00Z' },
      { id: 5, situacao: 'negada', prioridade: 'eletivo', solicitadoEm: '2026-11-25T09:30:00Z' },
    ]);
    expect(f.map((x) => x.id)).toEqual([4, 3, 2, 5, 1]);
  });
  it('mapeia a prioridade da central para a lista de espera', () => {
    expect(['emergencia', 'urgente', 'prioritario', 'eletivo', null].map(prioridadeListaEsperaDe)).toEqual([
      'urgente',
      'urgente',
      'preferencial',
      'normal',
      'normal',
    ]);
  });
  it('a devolução leva só IDs e códigos', () => {
    expect(
      cargaDevolucaoRegulacao({ solicitacao: 9, numero: 'REG-1', situacao: 'negada', motivo: 'sem_recurso' }),
    ).toEqual({ solicitacao: 9, numero: 'REG-1', resposta: 'recusado', motivo: 'sem_recurso' });
  });
});

describe('aceite que abre o pedido de leito do NIR', () => {
  const resp = { situacao: 'solicitada', motivo: null, complemento: null, especialidade: null } as const;
  it('internação e transferência abrem o pedido de leito; consulta vai à lista de espera; recusa não abre', () => {
    expect(conferirRespostaRegulacao({ ...resp, tipo: 'internacao', decisao: 'aceitar' })).toMatchObject({
      ok: true,
      pedidoLeito: true,
      listaEspera: false,
    });
    expect(conferirRespostaRegulacao({ ...resp, tipo: 'transferencia', decisao: 'aceitar' })).toMatchObject({
      pedidoLeito: true,
    });
    expect(
      conferirRespostaRegulacao({ ...resp, tipo: 'consulta', decisao: 'aceitar', especialidade: 3 }),
    ).toMatchObject({ pedidoLeito: false, listaEspera: true });
    expect(
      conferirRespostaRegulacao({ ...resp, tipo: 'internacao', decisao: 'recusar', motivo: 'sem_recurso' }),
    ).toMatchObject({ pedidoLeito: false });
  });
  it('mapeia a prioridade da central para a do pedido de leito', () => {
    expect(['emergencia', 'urgente', 'prioritario', 'eletivo', null].map(prioridadePedidoLeitoDe)).toEqual([
      'emergencia',
      'alta',
      'media',
      'baixa',
      'baixa',
    ]);
  });
});

describe('cancelamento do pedido recebido', () => {
  const c = {
    situacao: 'solicitada',
    motivo: 'cancelado_pela_central',
    complemento: null,
    estadoPedidoLeito: null,
  };
  it('cancela o pedido aberto ou aceito, com o motivo padronizado no texto', () => {
    expect(conferirCancelamentoRegulacao(c)).toEqual({
      ok: true,
      cancelaPedidoLeito: false,
      texto: 'Cancelado pela central de regulação',
    });
    expect(
      conferirCancelamentoRegulacao({ ...c, situacao: 'autorizada', estadoPedidoLeito: 'solicitado' }),
    ).toMatchObject({ ok: true, cancelaPedidoLeito: true });
  });
  it('recusa o já encerrado, o motivo ausente e o "outro" sem detalhe', () => {
    for (const situacao of ['negada', 'cancelada', 'concluida'])
      expect(conferirCancelamentoRegulacao({ ...c, situacao })).toMatchObject({
        ok: false,
        problemas: [{ campo: 'situacao' }],
      });
    const r = conferirCancelamentoRegulacao({ ...c, motivo: null });
    expect(r.ok ? [] : r.problemas.map((x) => x.campo)).toEqual(['motivo']);
    const o = conferirCancelamentoRegulacao({ ...c, motivo: 'outro', complemento: 'curto' });
    expect(o.ok ? [] : o.problemas.map((x) => x.campo)).toEqual(['complemento']);
    expect(
      conferirCancelamentoRegulacao({
        ...c,
        motivo: 'outro',
        complemento: 'Central reabriu como novo pedido',
      }),
    ).toMatchObject({ ok: true, texto: 'Outro motivo: Central reabriu como novo pedido' });
  });
  it('não cancela com leito reservado nem com o paciente já internado pelo pedido de leito', () => {
    for (const estadoPedidoLeito of ['reservado', 'em_transito', 'internado']) {
      const r = conferirCancelamentoRegulacao({ ...c, situacao: 'autorizada', estadoPedidoLeito });
      expect(r.ok ? [] : r.problemas.map((x) => x.campo)).toEqual(['pedidoLeito']);
    }
  });
});

describe('conclusão do pedido aceito na chegada', () => {
  const base = {
    situacao: 'autorizada',
    tipo: 'consulta',
    chegadaEm: new Date('2026-11-25T11:00:00Z'),
    reguladoEm: new Date('2026-11-25T10:30:00Z'),
    agora,
    internacao: null,
  };
  it('conclui a consulta na chegada e a internação ligada à internação', () => {
    expect(conferirConclusaoRegulacao(base)).toEqual({ ok: true, texto: 'Paciente chegou ao hospital' });
    expect(conferirConclusaoRegulacao({ ...base, tipo: 'internacao', internacao: 9 })).toEqual({
      ok: true,
      texto: 'Paciente chegou e foi internado',
    });
  });
  it('exige a internação na internação e na transferência', () => {
    for (const tipo of ['internacao', 'transferencia']) {
      const r = conferirConclusaoRegulacao({ ...base, tipo });
      expect(r.ok ? [] : r.problemas.map((x) => x.campo)).toEqual(['internacao']);
    }
  });
  it('recusa o pedido não aceito, a chegada futura e a anterior ao aceite', () => {
    for (const situacao of ['solicitada', 'negada', 'cancelada', 'concluida'])
      expect(conferirConclusaoRegulacao({ ...base, situacao })).toMatchObject({
        ok: false,
        problemas: [{ campo: 'situacao' }],
      });
    const f = conferirConclusaoRegulacao({ ...base, chegadaEm: new Date('2026-11-25T13:00:00Z') });
    expect(f.ok ? [] : f.problemas.map((x) => x.campo)).toEqual(['chegadaEm']);
    const a = conferirConclusaoRegulacao({ ...base, chegadaEm: new Date('2026-11-25T09:00:00Z') });
    expect(a.ok ? [] : a.problemas.map((x) => x.campo)).toEqual(['chegadaEm']);
  });
});
