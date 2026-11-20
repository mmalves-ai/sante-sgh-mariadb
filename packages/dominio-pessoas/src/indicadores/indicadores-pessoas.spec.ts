import { CODIGOS_CATEGORIA_SCP, INDICADORES_PESSOAS, esquemaIndicadorPessoasCalculado } from '@sgh/contratos';
import { describe, expect, it } from 'vitest';
import {
  type BaseIndicadoresPessoas,
  calcularIndicadoresPessoas,
  FICHAS_INDICADOR_PESSOAS,
  horasCofenVigentes,
  referenciaCofen,
} from './indicadores-pessoas.js';

// Base de teste conferida à mão (W0-06, aceite 10): hospital "aa", setores 10 (Clínica) e 20 (UTI), 1º trimestre.
const CLI = { hospital: 'aa', setor: 10, nomeSetor: 'Clínica' };
const UTI = { hospital: 'aa', setor: 20, nomeSetor: 'UTI' };
const zero = Object.fromEntries(CODIGOS_CATEGORIA_SCP.map((c) => [c, 0])) as Record<
  (typeof CODIGOS_CATEGORIA_SCP)[number],
  number
>;
const BASE: BaseIndicadoresPessoas = {
  inicio: '2026-01-01',
  fim: '2026-03-31',
  vinculos: [
    { ...CLI, admissao: '2025-01-01', desligamento: null },
    { ...CLI, admissao: '2025-06-01', desligamento: '2026-02-10' },
    { ...CLI, admissao: '2026-02-15', desligamento: null },
    { ...CLI, admissao: '2024-01-01', desligamento: null },
    { ...UTI, admissao: '2020-01-01', desligamento: null },
    { ...UTI, admissao: '2020-01-01', desligamento: null },
    { ...UTI, admissao: '2020-01-01', desligamento: '2026-03-31' },
    { ...UTI, admissao: '2026-01-01', desligamento: null },
  ],
  ponto: [
    {
      ...CLI,
      horasPrevistas: 600,
      horasTrabalhadas: 580,
      horasAusencia: 25,
      horasExtras: 5,
      horasEnfermagem: 350,
    },
    {
      ...CLI,
      horasPrevistas: 400,
      horasTrabalhadas: 400,
      horasAusencia: 15,
      horasExtras: 15,
      horasEnfermagem: 250,
    },
    {
      ...UTI,
      horasPrevistas: 2000,
      horasTrabalhadas: 2050,
      horasAusencia: 50,
      horasExtras: 100,
      horasEnfermagem: 1800,
    },
  ],
  folhaHorasExtras: [
    { ...CLI, valorCent: 50_000 },
    { ...UTI, valorCent: 150_000 },
  ],
  treinamento: [
    { ...CLI, horas: 30 },
    { ...UTI, horas: 20 },
  ],
  acidentes: [{ ...UTI, quantidade: 1, comAfastamento: 1 }],
  censo: [
    { ...CLI, pacientesDia: 60 },
    { ...CLI, pacientesDia: 40 },
    { ...UTI, pacientesDia: 90 },
  ],
  dimensionamento: [
    { ...CLI, pacientes: { ...zero, minimos: 2, intermediarios: 2 } },
    { ...UTI, pacientes: { ...zero, intensivos: 5 } },
  ],
};

const porCodigo = (b: BaseIndicadoresPessoas) =>
  Object.fromEntries(calcularIndicadoresPessoas(b).map((i) => [i.ficha.codigo, i]));

