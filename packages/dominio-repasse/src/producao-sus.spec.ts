import { describe, expect, it } from 'vitest';
import {
  apurarProducaoSus,
  type AtoProducaoSus,
  calcularAtoSus,
  conferirRateioSadt,
  conferirRegraSus,
  escolherRegraSus,
  papelDaAtividadeAih,
  ratearSadtAih,
  type RegraRateioSadtAih,
  type RegraRepasseSus,
} from './producao-sus.js';

const regra = (x: Partial<RegraRepasseSus>): RegraRepasseSus => ({
  id: 1,
  codigo: 'R1',
  modalidade: 'internacao',
  procedimento: null,
  grupo: null,
  ocupacao: null,
  papel: 'todos',
  base: 'servico_profissional',
  percentualPago: 70,
  percentualDesconto: null,
  valorFixo: null,
  valorDesconto: null,
  valorPonto: null,
  prioridade: 100,
  inicio: '2025-01-01',
  fim: null,
  ativo: true,
  ...x,
});
const ato = (x: Partial<AtoProducaoSus>): AtoProducaoSus => ({
  instrumento: 'aih',
  origem: 10,
  procedimento: 500,
  grupo: 4,
  ocupacao: 9,
  executante: 77,
  papel: 'executante',
  quantidade: 1,
  pontos: null,
  servicoProfissional: 100,
  servicoHospitalar: 300,
  servicoAmbulatorial: 0,
  total: 400,
  fracaoAprovada: 1,
  ...x,
});
const rateio = (x: Partial<RegraRateioSadtAih>): RegraRateioSadtAih => ({
  id: 1,
  procedimento: null,
  grupo: 2,
  profissional: null,
  consideraSadt: true,
  usaPeso: false,
  pesoPercentual: null,
  tetoPercentual: null,
  inicio: '2025-01-01',
  fim: null,
  ativo: true,
  ...x,
});

