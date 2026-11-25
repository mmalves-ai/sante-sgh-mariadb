import { describe, expect, it } from 'vitest';
import {
  calcularAnalitos,
  conferirGrupoDoAnalito,
  type FormulaDoAnalito,
  idadeEmAnos,
  type RespostaDoGrupo,
  validarGrupoResposta,
  validarTextoPadrao,
  variaveisADigitar,
} from './respostas-calculo.js';

const resposta = (p: Partial<RespostaDoGrupo> = {}): RespostaDoGrupo => ({
  sequencia: 1,
  codigo: 'NEG',
  descricao: 'Não reagente',
  mnemonico: null,
  anormal: false,
  critico: false,
  padrao: false,
  ativo: true,
  ...p,
});
const grupo = (respostas: RespostaDoGrupo[], p: Record<string, unknown> = {}) => ({
  codigo: 'REAG',
  descricao: 'Reagente e não reagente',
  tipo: 'qualitativo',
  ativo: true,
  respostas,
  ...p,
});
const mensagens = (f: { mensagem: string }[]) => f.map((x) => x.mensagem).join(' | ');

describe('grupo de respostas do analito qualitativo', () => {
  it('aceita o grupo com as respostas em ordem, uma sugerida e a crítica anormal', () => {
    expect(
      validarGrupoResposta(
        grupo([
          resposta({ padrao: true, mnemonico: 'N' }),
          resposta({ sequencia: 2, codigo: 'POS', descricao: 'Reagente', anormal: true, critico: true }),
        ]),
      ),
    ).toEqual([]);
  });

  it('recusa código, descrição e tipo inválidos e o grupo ativo sem resposta ativa', () => {
    const f = validarGrupoResposta(
      grupo([resposta({ ativo: false })], { codigo: ' ', descricao: 'x', tipo: 'outro' }),
    );
    expect(f.map((x) => x.campo)).toEqual(['codigo', 'descricao', 'tipo', 'respostas']);
    expect(validarGrupoResposta(grupo([resposta({ ativo: false })], { ativo: false }))).toEqual([]);
  });

  it('recusa código, ordem e atalho repetidos, duas sugeridas, crítica não anormal e sugerida inativa', () => {
    const m = mensagens(
      validarGrupoResposta(
        grupo([
          resposta({ padrao: true, mnemonico: 'N' }),
          resposta({ codigo: 'neg', padrao: true, mnemonico: 'n', critico: true }),
          resposta({ sequencia: 3, codigo: 'IND', padrao: false, ativo: false }),
        ]),
      ),
    );
    expect(m).toContain('Código de resposta repetido: neg');
    expect(m).toContain('Ordem repetida: 1');
    expect(m).toContain('Atalho repetido entre as respostas ativas: n');
    expect(m).toContain('Só uma resposta pode ser a sugerida');
    expect(m).toContain('a resposta crítica é sempre anormal');
    expect(
      mensagens(
        validarGrupoResposta(
          grupo([resposta(), resposta({ sequencia: 2, codigo: 'X', padrao: true, ativo: false })]),
        ),
      ),
    ).toContain('a resposta sugerida precisa estar ativa');
    expect(
      mensagens(validarGrupoResposta(grupo([resposta({ sequencia: 0, mnemonico: 'com espaco' })]))),
    ).toMatch(/a ordem vai de 1 a 9999.*o atalho tem até 10 caracteres/);
  });

  it('o atalho de uma resposta inativa pode se repetir numa ativa', () => {
    expect(
      validarGrupoResposta(
        grupo([
          resposta({ mnemonico: 'N' }),
          resposta({ sequencia: 2, codigo: 'ANT', mnemonico: 'N', ativo: false }),
        ]),
      ),
    ).toEqual([]);
  });
});

describe('texto padrão do resultado', () => {
  const t = {
    codigo: 'HEMOL',
    descricao: 'Amostra hemolisada',
    texto: 'Amostra hemolisada.',
    mnemonico: 'hem',
    aplicacao: 'resultado',
  };
  it('aceita o texto completo e recusa o vazio, o atalho com espaço e a aplicação desconhecida', () => {
    expect(validarTextoPadrao(t)).toEqual([]);
    expect(
      validarTextoPadrao({
        ...t,
        codigo: '',
        descricao: 'x',
        texto: '  ',
        mnemonico: 'a b',
        aplicacao: 'x',
      }).map((x) => x.campo),
    ).toEqual(['codigo', 'descricao', 'texto', 'mnemonico', 'aplicacao']);
  });
});

describe('ligação do grupo ao analito do exame', () => {
  const a = {
    tipoResultado: 'texto_padrao',
    calculado: false,
    ativo: true,
    grupoRespostaId: 7,
    grupoAtivo: true,
  };
  it('o analito de texto leva grupo ativo; o de resposta padronizada exige o grupo', () => {
    expect(conferirGrupoDoAnalito(a)).toEqual([]);
    expect(conferirGrupoDoAnalito({ ...a, tipoResultado: 'texto' })).toEqual([]);
    expect(
      conferirGrupoDoAnalito({ ...a, tipoResultado: 'texto', grupoRespostaId: null, grupoAtivo: null }),
    ).toEqual([]);
    expect(mensagens(conferirGrupoDoAnalito({ ...a, grupoRespostaId: null, grupoAtivo: null }))).toContain(
      'precisa do grupo',
    );
    // Inativar o vínculo não exige grupo.
    expect(conferirGrupoDoAnalito({ ...a, ativo: false, grupoRespostaId: null, grupoAtivo: null })).toEqual(
      [],
    );
  });
  it('recusa grupo no numérico, no calculado, grupo inexistente e grupo inativo', () => {
    expect(mensagens(conferirGrupoDoAnalito({ ...a, tipoResultado: 'numerico' }))).toContain(
      'Só o analito de texto',
    );
    expect(mensagens(conferirGrupoDoAnalito({ ...a, calculado: true }))).toContain('calculado não leva');
    expect(mensagens(conferirGrupoDoAnalito({ ...a, grupoAtivo: null }))).toContain('não existe');
    expect(mensagens(conferirGrupoDoAnalito({ ...a, grupoAtivo: false }))).toContain('inativo');
  });
});

