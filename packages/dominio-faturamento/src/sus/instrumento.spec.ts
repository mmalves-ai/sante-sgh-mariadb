// Regra 1 do M51: a conta é uma só, com financiador; o instrumento sai do financiador e do registro SIGTAP.
import { describe, expect, it } from 'vitest';
import { financiadorDoConvenio, instrumentoDeSaida, registroSigtap } from './instrumento.js';

describe('instrumento de saída (regra 1)', () => {
  it('financiador pelo convênio (SUS 1 e particular 10 por padrão; parâmetro por estabelecimento)', () => {
    expect(financiadorDoConvenio(1)).toBe('sus');
    expect(financiadorDoConvenio(10)).toBe('particular');
    expect(financiadorDoConvenio(20)).toBe('convenio');
    expect(financiadorDoConvenio(5, { sus: [5], particular: [] })).toBe('sus');
  });

  it('registro SIGTAP pelo código de tb_registro', () => {
    expect(registroSigtap('01')).toBe('bpa-c');
    expect(registroSigtap(2)).toBe('bpa-i');
    expect(registroSigtap('03')).toBe('aih-principal');
    expect(registroSigtap('06')).toBe('apac-principal');
    expect(registroSigtap('99')).toBeNull();
    expect(registroSigtap(null)).toBeNull();
  });

  it('não SUS: guia TISS ou recibo, e sempre a CIHA', () => {
    expect(instrumentoDeSaida('convenio', 'internacao', [])).toEqual({ cobranca: 'tiss', ciha: true });
    expect(instrumentoDeSaida('particular', 'ambulatorial', ['bpa-c'])).toEqual({
      cobranca: 'recibo',
      ciha: true,
    });
  });

  it('SUS: AIH na internação; APAC, BPA-I e BPA-C no ambulatório; nunca CIHA', () => {
    expect(instrumentoDeSaida('sus', 'internacao', ['aih-principal'])).toEqual({
      cobranca: 'aih',
      ciha: false,
    });
    expect(instrumentoDeSaida('sus', 'internacao', ['bpa-c'])).toEqual({ cobranca: null, ciha: false });
    expect(instrumentoDeSaida('sus', 'ambulatorial', ['bpa-c', 'apac-secundario']).cobranca).toBe('apac');
    expect(instrumentoDeSaida('sus', 'ambulatorial', ['bpa-c', 'bpa-i']).cobranca).toBe('bpa-i');
    expect(instrumentoDeSaida('sus', 'ambulatorial', ['bpa-c']).cobranca).toBe('bpa-c');
    expect(instrumentoDeSaida('sus', 'ambulatorial', ['aih-principal']).cobranca).toBeNull();
  });
});
