import { describe, expect, it } from 'vitest';
import { conferirParcelasAlteracao, motivosDaOrigem } from './api-titulo-pagar-alteracao.js';

describe('alteração do título a pagar: conferência da tela (C1-008)', () => {
  it('as parcelas somam o valor do documento, em centavos', () => {
    const ps = [
      { vencimento: '2026-12-10', valor: 333.33 },
      { vencimento: '2027-01-10', valor: 333.33 },
      { vencimento: '2027-02-10', valor: 333.34 },
    ];
    expect(conferirParcelasAlteracao(ps, 1000)).toEqual({ erro: null, soma: 1000 });
    expect(conferirParcelasAlteracao(ps, 1000.01).erro).toBe('soma-diferente');
  });
  it('parcela sem vencimento ou sem valor, e nenhuma parcela, são recusadas', () => {
    expect(conferirParcelasAlteracao([], 10).erro).toBe('sem-parcela');
    expect(conferirParcelasAlteracao([{ vencimento: '', valor: 10 }], 10).erro).toBe('parcela-incompleta');
    expect(conferirParcelasAlteracao([{ vencimento: '2026-12-01', valor: 0 }], 0).erro).toBe(
      'parcela-incompleta',
    );
  });
  it('o motivo da devolução segue a natureza da origem', () => {
    const ms = [
      { id: 1, natureza: 'credito' as const },
      { id: 2, natureza: 'debito' as const },
      { id: 3, natureza: 'ambos' as const },
    ];
    expect(motivosDaOrigem(ms, 'fornecedor').map((m) => m.id)).toEqual([1, 3]);
    expect(motivosDaOrigem(ms, 'hospital').map((m) => m.id)).toEqual([2, 3]);
  });
});
