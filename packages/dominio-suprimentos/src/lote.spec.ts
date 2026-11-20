// Regra 8 (ficha do M28): soma por lote, sugestão do que vence primeiro, vencido e interditado, validade na entrada.
import { describe, expect, it } from 'vitest';
import {
  conferirCorrecaoValidade,
  conferirLoteEntrada,
  conferirLotesSaida,
  diasParaVencer,
  sugerirLotes,
  validadeSuspeita,
} from '@sgh/contratos/regras-suprimentos';

const hoje = '2026-10-22';
const lotes = [
  { id: 1, lote: 'B', validade: '2027-05-01', saldo: 10 },
  { id: 2, lote: 'A', validade: '2026-12-01', saldo: 3 },
  { id: 3, lote: 'V', validade: '2026-01-01', saldo: 50 },
  { id: 4, lote: 'I', validade: '2026-11-01', saldo: 50, interditado: true },
  { id: 5, lote: 'S', validade: '2206-01-01', saldo: 50 },
  { id: 6, lote: 'Z', validade: '2028-01-01', saldo: 0 },
];

describe('lote e validade (regra 8)', () => {
  it('sugere o que vence primeiro, sem vencido, interditado, suspeito ou zerado', () => {
    expect(sugerirLotes(lotes, 5, hoje)).toEqual([
      { lote: 'A', validade: '2026-12-01', quantidade: 3 },
      { lote: 'B', validade: '2027-05-01', quantidade: 2 },
    ]);
    expect(sugerirLotes(lotes, 100, hoje).reduce((s, l) => s + l.quantidade, 0)).toBe(13);
  });
  it('a soma por lote é a quantidade do item', () => {
    expect(
      conferirLotesSaida(5, [{ lote: 'A', validade: '2026-12-01', quantidade: 3 }], lotes, hoje)[0]?.codigo,
    ).toBe('soma-dos-lotes');
    expect(
      conferirLotesSaida(
        5,
        [
          { lote: 'A', validade: '2026-12-01', quantidade: 3 },
          { lote: 'B', validade: '2027-05-01', quantidade: 2 },
        ],
        lotes,
        hoje,
      ),
    ).toEqual([]);
  });
  it('vencido, interditado, inexistente e sem saldo não saem', () => {
    const c = (lote: string, validade: string, q: number) =>
      conferirLotesSaida(q, [{ lote, validade, quantidade: q }], lotes, hoje).map((r) => r.codigo);
    expect(c('V', '2026-01-01', 1)).toEqual(['lote-vencido']);
    expect(c('I', '2026-11-01', 1)).toEqual(['lote-interditado']);
    expect(c('X', '2026-11-01', 1)).toEqual(['lote-inexistente']);
    expect(c('A', '2026-12-01', 4)).toEqual(['saldo-do-lote']);
  });
  it('na entrada, lote e validade obrigatórios, validade não passada nem suspeita', () => {
    expect(conferirLoteEntrada({ lote: 'L', validade: '2027-01-01' }, hoje)).toEqual([]);
    expect(conferirLoteEntrada({}, hoje).map((r) => r.codigo)).toEqual(['sem-lote', 'sem-validade']);
    expect(conferirLoteEntrada({ lote: 'L', validade: '2026-10-21' }, hoje)[0]?.codigo).toBe(
      'validade-no-passado',
    );
    expect(conferirLoteEntrada({ lote: 'L', validade: '2207-01-01' }, hoje)[0]?.codigo).toBe(
      'validade-suspeita',
    );
  });
  it('saneamento da validade com dígitos trocados', () => {
    expect(validadeSuspeita('2027-01-01')).toBe(false);
    expect(validadeSuspeita('1027-01-01')).toBe(true);
    expect(conferirCorrecaoValidade('2027-01-01', '2027-02-01')?.codigo).toBe('validade-correta');
    expect(conferirCorrecaoValidade('2207-01-01', '2207-02-01')?.codigo).toBe('validade-invalida');
    expect(conferirCorrecaoValidade('2207-01-01', '2027-02-01')).toBeNull();
    expect(diasParaVencer('2026-10-25', hoje)).toBe(3);
  });
});
