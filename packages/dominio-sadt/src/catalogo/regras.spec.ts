import { describe, expect, it } from 'vitest';
import {
  type FaixaNova,
  padroesADesmarcar,
  planejarNovaVersaoFaixa,
  validarExame,
  validarExameLigado,
  validarFormula,
  validarLimitesFaixa,
  variaveisDaExpressao,
  vespera,
} from './regras.js';

const exame = {
  codigo: 'HB01',
  sigla: 'HB',
  nome: 'Hemoglobina',
  tipoServico: 'laboratorio',
  modalidadeImagemId: null,
  idadeMinimaDias: null,
  idadeMaximaDias: null,
  limiteSolicitacoes: null,
  periodoLimiteDias: null,
  custoUnitario: null,
};

const faixa: FaixaNova = {
  sexoId: 1,
  idadeMinimaDias: 6570,
  idadeMaximaDias: null,
  materialBiologicoId: null,
  metodoAnaliticoId: null,
  condicao: 'nenhuma',
  referenciaMinima: 12,
  referenciaMaxima: 16,
  alertaMinimo: null,
  alertaMaximo: null,
  criticoMinimo: 7,
  criticoMaximo: 20,
  absurdoMinimo: 2,
  absurdoMaximo: 25,
  referenciaTexto: null,
  vigenciaInicio: '2026-12-01',
};

describe('catálogo de exames: o exame', () => {
  it('aceita o exame completo', () => expect(validarExame(exame)).toEqual([]));
  it('imagem exige modalidade', () =>
    expect(validarExame({ ...exame, tipoServico: 'imagem' }).map((f) => f.campo)).toEqual([
      'modalidadeImagemId',
    ]));
  it('recusa idade invertida, limite sem período, custo negativo, sigla inválida e tipo desconhecido', () => {
    const f = validarExame({
      ...exame,
      sigla: 'H B',
      tipoServico: 'x',
      idadeMinimaDias: 10,
      idadeMaximaDias: 5,
      limiteSolicitacoes: 2,
      custoUnitario: -1,
    }).map((x) => x.campo);
    expect(f).toEqual(['sigla', 'tipoServico', 'idadeMaximaDias', 'periodoLimiteDias', 'custoUnitario']);
  });
});

describe('catálogo de exames: padrão único e exame ligado', () => {
  it('desmarca os outros padrões ativos', () =>
    expect(
      padroesADesmarcar(
        [
          { id: 1, padrao: true, ativo: true },
          { id: 2, padrao: false, ativo: true },
          { id: 3, padrao: true, ativo: false },
        ],
        2,
      ),
    ).toEqual([1]));
  it('recusa ligar o exame a ele mesmo e o ciclo', () => {
    expect(validarExameLigado(1, 1, [])).toHaveLength(1);
    expect(
      validarExameLigado(1, 2, [
        { de: 2, para: 3 },
        { de: 3, para: 1 },
      ])[0]?.mensagem,
    ).toMatch(/ciclo/);
    expect(validarExameLigado(1, 2, [{ de: 3, para: 1 }])).toEqual([]);
  });
});

describe('catálogo de exames: faixa de referência com versão', () => {
  it('confere a ordem dos limites e o crítico fora da faixa normal', () => {
    expect(validarLimitesFaixa(faixa)).toEqual([]);
    const f = validarLimitesFaixa({ ...faixa, criticoMinimo: 13, absurdoMaximo: 19 }).map((x) => x.campo);
    expect(f).toEqual(['criticoMinimo', 'absurdoMaximo']);
    expect(
      validarLimitesFaixa({
        ...faixa,
        referenciaMinima: null,
        referenciaMaxima: null,
        criticoMinimo: null,
        criticoMaximo: null,
        absurdoMinimo: null,
        absurdoMaximo: null,
      }),
    ).toHaveLength(1);
  });
  it('encerra a faixa em vigor do mesmo estrato na véspera e deixa as outras', () => {
    const p = planejarNovaVersaoFaixa(
      faixa,
      [
        { ...faixa, id: 10, vigenciaInicio: '2025-01-01', vigenciaFim: null },
        { ...faixa, id: 11, sexoId: 2, vigenciaInicio: '2025-01-01', vigenciaFim: null },
        { ...faixa, id: 12, vigenciaInicio: '2024-01-01', vigenciaFim: '2024-12-31' },
      ],
      '2026-11-24',
    );
    expect(p.falhas).toEqual([]);
    expect(p.encerrar).toEqual([{ id: 10, vigenciaFim: '2026-11-30' }]);
  });
  it('recusa a nova retroativa e a que não começa depois da em vigor', () => {
    expect(
      planejarNovaVersaoFaixa({ ...faixa, vigenciaInicio: '2026-11-01' }, [], '2026-11-24').falhas,
    ).toHaveLength(1);
    const p = planejarNovaVersaoFaixa(
      faixa,
      [{ ...faixa, id: 10, vigenciaInicio: '2026-12-01', vigenciaFim: null }],
      '2026-11-24',
    );
    expect(p.falhas).toHaveLength(1);
    expect(p.encerrar).toEqual([]);
  });
  it('véspera atravessa o mês e o ano', () => {
    expect(vespera('2026-03-01')).toBe('2026-02-28');
    expect(vespera('2027-01-01')).toBe('2026-12-31');
  });
});

describe('catálogo de exames: fórmula', () => {
  it('aceita a fórmula com as variáveis declaradas e funções', () => {
    expect(validarFormula('CT - HDL - TG / 5', ['CT', 'HDL', 'TG'])).toEqual([]);
    expect(validarFormula('raiz(PESO * ALT / 3600)', ['PESO', 'ALT'])).toEqual([]);
    expect(variaveisDaExpressao('max(A, b1) + ln(A)')).toEqual(['A', 'b1']);
  });
  it('recusa caractere estranho, parêntese aberto, operador solto e variável não declarada ou sobrando', () => {
    expect(validarFormula('A; B', ['A', 'B']).map((f) => f.campo)).toContain('expressao');
    expect(validarFormula('(A + B', ['A', 'B'])[0]?.mensagem).toMatch(/Parênteses/);
    expect(validarFormula('A + * B', ['A', 'B'])[0]?.mensagem).toMatch(/Operador/);
    expect(
      validarFormula('A + C', ['A', 'B'])
        .map((f) => f.mensagem)
        .join(' '),
    ).toMatch(/C\..*B\./);
  });
});
