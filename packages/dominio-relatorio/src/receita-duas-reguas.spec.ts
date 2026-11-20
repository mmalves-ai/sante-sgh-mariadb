// Regra 13: as duas réguas da receita, ambas visíveis e com o nome da régua (data do item e competência da
// conta). A conferência com os valores de controle da cópia fica em receita-duas-reguas.int.spec.ts.
import { describe, expect, it } from 'vitest';
import { seriesFinanceiras, totalDaSerie } from './paineis.js';

describe('duas réguas de receita', () => {
  const meses = ['2025-01', '2025-02'];
  const s = seriesFinanceiras(
    [
      {
        periodo: '2025-01',
        regua: 'data-do-item',
        cobrado: 10.1,
        pago: 5,
        cobradoBaixado: 9,
        pagoBaixado: 5,
      },
      {
        periodo: '2025-02',
        regua: 'data-do-item',
        cobrado: 20.2,
        pago: 0,
        cobradoBaixado: 0,
        pagoBaixado: 0,
      },
      { periodo: '2025-01', regua: 'competencia', cobrado: 12, pago: 4, cobradoBaixado: 8, pagoBaixado: 4 },
    ],
    meses,
    '2025-02',
  );

  it('cobrado e pago nas duas réguas, com o nome da régua no rótulo', () => {
    expect(s.map((x) => x.codigo)).toEqual([
      'cobrado-data-do-item',
      'pago-data-do-item',
      'cobrado-competencia',
      'pago-competencia',
      'glosa-baixados',
      'maturacao',
    ]);
    expect(s[0]?.rotulo).toBe('Receita cobrada (pela data do item)');
    expect(s[2]?.rotulo).toBe('Receita cobrada (pela competência da conta)');
    expect(s[2]?.regua).toBe('competencia');
  });

  it('totais por régua; o mês a partir do parcial vem marcado', () => {
    expect(totalDaSerie(s[0]!, meses)).toBe(30.3);
    expect(totalDaSerie(s[2]!, meses)).toBe(12);
    expect(s[0]?.valores.map((v) => v.parcial)).toEqual([false, true]);
    expect(s[3]?.valores.map((v) => v.valor)).toEqual([4, 0]);
  });
});
