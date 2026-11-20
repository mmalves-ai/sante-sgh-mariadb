// Férias (M53-F3; CLT arts. 129 a 145): períodos aquisitivos, escala das faltas, saldo, conferência da programação e
// recibo com a memória. As tabelas reproduzem os números públicos de 2026 só para a conta à mão; colaboradores sintéticos.
import { describe, expect, it } from 'vitest';
import {
  calcularFerias,
  conferirProgramacao,
  diasAfastadoNoPeriodo,
  diasDeDireito,
  type EntradaCalculoFerias,
  type EntradaProgramacaoFerias,
  type FeriasRegistrada,
  jornadaDiariaMinutos,
  periodosAquisitivos,
  saldoDosPeriodos,
} from './ferias.js';
import {
  avosDoAno,
  competenciasDoPeriodo,
  type HistoricoFolha,
  maisCompetencias,
  maisDias,
  mediaDasVariaveis,
  somarAnos,
} from './medias.js';
import { PARAM_2026, rubricasDeTeste, SALARIO, TABELA_2026, VINC } from './fixtures-folha.spec.js';

describe('datas e períodos', () => {
  it('anos com 29/02, dias e competências', () => {
    expect(somarAnos('2024-02-29', 1)).toBe('2025-02-28');
    expect(somarAnos('2024-01-10', 2)).toBe('2026-01-10');
    expect(maisDias('2026-03-01', -1)).toBe('2026-02-28');
    expect(maisCompetencias('2026-11', 3)).toBe('2027-02');
    expect(maisCompetencias('2026-01', -1)).toBe('2025-12');
  });

  it('períodos aquisitivos e concessivos desde a admissão (o último pode estar em aquisição)', () => {
    expect(periodosAquisitivos('2024-01-10', '2026-10-27')).toEqual([
      { inicio: '2024-01-10', fim: '2025-01-09', concessivoFim: '2026-01-09' },
      { inicio: '2025-01-10', fim: '2026-01-09', concessivoFim: '2027-01-09' },
      { inicio: '2026-01-10', fim: '2027-01-09', concessivoFim: '2028-01-09' },
    ]);
    expect(periodosAquisitivos('2026-11-01', '2026-10-27')).toEqual([]);
  });

  it('12 competências por período (D-MES-534): começa no mês do início até o dia 15, senão no seguinte', () => {
    expect(competenciasDoPeriodo('2024-01-10')).toEqual(
      Array.from({ length: 12 }, (_, i) => `2024-${String(i + 1).padStart(2, '0')}`),
    );
    const c = competenciasDoPeriodo('2024-01-20');
    expect(c[0]).toBe('2024-02');
    expect(c[11]).toBe('2025-01');
  });

  it('escala do art. 130 e jornada diária', () => {
    expect([0, 5, 6, 14, 15, 23, 24, 32, 33].map(diasDeDireito)).toEqual([30, 30, 24, 24, 18, 18, 12, 12, 0]);
    expect(jornadaDiariaMinutos(44)).toBe(440);
    expect(jornadaDiariaMinutos(36)).toBe(360);
  });
});

const hist = (
  competencia: string,
  papel: HistoricoFolha['papel'],
  quantidade: number,
  valor = 0,
): HistoricoFolha => ({
  competencia,
  papel,
  quantidade,
  valor,
});
const MESES_2025 = Array.from({ length: 12 }, (_, i) => `2025-${String(i + 1).padStart(2, '0')}`);
const HIST_CHEIO = MESES_2025.map((c) => hist(c, 'salario', 30, 300_000));

