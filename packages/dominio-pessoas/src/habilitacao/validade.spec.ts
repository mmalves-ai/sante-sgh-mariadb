// Regra 3 do M52: validade do conselho acompanhada pelo RH, com alerta antes do vencimento.
import { describe, expect, it } from 'vitest';
import { alertasDeConselho, piorSituacao, situacaoHabilitacao } from './validade.js';

describe('situação da validade', () => {
  it('vencida, a vencer na janela de 60 dias, válida e sem validade', () => {
    expect(situacaoHabilitacao('2026-10-23', '2026-10-24')).toEqual({
      situacao: 'vencida',
      diasParaVencer: -1,
    });
    expect(situacaoHabilitacao('2026-10-24', '2026-10-24')).toEqual({
      situacao: 'aVencer',
      diasParaVencer: 0,
    });
    expect(situacaoHabilitacao('2026-12-23', '2026-10-24')).toEqual({
      situacao: 'aVencer',
      diasParaVencer: 60,
    });
    expect(situacaoHabilitacao('2026-12-24', '2026-10-24')).toEqual({
      situacao: 'valida',
      diasParaVencer: 61,
    });
    expect(situacaoHabilitacao(null, '2026-10-24')).toEqual({
      situacao: 'semValidade',
      diasParaVencer: null,
    });
  });

  it('a janela vem do parâmetro', () => {
    expect(situacaoHabilitacao('2026-11-30', '2026-10-24', 30).situacao).toBe('valida');
    expect(situacaoHabilitacao('2026-11-23', '2026-10-24', 30).situacao).toBe('aVencer');
  });

  it('a pior situação manda no alerta da lista', () => {
    expect(piorSituacao(['valida', 'semValidade', 'aVencer'])).toBe('aVencer');
    expect(piorSituacao(['valida', 'vencida', 'aVencer'])).toBe('vencida');
    expect(piorSituacao(['valida'])).toBe('valida');
    expect(piorSituacao([])).toBeNull();
  });
});

describe('alertas do dia', () => {
  it('só registros ativos, do mais urgente ao menos urgente', () => {
    const registros = [
      { registro: 1, profissional: 10, ativo: true, validade: '2027-06-01' },
      { registro: 2, profissional: 11, ativo: true, validade: '2026-11-10' },
      { registro: 3, profissional: 12, ativo: null, validade: null },
      { registro: 4, profissional: 13, ativo: true, validade: '2026-10-01' },
      { registro: 5, profissional: 14, ativo: false, validade: '2026-01-01' },
      { registro: 6, profissional: 15, ativo: true, validade: '2026-10-20' },
      { registro: 7, profissional: 16, ativo: true, validade: '2026-11-10' },
    ];
    const a = alertasDeConselho(registros, '2026-10-24');
    expect(a.map((r) => [r.registro, r.situacao])).toEqual([
      [4, 'vencida'],
      [6, 'vencida'],
      [2, 'aVencer'],
      [7, 'aVencer'],
      [3, 'semValidade'],
    ]);
    expect(a[0]?.diasParaVencer).toBe(-23);
  });
});
