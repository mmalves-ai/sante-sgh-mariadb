// Grandeza calculada e cadastro do laudo estruturado (F3.5, 05-SADT linha 17): a conta pela fórmula vigente na data
// do exame, a cadeia de calculadas, o que falta, o valor digitado ignorado, e as regras do cadastro.
import { describe, expect, it } from 'vitest';
import { avaliarValores, type GrandezaDoLaudo, type PacienteDoExame } from './estruturado.js';
import {
  calcularGrandezas,
  completarValoresCalculados,
  type FaixaGrandezaCadastro,
  type FormulaDaGrandeza,
  formulasVigentes,
  planejarFormulaGrandeza,
  validarFaixaGrandeza,
  validarGrandezaLaudo,
  validarSecaoLaudo,
} from './grandeza-calculada.js';

const g = (id: number, codigo: string, calculada: boolean, casas: number | null = 1): GrandezaDoLaudo => ({
  id,
  codigo,
  descricao: codigo,
  casasDecimais: casas,
  obrigatoria: false,
  calculada,
  ordem: id,
  unidade: null,
});
// 1 diâmetro diastólico, 2 diâmetro sistólico, 3 fração de encurtamento (calculada), 4 índice (calculada de calculada).
const grandezas = [g(1, 'ddve', false), g(2, 'dsve', false), g(3, 'fenc', true), g(4, 'ifenc', true, 2)];
const fenc: FormulaDaGrandeza = {
  grandeza: 3,
  expressao: '(dd - ds) / dd * 100',
  casas: 1,
  vigenciaInicio: '2020-01-01',
  vigenciaFim: null,
  variaveis: [
    { identificador: 'dd', fonte: 'grandeza', grandeza: 1, dadoPaciente: null },
    { identificador: 'ds', fonte: 'grandeza', grandeza: 2, dadoPaciente: null },
  ],
};
const ifenc: FormulaDaGrandeza = {
  grandeza: 4,
  expressao: 'fe / sc',
  casas: 2,
  vigenciaInicio: '2020-01-01',
  vigenciaFim: null,
  variaveis: [
    { identificador: 'fe', fonte: 'grandeza', grandeza: 3, dadoPaciente: null },
    { identificador: 'sc', fonte: 'dado_paciente', grandeza: null, dadoPaciente: 'superficie_corporal' },
  ],
};
const paciente: PacienteDoExame = {
  sexo: 'masculino',
  idadeDias: 40 * 365,
  pesoKg: 80,
  alturaCm: 180,
  dataExame: '2026-11-20',
};

