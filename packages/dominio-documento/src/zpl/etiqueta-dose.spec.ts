// Etiqueta de dose da farmácia (ficha do M29, seção 10, "Documento: snapshot do ZPL da etiqueta"): o ZPL é comparado
// como texto com a referência versionada (referencias/etiqueta-dose.zpl); a impressão física é da validação humana.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { ErroZpl, zplEtiquetaDose } from './modelos.js';

const GS = '\u001d';
const d = {
  leito: '204-B',
  atendimento: 987654,
  iniciais: 'P.S.T.',
  medicamento: 'Cefazolina sintética 1 g',
  dose: '1 G EV',
  horario: '23/10 14:00',
  lote: 'AB-12',
  validade: '31/03/2027',
  datamatrix: `010789123456789517270331` + `10AB-12${GS}21D4321`,
};

describe('etiqueta de dose (ZPL com DataMatrix GS1)', () => {
  it('igual à referência versionada', () => {
    const ref = readFileSync(new URL('./referencias/etiqueta-dose.zpl', import.meta.url), 'utf8');
    expect(zplEtiquetaDose(d)).toBe(ref);
  });
  it('o FNC1 inicial e o separador viram `_1`; marca de controlado; sem lote', () => {
    const z = zplEtiquetaDose({ ...d, controlado: true, lote: null, validade: null });
    expect(z).toContain('^BXN,5,200,,,,_^FD_10107891234567895172703311' + '0AB-12_121D4321^FS');
    expect(z).toContain('CONTROLADO');
    expect(z).toContain('LOTE -  VAL -');
  });
  it('recusa dado inválido no código e atendimento inválido', () => {
    expect(() => zplEtiquetaDose({ ...d, datamatrix: 'A^B' })).toThrow(ErroZpl);
    expect(() => zplEtiquetaDose({ ...d, atendimento: 0 })).toThrow(/atendimento/);
  });
});