describe('saldo dos períodos', () => {
  const base = {
    vinculo: VINC(1),
    hoje: '2026-10-27',
    historico: HIST_CHEIO,
    afastamentos: [],
    diasEmpresa: 15,
    ferias: [] as FeriasRegistrada[],
  };

  it('vencido, aberto e em aquisição; competências sem cálculo viram aviso', () => {
    const ps = saldoDosPeriodos(base);
    expect(ps.map((p) => [p.situacao, p.direito, p.saldo])).toEqual([
      ['vencido', 30, 30],
      ['aberto', 30, 30],
      ['em-aquisicao', 30, 30],
    ]);
    // 2024 não tem folha calculada: aviso no 1º período; o 2º (2025) está completo.
    expect(ps[0]!.avisos).toContain('competencias-sem-calculo');
    expect(ps[1]!.avisos).toEqual([]);
    expect(ps[2]!.competenciasSemCalculo).toEqual([
      '2026-01',
      '2026-02',
      '2026-03',
      '2026-04',
      '2026-05',
      '2026-06',
      '2026-07',
      '2026-08',
      '2026-09',
    ]);
  });

  it('faltas do período pela jornada (D-FALTAS-534); gozados, programados, abono e quitado', () => {
    const ps = saldoDosPeriodos({
      ...base,
      historico: [
        ...HIST_CHEIO,
        hist('2025-03', 'faltas', 440 * 4),
        hist('2025-07', 'faltas', 440 * 2 + 100),
      ],
      ferias: [
        {
          id: 1,
          aquisitivoInicio: '2024-01-10',
          inicio: '2025-02-03',
          fim: '2025-03-04',
          dias: 30,
          abono: 0,
          adiantarDecimo: false,
          situacao: 'calculada',
        },
        {
          id: 2,
          aquisitivoInicio: '2025-01-10',
          inicio: '2026-11-02',
          fim: '2026-11-15',
          dias: 14,
          abono: 6,
          adiantarDecimo: false,
          situacao: 'programada',
        },
        {
          id: 3,
          aquisitivoInicio: '2025-01-10',
          inicio: '2026-12-01',
          fim: '2026-12-10',
          dias: 10,
          abono: 0,
          adiantarDecimo: false,
          situacao: 'cancelada',
        },
      ],
    });
    expect(ps[0]).toMatchObject({ situacao: 'quitado', gozados: 30, saldo: 0 });
    expect(ps[1]).toMatchObject({
      faltas: 6,
      direito: 24,
      programados: 14,
      abono: 6,
      saldo: 4,
      situacao: 'aberto',
    });
  });

  it('afastamento longo é aviso (D-AFAST-534); outro tipo de vínculo não tem férias', () => {
    const ps = saldoDosPeriodos({
      ...base,
      afastamentos: [{ vinculo: 1, inicio: '2025-02-01', fim: '2025-09-30', situacao: 'ativo' }],
    });
    expect(ps[1]!.avisos).toContain('afastamento-longo');
    expect(
      diasAfastadoNoPeriodo(
        [{ vinculo: 1, inicio: '2025-02-01', fim: '2025-02-20', situacao: 'ativo' }],
        '2025-01-10',
        '2026-01-09',
        15,
      ),
    ).toBe(5);
    expect(saldoDosPeriodos({ ...base, vinculo: VINC(1, { tipo: 'pj' }) })).toEqual([]);
  });

  it('desligado: os períodos param no desligamento', () => {
    const ps = saldoDosPeriodos({ ...base, vinculo: VINC(1, { desligamento: '2025-06-30' }) });
    expect(ps.map((p) => p.inicio)).toEqual(['2024-01-10', '2025-01-10']);
  });
});

