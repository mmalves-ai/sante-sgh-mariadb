import { describe, expect, it } from 'vitest';
import {
  type AlvoParaVinculo,
  type NotaParaVinculo,
  notaDocumenta,
  notaServeAoAlvo,
  saldosVinculo,
  situacaoDocumentacao,
  validarDesligamentoNota,
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
  id: 50,
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
  it('recusa a nota emitida para outra fatura ou conta e a de tomador que não é do paciente nem do responsável', () => {
    expect(notaServeAoAlvo({ ...nota, faturaFontePagadoraId: 50 }, fatura)).toBeNull();
    expect(notaServeAoAlvo({ ...nota, faturaFontePagadoraId: 51 }, fatura)).toMatch(/outra fatura/);
    expect(notaServeAoAlvo({ ...nota, contaHospitalarId: 50 }, fatura)).toMatch(/outra fatura/);
    const conta: AlvoParaVinculo = {
      ...fatura,
      tipo: 'conta',
      id: 80,
      documentosTomador: ['11122233344', '55566677788'],
    };
    expect(notaServeAoAlvo({ ...nota, contaHospitalarId: 81 }, conta)).toMatch(/outra conta/);
    expect(notaServeAoAlvo({ ...nota, contaHospitalarId: 80 }, conta)).toBeNull();
    // Particular: a nota sem fonte pagadora só serve se o tomador for o paciente ou um responsável.
    const particular = { ...nota, fontePagadoraId: null };
    expect(notaServeAoAlvo({ ...particular, tomadorDocumento: '111.222.333-44' }, conta)).toBeNull();
    expect(notaServeAoAlvo({ ...particular, tomadorDocumento: '99988877766' }, conta)).toMatch(/paciente/);
    expect(notaServeAoAlvo({ ...particular, tomadorDocumento: null }, conta)).toMatch(/paciente/);
    expect(notaServeAoAlvo(particular, { ...fatura, documentosTomador: [] })).toMatch(/fonte pagadora/);
    expect(
      validarVinculoNota(
        { ...particular, tomadorDocumento: '99988877766' },
        { ...conta, situacao: 'fechada' },
        {
          valorApropriado: 10,
        },
      )['notaServicoId'],
    ).toMatch(/paciente/);
  });
  it('desligar pede motivo; a nota cancelada não documenta mais', () => {
    expect(validarDesligamentoNota('')).toHaveProperty('motivo');
    expect(validarDesligamentoNota('  curto   ')).toHaveProperty('motivo');
    expect(validarDesligamentoNota('x'.repeat(501))).toHaveProperty('motivo');
    expect(validarDesligamentoNota('nota emitida em duplicidade')).toEqual({});
    expect(notaDocumenta('autorizada')).toBe(true);
    expect(notaDocumenta('cancelada')).toBe(false);
  });
});
