import { describe, expect, it } from 'vitest';
import { dividirParcelas, paraCsv, somarDias, somarMeses } from './regras-tela.js';

describe('regras das telas do financeiro', () => {
  it('divide o valor em parcelas iguais em centavos, com a diferença na última', () => {
    const p = dividirParcelas(100, 3, '2026-10-31');
    expect(p.map((x) => x.valor)).toEqual([33.33, 33.33, 33.34]);
    // 33,33 + 33,33 + 33,34 = 100,00: a soma fecha o valor do documento.
    expect(Math.round(p.reduce((s, x) => s + x.valor, 0) * 100)).toBe(10_000);
    expect(p.map((x) => x.vencimento)).toEqual(['2026-10-31', '2026-11-30', '2026-12-31']);
    expect(p.map((x) => x.parcela)).toEqual([1, 2, 3]);
  });

  it('parcela única e limites de quantidade', () => {
    expect(dividirParcelas(1500.5, 1, '2026-10-23')).toEqual([
      { parcela: 1, vencimento: '2026-10-23', valor: 1500.5 },
    ]);
    expect(dividirParcelas(10, 0, '2026-10-23')).toHaveLength(1);
    expect(dividirParcelas(10, 500, '2026-10-23')).toHaveLength(120);
  });

  it('soma dias e meses sem saltar o fim do mês', () => {
    expect(somarDias('2026-12-31', 1)).toBe('2027-01-01');
    expect(somarDias('2026-03-01', -1)).toBe('2026-02-28');
    expect(somarMeses('2026-01-31', 1)).toBe('2026-02-28');
    expect(somarMeses('2028-01-31', 1)).toBe('2028-02-29');
  });

  it('CSV com ponto e vírgula, decimal com vírgula e aspas quando precisa', () => {
    expect(
      paraCsv(
        ['a', 'b'],
        [
          ['x;y', 1.5],
          ['z', 2],
        ],
      ),
    ).toBe('a;b\r\n"x;y";1,5\r\nz;2');
  });
});
