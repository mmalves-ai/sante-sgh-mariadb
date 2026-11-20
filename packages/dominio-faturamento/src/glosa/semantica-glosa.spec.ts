// Regra 6 do M31: GLOSADO='T' é baixa (conciliado), não glosa; glosa real = VALOR_C − VLR_PG nos itens baixados; na
// tela, conciliado e glosado são campos distintos; o pago a maior é glosa negativa (régua líquida).
import { describe, expect, it } from 'vitest';
import { semanticaGlosa } from '@sgh/contratos/regras-faturamento';

describe('semântica da glosa', () => {
  it('não baixado: nem conciliado nem glosado, mesmo com pago 0', () => {
    expect(semanticaGlosa({ glosado: 'F', valorCobrado: 100, valorPago: 0 })).toEqual({
      conciliado: false,
      glosa: 0,
      glosaPositiva: 0,
      pagoAMaior: false,
    });
  });
  it('baixado com pago menor: glosa real', () => {
    expect(semanticaGlosa({ glosado: 'T', valorCobrado: 100, valorPago: 70.5 })).toMatchObject({
      conciliado: true,
      glosa: 29.5,
      glosaPositiva: 29.5,
    });
  });
  it('baixado com pago integral: conciliado sem glosa', () => {
    expect(semanticaGlosa({ glosado: 't ', valorCobrado: 50, valorPago: 50 })).toMatchObject({
      conciliado: true,
      glosa: 0,
    });
  });
  it('pago a maior: glosa negativa na régua líquida, zero na positiva', () => {
    expect(semanticaGlosa({ glosado: 'T', valorCobrado: 50, valorPago: 60 })).toEqual({
      conciliado: true,
      glosa: -10,
      glosaPositiva: 0,
      pagoAMaior: true,
    });
  });
});
