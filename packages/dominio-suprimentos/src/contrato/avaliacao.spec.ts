// Regra 8 da ficha do M55 (etapa 3; ONA-05): a avaliação do fornecedor pela média das notas (qualquer nota 1
// desqualifica), com a conta impressa, e a periodicidade (crítico 6 meses, os demais 12).
import { describe, expect, it } from 'vitest';
import { avaliacaoVencida, avaliarFornecedor, proximaAvaliacao } from '../index.js';

describe('avaliação do fornecedor', () => {
  it.each([
    [{ qualidade: 5, prazo: 4, atendimento: 4, documentacao: 3 }, 4, 'qualificado'],
    [{ qualidade: 4, prazo: 3, atendimento: 3, documentacao: 3 }, 3.25, 'condicional'],
    [{ qualidade: 3, prazo: 2, atendimento: 3, documentacao: 2 }, 2.5, 'desqualificado'],
    [{ qualidade: 5, prazo: 5, atendimento: 5, documentacao: 1 }, 4, 'desqualificado'],
  ])('%o → média %d, %s', (notas, media, resultado) => {
    expect(avaliarFornecedor(notas)).toMatchObject({ media, resultado });
  });
  it('a conta impressa', () => {
    expect(avaliarFornecedor({ qualidade: 5, prazo: 4, atendimento: 4, documentacao: 3 }).conta).toBe(
      '(5 + 4 + 4 + 3) ÷ 4 = 4.00',
    );
  });
});

describe('periodicidade da avaliação', () => {
  it('crítico a cada 6 meses, os demais a cada 12, desde a última ou do início', () => {
    expect(proximaAvaliacao({ critico: true, inicio: '2026-01-10', ultima: null })).toBe('2026-07-10');
    expect(proximaAvaliacao({ critico: false, inicio: '2026-01-10', ultima: null })).toBe('2027-01-10');
    expect(proximaAvaliacao({ critico: true, inicio: '2026-01-10', ultima: '2026-07-01' })).toBe(
      '2027-01-01',
    );
  });
  it('vencida só no contrato ativo depois da data', () => {
    const o = { critico: true, inicio: '2026-01-10', ultima: null, situacao: 'ativo' as const };
    expect(avaliacaoVencida({ ...o, hoje: '2026-07-10' })).toBe(false);
    expect(avaliacaoVencida({ ...o, hoje: '2026-07-11' })).toBe(true);
    expect(avaliacaoVencida({ ...o, situacao: 'encerrado', hoje: '2027-07-11' })).toBe(false);
  });
});
