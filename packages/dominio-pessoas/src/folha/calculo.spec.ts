// Cálculo mensal da folha (M53-F2; ficha do M53, regras 7 e 8): fórmulas da lei sobre as vigências passadas (INSS
// progressivo, IRRF com dedução e redução, salário-família, horas extras, adicional noturno, DSR, sobreaviso,
// adicionais, faltas, dias pagos), papéis das rubricas, pendências que barram a gravação e a prova da soma. As tabelas
// dos testes reproduzem os números públicos da lei (2025/2026) só para conferir a conta à mão; colaboradores sintéticos.
import type { ParametrosFolha, RubricaFolha, TabelaLegalFolha } from '@sgh/contratos';
import { PAPEIS_CALCULO_FOLHA } from '@sgh/contratos';
import { describe, expect, it } from 'vitest';
import {
  calcularFolhaCompetencia,
  calcularVinculo,
  conferirCalculo,
  cotaSalarioFamilia,
  diasPagos,
  domingosDoMes,
  type EntradaCalculoFolha,
  entraNaFolhaMensal,
  horasMin,
  inssProgressivo,
  irrfMensal,
  multiplicarDividir,
  pct,
  reais,
  rubricaServeAoPapel,
  totalizarCalculo,
  type VinculoParaCalculo,
} from './calculo.js';

const TABELA: TabelaLegalFolha = {
  inicio: '2026-01-01',
  irrf: {
    faixas: [
      { de: 0, ate: 242_880, aliquota: 0, deducao: 0 },
      { de: 242_881, ate: 282_665, aliquota: 750, deducao: 18_216 },
      { de: 282_666, ate: 375_105, aliquota: 1500, deducao: 39_416 },
      { de: 375_106, ate: 466_468, aliquota: 2250, deducao: 67_549 },
      { de: 466_469, ate: null, aliquota: 2750, deducao: 90_873 },
    ],
    deducaoDependente: 18_959,
    descontoSimplificado: 60_720,
    reducao: {
      isencaoAte: 500_000,
      reducaoDe: 500_001,
      reducaoAte: 735_000,
      valor: 31_289,
      semReducaoAcimaDe: 735_000,
    },
  },
  inss: {
    faixas: [
      { de: 0, ate: 151_800, aliquota: 750, deducao: 0 },
      { de: 151_801, ate: 279_388, aliquota: 900, deducao: 0 },
      { de: 279_389, ate: 419_083, aliquota: 1200, deducao: 0 },
      { de: 419_084, ate: 815_741, aliquota: 1400, deducao: 0 },
    ],
    teto: 815_741,
  },
  salarioFamilia: [{ de: 0, ate: 190_604, cota: 6_504 }],
  salarioMinimo: 151_800,
  contribuinteIndividual: { aliquota: 2000, teto: 815_741 },
};

const SEM_REDUCAO: TabelaLegalFolha = {
  ...TABELA,
  inicio: '2025-05-01',
  irrf: {
    ...TABELA.irrf,
    reducao: { isencaoAte: 0, reducaoDe: 0, reducaoAte: 0, valor: 0, semReducaoAcimaDe: 0 },
  },
};

const rubrica = (
  id: number,
  codigo: number,
  tipo: RubricaFolha['tipo'],
  inc: { inss?: boolean; irrf?: boolean; fgts?: boolean } = {},
): RubricaFolha => ({
  id,
  empresa: 1,
  codigo,
  descricao: `Rubrica ${codigo}`,
  tipo,
  referencia: 'valor',
  percentual: 0,
  prioridade: null,
  ativa: true,
  vigencia: { inicio: null, fim: null },
  usos: ['mensal'],
  incidencias: {
    inss: inc.inss ?? false,
    irrf: inc.irrf ?? false,
    fgts: inc.fgts ?? false,
  } as RubricaFolha['incidencias'],
  esocial: { inss: null, irrf: null, fgts: null, sindical: null },
  natureza: null,
});

