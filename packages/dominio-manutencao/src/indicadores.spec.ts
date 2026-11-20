// Regra 3 do M55: disponibilidade, MTBF e MTTR com as parcelas impressas. Dados sintéticos; as contas esperadas estão
// escritas ao lado de cada número.
import { describe, expect, it } from 'vitest';
import { calcularIndicadores, minutosDaUniao, type EquipamentoNoPeriodo } from './indicadores.js';

const A: EquipamentoNoPeriodo = {
  id: 1,
  codigo: 'EQ-A',
  nome: 'Ventilador sintético',
  instalacao: null,
  desativacao: null,
};
const B: EquipamentoNoPeriodo = { ...A, id: 2, codigo: 'EQ-B', instalacao: '2026-10-06' };

describe('união das paradas', () => {
  it('sobrepostas contam uma vez; vazias e invertidas não contam', () => {
    expect(minutosDaUniao([])).toBe(0);
    expect(
      minutosDaUniao([
        [0, 60],
        [30, 90],
        [120, 150],
        [200, 200],
        [300, 250],
      ]),
    ).toBe(120);
  });
});

describe('indicadores do período', () => {
  const r = calcularIndicadores({
    inicio: '2026-10-01',
    fim: '2026-10-10',
    agora: '2026-10-24T12:00',
    equipamentos: [A, B],
    paradas: [
      { equipamento: 1, inicio: '2026-10-02T08:00', fim: '2026-10-02T20:00' },
      { equipamento: 1, inicio: '2026-10-02T18:00', fim: '2026-10-03T02:00' },
      { equipamento: 1, inicio: '2026-09-30T00:00', fim: '2026-10-01T06:00' },
    ],
    corretivas: [
      {
        equipamento: 1,
        registro: '2026-10-02T08:00',
        causa: 'desgaste',
        inicioReparo: '2026-10-02T22:00',
        fimReparo: '2026-10-03T02:00',
      },
      {
        equipamento: 1,
        registro: '2026-10-05T10:00',
        causa: 'semDefeito',
        inicioReparo: '2026-10-05T11:00',
        fimReparo: '2026-10-05T12:00',
      },
      {
        equipamento: 1,
        registro: '2026-09-30T00:00',
        causa: 'energia',
        inicioReparo: '2026-09-30T23:00',
        fimReparo: '2026-10-01T05:00',
      },
      { equipamento: 1, registro: '2026-10-08T09:00', causa: null, inicioReparo: null, fimReparo: null },
    ],
  });

  it('equipamento A: 240 h no período, 24 h paradas (18 h unidas + 6 h recortadas), 2 falhas, 3 reparos em 11 h', () => {
    const a = r.porEquipamento[0]!;
    expect(a.parcelas).toEqual({
      horasPeriodo: 240,
      horasParadas: 24,
      horasOperacao: 216,
      falhas: 2,
      reparos: 3,
      horasReparo: 11,
    });
    expect(a.disponibilidade).toBe(90); // 216 ÷ 240
    expect(a.mtbf).toBe(108); // 216 ÷ 2
    expect(a.mttr).toBe(3.67); // 11 ÷ 3
  });

  it('equipamento B instalado no dia 6: 120 h, sem falha nem reparo (MTBF e MTTR nulos)', () => {
    const b = r.porEquipamento[1]!;
    expect(b.parcelas.horasPeriodo).toBe(120);
    expect(b.disponibilidade).toBe(100);
    expect(b.mtbf).toBeNull();
    expect(b.mttr).toBeNull();
  });

  it('soma do recorte: 360 h, 24 h paradas, 93,33%, MTBF 168 h, MTTR 3,67 h', () => {
    expect(r.equipamentos).toBe(2);
    expect(r.parcelas).toEqual({
      horasPeriodo: 360,
      horasParadas: 24,
      horasOperacao: 336,
      falhas: 2,
      reparos: 3,
      horasReparo: 11,
    });
    expect(r.disponibilidade).toBe(93.33);
    expect(r.mtbf).toBe(168);
    expect(r.mttr).toBe(3.67);
  });
});

describe('bordas do período', () => {
  it('o período para no "agora"; parada sem fim conta até agora; desativado conta até a desativação', () => {
    const r = calcularIndicadores({
      inicio: '2026-10-20',
      fim: '2026-10-31',
      agora: '2026-10-24T12:00',
      equipamentos: [A, { ...A, id: 3, desativacao: '2026-10-22' }],
      paradas: [
        { equipamento: 1, inicio: '2026-10-24T06:00', fim: null },
        { equipamento: 3, inicio: '2026-10-23T00:00', fim: null },
      ],
      corretivas: [],
    });
    expect(r.porEquipamento[0]!.parcelas).toMatchObject({ horasPeriodo: 108, horasParadas: 6 });
    expect(r.porEquipamento[1]!.parcelas).toMatchObject({ horasPeriodo: 48, horasParadas: 0 });
  });

  it('sem equipamento no recorte, tudo nulo; período no futuro falha', () => {
    const vazio = calcularIndicadores({
      inicio: '2026-10-01',
      fim: '2026-10-01',
      agora: '2026-10-24T00:00',
      equipamentos: [],
      paradas: [],
      corretivas: [],
    });
    expect(vazio).toMatchObject({ equipamentos: 0, disponibilidade: null, mtbf: null, mttr: null });
    expect(() =>
      calcularIndicadores({
        inicio: '2026-11-01',
        fim: '2026-11-30',
        agora: '2026-10-24T00:00',
        equipamentos: [A],
        paradas: [],
        corretivas: [],
      }),
    ).toThrow();
  });
});
