// A passagem do crachá do colaborador na catraca (08-INTG L141): regras por perfil, setor, dia, faixa horária,
// vigência e sentido; acesso negado por padrão sem regra; o motivo e a regra de maior prioridade na recusa.
import { describe, expect, it } from 'vitest';
import {
  avaliarColaboradorNaCatraca,
  type ColaboradorParaAvaliar,
  conferirRegraAcesso,
  diaDaSemana,
  type RegraAcessoParaAvaliar,
} from './index.js';

const regra = (r: Partial<RegraAcessoParaAvaliar> = {}): RegraAcessoParaAvaliar => ({
  id: 1,
  perfil: null,
  setor: null,
  diasSemana: [1, 2, 3, 4, 5, 6, 7],
  horaInicio: '07:00',
  horaFim: '19:00',
  entrada: true,
  saida: true,
  vigenciaInicio: '2026-01-01',
  vigenciaFim: null,
  prioridade: 0,
  ativo: true,
  ...r,
});
const colab: ColaboradorParaAvaliar = { id: 9, ativo: true, perfis: [30], setores: [40] };
const terminal = { ativo: true, sentido: 'ambos' as const };
// 2026-11-25 é quarta-feira (4).
const av = (
  regras: RegraAcessoParaAvaliar[],
  agora = '2026-11-25T10:00',
  extra: Partial<Parameters<typeof avaliarColaboradorNaCatraca>[0]> = {},
) =>
  avaliarColaboradorNaCatraca({ colaborador: colab, regras, agora, sentido: 'entrada', terminal, ...extra });

describe('crachá do colaborador na catraca', () => {
  it('dia da semana de 1 (domingo) a 7 (sábado)', () => {
    expect(diaDaSemana('2026-11-22')).toBe(1);
    expect(diaDaSemana('2026-11-25')).toBe(4);
    expect(diaDaSemana('2026-11-28')).toBe(7);
  });

  it('libera pela regra que atende e devolve a regra', () => {
    expect(av([regra({ id: 5, perfil: 30, setor: 40 })])).toEqual({
      resultado: 'liberado',
      motivo: null,
      regra: 5,
    });
  });

  it('sem regra ativa no terminal: recusa (acesso negado por padrão)', () => {
    expect(av([])).toEqual({ resultado: 'negado', motivo: 'sem-regra', regra: null });
    expect(av([regra({ ativo: false })])).toMatchObject({ motivo: 'sem-regra' });
  });

  it('terminal inativo, sentido do terminal e vínculo inativo vêm antes das regras', () => {
    expect(av([regra()], undefined, { terminal: { ativo: false, sentido: 'ambos' } })).toMatchObject({
      motivo: 'terminal-inativo',
    });
    expect(av([regra()], undefined, { terminal: { ativo: true, sentido: 'saida' } })).toMatchObject({
      motivo: 'sentido-do-terminal',
    });
    expect(av([regra()], undefined, { colaborador: { ...colab, ativo: false } })).toMatchObject({
      motivo: 'colaborador-inativo',
    });
  });

  it('cada critério da regra recusa com o seu motivo e a regra', () => {
    expect(av([regra({ id: 2, vigenciaInicio: '2026-12-01' })])).toEqual({
      resultado: 'negado',
      motivo: 'fora-da-vigencia',
      regra: 2,
    });
    expect(av([regra({ vigenciaFim: '2026-11-24' })])).toMatchObject({ motivo: 'fora-da-vigencia' });
    expect(av([regra({ perfil: 31 })])).toMatchObject({ motivo: 'perfil-nao-permitido' });
    expect(av([regra({ setor: 41 })])).toMatchObject({ motivo: 'setor-nao-permitido' });
    expect(av([regra({ diasSemana: [2, 3, 5, 6] })])).toMatchObject({ motivo: 'fora-do-dia' });
    expect(av([regra()], '2026-11-25T19:00')).toMatchObject({ motivo: 'fora-do-horario' });
    expect(av([regra()], '2026-11-25T06:59')).toMatchObject({ motivo: 'fora-do-horario' });
    expect(av([regra({ entrada: false })])).toMatchObject({ motivo: 'sentido-nao-permitido' });
    expect(av([regra({ entrada: false })], undefined, { sentido: 'saida' })).toMatchObject({
      resultado: 'liberado',
    });
  });

  it('faixa que atravessa a meia-noite: a madrugada conta pelo dia em que o turno começou', () => {
    const noturno = regra({ horaInicio: '19:00', horaFim: '07:00', diasSemana: [4] });
    expect(av([noturno], '2026-11-25T22:00')).toMatchObject({ resultado: 'liberado' });
    // Quinta 03:00 pertence ao turno de quarta.
    expect(av([noturno], '2026-11-26T03:00')).toMatchObject({ resultado: 'liberado' });
    // Quarta 03:00 pertence ao turno de terça (fora dos dias).
    expect(av([noturno], '2026-11-25T03:00')).toMatchObject({ motivo: 'fora-do-dia' });
    expect(av([noturno], '2026-11-25T12:00')).toMatchObject({ motivo: 'fora-do-horario' });
  });

  it('início igual ao fim vale o dia inteiro', () => {
    expect(av([regra({ horaInicio: '00:00', horaFim: '00:00' })], '2026-11-25T23:59')).toMatchObject({
      resultado: 'liberado',
    });
  });

  it('a de maior prioridade decide a recusa; qualquer regra que atenda libera', () => {
    const uti = regra({ id: 7, setor: 41, prioridade: 10 });
    const geral = regra({ id: 8, horaInicio: '08:00', horaFim: '09:00', prioridade: 1 });
    expect(av([geral, uti])).toEqual({ resultado: 'negado', motivo: 'setor-nao-permitido', regra: 7 });
    expect(av([geral, uti], '2026-11-25T08:30')).toEqual({ resultado: 'liberado', motivo: null, regra: 8 });
  });

  it('conferência da regra antes de gravar', () => {
    const ok = {
      diasSemana: [2],
      horaInicio: '07:00',
      horaFim: '19:00',
      entrada: true,
      saida: false,
      vigenciaInicio: '2026-01-01',
      vigenciaFim: null,
    };
    expect(conferirRegraAcesso(ok)).toEqual([]);
    expect(
      conferirRegraAcesso({
        ...ok,
        diasSemana: [],
        horaInicio: '25:00',
        entrada: false,
        vigenciaFim: '2025-01-01',
      }).map((x) => x.campo),
    ).toEqual(['diasSemana', 'horaInicio', 'entrada', 'vigenciaFim']);
  });
});
