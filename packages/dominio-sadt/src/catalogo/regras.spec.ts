import { describe, expect, it } from 'vitest';
import {
  type FaixaNova,
  padroesADesmarcar,
  planejarNovaVersaoFaixa,
  planejarNovaVersaoFormula,
  planejarNovasFaixas,
  idadesCobertas,
  validarExame,
  validarExameLigado,
  validarFonteVariavel,
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

describe('catálogo de exames: faixa que se cruza só em parte com a em vigor', () => {
  const adulta = {
    id: 7,
    sexoId: null,
    idadeMinimaDias: 6570,
    idadeMaximaDias: null,
    materialBiologicoId: null,
    metodoAnaliticoId: null,
    condicao: 'nenhuma',
    vigenciaInicio: '2026-01-01',
    vigenciaFim: null,
  };
  const nova = (min: number | null, max: number | null): FaixaNova => ({
    ...faixa,
    sexoId: null,
    idadeMinimaDias: min,
    idadeMaximaDias: max,
    materialBiologicoId: null,
    metodoAnaliticoId: null,
    condicao: 'nenhuma',
    vigenciaInicio: '2026-12-01',
  });
  it('recusa a nova de 18 a 60 anos sobre a adulta sem limite (o idoso ficaria sem referência)', () => {
    const p = planejarNovaVersaoFaixa(nova(6570, 21900), [adulta], '2026-11-24');
    expect(p.encerrar).toEqual([]);
    expect(p.falhas.map((f) => f.campo)).toContain('idadeMinimaDias');
  });
  it('aceita a cobertura completa na mesma operação e encerra a antiga na véspera', () => {
    const p = planejarNovasFaixas([nova(6570, 21900), nova(21901, null)], [adulta], '2026-11-24');
    expect(p.falhas).toEqual([]);
    expect(p.encerrar).toEqual([{ id: 7, vigenciaFim: '2026-11-30' }]);
  });
  it('a nova que contém a antiga inteira a encerra; as novas da operação não se cruzam', () => {
    expect(planejarNovaVersaoFaixa(nova(0, null), [adulta], '2026-11-24').encerrar).toHaveLength(1);
    const p = planejarNovasFaixas([nova(6570, 21900), nova(20000, null)], [adulta], '2026-11-24');
    expect(p.falhas.some((f) => f.mensagem.includes('Se cruza com a faixa 1'))).toBe(true);
  });
  it('cobertura com buraco de idade não vale', () => {
    expect(idadesCobertas(adulta, [nova(6570, 21000), nova(21002, null)])).toBe(false);
    expect(idadesCobertas(adulta, [nova(6570, 21000), nova(21001, null)])).toBe(true);
  });
});

describe('catálogo de exames: nova versão da fórmula', () => {
  const ctx = {
    hoje: '2026-11-24',
    analitoAlvoId: 3,
    calculado: true,
    analitosDoExame: [1, 2, 3],
    vigentes: [{ id: 50, vigenciaInicio: '2026-01-01', vigenciaFim: null }],
    dependencias: [] as { analitoId: number; usa: number[] }[],
  };
  const formula = {
    expressao: 'CT - HDL',
    vigenciaInicio: '2026-12-01',
    variaveis: [
      { identificador: 'CT', fonte: 'analito', analitoId: 1, dadoPaciente: null },
      { identificador: 'HDL', fonte: 'analito', analitoId: 2, dadoPaciente: null },
    ],
  };
  const campos = (p: { falhas: readonly { mensagem: string }[] }) =>
    p.falhas.map((f) => f.mensagem).join(' | ');
  it('a válida encerra a anterior na véspera', () => {
    expect(planejarNovaVersaoFormula(formula, ctx)).toEqual({
      falhas: [],
      encerrar: [{ id: 50, vigenciaFim: '2026-11-30' }],
    });
  });
  it('recusa autorreferência, analito fora do exame, analito não calculado e data retroativa', () => {
    const auto = {
      ...formula,
      variaveis: [{ ...formula.variaveis[0]!, analitoId: 3 }, formula.variaveis[1]!],
    };
    expect(campos(planejarNovaVersaoFormula(auto, ctx))).toContain('próprio analito');
    const fora = {
      ...formula,
      variaveis: [{ ...formula.variaveis[0]!, analitoId: 99 }, formula.variaveis[1]!],
    };
    expect(campos(planejarNovaVersaoFormula(fora, ctx))).toContain('não está neste exame');
    expect(campos(planejarNovaVersaoFormula(formula, { ...ctx, calculado: false }))).toContain('calculado');
    const p = planejarNovaVersaoFormula({ ...formula, vigenciaInicio: '2026-11-01' }, ctx);
    expect(campos(p)).toContain('nada retroativo');
    expect(p.encerrar).toEqual([]);
  });
  it('recusa o ciclo entre fórmulas do exame e a que começa antes da em vigor', () => {
    const ciclo = { ...ctx, dependencias: [{ analitoId: 2, usa: [3] }] };
    expect(campos(planejarNovaVersaoFormula(formula, ciclo))).toContain('ciclo');
    const futura = { ...ctx, vigentes: [{ id: 51, vigenciaInicio: '2026-12-05', vigenciaFim: null }] };
    expect(campos(planejarNovaVersaoFormula(formula, futura))).toContain('começa depois');
  });
  it('analito só com a fonte analito; dado do paciente só com a fonte paciente', () => {
    const errada = {
      ...formula,
      expressao: 'P',
      variaveis: [{ identificador: 'P', fonte: 'digitado', analitoId: 1, dadoPaciente: 'peso' }],
    };
    const m = campos(planejarNovaVersaoFormula(errada, ctx));
    expect(m).toContain('fonte analito');
    expect(m).toContain('fonte paciente');
  });

  it('a tela confere a fonte de cada variável pela mesma regra antes de gravar', () => {
    const base = { identificador: 'x', analitoId: null, dadoPaciente: null };
    expect(validarFonteVariavel({ ...base, fonte: 'analito' })).toHaveLength(1);
    expect(validarFonteVariavel({ ...base, fonte: 'dado_paciente' })).toHaveLength(1);
    expect(validarFonteVariavel({ ...base, fonte: 'digitado' })).toEqual([]);
    expect(validarFonteVariavel({ ...base, fonte: 'analito', analitoId: 7 })).toEqual([]);
    expect(validarFonteVariavel({ ...base, fonte: 'outra' })[0]?.mensagem).toContain('fonte desconhecida');
  });
});