const TODAS = { inss: true, irrf: true, fgts: true };
const RUBRICAS: RubricaFolha[] = [
  rubrica(1, 1, 'provento', TODAS),
  rubrica(2, 50, 'provento', TODAS),
  rubrica(3, 100, 'provento', TODAS),
  rubrica(4, 25, 'provento', TODAS),
  rubrica(5, 30, 'provento', TODAS),
  rubrica(6, 40, 'provento', TODAS),
  rubrica(7, 60, 'provento', TODAS),
  rubrica(8, 61, 'provento', TODAS),
  rubrica(9, 70, 'provento'),
  rubrica(10, 80, 'desconto', TODAS),
  rubrica(11, 81, 'desconto', TODAS),
  rubrica(12, 900, 'desconto'),
  rubrica(13, 901, 'desconto'),
  rubrica(14, 950, 'base'),
];
const PAPEL_ID = Object.fromEntries(
  PAPEIS_CALCULO_FOLHA.map((p, i) => [p, i + 1]),
) as ParametrosFolha['rubricas'];

const PARAM: ParametrosFolha = {
  empresa: 1,
  inicio: '2026-01-01',
  percentuais: {
    horaExtra50: 5000,
    horaExtra100: 10_000,
    adicionalNoturno: 2000,
    sobreaviso: 3333,
    periculosidade: 3000,
  },
  encargos: { inssPatronal: 2000, ratAjustado: 300, terceiros: 580, fgts: 800 },
  divisorHoras: null,
  rubricas: PAPEL_ID,
};

const V = (id: number, extra: Partial<VinculoParaCalculo> = {}): VinculoParaCalculo => ({
  id,
  matricula: `M${id}`,
  tipo: 'clt',
  admissao: '2024-01-10',
  desligamento: null,
  centroCusto: 10,
  cargaSemanal: 44,
  ...extra,
});

const entrada = (extra: Partial<EntradaCalculoFolha> = {}): EntradaCalculoFolha => ({
  empresa: 1,
  competencia: '2026-03',
  hoje: '2026-04-05',
  vinculos: [V(1)],
  salarios: [
    {
      vinculo: 1,
      inicio: '2024-01-10',
      salario: 300_000,
      dependentesIrrf: 0,
      dependentesSalarioFamilia: 0,
      insalubridade: 0,
      periculosidade: false,
    },
  ],
  ponto: new Map([[1, { eventos: {}, horas: {} }]]),
  sobreaviso: new Map(),
  afastamentos: [],
  tabelasLegais: [TABELA, SEM_REDUCAO],
  diasAfastamento: [{ inicio: '2020-01-01', dias: 15 }],
  parametros: [PARAM],
  rubricas: RUBRICAS,
  ...extra,
});

describe('aritmética e formatação', () => {
  it('multiplica e divide em BigInt, meio centavo para cima, e recusa divisão por zero e negativo', () => {
    expect(multiplicarDividir([5], [2])).toBe(3);
    expect(multiplicarDividir([4], [3])).toBe(1);
    expect(multiplicarDividir([9_999_999_999, 44_640, 20_000], [220, 60, 10_000])).toBe(67_636_363_630);
    expect(() => multiplicarDividir([1], [0])).toThrow(/zero/);
    expect(() => multiplicarDividir([-1], [1])).toThrow(/negativo/);
  });

  it('memória em reais, horas e percentuais', () => {
    expect(reais(123_456_789)).toBe('R$ 1.234.567,89');
    expect(reais(5)).toBe('R$ 0,05');
    expect(reais(-150)).toBe('-R$ 1,50');
    expect(horasMin(605)).toBe('10h05');
    expect(pct(750)).toBe('7,5%');
    expect(pct(3333)).toBe('33,33%');
    expect(pct(2000)).toBe('20%');
  });
});