describe('cálculo dos analitos do exame pela fórmula', () => {
  const v = (
    id: number,
    identificador: string,
    fonte: 'analito' | 'dado_paciente' | 'digitado',
    extra: object = {},
  ) => ({
    id,
    identificador,
    descricao: identificador,
    fonte,
    analito: null,
    dadoPaciente: null,
    ...extra,
  });
  // 1 colesterol total, 2 HDL, 3 triglicérides (digitados); 10 VLDL = TG / 5; 11 LDL = CT - HDL - VLDL (usa o calculado).
  const lipidograma: FormulaDoAnalito[] = [
    {
      analito: 11,
      expressao: 'CT - HDL - VLDL',
      casas: 0,
      variaveis: [
        v(1, 'CT', 'analito', { analito: 1 }),
        v(2, 'HDL', 'analito', { analito: 2 }),
        v(3, 'VLDL', 'analito', { analito: 10 }),
      ],
    },
    { analito: 10, expressao: 'TG / 5', casas: 1, variaveis: [v(4, 'TG', 'analito', { analito: 3 })] },
  ];

  it('calcula na ordem das dependências, com as casas da fórmula', () => {
    const r = calcularAnalitos({
      formulas: lipidograma,
      valores: new Map([
        [1, 200],
        [2, 50],
        [3, 151],
        [11, 999], // o valor digitado do calculado é ignorado
      ]),
      digitadas: {},
      paciente: { idade: null },
    });
    expect(r.get(10)).toEqual({ ok: true, valor: 30.2 });
    expect(r.get(11)).toEqual({ ok: true, valor: 120 });
  });

  it('sem o valor de um analito, diz qual falta e não calcula o dependente (nunca zero)', () => {
    const r = calcularAnalitos({
      formulas: lipidograma,
      valores: new Map([
        [1, 200],
        [2, 50],
      ]),
      digitadas: {},
      paciente: { idade: null },
    });
    expect(r.get(10)).toEqual({ ok: false, motivo: 'Falta o valor de TG.' });
    expect(r.get(11)).toEqual({ ok: false, motivo: 'VLDL: Falta o valor de TG.' });
  });

  it('idade vem do paciente (a digitada prevalece); peso e variável digitada vêm da digitação', () => {
    // Depuração estimada: ((140 - idade) * peso) / (72 * CR) * fator
    const formulas: FormulaDoAnalito[] = [
      {
        analito: 20,
        expressao: '((140 - idade) * peso) / (72 * CR) * fator',
        casas: 1,
        variaveis: [
          v(31, 'idade', 'dado_paciente', { dadoPaciente: 'idade' }),
          v(32, 'peso', 'dado_paciente', { dadoPaciente: 'peso' }),
          v(33, 'CR', 'analito', { analito: 5 }),
          v(34, 'fator', 'digitado'),
        ],
      },
    ];
    expect(variaveisADigitar(formulas).map((x) => x.identificador)).toEqual(['peso', 'fator']);
    const base = { formulas, valores: new Map([[5, 1]]), paciente: { idade: 40 } };
    expect(calcularAnalitos({ ...base, digitadas: { 32: 72, 34: 1 } }).get(20)).toEqual({
      ok: true,
      valor: 100,
    });
    expect(calcularAnalitos({ ...base, digitadas: { 31: 90, 32: 72, 34: 1 } }).get(20)).toEqual({
      ok: true,
      valor: 50,
    });
    expect(calcularAnalitos({ ...base, digitadas: { 34: 1 } }).get(20)).toEqual({
      ok: false,
      motivo: 'Falta o valor de peso.',
    });
    expect(
      calcularAnalitos({ ...base, valores: new Map([[5, 0]]), digitadas: { 32: 72, 34: 1 } }).get(20),
    ).toEqual({
      ok: false,
      motivo: 'Divisão por zero.',
    });
  });

  it('fórmulas em ciclo não calculam', () => {
    const r = calcularAnalitos({
      formulas: [
        { analito: 1, expressao: 'B + 1', casas: null, variaveis: [v(1, 'B', 'analito', { analito: 2 })] },
        { analito: 2, expressao: 'A + 1', casas: null, variaveis: [v(2, 'A', 'analito', { analito: 1 })] },
      ],
      valores: new Map(),
      digitadas: {},
      paciente: { idade: null },
    });
    expect(r.get(1)?.ok).toBe(false);
    expect(r.get(2)?.ok).toBe(false);
  });

  it('idade em anos completos pelos dias de vida', () => {
    expect(idadeEmAnos(365)).toBe(0);
    expect(idadeEmAnos(366)).toBe(1);
    expect(idadeEmAnos(14610)).toBe(40);
    expect(idadeEmAnos(null)).toBeNull();
    expect(idadeEmAnos(-3)).toBeNull();
  });
});
