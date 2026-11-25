import { describe, expect, it } from 'vitest';
import {
  cargaDevolucaoRegulacao,
  conferirRecebimentoRegulacao,
  conferirRespostaRegulacao,
  ordenarRecebidosRegulacao,
  prioridadeListaEsperaDe,
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