describe('programação (CLT art. 134, 135, 137 e 143)', () => {
  const [, aberto] = saldoDosPeriodos({
    vinculo: VINC(1),
    hoje: '2026-10-27',
    historico: HIST_CHEIO,
    afastamentos: [],
    diasEmpresa: 15,
    ferias: [],
  });
  const prog = (
    nova: Partial<EntradaProgramacaoFerias['nova']>,
    extra: Partial<EntradaProgramacaoFerias> = {},
  ) =>
    conferirProgramacao({
      vinculo: VINC(1),
      hoje: '2026-10-27',
      periodo: aberto!,
      ferias: [],
      decimoAdiantadoNoAno: false,
      nova: { inicio: '2026-11-30', dias: 30, abono: 0, adiantarDecimo: false, ...nova },
      ...extra,
    });

  it('30 dias numa segunda: fim, pagamento dois dias antes, sem recusa', () => {
    expect(prog({})).toEqual({
      recusas: [],
      avisos: [],
      fim: '2026-12-29',
      pagamento: '2026-11-28',
      dobra: 0,
    });
  });

  it('véspera de descanso, aviso curto, início no passado e aquisitivo incompleto', () => {
    expect(prog({ inicio: '2026-12-04' }).recusas).toContain('vespera-de-descanso');
    expect(prog({ inicio: '2026-12-05' }).recusas).toContain('vespera-de-descanso');
    expect(prog({ inicio: '2026-11-02' }).avisos).toContain('aviso-curto');
    expect(prog({ inicio: '2026-10-26' }).recusas).toContain('inicio-no-passado');
    expect(prog({ inicio: '2026-01-05' }, { hoje: '2026-01-01' }).recusas).toContain('aquisitivo-incompleto');
  });

  it('frações: mínimo de 5, uma com 14, até três; saldo; abono até 1/3 e uma vez', () => {
    expect(prog({ dias: 4 }).recusas).toContain('fracao-minima');
    expect(prog({ dias: 10 }).recusas).toEqual([]);
    // 10 + 10 deixa 10: nenhuma fração com 14.
    const dez: FeriasRegistrada = {
      id: 9,
      aquisitivoInicio: aberto!.inicio,
      inicio: '2027-01-04',
      fim: '2027-01-13',
      dias: 10,
      abono: 0,
      adiantarDecimo: false,
      situacao: 'programada',
    };
    const comDez = { ...aberto!, programados: 10, saldo: 20 };
    expect(prog({ dias: 10 }, { periodo: comDez, ferias: [dez] }).recusas).toContain('fracao-quatorze');
    expect(prog({ dias: 14 }, { periodo: comDez, ferias: [dez] }).recusas).toEqual([]);
    expect(prog({ dias: 16 }, { periodo: comDez, ferias: [dez] }).recusas).toContain('fracao-minima');
    expect(prog({ dias: 20 }, { periodo: comDez, ferias: [dez] }).recusas).toEqual([]);
    expect(prog({ dias: 21 }, { periodo: comDez, ferias: [dez] }).recusas).toContain('saldo-insuficiente');
    expect(
      prog(
        { dias: 5 },
        {
          periodo: { ...aberto!, saldo: 15 },
          ferias: [
            dez,
            { ...dez, id: 10, inicio: '2027-02-01', fim: '2027-02-10' },
            { ...dez, id: 11, inicio: '2027-03-01', fim: '2027-03-10' },
          ],
        },
      ).recusas,
    ).toContain('tres-fracoes');
    expect(prog({ dias: 20, abono: 10 }).recusas).toEqual([]);
    expect(prog({ dias: 19, abono: 11 }).recusas).toContain('abono-acima');
    expect(
      prog({ dias: 14, abono: 5 }, { periodo: comDez, ferias: [{ ...dez, abono: 1 }] }).recusas,
    ).toContain('abono-repetido');
  });

  it('direito menor que 14 (faltas): gozo de uma vez', () => {
    const doze = { ...aberto!, direito: 12, saldo: 12 };
    expect(prog({ dias: 12 }, { periodo: doze }).recusas).toEqual([]);
    expect(prog({ dias: 6 }, { periodo: doze }).recusas).toContain('fracao-quatorze');
  });

  it('sobreposição, desligamento, adiantamento do 13º repetido e vínculo sem férias', () => {
    const outra: FeriasRegistrada = {
      id: 5,
      aquisitivoInicio: '2024-01-10',
      inicio: '2026-12-14',
      fim: '2026-12-23',
      dias: 10,
      abono: 0,
      adiantarDecimo: true,
      situacao: 'calculada',
    };
    expect(prog({}, { ferias: [outra] }).recusas).toContain('sobreposicao');
    expect(
      prog(
        { inicio: '2027-01-04', dias: 20, adiantarDecimo: true },
        { ferias: [{ ...outra, inicio: '2027-02-01', fim: '2027-02-10' }] },
      ).recusas,
    ).toContain('adiantamento-repetido');
    expect(prog({ adiantarDecimo: true }, { decimoAdiantadoNoAno: true }).recusas).toContain(
      'adiantamento-repetido',
    );
    expect(prog({}, { vinculo: VINC(1, { desligamento: '2026-12-15' }) }).recusas).toContain(
      'depois-do-desligamento',
    );
    expect(prog({}, { vinculo: VINC(1, { tipo: 'cooperado' }) }).recusas).toEqual(['vinculo-sem-ferias']);
    expect(prog({}, { periodo: null }).recusas).toEqual(['periodo-inexistente']);
  });

  it('gozo depois do concessivo: dobra dos dias que passam e aviso', () => {
    const r = prog({ inicio: '2027-01-04', dias: 20 });
    // Concessivo até 2027-01-09: 04 a 09 dentro (6 dias), 10 a 23 em dobro (14).
    expect(r.dobra).toBe(14);
    expect(r.avisos).toContain('concessivo-vencido');
  });
});

