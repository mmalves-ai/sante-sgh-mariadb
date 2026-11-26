import { describe, expect, it } from 'vitest';
import { conferirDecisaoDevolucao, disponivelParaDevolver } from './devolucao-adiantamento.js';

describe('devolução do adiantamento por duas pessoas', () => {
  it('o disponível é o saldo menos os pedidos em aberto, nunca negativo', () => {
    expect(disponivelParaDevolver(500, [])).toBe(500);
    expect(disponivelParaDevolver(500, [300, 0.1])).toBe(199.9);
    expect(disponivelParaDevolver(200, [300])).toBe(0);
  });

  it('quem pediu não aprova; outra pessoa aprova; o solicitante desconhecido não é aprovado', () => {
    const pedido = { situacao: 'solicitada' as const, solicitante: 7, decisao: 'aprovar' as const };
    expect(conferirDecisaoDevolucao({ ...pedido, decisor: 7 })?.codigo).toBe('aprovacao-pelo-solicitante');
    expect(conferirDecisaoDevolucao({ ...pedido, decisor: 8 })).toBeNull();
    expect(conferirDecisaoDevolucao({ ...pedido, solicitante: null, decisor: 8 })?.codigo).toBe(
      'aprovacao-pelo-solicitante',
    );
  });

  it('o próprio solicitante cancela o pedido; o decidido não muda mais', () => {
    expect(
      conferirDecisaoDevolucao({ situacao: 'solicitada', solicitante: 7, decisor: 7, decisao: 'cancelar' }),
    ).toBeNull();
    for (const situacao of ['aprovada', 'devolvida', 'cancelada'] as const)
      for (const decisao of ['aprovar', 'cancelar'] as const)
        expect(conferirDecisaoDevolucao({ situacao, solicitante: 7, decisor: 8, decisao })?.codigo).toBe(
          'devolucao-decidida',
        );
  });

  it('fora do dinheiro, a aprovação exige o identificador da transação (do pedido ou da aprovação)', () => {
    const base = { situacao: 'solicitada' as const, solicitante: 7, decisor: 8, decisao: 'aprovar' as const };
    for (const meio of ['pix', 'transferencia', 'cartao_credito', 'cheque']) {
      expect(conferirDecisaoDevolucao({ ...base, meio, comprovante: null })?.codigo).toBe(
        'comprovante-obrigatorio',
      );
      expect(conferirDecisaoDevolucao({ ...base, meio, comprovante: '   ' })?.codigo).toBe(
        'comprovante-obrigatorio',
      );
      expect(conferirDecisaoDevolucao({ ...base, meio, comprovante: 'E2E-SINT-0001' })).toBeNull();
    }
    expect(conferirDecisaoDevolucao({ ...base, meio: 'dinheiro', comprovante: null })).toBeNull();
    // O cancelamento não pede comprovante.
    expect(
      conferirDecisaoDevolucao({ ...base, decisao: 'cancelar', meio: 'pix', comprovante: null }),
    ).toBeNull();
  });
});
