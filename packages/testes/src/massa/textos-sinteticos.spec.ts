import { describe, expect, it } from 'vitest';
import { CORPUS_ACENTUADO, palavraSintetica, textoLongoAcentuado } from './textos-sinteticos.js';

// A ida e volta no banco (coluna utf8mb4) é provada em textos-sinteticos.int.spec.ts; aqui só a forma dos textos.
const QUATRO_BYTES = /[\u{10000}-\u{10FFFF}]/u;

describe('textos sintéticos da massa', () => {
  it('palavraSintetica: só minúsculas e sem repetir', () => {
    const vistas = new Set(Array.from({ length: 200 }, () => palavraSintetica()));
    expect(vistas.size).toBe(200);
    for (const p of vistas) expect(p).toMatch(/^sgh[a-z]{1,10}$/);
  });
  it('corpus e texto longo têm caracteres de 2, 3 e 4 bytes (só utf8mb4 guarda os de 4)', () => {
    for (const t of [CORPUS_ACENTUADO, textoLongoAcentuado()]) {
      expect(t).toMatch(/[çãéü]/); // 2 bytes
      expect(t).toMatch(/[€“]/); // 3 bytes
      expect(t).toMatch(QUATRO_BYTES); // 4 bytes, fora do plano básico
    }
    expect(textoLongoAcentuado().length).toBeGreaterThan(75000);
    expect(Buffer.byteLength(textoLongoAcentuado(), 'utf8')).toBeGreaterThan(65535); // não cabe em TEXT
  });
});
