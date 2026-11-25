import { describe, expect, it } from 'vitest';
import {
  conferirMembrosEquipe,
  equipeDoItemComOAto,
  type MembroInformado,
  membrosDoProcedimento,
  minutosDeParticipacao,
  principalDoAto,
  tipoCobrancaDaFuncao,
  vagaDaCobranca,
} from './membros-equipe.js';

const SALA = { entrada: '08:00', saida: '11:00' };
const m = (
  x: Partial<MembroInformado> & Pick<MembroInformado, 'funcao' | 'profissional'>,
): MembroInformado => ({
  procedimento: null,
  entrada: null,
  saida: null,
  percentual: null,
  ...x,
});

describe('conferirMembrosEquipe', () => {
  it('aceita a troca de anestesista no meio do ato e tempos diferentes por procedimento', () => {
    const r = conferirMembrosEquipe(
      [
        m({ funcao: 'cirurgiao', profissional: 1 }),
        m({ funcao: 'anestesista', profissional: 2, saida: '09:30' }),
        m({ funcao: 'anestesista', profissional: 3, entrada: '09:30' }),
        m({ funcao: 'auxiliar1', profissional: 4, procedimento: 0, saida: '09:00' }),
        m({ funcao: 'auxiliar1', profissional: 5, procedimento: 1, entrada: '09:00', percentual: 20 }),
      ],
      SALA,
      2,
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.membros.map((x) => [x.funcao, x.entradaMin, x.saidaMin, x.percentual])).toEqual([
      ['cirurgiao', 0, 180, 100],
      ['anestesista', 0, 90, null],
      ['anestesista', 90, 180, null],
      ['auxiliar1', 0, 60, 30],
      ['auxiliar1', 60, 180, 20],
    ]);
    expect(r.membros[1]).toMatchObject({ entradaInformada: false, saidaInformada: true });
    expect(membrosDoProcedimento(r.membros, 1).map((x) => x.profissional)).toEqual([1, 2, 3, 5]);
    expect(principalDoAto(r.membros)?.profissional).toBe(1);
  });

  it('recusa a sobreposição na mesma função e no mesmo procedimento', () => {
    const r = conferirMembrosEquipe(
      [
        m({ funcao: 'cirurgiao', profissional: 1 }),
        m({ funcao: 'anestesista', profissional: 2, saida: '10:00' }),
        m({ funcao: 'anestesista', profissional: 3, entrada: '09:30' }),
      ],
      SALA,
      1,
    );
    expect(r).toMatchObject({ ok: false, problema: { indice: 2, campo: 'entrada' } });
  });

  it('aceita a mesma função em procedimentos diferentes ao mesmo tempo', () => {
    const r = conferirMembrosEquipe(
      [
        m({ funcao: 'cirurgiao', profissional: 1, procedimento: 0 }),
        m({ funcao: 'cirurgiao', profissional: 2, procedimento: 1 }),
      ],
      SALA,
      2,
    );
    expect(r.ok).toBe(true);
  });

  it('recusa o mesmo profissional em duas funções ao mesmo tempo', () => {
    const r = conferirMembrosEquipe(
      [m({ funcao: 'cirurgiao', profissional: 1 }), m({ funcao: 'auxiliar1', profissional: 1 })],
      SALA,
      1,
    );
    expect(r).toMatchObject({ ok: false, problema: { indice: 1, campo: 'profissional' } });
  });

  it('recusa procedimento fora do registro, hora fora da sala, percentual e equipe sem cirurgião', () => {
    expect(
      conferirMembrosEquipe([m({ funcao: 'cirurgiao', profissional: 1, procedimento: 1 })], SALA, 1),
    ).toMatchObject({ ok: false, problema: { campo: 'procedimento' } });
    expect(
      conferirMembrosEquipe([m({ funcao: 'cirurgiao', profissional: 1, entrada: '07:00' })], SALA, 1),
    ).toMatchObject({ ok: false, problema: { campo: 'entrada' } });
    expect(
      conferirMembrosEquipe([m({ funcao: 'cirurgiao', profissional: 1, percentual: 120 })], SALA, 1),
    ).toMatchObject({ ok: false, problema: { campo: 'percentual' } });
    expect(conferirMembrosEquipe([m({ funcao: 'anestesista', profissional: 1 })], SALA, 1)).toMatchObject({
      ok: false,
      problema: { campo: 'funcao' },
    });
    expect(conferirMembrosEquipe([m({ funcao: 'cirurgiao', profissional: 0 })], SALA, 1)).toMatchObject({
      ok: false,
      problema: { campo: 'profissional' },
    });
  });

  it('aceita o ato que vira a meia-noite', () => {
    const r = conferirMembrosEquipe(
      [
        m({ funcao: 'cirurgiao', profissional: 1, saida: '00:30' }),
        m({ funcao: 'cirurgiao', profissional: 2, entrada: '00:30' }),
      ],
      { entrada: '23:00', saida: '01:00' },
      1,
    );
    expect(r.ok && r.membros.map((x) => [x.entradaMin, x.saidaMin])).toEqual([
      [0, 90],
      [90, 120],
    ]);
  });
});