describe('tabelas legais (regra 7: os números vêm da vigência)', () => {
  it('INSS progressivo: R$ 3.000,00 → R$ 253,41; acima do teto, limitado', () => {
    expect(inssProgressivo(300_000, TABELA.inss).valor).toBe(25_341);
    const teto = inssProgressivo(1_200_000, TABELA.inss);
    expect(teto.valor).toBe(inssProgressivo(815_741, TABELA.inss).valor);
    expect(teto.memoria).toMatch(/teto/);
    expect(inssProgressivo(0, TABELA.inss)).toEqual({ valor: 0, memoria: 'base zero' });
    // Sem teto declarado: a última faixa aberta vale para a base inteira.
    const aberta = { faixas: [{ de: 0, ate: null, aliquota: 1000, deducao: 0 }], teto: 0 };
    expect(inssProgressivo(100_000, aberta).valor).toBe(10_000);
  });

  it('IRRF: desconto simplificado quando maior; dedução legal com dependentes; faixa e parcela', () => {
    // 3.000: INSS 253,41 < simplificado 607,20 → base 2.392,80, isenta.
    expect(irrfMensal(300_000, 25_341, 0, SEM_REDUCAO.irrf).valor).toBe(0);
    // 6.000 sem redução: INSS 649,60 → base 5.350,40 × 27,5% − 908,73 = 562,63.
    const seis = irrfMensal(600_000, 64_960, 0, SEM_REDUCAO.irrf);
    expect(seis.base).toBe(535_040);
    expect(seis.valor).toBe(56_263);
    // Dois dependentes: 649,60 + 379,18 = 1.028,78 → base 4.971,22 → 27,5% − 908,73 = 458,36.
    expect(irrfMensal(600_000, 64_960, 2, SEM_REDUCAO.irrf).valor).toBe(45_836);
    expect(irrfMensal(600_000, 64_960, 2, SEM_REDUCAO.irrf).memoria).toMatch(/2 dependente/);
  });

  it('memória só com caracteres do CP1252 (a coluna é charset NONE; o sinal U+2212 viraria "?")', () => {
    // CP1252 imprimível ≈ ASCII + Latin-1 (× e ÷ inclusos); fora dele, a gravação recusa (prepararTexto no legado).
    const cp1252 = /^[\x20-\x7e\u00a0-\u00ff]*$/u;
    const ms = [
      irrfMensal(600_000, 64_960, 2, SEM_REDUCAO.irrf).memoria,
      irrfMensal(600_000, 64_960, 0, TABELA.irrf).memoria,
      ...calcularFolhaCompetencia(entrada()).colaboradores.flatMap((c) => c.linhas.map((l) => l.memoria)),
    ];
    for (const m of ms) expect(m).toMatch(cp1252);
    expect(irrfMensal(600_000, 64_960, 0, SEM_REDUCAO.irrf).memoria).toContain('- R$');
  });

  it('redução de 2026 (D-RED-533): até 5.000 zera; 6.000 reduz 179,75 (978,62 − 0,133145 × renda); acima de 7.350, nada', () => {
    expect(irrfMensal(500_000, 51_000, 0, TABELA.irrf).valor).toBe(0);
    const seis = irrfMensal(600_000, 64_960, 0, TABELA.irrf);
    expect(seis.valor).toBe(56_263 - 17_975);
    expect(seis.memoria).toMatch(/redução R\$ 179,75/);
    const alto = irrfMensal(800_000, 81_000, 0, TABELA.irrf);
    expect(alto.valor).toBe(irrfMensal(800_000, 81_000, 0, SEM_REDUCAO.irrf).valor);
  });

  it('salário-família pela faixa da remuneração', () => {
    expect(cotaSalarioFamilia(190_604, TABELA.salarioFamilia)).toBe(6_504);
    expect(cotaSalarioFamilia(190_605, TABELA.salarioFamilia)).toBe(0);
  });
});