describe('indicadores de pessoas (W0-06, M4): conferidos contra a base de teste', () => {
  const r = porCodigo(BASE);

  it('os seis indicadores, na ordem do painel, todos com ficha técnica e válidos no contrato', () => {
    const lista = calcularIndicadoresPessoas(BASE);
    expect(lista.map((i) => i.ficha.codigo)).toEqual([...INDICADORES_PESSOAS]);
    for (const i of lista) {
      expect(() => esquemaIndicadorPessoasCalculado.parse(i)).not.toThrow();
      expect(i.ficha).toBe(FICHAS_INDICADOR_PESSOAS[i.ficha.codigo]);
      expect(i.ficha.fontes.length).toBeGreaterThan(0);
      expect(i.ficha.formula).not.toBe('');
    }
  });

  it('turnover: média de admissões e desligamentos sobre o efetivo médio; consolidado = Σ num ÷ Σ den', () => {
    const t = r.turnover!;
    expect(t.parcelas.map((p) => [p.nomeSetor, p.numerador, p.denominador, p.valor])).toEqual([
      ['Clínica', 1, 3, 33.33],
      ['UTI', 1, 4, 25],
    ]);
    expect(t.parcelas[0]!.conta).toBe(
      '((1 admissão(ões) + 1 desligamento(s)) ÷ 2) ÷ ((3 + 3) ÷ 2) × 100 = 33,33%',
    );
    expect([t.numerador, t.denominador, t.valor]).toEqual([2, 7, 28.57]);
    expect(t.conta).toBe('(1 + 1) ÷ (3 + 4) × 100 = 2 ÷ 7 × 100 = 28,57%');
  });

  it('absenteísmo e horas extras somam as linhas do ponto do mesmo setor; o valor pago vem da folha', () => {
    expect(r.absenteismo!.parcelas.map((p) => p.valor)).toEqual([4, 2.5]);
    expect([r.absenteismo!.numerador, r.absenteismo!.denominador, r.absenteismo!.valor]).toEqual([
      90, 3000, 3,
    ]);
    expect(r.horasExtras!.parcelas.map((p) => p.valor)).toEqual([2.04, 4.88]);
    expect(r.horasExtras!.valor).toBe(3.96);
    expect(r.horasExtras!.complementos).toEqual([
      { rotulo: 'Horas extras no período', valor: '120 h' },
      { rotulo: 'Valor pago na folha', valor: 'R$ 2.000,00' },
    ]);
  });

  it('horas de enfermagem por paciente-dia comparadas à referência da COFEN 543/2017 de cada setor', () => {
    const e = r.horasEnfermagemPacienteDia!;
    expect(e.parcelas.map((p) => [p.nomeSetor, p.valor, p.referencia])).toEqual([
      ['Clínica', 6, 5],
      ['UTI', 20, 18],
    ]);
    expect(e.parcelas[0]!.contaReferencia).toBe('(2 × 4 h + 2 × 6 h) ÷ 4 paciente(s) = 20 ÷ 4 = 5 h');
    expect([e.numerador, e.denominador, e.valor]).toEqual([2400, 190, 12.63]);
    // (5 × 100 + 18 × 90) ÷ 190 = 2120 ÷ 190 = 11,16; razão 12,63 ÷ 11,16 = 1,13.
    expect(e.referencia).toBe(11.16);
    expect(e.razaoReferencia).toBe(1.13);
    expect(e.complementos[0]!.valor).toBe('5 h × 100 + 18 h × 90 ÷ 190 = 11,16 h');
  });

  it('o parâmetro ajusta as horas da categoria; sem dimensionamento o setor sai sem referência', () => {
    expect(horasCofenVigentes({ intensivos: 16 }).intensivos).toBe(16);
    expect(horasCofenVigentes().minimos).toBe(4);
    const ajustado = porCodigo({ ...BASE, horasCofen: { intensivos: 16 } }).horasEnfermagemPacienteDia!;
    expect(ajustado.parcelas[1]!.referencia).toBe(16);
    const semDim = porCodigo({ ...BASE, dimensionamento: [] }).horasEnfermagemPacienteDia!;
    expect(semDim.referencia).toBeNull();
    expect(semDim.razaoReferencia).toBeNull();
    expect(semDim.parcelas[0]!.contaReferencia).toBe('Sem dimensionamento registrado no setor.');
    expect(referenciaCofen(zero, horasCofenVigentes()).valor).toBeNull();
  });

  it('treinamento per capita e taxa de frequência de acidentes (NBR 14280)', () => {
    expect(r.treinamentoPerCapita!.parcelas.map((p) => p.valor)).toEqual([10, 5]);
    expect(r.treinamentoPerCapita!.valor).toBe(7.14);
    const a = r.acidentesTrabalho!;
    expect(a.parcelas.map((p) => p.valor)).toEqual([0, 487.8]);
    expect(a.valor).toBe(330.03);
    expect(a.complementos).toEqual([
      { rotulo: 'Acidentes no período', valor: '1' },
      { rotulo: 'Com afastamento', valor: '1' },
    ]);
  });

  it('setor só com acidente ou só com treinamento entra sem denominador; base vazia não inventa valor', () => {
    const outro = { hospital: 'aa', setor: 30, nomeSetor: 'Zeladoria' };
    const x = porCodigo({
      ...BASE,
      acidentes: [...BASE.acidentes, { ...outro, quantidade: 2, comAfastamento: 0 }],
      treinamento: [...BASE.treinamento, { ...outro, horas: 8 }],
    });
    expect(x.acidentesTrabalho!.parcelas.at(-1)!.conta).toBe(
      '2 acidente(s) × 1.000.000 ÷ 0 h = sem horas trabalhadas',
    );
    expect(x.treinamentoPerCapita!.parcelas.at(-1)!.valor).toBeNull();
    const vazio = calcularIndicadoresPessoas({
      inicio: '2026-01-01',
      fim: '2026-01-31',
      vinculos: [],
      ponto: [],
      folhaHorasExtras: [],
      treinamento: [],
      acidentes: [],
      censo: [],
      dimensionamento: [],
    });
    for (const i of vazio) {
      expect(i.valor).toBeNull();
      expect(i.conta).toBe('Sem dados no período.');
    }
  });
});