describe('repasse da produção SUS', () => {
  it('escolhe pela prioridade e, no empate, pela mais específica; respeita modalidade, papel e vigência', () => {
    const geral = regra({ id: 1 });
    const doProc = regra({ id: 2, procedimento: 500 });
    const anest = regra({ id: 3, papel: 'anestesista', procedimento: 500 });
    const vencida = regra({ id: 4, procedimento: 500, prioridade: 1, fim: '2025-05-31' });
    const amb = regra({ id: 5, modalidade: 'ambulatorial', prioridade: 1 });
    const rs = [geral, doProc, anest, vencida, amb];
    expect(escolherRegraSus(ato({}), rs, '2025-06-01')?.id).toBe(2);
    expect(escolherRegraSus(ato({ papel: 'anestesista' }), rs, '2025-06-01')?.id).toBe(3);
    expect(escolherRegraSus(ato({}), rs, '2025-05-01')?.id).toBe(4);
    expect(escolherRegraSus(ato({ instrumento: 'bpa' }), rs, '2025-06-01')?.id).toBe(5);
    expect(escolherRegraSus(ato({ grupo: 3 }), [regra({ grupo: 4 })], '2025-06-01')).toBeNull();
  });

  it('calcula percentual, desconto, pontos, valor fixo e glosa proporcional', () => {
    expect(calcularAtoSus(ato({}), regra({}))).toEqual({ base: 100, percentual: 70, glosa: 0, repasse: 70 });
    expect(calcularAtoSus(ato({ fracaoAprovada: 0.5 }), regra({ percentualDesconto: 10 }))).toEqual({
      base: 100,
      percentual: 70,
      glosa: 31.5,
      repasse: 31.5,
    });
    expect(
      calcularAtoSus(ato({ pontos: 120 }), regra({ base: 'pontos', valorPonto: 0.25, percentualPago: null })),
    ).toMatchObject({ base: 30, repasse: 30 });
    expect(
      calcularAtoSus(
        ato({ quantidade: 3 }),
        regra({ base: 'valor_fixo', valorFixo: 12.5, percentualPago: null }),
      ).repasse,
    ).toBe(37.5);
    expect(calcularAtoSus(ato({}), regra({ valorDesconto: 500 })).repasse).toBe(0);
  });

  it('rateia o SADT por pontos e por peso, com teto e sem passar do total', () => {
    const ps = [
      { origem: 1, procedimento: 21, grupo: 2, executante: 70, pontos: 100, quantidade: 1 },
      { origem: 2, procedimento: 22, grupo: 2, executante: 71, pontos: 200, quantidade: 1 },
      { origem: 3, procedimento: 23, grupo: 3, executante: 72, pontos: 900, quantidade: 1 },
      { origem: 4, procedimento: 24, grupo: 2, executante: null, pontos: 900, quantidade: 1 },
    ];
    const r = ratearSadtAih(100, ps, [rateio({})], '2025-06-01');
    expect(r.map((x) => [x.origem, x.valor])).toEqual([
      [1, 33.33],
      [2, 66.67],
    ]);
    const comTeto = ratearSadtAih(
      100,
      ps,
      [rateio({}), rateio({ id: 2, procedimento: 22, tetoPercentual: 50 })],
      '2025-06-01',
    );
    expect(comTeto.find((x) => x.origem === 2)).toMatchObject({ valor: 50, regra: 2 });
    const porPeso = ratearSadtAih(
      90,
      ps,
      [
        rateio({ usaPeso: true, pesoPercentual: 10 }),
        rateio({ id: 3, procedimento: 22, usaPeso: true, pesoPercentual: 20 }),
      ],
      '2025-06-01',
    );
    expect(porPeso.map((x) => x.valor)).toEqual([30, 60]);
    expect(ratearSadtAih(100, ps, [rateio({ consideraSadt: false })], '2025-06-01')).toEqual([]);
  });

  it('apura: linhas, pendências sem executante e sem regra, SADT com a glosa da AIH, totais', () => {
    const r = apurarProducaoSus({
      competencia: '202506',
      atos: [
        ato({ origem: 1 }),
        ato({ origem: 2, executante: null }),
        ato({ origem: 3, instrumento: 'apac' }),
        ato({ origem: 4, papel: 'anestesista', servicoProfissional: 50, fracaoAprovada: 0.8 }),
      ],
      regras: [regra({})],
      sadt: [
        {
          valor: 40,
          fracaoAprovada: 0.8,
          participantes: [
            { origem: 9, procedimento: 21, grupo: 2, executante: 70, pontos: 10, quantidade: 1 },
          ],
        },
      ],
      rateios: [rateio({})],
    });
    expect(r.linhas.map((l) => [l.sequencia, l.origem, l.repasse, l.glosa, l.sadt])).toEqual([
      [1, 1, 70, 0, false],
      [2, 4, 28, 7, false],
      [3, 9, 32, 8, true],
    ]);
    expect(r.pendencias).toEqual([
      { instrumento: 'aih', origem: 2, motivo: 'sem-executante' },
      { instrumento: 'apac', origem: 3, motivo: 'sem-regra' },
    ]);
    expect([r.totalRepasse, r.totalGlosa]).toEqual([130, 15]);
    expect(() => apurarProducaoSus({ competencia: '2025-06', atos: [], regras: [] })).toThrow();
  });

  it('papel pela atividade da AIH e conferências da regra e do rateio', () => {
    expect(['1', '06', '3', '9', null].map(papelDaAtividadeAih)).toEqual([
      'executante',
      'anestesista',
      'auxiliar',
      'outro',
      'executante',
    ]);
    const base = {
      codigo: 'CIR-70',
      descricao: 'Cirurgia 70%',
      base: 'pontos' as const,
      procedimento: 1,
      grupo: 2,
      percentualPago: 120,
      percentualDesconto: null,
      valorFixo: null,
      valorPonto: null,
      inicio: '2025-01-15',
      fim: null,
    };
    expect(conferirRegraSus(base)).toEqual(['vigencia', 'percentual', 'valor-ponto', 'alvo-duplo']);
    expect(
      conferirRegraSus({
        ...base,
        procedimento: null,
        percentualPago: 70,
        valorPonto: 0.1,
        inicio: '2025-01-01',
      }),
    ).toEqual([]);
    expect(
      conferirRateioSadt({
        procedimento: null,
        grupo: null,
        usaPeso: true,
        pesoPercentual: null,
        tetoPercentual: 0,
        inicio: '2025-01-01',
        fim: null,
      }),
    ).toEqual(['alvo', 'peso', 'teto']);
  });
  it('bases hospitalar, ambulatorial e total; percentual nulo, ponto e valor fixo ausentes; fração fora de 0 a 1', () => {
    const a = ato({ servicoAmbulatorial: 50 });
    expect(calcularAtoSus(a, regra({ base: 'servico_hospitalar', percentualPago: null })).base).toBe(300);
    expect(calcularAtoSus(a, regra({ base: 'servico_ambulatorial' })).repasse).toBe(35);
    expect(calcularAtoSus(a, regra({ base: 'total', percentualPago: 50 })).repasse).toBe(200);
    expect(calcularAtoSus(a, regra({ base: 'pontos', percentualPago: null })).base).toBe(0);
    expect(calcularAtoSus(a, regra({ base: 'valor_fixo', percentualPago: 50 })).repasse).toBe(0);
    expect(calcularAtoSus(ato({ fracaoAprovada: 2 }), regra({})).glosa).toBe(0);
    expect(calcularAtoSus(ato({ fracaoAprovada: -1 }), regra({})).repasse).toBe(0);
  });

  it('conferências: código, descrição, fim antes do início, desconto, valor fixo, peso e vigência do rateio', () => {
    const base = {
      codigo: 'código com espaço',
      descricao: 'ab',
      base: 'valor_fixo' as const,
      procedimento: null,
      grupo: 3,
      percentualPago: null,
      percentualDesconto: -1,
      valorFixo: 0,
      valorPonto: null,
      inicio: '2025-02-01',
      fim: '2025-01-31',
    };
    expect(conferirRegraSus(base)).toEqual(['codigo', 'descricao', 'vigencia', 'percentual', 'valor-fixo']);
    expect(conferirRegraSus({ ...base, codigo: 'X', descricao: 'd'.repeat(151), fim: null })).toEqual([
      'descricao',
      'percentual',
      'valor-fixo',
    ]);
    expect(
      conferirRegraSus({ ...base, codigo: 'X', descricao: 'Fixo', percentualDesconto: 101, valorFixo: 5 }),
    ).toEqual(['vigencia', 'percentual']);
    const rat = {
      procedimento: 7,
      grupo: null,
      usaPeso: true,
      pesoPercentual: 101,
      tetoPercentual: 101,
      inicio: '2025-02-01',
      fim: '2025-01-31',
    };
    expect(conferirRateioSadt(rat)).toEqual(['peso', 'teto', 'vigencia']);
    expect(
      conferirRateioSadt({ ...rat, pesoPercentual: 0, tetoPercentual: 50, inicio: '2025-02-15', fim: null }),
    ).toEqual(['peso', 'vigencia']);
    expect(conferirRateioSadt({ ...rat, usaPeso: false, tetoPercentual: null, fim: '2025-03-31' })).toEqual(
      [],
    );
  });
});