describe('grandeza calculada do laudo estruturado', () => {
  it('calcula pela fórmula e encadeia a calculada que usa outra calculada', () => {
    const r = calcularGrandezas(
      [ifenc, fenc],
      new Map([
        [1, 50],
        [2, 30],
      ]),
      paciente,
    );
    expect(r.get(3)).toEqual({ ok: true, valor: 40 });
    // superfície de Mosteller de 80 kg e 180 cm = 2 m².
    expect(r.get(4)).toEqual({ ok: true, valor: 20 });
  });

  it('sem a medida ou sem o dado do paciente não calcula e diz o que falta (nunca zero)', () => {
    const semMedida = calcularGrandezas([fenc], new Map([[1, 50]]), paciente);
    expect(semMedida.get(3)).toEqual({ ok: false, motivo: 'Falta a medida ds.' });
    const semPeso = calcularGrandezas(
      [fenc, ifenc],
      new Map([
        [1, 50],
        [2, 30],
      ]),
      { ...paciente, pesoKg: null },
    );
    expect(semPeso.get(3)).toEqual({ ok: true, valor: 40 });
    expect(semPeso.get(4)?.ok).toBe(false);
    const divisao = calcularGrandezas(
      [fenc],
      new Map([
        [1, 0],
        [2, 30],
      ]),
      paciente,
    );
    expect(divisao.get(3)?.ok).toBe(false);
  });

  it('usa a fórmula vigente na data do exame', () => {
    const antiga: FormulaDaGrandeza = { ...fenc, expressao: 'dd - ds', vigenciaFim: '2026-11-21' };
    const nova: FormulaDaGrandeza = { ...fenc, vigenciaInicio: '2026-11-22' };
    expect(formulasVigentes([antiga, nova], '2026-11-20').map((f) => f.expressao)).toEqual(['dd - ds']);
    expect(formulasVigentes([antiga, nova], '2026-11-23').map((f) => f.expressao)).toEqual([fenc.expressao]);
    expect(formulasVigentes([nova], '2026-11-20')).toEqual([]);
    const medidos = new Map([
      [1, 50],
      [2, 30],
    ]);
    expect(calcularGrandezas([antiga, nova], medidos, paciente).get(3)).toEqual({ ok: true, valor: 20 });
  });

  it('o valor digitado na calculada é ignorado; a que não calcula fica sem valor; sem fórmula continua digitada', () => {
    const valores = [
      { grandeza: 1, numero: 50, texto: null },
      { grandeza: 2, numero: 30, texto: null },
      { grandeza: 3, numero: 99, texto: null },
    ];
    const completos = completarValoresCalculados(grandezas, valores, [fenc, ifenc], paciente);
    expect(completos.find((v) => v.grandeza === 3)?.numero).toBe(40);
    expect(completos.find((v) => v.grandeza === 4)?.numero).toBe(20);
    const av = avaliarValores(grandezas, completos, [], paciente);
    expect(av.map((v) => [v.grandeza, v.numero, v.calculado])).toEqual([
      [1, 50, false],
      [2, 30, false],
      [3, 40, true],
      [4, 20, true],
    ]);
    const semSistolico = completarValoresCalculados(grandezas, [valores[0]!, valores[2]!], [fenc], paciente);
    expect(semSistolico.map((v) => v.grandeza)).toEqual([1]);
    // Sem fórmula no cadastro a grandeza marcada como calculada segue digitada (não se perde o que o médico informou).
    expect(completarValoresCalculados(grandezas, valores, [], paciente)).toEqual(valores);
    // Fórmula de grandeza que não é calculada (ou de outro exame) não mexe nas medidas.
    expect(completarValoresCalculados(grandezas, valores, [{ ...fenc, grandeza: 1 }], paciente)).toEqual(
      valores,
    );
  });

  it('ciclo entre fórmulas não calcula', () => {
    const a: FormulaDaGrandeza = {
      ...fenc,
      expressao: 'x + 1',
      variaveis: [{ identificador: 'x', fonte: 'grandeza', grandeza: 4, dadoPaciente: null }],
    };
    const b: FormulaDaGrandeza = {
      ...ifenc,
      expressao: 'y + 1',
      variaveis: [{ identificador: 'y', fonte: 'grandeza', grandeza: 3, dadoPaciente: null }],
    };
    const r = calcularGrandezas([a, b], new Map(), paciente);
    expect(r.get(3)?.ok).toBe(false);
    expect(r.get(4)?.ok).toBe(false);
  });
});

