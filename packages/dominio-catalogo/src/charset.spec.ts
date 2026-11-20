import { describe, expect, it } from 'vitest';
import { bytesCp1252, converterParaCp1252, descreverTrocas } from './charset.js';

// Corpus com caracteres-limite (ficha do M13, regra 7): os que existem no CP1252 passam; os outros recebem a
// troca proposta (tabela do contrato, letra sem o acento combinado ou "?").
describe('conversão para CP1252', () => {
  it('texto do CP1252 passa sem troca (acentos, ç, aspas curvas, travessão, €)', () => {
    const t = 'Ação “cirúrgica” — Œ € ñ ü ß';
    expect(converterParaCp1252(t)).toEqual({ texto: t, trocas: [] });
  });
  it('espaço especial vira espaço comum e o invisível sai (normalização do contrato)', () => {
    expect(converterParaCp1252('A B​C').texto).toBe('A BC');
  });
  it('símbolo da tabela de trocas, letra sem acento combinado e o resto "?"', () => {
    const r = converterParaCp1252('≥ 5 Erdős 漢');
    expect(r.texto).toBe('>= 5 Erdos ?');
    expect(r.trocas.map((t) => t.troca)).toEqual(['>=', 'o', '?']);
    expect(descreverTrocas('nome', r.trocas)).toBe('nome: troca proposta "≥" → ">=", "ő" → "o", "漢" → "?"');
  });
  it('mais de três trocas resumidas', () => {
    const r = converterParaCp1252('漢漢漢漢漢');
    expect(descreverTrocas('nome', r.trocas)).toContain('(e mais 2)');
  });
  it('acento decomposto é recomposto (NFC) e conta 1 byte', () => {
    const r = converterParaCp1252('José');
    expect(r.texto).toBe('José');
    expect(bytesCp1252(r.texto)).toBe(4);
  });
});
