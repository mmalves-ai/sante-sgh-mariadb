import { describe, expect, it } from 'vitest';
import {
  type AlvoParaVinculo,
  type NotaParaVinculo,
  saldosVinculo,
  situacaoDocumentacao,
  validarVinculoNota,
  valorDocumentavelFatura,
} from './nota-vinculo.js';

const nota: NotaParaVinculo = {
  situacao: 'autorizada',
  valorServicos: 1000,
  valorJaApropriado: 300,
  fontePagadoraId: 7,
};
const fatura: AlvoParaVinculo = {
  tipo: 'fatura',
  situacao: 'fechada',
  valorDocumentavel: 900,
  valorJaDocumentado: 100,
  fontePagadoraId: 7,
};

describe('nota fiscal que documenta a fatura ou a conta (06-FAT linha 36)', () => {
  it('sugere o menor entre o saldo da nota e o saldo do alvo', () => {
    expect(saldosVinculo(nota, fatura)).toEqual({ saldoNota: 700, saldoAlvo: 800, sugerido: 700 });
  });
  it('aceita o valor dentro dos dois saldos', () => {
    expect(validarVinculoNota(nota, fatura, { valorApropriado: 700 })).toEqual({});
  });
  it('recusa passar do saldo da nota e do saldo do alvo', () => {
    expect(validarVinculoNota(nota, fatura, { valorApropriado: 700.01 })['valorApropriado']).toMatch(
      /700.00/,
    );
    const n2 = { ...nota, valorJaApropriado: 0 };
    expect(validarVinculoNota(n2, fatura, { valorApropriado: 850 })['valorApropriado']).toMatch(
      /800.00.*fatura/,
    );
  });
  it('recusa nota cancelada, alvo aberto, outra fonte e valor zero', () => {
    const e = validarVinculoNota(
      { ...nota, situacao: 'cancelada' },
      { ...fatura, situacao: 'aberta' },
      { valorApropriado: 0 },
    );
    expect(Object.keys(e).sort()).toEqual(['alvo', 'notaServicoId', 'valorApropriado']);
    expect(
      validarVinculoNota(nota, { ...fatura, fontePagadoraId: 8 }, { valorApropriado: 1 })['notaServicoId'],
    ).toMatch(/outra fonte/);
  });
  it('conta do particular só depois de fechada; desconto negativo recusado', () => {
    const conta: AlvoParaVinculo = {
      ...fatura,
      tipo: 'conta',
      situacao: 'em_auditoria',
      fontePagadoraId: null,
    };
    expect(validarVinculoNota(nota, conta, { valorApropriado: 10 })['alvo']).toMatch(/conta/);
    expect(
      validarVinculoNota(nota, { ...conta, situacao: 'fechada' }, { valorApropriado: 10, valorDesconto: -1 }),
    ).toEqual({ valorDesconto: 'O desconto não pode ser negativo.' });
  });
  it('valor da fatura a documentar e situação da documentação', () => {
    expect(
      valorDocumentavelFatura({ valorApresentado: 100.1, valorAcrescimo: 0.2, valorDesconto: 0.3 }),
    ).toBe(100);
    expect(situacaoDocumentacao(100, 0)).toBe('sem_nota');
    expect(situacaoDocumentacao(100, 99.99)).toBe('parcial');
    expect(situacaoDocumentacao(100, 100)).toBe('documentada');
  });
});
