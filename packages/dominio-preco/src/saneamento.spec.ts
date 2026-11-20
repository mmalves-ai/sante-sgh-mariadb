import { describe, expect, it } from 'vitest';
import { motivoDataSuspeita, relatorioSaneamento } from './saneamento.js';

describe('relatório de saneamento (regra 9: o novo não corrige sozinho)', () => {
  it('anos fora da faixa e datas ilegíveis; sentinela não é erro', () => {
    expect(motivoDataSuspeita('0218-03-01')).toBe('ano-fora-da-faixa');
    expect(motivoDataSuspeita('2201-03-01')).toBe('ano-fora-da-faixa');
    expect(motivoDataSuspeita('2026-02-31')).toBe('data-ilegivel');
    expect(motivoDataSuspeita('1899-12-30')).toBeNull();
    expect(motivoDataSuspeita(null)).toBeNull();
    expect(motivoDataSuspeita('2025-01-01')).toBeNull();
  });
  it('agrupa por origem e ordena', () => {
    const r = relatorioSaneamento([
      { origem: 'percentual-matmed', chave: 'conv 20 item 3', data: '0218-01-01' },
      { origem: 'indice', chave: 'conv 5 ind 1', data: '0019-01-01' },
      { origem: 'indice', chave: 'conv 5 ind 2', data: '2025-01-01' },
      { origem: 'percentual-matmed', chave: 'conv 20 item 1', data: '2201-01-01' },
    ]);
    expect(r.porOrigem).toEqual({ 'percentual-matmed': 2, indice: 1 });
    expect(r.achados.map((a) => a.chave)).toEqual(['conv 5 ind 1', 'conv 20 item 1', 'conv 20 item 3']);
  });
});
