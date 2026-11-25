import { describe, expect, it } from 'vitest';
import {
  apurarProducaoMensal,
  diasDoPeriodo,
  faixaVigente,
  type FaixaValorCategoria,
  limitesDoMes,
  mesValido,
  periodosEfetivos,
  validarFaixaValor,
  validarPeriodoCategoria,
  valorDoPeriodo,
  valorPorPeriodo,
} from './producao-hospitalar.js';

const MED = 1;
const CIR = 2;
const faixas: FaixaValorCategoria[] = [
  { clinicaId: MED, inicio: '2026-01-01', fim: '2026-03-14', valorDiaria: 100 },
  { clinicaId: MED, inicio: '2026-03-15', fim: null, valorDiaria: 120 },
  { clinicaId: CIR, inicio: '2026-01-01', fim: null, valorDiaria: 300 },
];

describe('paciente-dia (Portaria 312: o dia da saída não conta)', () => {
  it('conta da entrada até a véspera da saída, dentro do mês', () => {
    expect(diasDoPeriodo('2026-03-10T08:00', '2026-03-13T10:00', '2026-03-01', '2026-03-31')).toEqual([
      '2026-03-10',
      '2026-03-11',
      '2026-03-12',
    ]);
  });
  it('entrada e saída no mesmo dia contam 1; período interno do mesmo dia não conta', () => {
    expect(diasDoPeriodo('2026-03-10T08:00', '2026-03-10T18:00', '2026-03-01', '2026-03-31')).toHaveLength(1);
    expect(
      diasDoPeriodo('2026-03-10T08:00', '2026-03-10T18:00', '2026-03-01', '2026-03-31', false),
    ).toHaveLength(0);
  });
  it('corta no mês e o aberto vai até o último dia apurado', () => {
    expect(diasDoPeriodo('2026-02-27T08:00', '2026-03-02T08:00', '2026-03-01', '2026-03-31')).toEqual([
      '2026-03-01',
    ]);
    expect(diasDoPeriodo('2026-03-29T08:00', null, '2026-03-01', '2026-03-30')).toHaveLength(2);
  });
  it('limites e formato do mês', () => {
    expect(limitesDoMes('2028-02')).toEqual({ de: '2028-02-01', ate: '2028-02-29' });
    expect(mesValido('2026-13')).toBe(false);
    expect(mesValido('2026-11')).toBe(true);
  });
});

describe('valor pela faixa vigente', () => {
  it('escolhe a faixa do dia e troca de valor no meio do período', () => {
    expect(faixaVigente(faixas, MED, '2026-03-14')?.valorDiaria).toBe(100);
    expect(faixaVigente(faixas, MED, '2026-03-15')?.valorDiaria).toBe(120);
    const v = valorDoPeriodo(
      { clinicaId: MED, inicio: '2026-03-13T09:00', fim: '2026-03-17T09:00' },
      faixas,
      '2026-12-31',
    );
    expect(v).toMatchObject({ diarias: 4, valor: 440, diasSemFaixa: 0 });
    expect(v.faixas).toEqual([
      { inicio: '2026-01-01', valorDiaria: 100, dias: 2 },
      { inicio: '2026-03-15', valorDiaria: 120, dias: 2 },
    ]);
  });
  it('dia sem faixa fica fora do valor e é contado à parte', () => {
    const v = valorDoPeriodo(
      { clinicaId: CIR, inicio: '2025-12-30T09:00', fim: '2026-01-02T09:00' },
      faixas,
      '2026-12-31',
    );
    expect(v).toMatchObject({ diarias: 3, valor: 300, diasSemFaixa: 2 });
  });
});

