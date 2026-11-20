import { describe, expect, it } from 'vitest';
import {
  competenciaSeguinte,
  competenciaValida,
  dataDoArquivo,
  decimalDoArquivo,
  inicioDaCompetencia,
  normalizarCodigo,
  valorEmCentavos,
} from './codigo.js';

describe('códigos como texto, com zeros à esquerda (regra 8)', () => {
  it.each([
    ['cid', 'a00.0', 'A000'],
    ['cid', 'U07.1', 'U071'],
    ['cid', 'C50', 'C50'],
    ['morfologia', '8000/3', 'M80003'],
    ['morfologia', 'M81470', 'M81470'],
    ['ciap', 'a01', 'A01'],
    ['ciap', '-30', '-30'],
    ['cbo', '22512', '022512'],
    ['cbo', '225125', '225125'],
    ['cep', '1001-000', '01001000'],
    ['cep', '28010-000', '28010000'],
    ['sigtap', '303090286', '0303090286'],
    ['ibge', '330100', '0330100'],
    ['banco', '1', '001'],
    ['tuss', '00012345', '00012345'],
    ['numerico', '0', '0'],
  ] as const)('%s %s → %s', (tipo, bruto, esperado) => {
    expect(normalizarCodigo(tipo, bruto)).toEqual({ ok: true, codigo: esperado });
  });

  it.each([
    ['cid', '0A0'],
    ['cid', ''],
    ['morfologia', '800'],
    ['ciap', 'AA1'],
    ['cep', '123456789'],
    ['sigtap', 'ABC'],
    ['tuss', '12a'],
  ] as const)('%s %s é recusado', (tipo, bruto) => {
    expect(normalizarCodigo(tipo, bruto).ok).toBe(false);
  });

  it('nulo é recusado', () => {
    expect(normalizarCodigo('cid', null)).toEqual({ ok: false, erro: 'código vazio' });
  });
});

describe('competência AAAAMM', () => {
  it('valida, primeiro dia e a seguinte', () => {
    expect(competenciaValida('202610')).toBe(true);
    expect(competenciaValida('202613')).toBe(false);
    expect(competenciaValida('1999012')).toBe(false);
    expect(inicioDaCompetencia('201311')).toBe('2013-11-01');
    expect(competenciaSeguinte('201311')).toBe('201312');
    expect(competenciaSeguinte('201312')).toBe('201401');
    expect(() => inicioDaCompetencia('2013')).toThrow();
    expect(() => competenciaSeguinte('x')).toThrow();
  });
});

describe('datas e valores do arquivo', () => {
  it('datas DDMMAAAA, DD/MM/AAAA e AAAA-MM-DD', () => {
    expect(dataDoArquivo('01012026')).toBe('2026-01-01');
    expect(dataDoArquivo('31/12/2025')).toBe('2025-12-31');
    expect(dataDoArquivo('2026-02-28')).toBe('2026-02-28');
    expect(dataDoArquivo('30/02/2026')).toBeNull();
    expect(dataDoArquivo('')).toBeNull();
    expect(dataDoArquivo('ontem')).toBeNull();
  });
  it('centavos e decimais', () => {
    expect(valorEmCentavos('000000001234')).toBe(12.34);
    expect(valorEmCentavos('')).toBe(0);
    expect(valorEmCentavos('12,3')).toBeNull();
    expect(decimalDoArquivo('1.234,56')).toBe(1234.56);
    expect(decimalDoArquivo('1234.5')).toBe(1234.5);
    expect(decimalDoArquivo('')).toBeNull();
    expect(decimalDoArquivo('abc')).toBeNull();
  });
});
