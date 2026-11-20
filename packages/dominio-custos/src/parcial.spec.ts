// Regra 8 (ficha do M54): sem uma competência completa de estoque, financeiro, faturamento e pessoal, o custeio sai
// marcado "parcial"; sem a folha (M53 não aceito), "parcial (sem pessoal)".
import { describe, expect, it } from 'vitest';
import { avaliarCompletude } from './parcial.js';

describe('completude do custeio', () => {
  it('sem a folha: parcial (sem pessoal)', () => {
    const r = avaliarCompletude({ saidas: 95_520, despesas: 1_014, contas: 3_189, folha: 0 });
    expect(r.parcial).toBe(true);
    expect(r.rotulo).toBe('parcial (sem pessoal)');
    expect(r.fontes.find((f) => f.fonte === 'pessoal')?.detalhe).toContain('folha');
    expect(r.fontes.find((f) => f.fonte === 'estoque')?.detalhe).toContain('95.520');
  });
  it('com tudo: completa, sem rótulo', () => {
    const r = avaliarCompletude({ saidas: 1, despesas: 1, contas: 1, folha: 1 });
    expect(r).toMatchObject({ parcial: false, rotulo: null });
    expect(r.fontes.every((f) => f.presente)).toBe(true);
  });
  it('mais de uma fonte faltando: lista com vírgula e "e"', () => {
    expect(avaliarCompletude({ saidas: 0, despesas: 0, contas: 5, folha: 0 }).rotulo).toBe(
      'parcial (sem estoque, financeiro e pessoal)',
    );
    expect(avaliarCompletude({ saidas: 1, despesas: 1, contas: 0, folha: 0 }).rotulo).toBe(
      'parcial (sem faturamento e pessoal)',
    );
  });
});
