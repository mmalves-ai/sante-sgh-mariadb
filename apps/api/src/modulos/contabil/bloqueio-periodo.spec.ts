import { describe, expect, it } from 'vitest';
import { avisoDoBloqueio, bloqueioDoLancamento } from './bloqueio-periodo.js';

describe('bloqueio do período para lançar', () => {
  it('aberto sem bloqueio diário aceita', () => {
    expect(bloqueioDoLancamento({ situacao: 'aberto', bloqueadoAte: null }, '2026-03-10', '2026-03')).toBeNull();
    expect(avisoDoBloqueio({ situacao: 'aberto', bloqueadoAte: null })).toBeNull();
  });
  it('encerrado e bloqueado recusam com o código', () => {
    expect(bloqueioDoLancamento({ situacao: 'encerrado', bloqueadoAte: null }, '2026-03-10', '2026-03')?.codigo).toBe('periodo-encerrado');
    expect(bloqueioDoLancamento({ situacao: 'bloqueado', bloqueadoAte: null }, '2026-03-10', '2026-03')?.codigo).toBe('periodo-bloqueado');
    expect(avisoDoBloqueio({ situacao: 'bloqueado', bloqueadoAte: null })).toBe('Período bloqueado para lançamentos.');
  });
  it('bloqueio diário recusa a data até o dia, inclusive, e aceita a seguinte', () => {
    const p = { situacao: 'aberto', bloqueadoAte: '2026-03-15' };
    expect(bloqueioDoLancamento(p, '2026-03-15', '2026-03')?.codigo).toBe('data-bloqueada');
    expect(bloqueioDoLancamento(p, '2026-03-01', '2026-03')?.mensagem).toContain('15/03/2026');
    expect(bloqueioDoLancamento(p, '2026-03-16', '2026-03')).toBeNull();
    expect(avisoDoBloqueio(p)).toBe('Lançamentos bloqueados até 15/03/2026.');
  });
});
