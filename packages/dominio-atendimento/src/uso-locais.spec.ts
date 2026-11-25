// Uso da configuração dos locais (02-REC linha 34): encaminhamento, visibilidade e horário na fila e na recepção.
import { describe, expect, it } from 'vitest';
import {
  destinosDeEncaminhamento,
  diaDaSemana,
  encaminhamentoPermitido,
  horarioDoLocalAgora,
  locaisVisiveisAoUsuario,
} from './uso-locais.js';

const L = (id: number, recepcao = 1, ativo = true, permiteEncaminhamento = true) => ({
  id,
  recepcao,
  ativo,
  permiteEncaminhamento,
});
const locais = [L(1), L(2), L(3), L(4, 1, false), L(5, 2), L(6, 1, true, false)];

describe('encaminhamento entre locais', () => {
  it('sem lista configurada: os outros locais ativos da mesma recepção', () => {
    expect(destinosDeEncaminhamento(1, [], locais)).toEqual([2, 3, 6]);
  });
  it('com lista configurada: só os da lista, e nunca inativo nem de outra recepção', () => {
    expect(destinosDeEncaminhamento(1, [3, 4, 5], locais)).toEqual([3]);
    expect(encaminhamentoPermitido(1, 3, [3], locais)).toBe(true);
    expect(encaminhamentoPermitido(1, 2, [3], locais)).toBe(false);
  });
  it('local que não encaminha, ou desconhecido, não tem destino', () => {
    expect(destinosDeEncaminhamento(6, [], locais)).toEqual([]);
    expect(destinosDeEncaminhamento(99, [], locais)).toEqual([]);
  });
});

describe('locais visíveis ao usuário', () => {
  const vis = [
    { local: 1, consultado: 2 },
    { local: 3, consultado: 5 },
    { local: 1, consultado: 4 },
  ];
  it('sem vínculo: todos os ativos', () => {
    expect(locaisVisiveisAoUsuario([], vis, locais)).toEqual([1, 2, 3, 5, 6]);
  });
  it('com vínculo: os seus e os que eles consultam, só ativos', () => {
    expect(
      locaisVisiveisAoUsuario([{ local: 1, atuaNoLocal: true, podeOperar: false }], vis, locais),
    ).toEqual([1, 2]);
  });
  it('vínculo sem papel não conta', () => {
    expect(
      locaisVisiveisAoUsuario([{ local: 3, atuaNoLocal: false, podeOperar: false }], vis, locais),
    ).toEqual([1, 2, 3, 5, 6]);
  });
});

describe('horário do local agora', () => {
  // 2026-11-25 é quarta-feira (dia 4).
  const semana = [
    { diaSemana: 4, diaNaoUtil: false, inicio: '07:00', fim: '12:00' },
    { diaSemana: 4, diaNaoUtil: false, inicio: '13:00', fim: '18:00' },
    { diaSemana: null, diaNaoUtil: true, inicio: '08:00', fim: '10:00' },
  ];
  it('dia da semana pelo calendário', () => {
    expect(diaDaSemana('2026-11-25')).toBe(4);
    expect(diaDaSemana('2026-11-29T10:00')).toBe(1);
  });
  it('sem semana configurada: aberto, sem aviso', () => {
    expect(horarioDoLocalAgora([], '2026-11-25T03:00', false)).toEqual({
      aberto: true,
      semHorario: true,
      abreAs: null,
      fechaAs: null,
    });
  });
  it('aberto diz quando fecha; fechado diz quando abre de novo hoje', () => {
    expect(horarioDoLocalAgora(semana, '2026-11-25T08:30:00', false)).toMatchObject({
      aberto: true,
      fechaAs: '12:00',
    });
    expect(horarioDoLocalAgora(semana, '2026-11-25T12:30', false)).toMatchObject({
      aberto: false,
      abreAs: '13:00',
    });
    expect(horarioDoLocalAgora(semana, '2026-11-25T18:00', false)).toMatchObject({
      aberto: false,
      abreAs: null,
    });
  });
  it('em dia não útil vale só a faixa de dia não útil', () => {
    expect(horarioDoLocalAgora(semana, '2026-11-25T11:00', true).aberto).toBe(false);
    expect(horarioDoLocalAgora(semana, '2026-11-25T09:00', true).aberto).toBe(true);
    expect(horarioDoLocalAgora(semana, '2026-11-26T09:00', false).abreAs).toBeNull();
  });
});
