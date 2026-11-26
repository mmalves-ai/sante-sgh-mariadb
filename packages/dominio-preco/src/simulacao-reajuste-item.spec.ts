import { describe, expect, it } from 'vitest';
import type { EntradaTotalHonorario } from './indice-cobranca.js';
import {
  alvosQueAfetam,
  reajustarEntradaHonorario,
  simularReajusteItem,
  validarReajusteSimulado,
} from './simulacao-reajuste-item.js';

const m = (o: Record<number, number>) => new Map(Object.entries(o).map(([k, v]) => [Number(k), v]));
const indices = (o: Record<number, number>) => ({
  valores: m(o),
  origem: new Map([...m(o).keys()].map((k) => [k, 'acordo' as const])),
});

// Item CH sintético: 100 CH, porte anestésico 1 (CH 0,5 → 50 + 150 = 200 por unidade).
const ch: EntradaTotalHonorario = {
  item: { ch: 100, porteAnestesico: '1' },
  vigente: { ch: 60, co: 40, filme: 9.25, anes: 0, outros: 0 },
  indices: indices({ 1: 0.5 }),
  porte: null,
  porteAnestesico: { valor: 150, valorHorarioEspecial: 195 },
};
// Item da tabela (modelo VALOR): 60 + 40 + 9,25 = 109,25.
const valor: EntradaTotalHonorario = {
  item: { ch: 0 },
  vigente: { ch: 60, co: 40, filme: 9.25, anes: 0, outros: 0 },
  indices: indices({}),
  porte: null,
};
// Item PORTE: porte 4A a 210.
const porte: EntradaTotalHonorario = {
  item: { ch: 0, porte: '4A' },
  vigente: null,
  indices: indices({}),
  porte: 210,
};

describe('validação do reajuste simulado', () => {
  it('exige um alvo e percentual na faixa com até 4 casas', () => {
    expect(validarReajusteSimulado({})).toHaveProperty('reajuste');
    expect(validarReajusteSimulado({ indice: 10.12345 })).toHaveProperty('indice');
    expect(validarReajusteSimulado({ tabela: -100 })).toHaveProperty('tabela');
    expect(validarReajusteSimulado({ porte: 1001 })).toHaveProperty('porte');
    expect(validarReajusteSimulado({ indice: 8.5, tabela: -3 })).toEqual({});
  });
});

describe('impacto do reajuste no item', () => {
  it('CH: reajuste do índice muda só a parte do índice; a vigência da tabela não entra', () => {
    const r = simularReajusteItem(ch, { indice: 10, tabela: 50 }, 2);
    expect(r.atual.total).toBe(400);
    expect(r.novo.total).toBe(410); // (0,55 × 100 + 150) × 2
    expect(r.diferenca).toBe(10);
    expect(r.percentual).toBe(2.5);
    expect(r.afetadoPor).toEqual(['indice']);
    expect(r.novo.passos.join(' ')).toContain('0,55 ×');
  });

  it('CH em horário especial: o porte anestésico reajustado entra pelo valor especial', () => {
    const r = simularReajusteItem({ ...ch, horarioEspecial: true }, { porteAnestesico: 10 });
    expect(r.atual.total).toBe(245);
    expect(r.novo.total).toBe(264.5);
    expect(r.afetadoPor).toEqual(['porteAnestesico']);
  });

  it('VALOR: reajuste da tabela muda cada componente; o do índice não alcança o item', () => {
    const r = simularReajusteItem(valor, { tabela: 10 }, 3);
    expect(r.atual.total).toBe(327.75);
    expect(r.novo.total).toBe(360.54); // (66 + 44 + 10,18) × 3
    expect(simularReajusteItem(valor, { indice: 10 }).afetadoPor).toEqual([]);
    expect(simularReajusteItem(valor, { indice: 10 }).diferenca).toBe(0);
  });

  it('PORTE: reajuste do porte de honorário', () => {
    const r = simularReajusteItem(porte, { porte: -5 }, 3);
    expect(r.atual.total).toBe(630);
    expect(r.novo.total).toBe(598.5);
    expect(r.percentual).toBe(-5);
  });

  it('faltando índice, o impacto não fecha (sem soma da vigência em silêncio)', () => {
    const r = simularReajusteItem({ ...ch, indices: indices({}) }, { indice: 10 });
    expect(r.atual.total).toBeNull();
    expect(r.diferenca).toBeNull();
    expect(r.percentual).toBeNull();
    expect(alvosQueAfetam({ ...ch, indices: indices({}) }, { indice: 10 })).toEqual([]);
  });

  it('os valores reajustados seguem as casas das tabelas oficiais', () => {
    const e = reajustarEntradaHonorario(ch, { indice: 3.3333, porteAnestesico: 3.3333 });
    expect(e.indices.valores.get(1)).toBe(0.516667);
    expect(e.porteAnestesico?.valor).toBe(155);
  });
});
