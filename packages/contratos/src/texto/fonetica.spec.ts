// Fonética do dicionário pessoal (M27): as regras medidas na cópia, com palavras sintéticas.
import { describe, expect, it } from 'vitest';
import { foneticaDoDicionario, palavraDoDicionario } from './fonetica.js';

describe('fonética do dicionário ortográfico pessoal', () => {
  it('ç antes de ã/õ vira s (entre vogais, z); nas demais sílabas, c com som de k', () => {
    expect(foneticaDoDicionario('medicação')).toBe('mdkz');
    expect(foneticaDoDicionario('infusões')).toBe('nfz');
    expect(foneticaDoDicionario('criança')).toBe('crnk');
    expect(foneticaDoDicionario('março')).toBe('mrk');
  });
  it('qu, c, ss, s entre vogais, y, g antes de e/i e o s final', () => {
    expect(foneticaDoDicionario('quadro')).toBe('kdr');
    expect(foneticaDoDicionario('cecal')).toBe('skl');
    expect(foneticaDoDicionario('pressão')).toBe('prz');
    expect(foneticaDoDicionario('casos')).toBe('kz');
    expect(foneticaDoDicionario('hyalino')).toBe('ln');
    expect(foneticaDoDicionario('gelo')).toBe('jl');
    expect(foneticaDoDicionario('gastos')).toBe('gst');
  });
  it('letras repetidas viram uma; vogais e h saem', () => {
    expect(foneticaDoDicionario('arritmia')).toBe('rtm');
    expect(foneticaDoDicionario('hálito')).toBe('lt');
  });
  it('as preposições têm a fonética vazia; a palavra é gravada em minúsculas, sem espaço nas pontas', () => {
    for (const p of ['de', 'da', 'do', 'das', 'dos', 'DOS']) expect(foneticaDoDicionario(p)).toBe('');
    expect(foneticaDoDicionario('no')).toBe('n');
    expect(palavraDoDicionario('  Ecocardiograma ')).toBe('ecocardiograma');
  });
  it('cabe na coluna (50)', () => {
    expect(foneticaDoDicionario('b'.repeat(40) + 'c'.repeat(80)).length).toBeLessThanOrEqual(50);
  });
});