describe('dias pagos e calendário (D-DIAS-533)', () => {
  it('domingos do mês', () => {
    expect(domingosDoMes('2026-03')).toBe(5);
    expect(domingosDoMes('2026-02')).toBe(4);
  });

  it('admissão no meio do mês e afastamento além dos dias da empresa', () => {
    expect(diasPagos({ admissao: '2026-03-11' }, [], '2026-03', 15)).toMatchObject({
      dias: 20,
      antesDaAdmissao: 10,
    });
    const a = [{ vinculo: 1, inicio: '2026-03-01', fim: '2026-03-20', situacao: 'ativo' }];
    // 15 dias a cargo da empresa (1º a 15); de 16 a 20 = 5 dias não pagos.
    expect(diasPagos({ admissao: '2020-01-01' }, a, '2026-03', 15)).toMatchObject({ dias: 25, afastado: 5 });
    // Afastamento curto (dentro dos dias da empresa): nada a descontar; cancelado não conta.
    const curto = [
      { vinculo: 1, inicio: '2026-03-01', fim: '2026-03-10', situacao: 'ativo' },
      { vinculo: 1, inicio: '2026-03-01', fim: null, situacao: 'cancelado' },
    ];
    expect(diasPagos({ admissao: '2020-01-01' }, curto, '2026-03', 15).dias).toBe(30);
    // Afastado o mês inteiro (começou antes): zero.
    const longo = [{ vinculo: 1, inicio: '2026-01-10', fim: null, situacao: 'ativo' }];
    expect(diasPagos({ admissao: '2020-01-01' }, longo, '2026-02', 15).dias).toBe(0);
  });

  it('quem entra na folha mensal (D-TIPO-533, D-DESLIG-533)', () => {
    expect(entraNaFolhaMensal(V(1), '2026-03')).toBe(true);
    expect(entraNaFolhaMensal(V(1, { tipo: 'pj' }), '2026-03')).toBe(false);
    expect(entraNaFolhaMensal(V(1, { admissao: '2026-04-01' }), '2026-03')).toBe(false);
    expect(entraNaFolhaMensal(V(1, { desligamento: '2026-03-15' }), '2026-03')).toBe(false);
    expect(entraNaFolhaMensal(V(1, { desligamento: '2026-01-15' }), '2026-03')).toBe(false);
    expect(entraNaFolhaMensal(V(1, { desligamento: '2026-04-15' }), '2026-03')).toBe(true);
  });
});

describe('rubricas dos papéis', () => {
  it('a rubrica serve ao papel: ativa, em vigor e do tipo do papel', () => {
    expect(rubricaServeAoPapel(RUBRICAS[0]!, 'salario', '2026-03')).toBe(true);
    expect(rubricaServeAoPapel(RUBRICAS[0]!, 'inss', '2026-03')).toBe(false);
    expect(rubricaServeAoPapel(RUBRICAS[13]!, 'fgts', '2026-03')).toBe(true);
    expect(rubricaServeAoPapel({ ...RUBRICAS[0]!, ativa: false }, 'salario', '2026-03')).toBe(false);
    expect(
      rubricaServeAoPapel(
        { ...RUBRICAS[0]!, vigencia: { inicio: '2026-04-01', fim: null } },
        'salario',
        '2026-03',
      ),
    ).toBe(false);
  });
});

