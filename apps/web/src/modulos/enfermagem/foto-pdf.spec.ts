// W0-03, M4: o PDF de uma página com a foto da lesão (o anexo do prontuário é gravado em PDF).
import { describe, expect, it } from 'vitest';
import { base64, pdfDeJpeg } from './foto-pdf.js';

const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4, 0xff, 0xd9]);
const latin = (b: Uint8Array) => Array.from(b, (c) => String.fromCharCode(c)).join('');

describe('pdfDeJpeg', () => {
  it('monta o PDF com a imagem DCTDecode do tamanho da foto e o xref com os deslocamentos certos', () => {
    const pdf = pdfDeJpeg(JPEG, 640, 480);
    const s = latin(pdf);
    expect(s.startsWith('%PDF-1.4\n')).toBe(true);
    expect(s.trimEnd().endsWith('%%EOF')).toBe(true);
    expect(s).toContain('/MediaBox [0 0 640 480]');
    expect(s).toContain(`/Filter /DCTDecode /Length ${JPEG.length}`);
    expect(s).toContain('q 640 0 0 480 0 0 cm /Im0 Do Q');
    // O JPEG vai inteiro, sem recompressão.
    expect(s).toContain(latin(JPEG));
    // Cada entrada do xref aponta para o início do objeto, e o startxref para o xref.
    const xref = Number(/startxref\n(\d+)/.exec(s)![1]);
    expect(s.slice(xref, xref + 4)).toBe('xref');
    const entradas = [...s.slice(xref).matchAll(/(\d{10}) 00000 n /g)].map((m) => Number(m[1]));
    expect(entradas).toHaveLength(5);
    entradas.forEach((o, i) => expect(s.slice(o, o + `${i + 1} 0 obj`.length)).toBe(`${i + 1} 0 obj`));
  });

  it('recusa o que não é JPEG e o base64 começa pelo cabeçalho do PDF', () => {
    expect(() => pdfDeJpeg(new Uint8Array([0x89, 0x50, 0x4e, 0x47]), 1, 1)).toThrow('não é JPEG');
    expect(base64(pdfDeJpeg(JPEG, 1, 1)).startsWith('JVBERi0')).toBe(true);
  });
});
