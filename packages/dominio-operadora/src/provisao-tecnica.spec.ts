import { describe, expect, it } from 'vitest';
import {
  balanceteNoPadraoAns,
  baseDaCompetencia,
  calcularProvisoesTecnicas,
  conferirAcaoProvisao,
  type ContaPadraoAns,
  type EntradaProvisaoTecnica,
  type MapaContaAns,
  partidasDaProvisao,
  peonaMetodologiaAns,
  problemasDaContaPadraoAns,
  problemasDoMapaAns,
} from './provisao-tecnica.js';

const conta = (codigo: string, tipo: 'sintetica' | 'analitica', extra: Partial<ContaPadraoAns> = {}): ContaPadraoAns => ({
  codigo,
  descricao: `Conta ${codigo}`,
  tipo,
  natureza: tipo === 'analitica' ? 'devedora' : null,
  modalidades: null,
  vigenciaInicio: '2023-01-01',
  vigenciaFim: null,
  versaoFonte: 'RN528',
  ...extra,
});
const plano = [
  conta('1', 'sintetica'),
  conta('12', 'sintetica'),
  conta('121', 'analitica'),
  conta('2', 'sintetica'),
  conta('21', 'sintetica'),
  conta('211', 'analitica', { natureza: 'credora' }),
  conta('212', 'analitica', { natureza: 'credora', modalidades: ['seguradora'] }),
];

describe('plano de contas padrão da ANS', () => {
  it('exige conta-mãe sintética, código numérico e não repete na vigência', () => {
    expect(problemasDaContaPadraoAns(conta('1211', 'analitica'), plano).map((p) => p.codigo)).toEqual([
      'superior-analitica',
    ]);
    expect(problemasDaContaPadraoAns(conta('31', 'sintetica'), plano)[0]?.codigo).toBe('sem-superior');
    expect(problemasDaContaPadraoAns(conta('12A', 'sintetica'), plano)[0]?.codigo).toBe('codigo-invalido');
    expect(problemasDaContaPadraoAns(conta('121', 'analitica'), plano)[0]?.codigo).toBe('conta-repetida');
    expect(
      problemasDaContaPadraoAns(conta('121', 'analitica', { vigenciaInicio: '2027-01-01' }), [
        conta('121', 'analitica', { vigenciaFim: '2026-12-31' }),
        ...plano.filter((c) => c.codigo !== '121'),
      ]),
    ).toEqual([]);
    expect(problemasDaContaPadraoAns(conta('122', 'analitica', { natureza: null }), plano)[0]?.codigo).toBe(
      'sem-natureza',
    );
  });
});

describe('mapa da conta própria para a ANS', () => {
  const c211 = plano.find((c) => c.codigo === '211') ?? null;
  const m = (contaAns: string, duplica = false): MapaContaAns => ({
    contaContabil: 7,
    contaAns,
    duplicaValor: duplica,
    vigenciaInicio: '2026-01-01',
    vigenciaFim: null,
  });
  const propria = { id: 7, tipo: 'analitica', ativo: true };
  it('liga só conta analítica, aplicável à modalidade, uma vez por vigência', () => {
    expect(problemasDoMapaAns(m('211'), c211, propria, 'medicina_grupo', [])).toEqual([]);
    expect(problemasDoMapaAns(m('21'), plano[4] ?? null, propria, 'medicina_grupo', [])[0]?.codigo).toBe(
      'conta-ans-sintetica',
    );
    expect(problemasDoMapaAns(m('212'), plano[6] ?? null, propria, 'medicina_grupo', [])[0]?.codigo).toBe(
      'modalidade-nao-aplicavel',
    );
    expect(problemasDoMapaAns(m('211'), c211, { ...propria, tipo: 'sintetica' }, 'medicina_grupo', [])[0]?.codigo).toBe(
      'conta-propria-sintetica',
    );
    expect(problemasDoMapaAns(m('211'), c211, propria, 'medicina_grupo', [m('211')])[0]?.codigo).toBe('mapa-repetido');
    expect(problemasDoMapaAns(m('211'), c211, propria, 'medicina_grupo', [m('121')])[0]?.codigo).toBe('conta-ja-mapeada');
    expect(problemasDoMapaAns(m('211', true), c211, propria, 'medicina_grupo', [m('121')])).toEqual([]);
  });
});