describe('cálculo do vínculo', () => {
  it('salário de R$ 3.000,00 cheio: INSS 253,41, IRRF zero, FGTS 240,00, encargos 25,8%, líquido 2.746,59', () => {
    const r = calcularFolhaCompetencia(entrada());
    expect(r.pendencias).toEqual([]);
    const c = r.colaboradores[0]!;
    expect(c.resumo).toMatchObject({
      diasPagos: 30,
      proventos: 300_000,
      descontos: 25_341,
      liquido: 274_659,
      baseInss: 300_000,
      baseIrrf: 300_000,
      baseFgts: 300_000,
      inss: 25_341,
      irrf: 0,
      fgts: 24_000,
      encargos: 60_000 + 9_000 + 17_400,
    });
    expect(c.linhas.find((l) => l.papel === 'salario')).toMatchObject({
      rubrica: 1,
      codigoRubrica: 1,
      memoria: 'R$ 3.000,00 × 30/30 dias',
    });
    expect(r.totais).toMatchObject({ colaboradores: 1, inssPatronal: 60_000, rat: 9_000, terceiros: 17_400 });
    expect(r.tabelaLegal).toBe('2026-01-01');
    expect(r.parametros).toBe('2026-01-01');
    expect(conferirCalculo(r.colaboradores, r.totais).ok).toBe(true);
  });

  it('horas extras, adicional noturno, DSR, sobreaviso, insalubridade, faltas e salário-família', () => {
    const e = entrada({
      salarios: [
        {
          vinculo: 1,
          inicio: '2024-01-10',
          salario: 176_000,
          dependentesIrrf: 1,
          dependentesSalarioFamilia: 2,
          insalubridade: 2000,
          periculosidade: false,
        },
      ],
      ponto: new Map([
        [1, { eventos: { '3': 480, '4': 30, '5': 600 }, horas: { '5': 600, '3': 120, '4': 60 } }],
      ]),
      sobreaviso: new Map([[1, 720]]),
    });
    const c = calcularFolhaCompetencia(e).colaboradores[0]!;
    const v = (p: string) => c.linhas.find((l) => l.papel === p)?.valor;
    // Hora = 1.760,00 ÷ 220 = 8,00.
    expect(v('horaExtra50')).toBe(12_000); // 10 h × 8 × 1,5
    expect(v('horaExtra100')).toBe(4_800); // 3 h × 8 × 2
    expect(v('adicionalNoturno')).toBe(1_600); // 10 h × 8 × 20%
    expect(v('dsrVariaveis')).toBe(multiplicarDividir([18_400, 5], [26])); // 5 domingos, 26 dias úteis
    expect(v('sobreaviso')).toBe(multiplicarDividir([176_000, 720, 3333], [220, 60, 10_000]));
    expect(v('insalubridade')).toBe(30_360); // 20% do mínimo
    expect(v('faltas')).toBe(6_400); // 8 h
    expect(v('atrasos')).toBe(400); // 30 min
    expect(c.linhas.find((l) => l.papel === 'salarioFamilia')).toBeUndefined(); // remuneração acima da faixa
    expect(c.linhas.find((l) => l.papel === 'periculosidade')).toBeUndefined();
    const proventos = c.linhas.filter((l) => l.tipo === 'provento').reduce((s, l) => s + l.valor, 0);
    expect(c.resumo.proventos).toBe(proventos);
    expect(c.resumo.baseInss).toBe(proventos - 6_400 - 400);
    expect(c.linhas.find((l) => l.papel === 'horaExtra50')!.memoria).toBe(
      '10h00 × (R$ 1.760,00 ÷ 220 h) × 150%',
    );

    // Salário baixo, com dependentes: salário-família proporcional e sem incidência (a rubrica não incide).
    const sf = calcularFolhaCompetencia(
      entrada({
        salarios: [
          {
            vinculo: 1,
            inicio: '2024-01-10',
            salario: 160_000,
            dependentesIrrf: 0,
            dependentesSalarioFamilia: 2,
            insalubridade: 0,
            periculosidade: true,
          },
        ],
      }),
    ).colaboradores[0]!;
    expect(sf.linhas.find((l) => l.papel === 'periculosidade')?.valor).toBe(48_000);
    expect(sf.linhas.find((l) => l.papel === 'salarioFamilia')).toBeUndefined(); // 2.080,00 > faixa
    const sf2 = calcularFolhaCompetencia(
      entrada({
        salarios: [
          {
            vinculo: 1,
            inicio: '2024-01-10',
            salario: 160_000,
            dependentesIrrf: 0,
            dependentesSalarioFamilia: 2,
            insalubridade: 0,
            periculosidade: false,
          },
        ],
      }),
    ).colaboradores[0]!;
    expect(sf2.linhas.find((l) => l.papel === 'salarioFamilia')).toMatchObject({
      valor: 13_008,
      quantidade: 2,
    });
    expect(sf2.resumo.baseInss).toBe(160_000);
  });

  it('divisor dos parâmetros e salário pela vigência do último dia (D-SAL-533)', () => {
    const e = entrada({
      parametros: [{ ...PARAM, divisorHoras: 200 }],
      salarios: [
        {
          vinculo: 1,
          inicio: '2024-01-10',
          salario: 200_000,
          dependentesIrrf: 0,
          dependentesSalarioFamilia: 0,
          insalubridade: 0,
          periculosidade: false,
        },
        {
          vinculo: 1,
          inicio: '2026-03-20',
          salario: 400_000,
          dependentesIrrf: 0,
          dependentesSalarioFamilia: 0,
          insalubridade: 0,
          periculosidade: false,
        },
        {
          vinculo: 1,
          inicio: '2026-04-01',
          salario: 900_000,
          dependentesIrrf: 0,
          dependentesSalarioFamilia: 0,
          insalubridade: 0,
          periculosidade: false,
        },
      ],
      ponto: new Map([[1, { eventos: {}, horas: { '5': 60 } }]]),
    });
    const c = calcularFolhaCompetencia(e).colaboradores[0]!;
    expect(c.linhas.find((l) => l.papel === 'salario')?.valor).toBe(400_000);
    expect(c.linhas.find((l) => l.papel === 'horaExtra50')?.valor).toBe(3_000); // 4.000 ÷ 200 × 1,5
  });

  it('calcularVinculo direto: rubrica sem incidência não entra nas bases', () => {
    const v = V(1);
    const r = calcularVinculo(v, {
      competencia: '2026-03',
      salario: {
        vinculo: 1,
        inicio: '2024-01-01',
        salario: 100_000,
        dependentesIrrf: 0,
        dependentesSalarioFamilia: 0,
        insalubridade: 0,
        periculosidade: false,
      },
      ponto: { eventos: {}, horas: {} },
      sobreaviso: 0,
      dias: diasPagos(v, [], '2026-03', 15),
      tabela: TABELA,
      parametros: PARAM,
      rubricas: new Map([['salario', rubrica(1, 1, 'provento')]]),
    });
    expect(r.resumo.baseInss).toBe(0);
    expect(r.resumo.inss).toBe(0);
    expect(r.linhas.find((l) => l.papel === 'baseInss')?.memoria).toBe('nenhuma rubrica incide');
  });
});

