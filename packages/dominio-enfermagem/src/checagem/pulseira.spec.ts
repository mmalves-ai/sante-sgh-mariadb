// Regra 5 do M25: pulseira lida (do paciente certo) ou o motivo de não ler; e o código da dose (GS1).
import { describe, expect, it } from 'vitest';
import { conferirPulseira, gtinCasa, lerCodigoDose, lerCodigoPulseira } from './pulseira.js';

describe('regra 5: pulseira', () => {
  it('lê o código da pulseira de identificação (paciente e atendimento)', () => {
    expect(lerCodigoPulseira('P1001|A5001')).toEqual({ paciente: 1001, atendimento: 5001 });
    expect(lerCodigoPulseira(' p1001 ')).toEqual({ paciente: 1001, atendimento: null });
    expect(lerCodigoPulseira('X1001')).toBeNull();
    expect(lerCodigoPulseira('P0')).toBeNull();
  });
  const c = { obrigatoria: true, paciente: 1001, atendimento: 5001 };
  it('a pulseira do paciente passa; a de outro paciente ou atendimento bloqueia; código inválido recusa', () => {
    expect(conferirPulseira({ ...c, leitura: { lida: true, codigo: 'P1001|A5001' } })).toEqual({
      ok: true,
      lida: true,
      motivo: null,
    });
    expect(conferirPulseira({ ...c, leitura: { lida: true, codigo: 'P1002|A5001' } })).toMatchObject({
      ok: false,
      codigo: 'pulseira-outro-paciente',
    });
    expect(conferirPulseira({ ...c, leitura: { lida: true, codigo: 'P1001|A9999' } })).toMatchObject({
      codigo: 'pulseira-outro-paciente',
    });
    expect(conferirPulseira({ ...c, leitura: { lida: true, codigo: '7891234' } })).toMatchObject({
      codigo: 'pulseira-ilegivel',
    });
  });
  it('em unidade com leitura ligada, sem ler exige o motivo (vai para a trilha e o indicador)', () => {
    expect(conferirPulseira({ ...c, leitura: { lida: false, motivo: '' } })).toMatchObject({
      codigo: 'pulseira-sem-motivo',
    });
    expect(conferirPulseira({ ...c, leitura: { lida: false, motivo: 'pulseiraIlegivel' } })).toEqual({
      ok: true,
      lida: false,
      motivo: 'pulseiraIlegivel',
    });
    expect(conferirPulseira({ ...c, obrigatoria: false, leitura: { lida: false, motivo: '' } })).toEqual({
      ok: true,
      lida: false,
      motivo: null,
    });
  });
});

describe('código da dose (GS1 DataMatrix e código de barras)', () => {
  it('GS1 sem parênteses, com o separador de grupo', () => {
    expect(lerCodigoDose('0107891234567895172701311012AB\u001d21XYZ')).toEqual({
      gtin: '07891234567895',
      validade: '2027-01-31',
      lote: '12AB',
      barras: null,
    });
  });
  it('GS1 com parênteses e o dia 00 (o último do mês)', () => {
    expect(lerCodigoDose('(01)07891234567895(17)270200(10)L9')).toEqual({
      gtin: '07891234567895',
      validade: '2027-02-28',
      lote: 'L9',
      barras: null,
    });
  });
  it('o separador trocado pelo leitor e o prefixo de simbologia', () => {
    expect(lerCodigoDose(']d20107891234567895|1734')).toMatchObject({ gtin: '07891234567895' });
    expect(lerCodigoDose('01078912345678951127010110LOTE')).toMatchObject({ lote: 'LOTE' });
  });
  it('código de barras simples (EAN) e o casamento com o cadastro', () => {
    expect(lerCodigoDose('7891234567895')).toEqual({
      gtin: null,
      validade: null,
      lote: null,
      barras: '7891234567895',
    });
    expect(gtinCasa('07891234567895', '7891234567895')).toBe(true);
    expect(gtinCasa('07891234567895', '7890000000000')).toBe(false);
    expect(gtinCasa(null, '7891234567895')).toBe(false);
  });
});