describe('precedência da faixa própria sobre a geral, dia a dia', () => {
  const PED = 3;
  const mistas: FaixaValorCategoria[] = [
    { clinicaId: PED, inicio: '2026-01-01', fim: null, valorDiaria: 50, todasUnidades: true },
    { clinicaId: PED, inicio: '2026-10-01', fim: null, valorDiaria: 80 },
  ];
  it('a própria que começa depois não apaga a geral antes do seu início', () => {
    expect(faixaVigente(mistas, PED, '2026-03-10')?.valorDiaria).toBe(50);
    expect(faixaVigente(mistas, PED, '2026-09-30')?.valorDiaria).toBe(50);
    expect(faixaVigente(mistas, PED, '2026-10-01')?.valorDiaria).toBe(80);
    const v = valorDoPeriodo(
      { clinicaId: PED, inicio: '2026-09-29T08:00', fim: '2026-10-02T08:00' },
      mistas,
      '2026-12-31',
    );
    expect(v).toMatchObject({ diarias: 3, valor: 50 + 50 + 80, diasSemFaixa: 0 });
  });
  it('a própria vigente prevalece mesmo com a geral de início mais recente', () => {
    const f: FaixaValorCategoria[] = [
      { clinicaId: PED, inicio: '2026-01-01', fim: null, valorDiaria: 70 },
      { clinicaId: PED, inicio: '2026-06-01', fim: null, valorDiaria: 55, todasUnidades: true },
    ];
    expect(faixaVigente(f, PED, '2026-07-01')?.valorDiaria).toBe(70);
  });
});

describe('períodos efetivos e valor do paciente (a mesma base da apuração)', () => {
  const faixasPaciente: FaixaValorCategoria[] = [
    { clinicaId: MED, inicio: '2026-01-01', fim: null, valorDiaria: 50, todasUnidades: true },
    { clinicaId: CIR, inicio: '2026-01-01', fim: null, valorDiaria: 200, todasUnidades: true },
  ];
  const internacao = {
    entrada: '2026-03-01T08:00:00',
    saida: '2026-03-20T10:00:00',
    tipoSaida: 'alta' as const,
    previstaAlta: null,
    clinicaId: MED,
    periodos: [{ clinicaId: CIR, inicio: '2026-03-10T08:00:00', fim: null }],
  };
  it('o trecho da entrada até a primeira classificação entra, e o aberto termina na saída', () => {
    expect(periodosEfetivos(internacao)).toEqual([
      { clinicaId: MED, inicio: '2026-03-01T08:00:00', fim: '2026-03-10T08:00:00', gravado: null },
      { clinicaId: CIR, inicio: '2026-03-10T08:00:00', fim: '2026-03-20T10:00:00', gravado: 0 },
    ]);
    const v = valorPorPeriodo(internacao, faixasPaciente, '2026-11-25');
    expect(v.map((p) => [p.clinicaId, p.diarias, p.valor, p.emAberto])).toEqual([
      [MED, 9, 450, false],
      [CIR, 10, 2000, false],
    ]);
  });
  it('a soma do paciente bate com a apuração do mês', () => {
    const v = valorPorPeriodo(internacao, faixasPaciente, '2026-11-25');
    const r = apurarProducaoMensal({
      mes: '2026-03',
      leitos: [],
      internacoes: [internacao],
      faixas: faixasPaciente,
    });
    expect(v.reduce((s, p) => s + p.valor, 0)).toBe(r.total.valorProduzido);
    expect(v.reduce((s, p) => s + p.diarias, 0)).toBe(r.total.pacienteDia);
  });
  it('sem saída, o último fica em aberto até a data dada', () => {
    const v = valorPorPeriodo({ ...internacao, saida: null, tipoSaida: null }, faixasPaciente, '2026-03-15');
    expect(v.map((p) => [p.diarias, p.emAberto])).toEqual([
      [9, false],
      [6, true],
    ]);
  });
});

describe('validações', () => {
  const base = {
    entrada: '2026-03-10T08:00:00',
    saida: null,
    inicioVigente: '2026-03-10T08:00:00',
    agora: '2026-03-20T08:00:00',
  };
  it('período da categoria: depois do vigente, nem antes da entrada nem no futuro', () => {
    expect(validarPeriodoCategoria({ ...base, inicio: '2026-03-12T08:00:00' })).toEqual({});
    expect(validarPeriodoCategoria({ ...base, inicio: '2026-03-09T08:00:00' })['inicio']).toMatch(/entrada/);
    expect(validarPeriodoCategoria({ ...base, inicio: '2026-03-21T08:00:00' })['inicio']).toMatch(/futuro/);
    expect(validarPeriodoCategoria({ ...base, inicio: '2026-03-10T08:00:00' })['inicio']).toMatch(/vigente/);
    expect(
      validarPeriodoCategoria({ ...base, saida: '2026-03-11T08:00:00', inicio: '2026-03-12T08:00:00' })[
        'inicio'
      ],
    ).toMatch(/saída/);
  });
  it('faixa: valor não negativo com dois decimais e vigência coerente', () => {
    expect(validarFaixaValor({ valorDiaria: 150.5, inicio: '2026-01-01', fim: null })).toEqual({});
    expect(validarFaixaValor({ valorDiaria: -1, inicio: '2026-01-01', fim: null })).toHaveProperty(
      'valorDiaria',
    );
    expect(validarFaixaValor({ valorDiaria: 1.234, inicio: '2026-01-01', fim: null })).toHaveProperty(
      'valorDiaria',
    );
    expect(validarFaixaValor({ valorDiaria: 1, inicio: '2026-02-01', fim: '2026-01-31' })).toHaveProperty(
      'fim',
    );
  });
});