describe('leitura e ponte com a conta', () => {
  it('minutos de participação com as horas nulas valendo o tempo da sala', () => {
    const sala = { entrada: new Date('2026-01-01T08:00:00Z'), saida: new Date('2026-01-01T11:00:00Z') };
    expect(minutosDeParticipacao(null, null, sala)).toBe(180);
    expect(minutosDeParticipacao(new Date('2026-01-01T09:30:00Z'), null, sala)).toBe(90);
  });

  it('função do ato para a função de cobrança', () => {
    expect(tipoCobrancaDaFuncao('cirurgiao')).toEqual({ tipo: 'cirurgiao', ordem: null });
    expect(tipoCobrancaDaFuncao('auxiliar2')).toEqual({ tipo: 'auxiliar', ordem: 2 });
    expect(tipoCobrancaDaFuncao('anestesista')).toEqual({ tipo: 'anestesista', ordem: null });
    expect(tipoCobrancaDaFuncao('circulante')).toBeNull();
    expect(tipoCobrancaDaFuncao('pediatra')).toBeNull();
  });

  it('mantém a equipe do faturista, junta a reentrada e pula a função sem honorário', () => {
    const existentes = [
      {
        profissionalId: 1,
        funcaoId: 10,
        grauId: 5,
        percentual: 100,
        formaPagamento: 'direto_fonte_pagadora' as const,
        vaga: 'cirurgiao',
      },
    ];
    const r = equipeDoItemComOAto(existentes, [
      { profissional: 1, funcaoCobranca: 10, vaga: 'cirurgiao', minutos: 60, percentual: 100 },
      { profissional: 2, funcaoCobranca: 20, vaga: 'auxiliar:1', minutos: 30, percentual: 20 },
      { profissional: 2, funcaoCobranca: 20, vaga: 'auxiliar:1', minutos: 30, percentual: 30 },
      { profissional: 3, funcaoCobranca: null, vaga: null, minutos: 60, percentual: null },
      { profissional: 4, funcaoCobranca: 40, vaga: null, minutos: 60, percentual: null },
      { profissional: 9, funcaoCobranca: 10, vaga: 'cirurgiao', minutos: 60, percentual: 100 },
    ]);
    expect(r.incluidos).toBe(2);
    expect(r.participantes).toEqual([
      {
        profissionalId: 1,
        funcaoId: 10,
        grauId: 5,
        percentual: 100,
        formaPagamento: 'direto_fonte_pagadora',
      },
      { profissionalId: 4, funcaoId: 40, grauId: null, percentual: null, formaPagamento: 'via_hospital' },
      { profissionalId: 2, funcaoId: 20, grauId: null, percentual: 30, formaPagamento: 'via_hospital' },
    ]);
    expect(r.foraDaVaga).toEqual([{ profissional: 9, funcaoCobranca: 10 }]);
  });

  it('na troca, a vaga única fica com quem ficou mais tempo', () => {
    const r = equipeDoItemComOAto(
      [],
      [
        { profissional: 1, funcaoCobranca: 10, vaga: 'anestesista', minutos: 40, percentual: 50 },
        { profissional: 2, funcaoCobranca: 10, vaga: 'anestesista', minutos: 140, percentual: 50 },
      ],
    );
    expect(r.participantes.map((p) => p.profissionalId)).toEqual([2]);
    expect(r.foraDaVaga).toEqual([{ profissional: 1, funcaoCobranca: 10 }]);
    expect(vagaDaCobranca('auxiliar', 2)).toBe('auxiliar:2');
    expect(vagaDaCobranca('instrumentador', null)).toBeNull();
  });
});