describe('médias (D-MEDIA-534) e avos (D-AVOS-534)', () => {
  it('média física das horas ÷ meses, valorizada pela hora atual; descanso pela média em valor', () => {
    const h = [
      hist('2025-03', 'horaExtra50', 600),
      hist('2025-08', 'horaExtra50', 600),
      hist('2025-08', 'dsrVariaveis', 0, 12_000),
    ];
    const m = mediaDasVariaveis(h, new Set(MESES_2025), 12, 300_000, 220, PARAM_2026);
    // 300.000 × 1.200 min × 150% ÷ (220 × 60 × 12) = 3.409,09 → 3.409; descanso 12.000 ÷ 12 = 1.000.
    expect(m.valor).toBe(3_409 + 1_000);
    expect(m.memoria).toMatch(/hora extra 20h00\/12/);
    expect(mediaDasVariaveis([], new Set(), 0, 1, 1, PARAM_2026).valor).toBe(0);
  });

  it('avo com 15 dias ou mais de trabalho no mês; afastamento além dos dias da empresa tira o avo', () => {
    expect(avosDoAno(VINC(1, { admissao: '2026-03-20' }), [], 2026, 15).avos).toBe(9);
    expect(avosDoAno(VINC(1, { admissao: '2026-03-17' }), [], 2026, 15).avos).toBe(10);
    const afast = [{ vinculo: 1, inicio: '2026-05-01', fim: '2026-06-30', situacao: 'ativo' }];
    // Maio: 15 dias pela empresa + 16 pela Previdência → 15 trabalhados (avo); junho inteiro afastado.
    expect(avosDoAno(VINC(1), afast, 2026, 15).meses).not.toContain('2026-06');
    expect(avosDoAno(VINC(1), afast, 2026, 15).meses).toContain('2026-05');
    expect(avosDoAno(VINC(1), [], 2026, 15, 11).avos).toBe(11);
  });
});

const entradaFerias = (
  extra: Partial<EntradaCalculoFerias> = {},
  ferias: Partial<EntradaCalculoFerias['ferias']> = {},
): EntradaCalculoFerias => ({
  empresa: 1,
  vinculo: VINC(1),
  ferias: {
    aquisitivoInicio: '2025-01-10',
    inicio: '2026-11-30',
    dias: 30,
    abono: 0,
    dobra: 0,
    adiantarDecimo: false,
    ...ferias,
  },
  salarios: [SALARIO(1)],
  historico: HIST_CHEIO,
  afastamentos: [],
  diasAfastamento: [{ inicio: '2020-01-01', dias: 15 }],
  tabelasLegais: [TABELA_2026],
  parametros: [PARAM_2026],
  rubricas: rubricasDeTeste(),
  ...extra,
});

