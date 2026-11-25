// Desenho ZPL da etiqueta de identificação do estoque: o DataMatrix GS1 com o FNC1 (`_1`) no início e entre os campos
// variáveis, o Code 128 só com o identificador e o texto legível; dado que quebraria o ZPL é recusado.
import { describe, expect, it } from 'vitest';
import { zplEtiquetaEstoque } from './estoque.js';
import { ErroZpl } from './modelos.js';

const base = {
  identificador: 'E00000A1',
  datamatrix: '0107891234567895172612311' + '0LOTE-1\u001d21E00000A1',
  legivel: '(01)07891234567895(17)261231(10)LOTE-1(21)E00000A1',
  item: 'Dipirona 500 mg comprimido',
  lote: 'LOTE-1',
  validade: '31/12/2026',
  quantidade: '10 CP',
};

describe('zplEtiquetaEstoque', () => {
  it('monta o DataMatrix GS1 com FNC1 e o Code 128 com o identificador', () => {
    const z = zplEtiquetaEstoque(base);
    expect(z.startsWith('^XA')).toBe(true);
    expect(z).toContain('^BXN,4,200,,,,_^FD_10107891234567895172612311' + '0LOTE-1_121E00000A1^FS');
    expect(z).toContain('^BCN,60,N,N,N^FDE00000A1^FS');
    expect(z).toContain('DIPIRONA 500 MG COMPRIMIDO');
    expect(z).toContain('LOTE LOTE-1  VAL 31/12/2026');
    expect(z.trimEnd().endsWith('^XZ')).toBe(true);
  });

  it('sem lote nem validade, mostra o traço', () => {
    const z = zplEtiquetaEstoque({ ...base, lote: null, validade: null, datamatrix: '21E00000A1' });
    expect(z).toContain('LOTE -  VAL -');
    expect(z).toContain('^FD_121E00000A1^FS');
  });

  it('recusa identificador ou DataMatrix que quebrariam o ZPL', () => {
    expect(() => zplEtiquetaEstoque({ ...base, identificador: 'E^XZ' })).toThrow(ErroZpl);
    expect(() => zplEtiquetaEstoque({ ...base, datamatrix: '10A^B' })).toThrow(ErroZpl);
    expect(() => zplEtiquetaEstoque({ ...base, datamatrix: '10A B' })).toThrow(ErroZpl);
  });
});