describe('pendências que barram a gravação', () => {
  it('competência não terminada, sem tabela, sem parâmetros e sem colaboradores', () => {
    const r = calcularFolhaCompetencia(
      entrada({
        hoje: '2026-03-31',
        tabelasLegais: [],
        parametros: [],
        vinculos: [V(1, { tipo: 'cooperado' })],
      }),
    );
    expect(r.pendencias.map((p) => p.codigo)).toEqual([
      'competencia-futura',
      'sem-colaboradores',
      'sem-parametros',
      'sem-tabela-legal',
    ]);
    expect(r.foraDaFolha).toBe(1);
    expect(r.colaboradores).toEqual([]);
  });

  it('tabela que não passa na conferência', () => {
    const ruim = { ...TABELA, salarioMinimo: 0 };
    expect(
      calcularFolhaCompetencia(entrada({ tabelasLegais: [ruim] })).pendencias.map((p) => p.codigo),
    ).toEqual(['tabela-legal-divergente']);
  });

  it('ponto não fechado e sem salário: por vínculo; os demais seguem na prévia', () => {
    const r = calcularFolhaCompetencia(
      entrada({
        vinculos: [V(1), V(2), V(3)],
        ponto: new Map([
          [1, { eventos: {}, horas: {} }],
          [3, { eventos: {}, horas: {} }],
        ]),
      }),
    );
    expect(r.pendencias).toEqual([
      { codigo: 'ponto-nao-fechado', vinculos: [2], papel: null },
      { codigo: 'sem-salario', vinculos: [2, 3], papel: null },
    ]);
    expect(r.colaboradores.map((c) => c.resumo.vinculo)).toEqual([1]);
  });

  it('afastamento sem os dias a cargo da empresa em vigor', () => {
    const r = calcularFolhaCompetencia(
      entrada({
        diasAfastamento: [],
        afastamentos: [{ vinculo: 1, inicio: '2026-03-01', fim: '2026-03-05', situacao: 'ativo' }],
      }),
    );
    expect(r.pendencias.map((p) => p.codigo)).toEqual(['sem-tabela-legal']);
  });

  it('papel com valor sem rubrica e rubrica inválida (não existe, outro tipo)', () => {
    const r = calcularFolhaCompetencia(
      entrada({
        parametros: [{ ...PARAM, rubricas: { ...PAPEL_ID, inss: null } }],
      }),
    );
    expect(r.pendencias).toEqual([{ codigo: 'papel-sem-rubrica', vinculos: [1], papel: 'inss' }]);
    expect(r.colaboradores).toEqual([]);
    // Rubrica que não existe na empresa (sem ela, o salário não incide e o INSS fica zerado).
    const inv = calcularFolhaCompetencia(
      entrada({ parametros: [{ ...PARAM, rubricas: { ...PAPEL_ID, salario: 99 } }] }),
    );
    expect(inv.pendencias).toEqual([{ codigo: 'rubrica-invalida', vinculos: [1], papel: 'salario' }]);
    // Papel sem valor no mês não precisa de rubrica.
    const ok = calcularFolhaCompetencia(
      entrada({ parametros: [{ ...PARAM, rubricas: { ...PAPEL_ID, sobreaviso: null } }] }),
    );
    expect(ok.pendencias).toEqual([]);
  });

  it('líquido negativo (faltas maiores que o salário pago)', () => {
    const r = calcularFolhaCompetencia(
      entrada({ ponto: new Map([[1, { eventos: { '3': 300 * 60 }, horas: {} }]]) }),
    );
    expect(r.pendencias.map((p) => p.codigo)).toEqual(['liquido-negativo']);
  });
});

