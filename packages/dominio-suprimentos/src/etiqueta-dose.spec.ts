// Etiqueta de dose (ficha do M29, seção 5 e seção 10, "Documento"): o conteúdo do DataMatrix GS1 (GTIN quando o código
// de barras é válido, senão o código interno; validade, lote e a série da dose por último).
import { describe, expect, it } from 'vitest';
import {
  codigoEtiquetaDose,
  etiquetasAceitas,
  GS,
  gtin14,
  serieDaDose,
} from '@sgh/contratos/regras-suprimentos';

describe('código da etiqueta de dose (GS1)', () => {
  it('GTIN-14 só com o dígito verificador correto', () => {
    expect(gtin14('7891234567895')).toBe('07891234567895');
    expect(gtin14('7891234567890')).toBeNull();
    expect(gtin14('ABC')).toBeNull();
    expect(gtin14(null)).toBeNull();
    expect(gtin14('96385074')).toBe('00000096385074');
  });
  it('com GTIN: (01)(17)(10)(21), GS depois do lote; a série por último', () => {
    const c = codigoEtiquetaDose({
      dose: 4321,
      item: 7,
      barras: '7891234567895',
      lote: 'AB-12',
      validade: '2027-03-31',
    });
    expect(c.legivel).toBe('(01)07891234567895(17)270331(10)AB-12(21)D4321');
    expect(c.dado).toBe(`010789123456789517270331` + `10AB-12${GS}21D4321`);
    expect(c.serie).toBe(serieDaDose(4321));
    expect(etiquetasAceitas(c)).toEqual([c.dado, c.legivel, '21D4321']);
  });
  it('sem GTIN nem lote: o código interno (91) e a série; o lote é limpo e cortado', () => {
    const c = codigoEtiquetaDose({ dose: 9, item: 70, barras: '', lote: null, validade: null });
    expect(c.legivel).toBe('(91)IT70(21)D9');
    expect(c.dado).toBe(`91IT70${GS}21D9`);
    const l = codigoEtiquetaDose({
      dose: 9,
      item: 70,
      barras: null,
      lote: 'L ç 1 23456789012345678901',
      validade: '27-1-1',
    });
    expect(l.legivel).toBe('(91)IT70(10)L1234567890123456789(21)D9');
  });
  it('dose inválida é recusada', () => {
    expect(() =>
      codigoEtiquetaDose({ dose: 0, item: 1, barras: null, lote: null, validade: null }),
    ).toThrow();
  });
});