describe('balancete no padrão da ANS', () => {
  it('soma as contas próprias nas analíticas e sobe às sintéticas, e lista as sem mapa', () => {
    const mapas: MapaContaAns[] = [
      { contaContabil: 1, contaAns: '121', duplicaValor: false, vigenciaInicio: '2026-01-01', vigenciaFim: null },
      { contaContabil: 2, contaAns: '121', duplicaValor: false, vigenciaInicio: '2026-01-01', vigenciaFim: null },
      { contaContabil: 3, contaAns: '211', duplicaValor: false, vigenciaInicio: '2026-01-01', vigenciaFim: null },
    ];
    const b = balanceteNoPadraoAns(
      [
        { contaContabil: 1, classificacao: '1.1.01', saldoCentavos: 70000 },
        { contaContabil: 2, classificacao: '1.1.02', saldoCentavos: 30000 },
        { contaContabil: 3, classificacao: '2.1.01', saldoCentavos: -100000 },
        { contaContabil: 9, classificacao: '9.9.99', saldoCentavos: 500 },
      ],
      mapas,
      plano,
      '2026-03-31',
    );
    expect(b.linhas.map((l) => [l.codigo, l.saldoCentavos])).toEqual([
      ['1', 100000],
      ['12', 100000],
      ['121', 100000],
      ['2', -100000],
      ['21', -100000],
      ['211', -100000],
    ]);
    expect(b.linhas.find((l) => l.codigo === '121')?.parcelas.length).toBe(2);
    expect(b.semMapa.map((s) => s.contaContabil)).toEqual([9]);
    expect(b.diferencaCentavos).toBe(0);
  });
});

describe('provisões técnicas', () => {
  const base: EntradaProvisaoTecnica = {
    competencia: '2026-03-01',
    metodo: 'metodologia_ans',
    contas: { peona: 11, pesl: 12, remissao: 13 },
    base: { contraprestacoesCentavos: 120_000_00, eventosCentavos: 90_000_00, avisadosNaoPagosCentavos: 4_321_00 },
    informados: [{ tipo: 'remissao', valorCentavos: 500_00, observacao: null }],
    notaTecnica: null,
    anteriores: { peona: 9_000_00 },
  };
  it('base de 12 meses até o fim da competência', () => {
    expect(baseDaCompetencia('2026-03-01')).toEqual({ inicio: '2025-04-01', fim: '2026-03-31' });
  });
  it('PEONA: a maior entre 8,5% das contraprestações e 10% dos eventos', () => {
    expect(peonaMetodologiaAns(base.base).valorCentavos).toBe(10_200_00);
    expect(peonaMetodologiaAns({ ...base.base, eventosCentavos: 150_000_00 }).valorCentavos).toBe(15_000_00);
  });
  it('metodologia da ANS: PEONA e PESL calculadas, remissão informada, com memória e total', () => {
    const r = calcularProvisoesTecnicas(base);
    expect(r.problemas).toEqual([]);
    expect(r.itens.map((i) => [i.sequencia, i.tipo, i.conta, i.valorCentavos, i.anteriorCentavos])).toEqual([
      [1, 'peona', 11, 10_200_00, 9_000_00],
      [2, 'pesl', 12, 4_321_00, null],
      [3, 'remissao', 13, 500_00, null],
    ]);
    expect(r.totalCentavos).toBe(15_021_00);
    expect(r.memoria).toContain('10200.00 + 4321.00 + 500.00 = 15021.00');
  });
  it('recusa conta faltando, PEONA informada na metodologia e nota técnica sem referência', () => {
    expect(calcularProvisoesTecnicas({ ...base, contas: { peona: 11 } }).problemas[0]?.campo).toBe('contas.pesl');
    expect(
      calcularProvisoesTecnicas({ ...base, informados: [{ tipo: 'peona', valorCentavos: 1, observacao: null }] })
        .problemas[0]?.codigo,
    ).toBe('calculado-pelo-sistema');
    const atuarial = { ...base, metodo: 'nota_tecnica_atuarial' as const, informados: [{ tipo: 'peona' as const, valorCentavos: 8_000_00, observacao: null }] };
    expect(calcularProvisoesTecnicas(atuarial).problemas[0]?.codigo).toBe('sem-nota-tecnica');
    const ok = calcularProvisoesTecnicas({ ...atuarial, notaTecnica: 'NTA 12/2026' });
    expect(ok.itens.map((i) => [i.tipo, i.valorCentavos])).toEqual([['peona', 8_000_00]]);
    expect(ok.itens[0]?.memoria).toContain('NTA 12/2026');
  });
  it('ciclo e partidas da variação', () => {
    expect(conferirAcaoProvisao('calculada', 'contabilizar')).toEqual([]);
    expect(conferirAcaoProvisao('contabilizada', 'calcular')[0]?.codigo).toBe('situacao-nao-permite');
    const p = partidasDaProvisao(
      [
        { tipo: 'peona', contaClassificacao: '2.1.1', valorCentavos: 10_200_00, anteriorCentavos: 9_000_00 },
        { tipo: 'pesl', contaClassificacao: '2.1.2', valorCentavos: 1_000_00, anteriorCentavos: 1_500_00 },
        { tipo: 'pic', contaClassificacao: '2.1.3', valorCentavos: 100, anteriorCentavos: 100 },
      ],
      '4.1.1',
      '3.9.1',
      '03/2026',
    );
    expect(p.map((x) => [x.lado, x.conta, x.valorCentavos])).toEqual([
      ['D', '4.1.1', 1_200_00],
      ['C', '2.1.1', 1_200_00],
      ['D', '2.1.2', 500_00],
      ['C', '3.9.1', 500_00],
    ]);
  });
});