describe('cadastro do laudo estruturado', () => {
  it('seção e grandeza: código, nome, ordem, casas e a inativação da medida usada em fórmula', () => {
    expect(validarSecaoLaudo({ codigo: 'VE', nome: 'Ventrículo esquerdo', sigla: null, ordem: 1 })).toEqual(
      [],
    );
    expect(
      validarSecaoLaudo({ codigo: 'V E', nome: 'x', sigla: null, ordem: 0 }).map((f) => f.campo),
    ).toEqual(['codigo', 'nome', 'ordem']);
    const base = {
      codigo: 'ddve',
      descricao: 'Diâmetro diastólico',
      sigla: null,
      casasDecimais: 1,
      ordem: 1,
      ativo: true,
      usadaEmFormula: true,
    };
    expect(validarGrandezaLaudo(base)).toEqual([]);
    expect(validarGrandezaLaudo({ ...base, codigo: '1 dd', casasDecimais: 9 }).map((f) => f.campo)).toEqual([
      'codigo',
      'casasDecimais',
    ]);
    expect(validarGrandezaLaudo({ ...base, ativo: false }).map((f) => f.campo)).toEqual(['ativo']);
    expect(validarGrandezaLaudo({ ...base, ativo: false, usadaEmFormula: false })).toEqual([]);
  });

  it('faixa: limites em ordem, alguma referência e nenhuma outra do mesmo recorte no mesmo período', () => {
    const f: FaixaGrandezaCadastro = {
      id: null,
      sexoId: null,
      idadeMinimaDias: null,
      idadeMaximaDias: null,
      pesoMinimoKg: null,
      pesoMaximoKg: null,
      superficieMinima: null,
      superficieMaxima: null,
      referenciaMinima: 55,
      referenciaMaxima: 75,
      referenciaTexto: null,
      vigenciaInicio: '2026-12-01',
      vigenciaFim: null,
      ativo: true,
    };
    expect(validarFaixaGrandeza(f, [])).toEqual([]);
    expect(
      validarFaixaGrandeza({ ...f, referenciaMinima: 80, idadeMinimaDias: 10, idadeMaximaDias: 5 }, []).map(
        (x) => x.campo,
      ),
    ).toEqual(['referenciaMaxima', 'idadeMaximaDias']);
    expect(
      validarFaixaGrandeza({ ...f, referenciaMinima: null, referenciaMaxima: null }, []).map((x) => x.campo),
    ).toEqual(['referenciaMinima']);
    const vigente = { ...f, id: 7, vigenciaInicio: '2020-01-01' };
    expect(validarFaixaGrandeza(f, [vigente]).map((x) => x.campo)).toEqual(['vigenciaInicio']);
    // A anterior encerrada na véspera, a de outro sexo e a inativa não conflitam; a própria faixa também não.
    expect(validarFaixaGrandeza(f, [{ ...vigente, vigenciaFim: '2026-11-30' }])).toEqual([]);
    expect(validarFaixaGrandeza(f, [{ ...vigente, sexoId: 2 }])).toEqual([]);
    expect(validarFaixaGrandeza(f, [{ ...vigente, ativo: false }])).toEqual([]);
    expect(validarFaixaGrandeza({ ...vigente }, [vigente])).toEqual([]);
  });

  it('fórmula nova: só calculada, variáveis do exame, sem autorreferência nem ciclo, nada retroativo', () => {
    const ctx = {
      hoje: '2026-11-24',
      grandezaAlvo: 3,
      calculada: true,
      grandezasDoExame: [1, 2, 3, 4],
      vigentes: [{ id: 9, vigenciaInicio: '2020-01-01', vigenciaFim: null }],
      dependencias: [{ grandeza: 4, usa: [3] }],
    };
    const nova = { expressao: fenc.expressao, vigenciaInicio: '2026-12-01', variaveis: fenc.variaveis };
    expect(planejarFormulaGrandeza(nova, ctx)).toEqual({
      falhas: [],
      encerrar: [{ id: 9, vigenciaFim: '2026-11-30' }],
    });
    const campos = (p: { falhas: readonly { campo: string }[] }) => p.falhas.map((x) => x.campo);
    expect(campos(planejarFormulaGrandeza(nova, { ...ctx, calculada: false }))).toEqual(['grandeza']);
    expect(campos(planejarFormulaGrandeza({ ...nova, vigenciaInicio: '2026-11-01' }, ctx))).toEqual([
      'vigenciaInicio',
    ]);
    expect(campos(planejarFormulaGrandeza({ ...nova, expressao: '(dd - ds' }, ctx))).toContain('expressao');
    const comVar = (grandeza: number) => ({
      ...nova,
      expressao: 'x * 2',
      variaveis: [{ identificador: 'x', fonte: 'grandeza' as const, grandeza, dadoPaciente: null }],
    });
    expect(
      planejarFormulaGrandeza(comVar(3), ctx)
        .falhas.map((x) => x.mensagem)
        .join(' '),
    ).toContain('própria medida');
    expect(
      planejarFormulaGrandeza(comVar(77), ctx)
        .falhas.map((x) => x.mensagem)
        .join(' '),
    ).toContain('não é deste exame');
    expect(
      planejarFormulaGrandeza(comVar(4), ctx)
        .falhas.map((x) => x.mensagem)
        .join(' '),
    ).toContain('dependendo uma da outra');
    expect(
      planejarFormulaGrandeza(
        {
          ...nova,
          expressao: 's + 1',
          variaveis: [{ identificador: 's', fonte: 'dado_paciente', grandeza: null, dadoPaciente: 'sexo' }],
        },
        ctx,
      ).falhas.map((x) => x.campo),
    ).toEqual(['variaveis']);
    // Com fórmula já marcada para começar depois, a nova não entra antes dela.
    expect(
      campos(
        planejarFormulaGrandeza(nova, {
          ...ctx,
          vigentes: [{ id: 9, vigenciaInicio: '2027-01-01', vigenciaFim: null }],
        }),
      ),
    ).toEqual(['vigenciaInicio']);
  });
});