describe('prova da soma (regra 8)', () => {
  it('totais pela soma dos vínculos; divergência quando o resumo não bate', () => {
    const r = calcularFolhaCompetencia(
      entrada({
        vinculos: [V(1), V(2)],
        salarios: [
          {
            vinculo: 1,
            inicio: '2024-01-10',
            salario: 300_000,
            dependentesIrrf: 0,
            dependentesSalarioFamilia: 0,
            insalubridade: 0,
            periculosidade: false,
          },
          {
            vinculo: 2,
            inicio: '2024-01-10',
            salario: 600_000,
            dependentesIrrf: 0,
            dependentesSalarioFamilia: 0,
            insalubridade: 0,
            periculosidade: false,
          },
        ],
        ponto: new Map([
          [1, { eventos: {}, horas: {} }],
          [2, { eventos: {}, horas: {} }],
        ]),
      }),
    );
    expect(r.totais).toEqual(totalizarCalculo(r.colaboradores));
    expect(r.totais.proventos).toBe(900_000);
    const ok = conferirCalculo(r.colaboradores, r.totais);
    expect(ok.ok).toBe(true);
    expect(ok.parcelas.find((p) => p.rotulo === 'liquido')?.valor).toBe(r.totais.liquido);
    const errado = conferirCalculo(
      [{ resumo: { ...r.colaboradores[0]!.resumo, liquido: 1 }, linhas: r.colaboradores[0]!.linhas }],
      { ...r.totais, colaboradores: 2 },
    );
    expect(errado.ok).toBe(false);
    expect(errado.divergencias).toContain('vinculo 1: proventos − descontos ≠ líquido');
    expect(errado.divergencias).toContain('soma dos proventos ≠ total');
    const linhas = conferirCalculo(
      [
        {
          resumo: {
            ...r.colaboradores[0]!.resumo,
            proventos: 1,
            liquido: 1 - r.colaboradores[0]!.resumo.descontos,
          },
          linhas: r.colaboradores[0]!.linhas,
        },
      ],
      r.totais,
    );
    expect(linhas.divergencias).toContain('vinculo 1: soma dos proventos ≠ resumo');
  });
});

describe('férias com recibo gravado no mês (M53-F3, D-FERMES-534)', () => {
  it('os dias de gozo saem do salário do mês; no mês do início, o INSS é o da base somada menos o retido no recibo', () => {
    const r = calcularFolhaCompetencia(
      entrada({
        competencia: '2026-10',
        hoje: '2026-11-05',
        ferias: new Map([[1, { dias: 12, baseInss: 400_000, inss: 37_341 }]]),
      }),
    );
    expect(r.pendencias).toEqual([]);
    const ls = r.colaboradores[0]!.linhas;
    const sal = ls.find((l) => l.papel === 'salario')!;
    expect(sal.quantidade).toBe(18);
    expect(sal.valor).toBe(180_000);
    expect(sal.memoria).toMatch(/12 dia\(s\) de férias/);
    const inss = ls.find((l) => l.papel === 'inss')!;
    // 580.000 no progressivo = 62.159,70 → 62.160; menos 37.341 retidos no recibo.
    expect(inss.valor).toBe(62_160 - 37_341);
    expect(inss.memoria).toMatch(/retido no recibo/);
  });

  it('no mês seguinte do gozo, só os dias (sem base do recibo); o mês inteiro de férias paga 0 dia de salário', () => {
    const r = calcularFolhaCompetencia(
      entrada({
        competencia: '2026-11',
        hoje: '2026-12-05',
        ferias: new Map([[1, { dias: 30, baseInss: 0, inss: 0 }]]),
      }),
    );
    const ls = r.colaboradores[0]?.linhas ?? [];
    expect(ls.find((l) => l.papel === 'salario')).toBeUndefined();
    expect(ls.find((l) => l.papel === 'inss')).toBeUndefined();
  });
});
