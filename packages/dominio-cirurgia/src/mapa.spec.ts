// Mapa do dia por sala com o alerta de sobreposição.
import { describe, expect, it } from 'vitest';
import { diasDaJanela, faixasAbertasDoDia, montarMapa, ocupacaoDaSala } from './mapa.js';

describe('mapa cirúrgico', () => {
  const ocup = [
    { id: 1, sala: 1, inicio: '2026-11-03 07:00', duracaoMin: 120, intervaloMin: 0 },
    { id: 2, sala: 1, inicio: '2026-11-03 08:00', duracaoMin: 60, intervaloMin: 0 },
    { id: 3, sala: 2, inicio: '2026-11-03 10:00', duracaoMin: 90, intervaloMin: 0 },
    { id: 4, sala: 2, inicio: '2026-11-04 10:00', duracaoMin: 90, intervaloMin: 0 },
  ];
  it('monta os blocos do dia por sala e marca os sobrepostos', () => {
    const m = montarMapa('2026-11-03', [1, 2, 3], ocup);
    expect(m.abertura).toBe('07:00');
    expect(m.fechamento).toBe('21:00');
    expect(m.sobreposicoes).toBe(1);
    expect(m.salas[0]!.blocos.map((b) => [b.id, b.topo, b.altura, b.sobreposto])).toEqual([
      [1, 0, 120, true],
      [2, 60, 60, true],
    ]);
    expect(m.salas[1]!.blocos[0]).toMatchObject({ id: 3, fim: '2026-11-03 11:30', sobreposto: false });
    expect(m.salas[2]!.blocos).toEqual([]);
    expect(montarMapa('2026-11-03', [1], ocup, 0, 'xx').abertura).toBe('07:00');
  });
  it('janela de até 7 dias e ocupação da sala no turno', () => {
    expect(diasDaJanela('2026-11-03', 3)).toEqual(['2026-11-03', '2026-11-04', '2026-11-05']);
    expect(diasDaJanela('2026-11-03', 30)).toHaveLength(7);
    expect(diasDaJanela('2026-11-03', 0)).toEqual(['2026-11-03']);
    expect(ocupacaoDaSala([{ topo: 0, altura: 420 }])).toBe(50);
    expect(ocupacaoDaSala([{ topo: -60, altura: 120 }], 600)).toBe(10);
    expect(ocupacaoDaSala([], 0)).toBe(0);
  });
});

describe('faixas abertas da grade no mapa (04-CC linha 92)', () => {
  const base = {
    vigenciaInicio: '2026-01-01',
    vigenciaFim: null,
    valeFeriado: false,
    especialidade: null,
    profissional: null,
    ativo: true,
  };
  // 2026-11-03 é terça (ISO 2).
  const faixas = [
    { ...base, id: 1, diaSemana: 2, inicio: '13:00', fim: '19:00', profissional: 7 },
    { ...base, id: 2, diaSemana: 2, inicio: '07:00', fim: '13:00', valeFeriado: true },
    { ...base, id: 3, diaSemana: 3, inicio: '07:00', fim: '19:00' },
    { ...base, id: 4, diaSemana: 2, inicio: '19:00', fim: '22:00', ativo: false },
  ];
  it('sem faixa ativa não pinta nada (a sala não usa grade)', () => {
    expect(faixasAbertasDoDia([], '2026-11-03', false)).toBeNull();
    expect(faixasAbertasDoDia([{ ...faixas[3]! }], '2026-11-03', false)).toBeNull();
  });
  it('as faixas do dia em ordem, com a reserva; a inativa fica fora', () => {
    expect(faixasAbertasDoDia(faixas, '2026-11-03', false)).toEqual([
      { inicio: '07:00', fim: '13:00', especialidade: null, profissional: null },
      { inicio: '13:00', fim: '19:00', especialidade: null, profissional: 7 },
    ]);
  });
  it('no feriado só a faixa que vale no feriado; fora da vigência a sala fica fechada', () => {
    expect(faixasAbertasDoDia(faixas, '2026-11-03', true)?.map((f) => f.inicio)).toEqual(['07:00']);
    expect(faixasAbertasDoDia(faixas, '2025-11-04', false)).toEqual([]);
  });
});
