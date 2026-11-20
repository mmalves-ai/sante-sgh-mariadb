// Regra 10 do M49 (DP-47.2): numeração SNCR de 16 dígitos e vários medicamentos na mesma receita.
import { describe, expect, it } from 'vitest';
import { aplicarRespostaSncr, montarSolicitacaoSncr, numeroSncrValido } from './sncr.js';

describe('numeração SNCR', () => {
  it('16 dígitos, nem mais nem menos', () => {
    expect(numeroSncrValido('1234567890123456')).toBe(true);
    expect(numeroSncrValido('123456789012345')).toBe(false);
    expect(numeroSncrValido('12345678901234567')).toBe(false);
    expect(numeroSncrValido('12345678901234a6')).toBe(false);
  });

  it('vários medicamentos numa receita: um item por medicamento e unidade, quantidades somadas', () => {
    const s = montarSolicitacaoSncr(10, 'controle-especial', [
      { medicamento: 1, quantidade: 30, unidade: 'comprimido' },
      { medicamento: 2, quantidade: 1, unidade: 'frasco' },
      { medicamento: 1, quantidade: 10, unidade: 'comprimido' },
    ]);
    expect(s).toEqual({
      receita: 10,
      tipo: 'controle-especial',
      itens: [
        { medicamento: 1, quantidade: 40, unidade: 'comprimido' },
        { medicamento: 2, quantidade: 1, unidade: 'frasco' },
      ],
    });
    expect(() => montarSolicitacaoSncr(10, 'antimicrobiano', [])).toThrow();
    expect(() =>
      montarSolicitacaoSncr(10, 'antimicrobiano', [{ medicamento: 1, quantidade: 0, unidade: 'x' }]),
    ).toThrow();
  });

  it('resposta: numerada só com 16 dígitos; recusa encerra; erro técnico tenta até o teto', () => {
    const p = { situacao: 'pendente', tentativas: 0, numero: null } as const;
    expect(aplicarRespostaSncr(p, { tipo: 'numero', numero: '1234567890123456' }, 3)).toEqual({
      situacao: 'numerada',
      tentativas: 1,
      numero: '1234567890123456',
    });
    expect(aplicarRespostaSncr(p, { tipo: 'numero', numero: '123' }, 3).situacao).toBe('erro');
    expect(aplicarRespostaSncr(p, { tipo: 'recusa' }, 3).situacao).toBe('recusada');
    expect(aplicarRespostaSncr(p, { tipo: 'erro' }, 3)).toEqual({
      situacao: 'pendente',
      tentativas: 1,
      numero: null,
    });
    expect(aplicarRespostaSncr({ ...p, tentativas: 2 }, { tipo: 'erro' }, 3).situacao).toBe('erro');
    expect(() =>
      aplicarRespostaSncr(
        { situacao: 'numerada', tentativas: 1, numero: '1234567890123456' },
        { tipo: 'erro' },
        3,
      ),
    ).toThrow();
  });
});