describe('recibo de férias (D-REMUN-534)', () => {
  it('30 dias: férias + 1/3, INSS e IRRF do recibo, FGTS e encargos', () => {
    const r = calcularFerias(entradaFerias());
    expect(r.pendencias).toEqual([]);
    expect(r.competencia).toBe('2026-11');
    const v = (p: string) => r.recibo!.linhas.find((l) => l.papel === p)?.valor ?? 0;
    expect(v('feriasGozo')).toBe(300_000);
    expect(v('feriasMedias')).toBe(0);
    expect(v('feriasTerco')).toBe(100_000);
    // INSS de 4.000,00: 1.518,00 × 7,5% + 1.275,88 × 9% + 1.206,12 × 12% = 373,41.
    expect(v('inssFerias')).toBe(37_341);
    // IRRF: desconto simplificado → base 3.392,80 × 15% - 394,16 = 114,76, zerado pela redução de 2026.
    expect(v('irrfFerias')).toBe(0);
    expect(v('fgts')).toBe(32_000);
    expect(v('inssPatronal')).toBe(80_000);
    expect(r.recibo!.resumo).toMatchObject({
      proventos: 400_000,
      descontos: 37_341,
      liquido: 362_659,
      diasPagos: 30,
    });
  });

  it('20 dias + 10 de abono com médias; o abono não entra nas bases (a rubrica diz)', () => {
    const h = [
      ...HIST_CHEIO,
      hist('2025-03', 'horaExtra50', 600),
      hist('2025-08', 'horaExtra50', 600),
      hist('2025-08', 'dsrVariaveis', 0, 12_000),
    ];
    const r = calcularFerias(entradaFerias({ historico: h }, { dias: 20, abono: 10 }));
    const v = (p: string) => r.recibo!.linhas.find((l) => l.papel === p)?.valor ?? 0;
    expect(v('feriasGozo')).toBe(200_000);
    expect(v('feriasMedias')).toBe(2_939); // 4.409 × 20/30
    expect(v('feriasTerco')).toBe(67_646); // 202.939 ÷ 3
    expect(v('abonoPecuniario')).toBe(101_470); // 304.409 × 10/30
    expect(v('abonoTerco')).toBe(33_823);
    expect(v('baseInss')).toBe(200_000 + 2_939 + 67_646);
  });

  it('dobra, adiantamento do 13º (fora do INSS e do IRRF) e adicionais fixos', () => {
    const r = calcularFerias(
      entradaFerias(
        { salarios: [SALARIO(1, 300_000, { insalubridade: 2000 })] },
        { dobra: 10, adiantarDecimo: true },
      ),
    );
    const v = (p: string) => r.recibo!.linhas.find((l) => l.papel === p)?.valor ?? 0;
    // Fixa = 3.000,00 + 1.518,00 × 20% = 3.303,60.
    expect(v('feriasGozo')).toBe(330_360);
    expect(v('feriasDobra')).toBe(146_827); // 330.360 × 10/30 × 4/3 = 146.826,67
    expect(v('decimoAdiantamento')).toBe(165_180); // 330.360 × 12/24
    expect(v('baseInss')).toBe(330_360 + 110_120);
  });

  it('pendências: sem salário, sem tabela, sem parâmetros e papel sem rubrica (a prévia volta)', () => {
    expect(calcularFerias(entradaFerias({ salarios: [] })).pendencias.map((p) => p.codigo)).toEqual([
      'sem-salario',
    ]);
    expect(calcularFerias(entradaFerias({ tabelasLegais: [] })).pendencias.map((p) => p.codigo)).toEqual([
      'sem-tabela-legal',
    ]);
    expect(calcularFerias(entradaFerias({ parametros: [] })).pendencias.map((p) => p.codigo)).toEqual([
      'sem-parametros',
    ]);
    const semTerco = { ...PARAM_2026, rubricas: { ...PARAM_2026.rubricas, feriasTerco: null } };
    const r = calcularFerias(entradaFerias({ parametros: [semTerco] }));
    expect(r.pendencias).toEqual([{ codigo: 'papel-sem-rubrica', vinculos: [1], papel: 'feriasTerco' }]);
    expect(r.recibo).not.toBeNull();
    const invalida = { ...PARAM_2026, rubricas: { ...PARAM_2026.rubricas, feriasTerco: 999 } };
    expect(calcularFerias(entradaFerias({ parametros: [invalida] })).pendencias[0]!.codigo).toBe(
      'rubrica-invalida',
    );
  });
});
