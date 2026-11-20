// Regra 7 do M32: a classificação gerencial só na parcela 1 (CDC 0) vale para o documento; o rateio no novo.
import { describe, expect, it } from 'vitest';
import {
  calcularRateio,
  CDC_GRAVADO,
  classificacaoMostrada,
  classificacaoTexto,
  conferirSomaRateio,
  gravaClassificacao,
} from './index.js';

describe('classificação gerencial (regra 7)', () => {
  it('MFLANGSI só na parcela 1, CDC 0', () => {
    expect(gravaClassificacao(1)).toBe(true);
    expect(gravaClassificacao(2)).toBe(false);
    expect(CDC_GRAVADO).toBe(0);
    expect(classificacaoTexto({ grupo: 216, subgrupo: 2, item: 1 })).toBe('216.2.1');
    expect(classificacaoMostrada(3, { grupo: 216, subgrupo: 2, item: 1 })).toEqual({
      classificacao: { grupo: 216, subgrupo: 2, item: 1 },
      valeParaDocumento: true,
    });
    expect(classificacaoMostrada(1, null).valeParaDocumento).toBe(false);
  });
  it('rateio 33,33% + 33,33% + 33,34% de R$ 1.000,00 = 333,30 + 333,30 + 333,40 (a última leva a diferença)', () => {
    const r = calcularRateio(
      [
        { centroCusto: 10, percentual: 33.33 },
        { centroCusto: 20, percentual: 33.33 },
        { centroCusto: 30, percentual: 33.34 },
      ],
      1_000,
    );
    expect(r.ok && r.rateio.map((x) => x.valor)).toEqual([333.3, 333.3, 333.4]);
    if (r.ok) expect(conferirSomaRateio(r.rateio, 1_000)).toBeNull();
    expect(conferirSomaRateio([{ centroCusto: 1, percentual: 100, valor: 999 }], 1_000)?.codigo).toBe(
      'rateio-nao-soma',
    );
    expect(calcularRateio([], 10)).toEqual({ ok: true, rateio: [] });
  });
  it('rateio recusado: repetido, sem percentual, não fecha 100%', () => {
    const r1 = calcularRateio(
      [
        { centroCusto: 1, percentual: 50 },
        { centroCusto: 1, percentual: 50 },
      ],
      10,
    );
    expect(!r1.ok && r1.recusa.codigo).toBe('rateio-repetido');
    const r2 = calcularRateio([{ centroCusto: 1, percentual: 0 }], 10);
    expect(!r2.ok && r2.recusa.codigo).toBe('rateio-sem-percentual');
    const r3 = calcularRateio(
      [
        { centroCusto: 1, percentual: 60 },
        { centroCusto: 2, percentual: 30 },
      ],
      10,
    );
    expect(!r3.ok && r3.recusa.codigo).toBe('rateio-nao-fecha');
  });
});