describe('apuração mensal', () => {
  const r = apurarProducaoMensal({
    mes: '2026-03',
    leitos: [
      { clinicaId: MED, leitos: 2 },
      { clinicaId: CIR, leitos: 1 },
    ],
    faixas,
    internacoes: [
      // Médica do dia 10 ao 13 (3 dias), alta antes da previsão.
      {
        entrada: '2026-03-10T08:00',
        saida: '2026-03-13T10:00',
        tipoSaida: 'alta',
        previstaAlta: '2026-03-14',
        clinicaId: MED,
        periodos: [],
      },
      // Entra na médica, passa à cirúrgica no dia 20 e morre no dia 25 (depois da previsão).
      {
        entrada: '2026-03-18T08:00',
        saida: '2026-03-25T08:00',
        tipoSaida: 'obito',
        previstaAlta: '2026-03-22',
        clinicaId: MED,
        periodos: [
          { clinicaId: MED, inicio: '2026-03-18T08:00', fim: null },
          { clinicaId: CIR, inicio: '2026-03-20T09:00', fim: null },
        ],
      },
      // Veio de fevereiro e segue internado na cirúrgica: o mês inteiro (31 dias).
      {
        entrada: '2026-02-20T08:00',
        saida: null,
        tipoSaida: null,
        previstaAlta: null,
        clinicaId: CIR,
        periodos: [],
      },
    ],
  });
  it('movimento, paciente-dia e leito-dia por categoria e no total', () => {
    const med = r.porClinica.find((c) => c.clinicaId === MED)!;
    const cir = r.porClinica.find((c) => c.clinicaId === CIR)!;
    expect(r.dias).toBe(31);
    expect(med).toMatchObject({ entradas: 2, saidas: 1, pacienteDia: 5, leitoDia: 62, obitos: 0 });
    expect(cir).toMatchObject({ entradas: 0, saidas: 1, obitos: 1, pacienteDia: 36, leitoDia: 31 });
    expect(r.total).toMatchObject({ entradas: 2, saidas: 2, obitos: 1, pacienteDia: 41, leitoDia: 93 });
  });
  it('indicadores da Portaria 312 com as parcelas e a pontualidade da alta', () => {
    expect(r.total.taxaOcupacao).toBe(44.09); // 41 / 93
    expect(r.total.mediaPermanencia).toBe(20.5); // 41 / 2
    expect(r.total.giroLeito).toBe(0.67); // 2 / 3
    expect(r.total.intervaloSubstituicao).toBe(26); // (93 − 41) / 2
    expect(r.total.taxaMortalidade).toBe(50);
    expect(r.total).toMatchObject({ saidasComPrevisao: 2, saidasNoPrazo: 1, pontualidadeAlta: 50 });
  });
  it('valor produzido pela faixa de cada dia, dentro do mês', () => {
    // Médica: 10,11,12 (100) + 18,19 (120) = 540. Cirúrgica: 20..24 (5) + 31 dias = 36 × 300 = 10 800.
    expect(r.porClinica.find((c) => c.clinicaId === MED)!.valorProduzido).toBe(540);
    expect(r.porClinica.find((c) => c.clinicaId === CIR)!.valorProduzido).toBe(10800);
    expect(r.total.valorProduzido).toBe(11340);
    expect(r.total.diasSemFaixa).toBe(0);
  });
  it('sem saída nem leito, as razões ficam nulas; ate corta o mês corrente', () => {
    const v = apurarProducaoMensal({
      mes: '2026-03',
      ate: '2026-03-10',
      leitos: [],
      internacoes: [],
      faixas,
    });
    expect(v).toMatchObject({ dias: 10, ate: '2026-03-10' });
    expect(v.total).toMatchObject({ taxaOcupacao: null, mediaPermanencia: null, pontualidadeAlta: null });
  });
});
