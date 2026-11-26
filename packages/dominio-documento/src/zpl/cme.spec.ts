// Desenho ZPL da etiqueta do pacote estéril: os campos do art. 83 da RDC 15/2012 legíveis e o Code 128 com o código;
// campo vazio, data fora do formato ou código que quebraria o ZPL são recusados.
import { describe, expect, it } from 'vitest';
import { zplEtiquetaPacoteEsteril } from './cme.js';
import { ErroZpl } from './modelos.js';

const base = {
  codigo: 'PE00100000042',
  produto: 'Caixa de laparotomia sintética',
  lote: 'L-2026-001',
  esterilizadoEm: '25/11/2026',
  validade: '25/12/2026',
  metodo: 'Vapor saturado',
  preparadoPor: 'tecnico.cme',
};

describe('zplEtiquetaPacoteEsteril', () => {
  it('monta a etiqueta com os campos da RDC e o Code 128 do código', () => {
    const z = zplEtiquetaPacoteEsteril(base);
    expect(z.startsWith('^XA')).toBe(true);
    expect(z).toContain('^BCN,70,N,N,N^FDPE00100000042^FS');
    expect(z).toContain('CAIXA DE LAPAROTOMIA SINT');
    expect(z).toContain('LOTE L-2026-001  VAPOR SATURADO');
    expect(z).toContain('ESTER 25/11/2026  VAL 25/12/2026');
    expect(z).toContain('PREP TECNICO.CME');
    expect(z.trimEnd().endsWith('^XZ')).toBe(true);
    expect(zplEtiquetaPacoteEsteril(base)).toBe(z);
  });

  it('recusa código, campo vazio ou data que quebrariam a etiqueta', () => {
    expect(() => zplEtiquetaPacoteEsteril({ ...base, codigo: 'PE^XZ' })).toThrow(ErroZpl);
    expect(() => zplEtiquetaPacoteEsteril({ ...base, lote: ' ' })).toThrow(ErroZpl);
    expect(() => zplEtiquetaPacoteEsteril({ ...base, validade: '2026-12-25' })).toThrow(ErroZpl);
  });
});
