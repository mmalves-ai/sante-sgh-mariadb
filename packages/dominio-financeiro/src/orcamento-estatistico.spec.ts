import { describe, expect, it } from 'vitest';
import {
  type CelulaDoPainel,
  type IndicadorDoPainel,
  type IndicadorOrcamentarioEntrada,
  lerQuantidade,
  mesesDaVigencia,
  montarPainelIndicadores,
  projetarQuantidades,
  quantidadeTexto,
  somarMeses,
  validarCelulasEstatisticas,
  validarIndicadorOrcamentario,
} from './orcamento-estatistico.js';

const ind = (x: Partial<IndicadorOrcamentarioEntrada> = {}): IndicadorOrcamentarioEntrada => ({
  codigo: 'DIARIAS',
  descricao: 'Pacientes-dia',
  grupoId: null,
  tipoDadoId: 3,
  unidade: 'pacientes-dia',
  visao: 'acumulado',
  tipoProjecao: 'media',
  mesesProjecao: 6,
  observacao: null,
  ativo: true,
  ...x,
});
const campos = (f: { campo: string }[]) => f.map((x) => x.campo);

describe('cadastro do indicador orçamentário', () => {
  it('aceita o indicador completo', () => {
    expect(validarIndicadorOrcamentario(ind())).toEqual([]);
    expect(validarIndicadorOrcamentario(ind({ tipoProjecao: 'nenhuma', tipoDadoId: null }))).toEqual([]);
  });
  it('recusa código, descrição, meses e projeção sem dado estatístico', () => {
    expect(campos(validarIndicadorOrcamentario(ind({ codigo: ' ', descricao: 'ab' })))).toEqual([
      'codigo',
      'descricao',
    ]);
    expect(campos(validarIndicadorOrcamentario(ind({ mesesProjecao: null })))).toEqual(['mesesProjecao']);
    expect(campos(validarIndicadorOrcamentario(ind({ mesesProjecao: 40 })))).toEqual(['mesesProjecao']);
    expect(
      campos(validarIndicadorOrcamentario(ind({ tipoProjecao: 'tendencia', mesesProjecao: 1 }))),
    ).toEqual(['mesesProjecao']);
    expect(campos(validarIndicadorOrcamentario(ind({ tipoDadoId: null })))).toEqual(['tipoDadoId']);
  });
});

describe('competência e células', () => {
  it('soma meses e lista a vigência', () => {
    expect(somarMeses('2033-11', 3)).toBe('2034-02');
    expect(somarMeses('2033-01', -12)).toBe('2032-01');
    expect(mesesDaVigencia('2033-01', '2033-12')).toHaveLength(12);
    expect(mesesDaVigencia('2033-05', '2033-01')).toEqual([]);
  });
  it('valida as células contra a vigência, repetição e faixa', () => {
    const v = { inicio: '2033-01', fim: '2033-12' };
    expect(
      validarCelulasEstatisticas(
        [
          { competencia: '2033-01', quantidadeCent: 12_000, projetadaCent: 11_000 },
          { competencia: '2033-02', quantidadeCent: null, projetadaCent: null },
        ],
        v,
      ),
    ).toEqual([]);
    expect(validarCelulasEstatisticas([], v)).toHaveLength(1);
    const f = validarCelulasEstatisticas(
      [
        { competencia: '2034-01', quantidadeCent: 1, projetadaCent: null },
        { competencia: '2033-03', quantidadeCent: -1, projetadaCent: null },
        { competencia: '2033-03', quantidadeCent: 1.5, projetadaCent: null },
        { competencia: '2033-13', quantidadeCent: 1, projetadaCent: null },
      ],
      v,
    );
    expect(f.map((x) => x.mensagem)).toEqual([
      'O mês está fora da vigência da versão.',
      'A quantidade vai de zero a 10 bilhões, com até 2 casas.',
      'O mês aparece duas vezes.',
      'A quantidade vai de zero a 10 bilhões, com até 2 casas.',
      'Mês inválido (use AAAA-MM).',
    ]);
  });
  it('lê e escreve a quantidade sem ponto flutuante', () => {
    expect(lerQuantidade('1.234,5')).toBe(123_450);
    expect(lerQuantidade('120')).toBe(12_000);
    expect(lerQuantidade('')).toBeNull();
    expect(lerQuantidade('-3')).toBe('invalida');
    expect(lerQuantidade('1,234')).toBe('invalida');
    expect(quantidadeTexto(123_450)).toBe('1.234,50');
    expect(quantidadeTexto(120_000)).toBe('1.200');
  });
});

describe('projeção a partir do realizado', () => {
  const real = [
    { competencia: '2032-01', cent: 10_000 },
    { competencia: '2032-10', cent: 10_000 },
    { competencia: '2032-11', cent: 12_000 },
    { competencia: '2032-12', cent: 14_000 },
    { competencia: '2033-01', cent: 99_900 }, // dentro do período alvo: não entra na base
  ];
  const alvo = ['2033-01', '2033-02'];
  it('média, último mês e mesmo mês do ano anterior', () => {
    expect([...projetarQuantidades('media', real, alvo, 3).values()]).toEqual([12_000, 12_000]);
    expect([...projetarQuantidades('ultimo_mes', real, alvo, 3).values()]).toEqual([14_000, 14_000]);
    expect([...projetarQuantidades('mesmo_mes_ano_anterior', real, alvo, null).values()]).toEqual([
      10_000,
      null,
    ]);
    expect([...projetarQuantidades('nenhuma', real, alvo, 3).values()]).toEqual([null, null]);
    expect([...projetarQuantidades('media', [], alvo, 3).values()]).toEqual([null, null]);
  });
  it('tendência pela reta dos mínimos quadrados, nunca negativa', () => {
    expect([...projetarQuantidades('tendencia', real, alvo, 3).values()]).toEqual([16_000, 18_000]);
    const caindo = [
      { competencia: '2032-11', cent: 2_000 },
      { competencia: '2032-12', cent: 1_000 },
    ];
    expect([...projetarQuantidades('tendencia', caindo, ['2033-06'], 2).values()]).toEqual([0]);
  });
});

describe('painel dos indicadores orçado × realizado', () => {
  const grupo = { id: 1, codigo: 'INTERN', descricao: 'Internação' };
  const indicadores: IndicadorDoPainel[] = [
    { id: 10, codigo: 'DIARIAS', descricao: 'Diárias', unidade: 'pacientes-dia', visao: 'acumulado', grupo },
    { id: 11, codigo: 'EXAMES', descricao: 'Exames', unidade: 'exames', visao: 'mensal', grupo: null },
    { id: 12, codigo: 'OCUP', descricao: 'Ocupação média', unidade: null, visao: 'media', grupo },
  ];
  const c = (
    indicadorId: number,
    centroId: number,
    competencia: string,
    orcadoCent: number,
    realizadoCent: number | null,
  ): CelulaDoPainel => ({ indicadorId, centroId, competencia, orcadoCent, realizadoCent });
  const celulas = [
    c(10, 1, '2033-01', 10_000, 11_000),
    c(10, 1, '2033-02', 10_000, 9_000),
    c(10, 2, '2033-01', 5_000, 5_000),
    c(10, 2, '2033-03', 5_000, null),
    c(11, 1, '2033-02', 40_000, 30_000),
    c(11, 1, '2033-01', 1_000, 1_000),
    c(12, 1, '2033-01', 8_000, 7_000),
    c(12, 1, '2033-02', 6_000, null),
  ];
  const nome = (id: number) => (id === 1 ? 'UTI' : 'Clínica');
  const painel = montarPainelIndicadores(indicadores, celulas, '2033-02', nome);

  it('agrupa pelo grupo e deixa o sem grupo por último', () => {
    expect(
      painel.map((g) => [g.grupo?.codigo ?? null, g.indicadores.map((i) => i.indicador.codigo)]),
    ).toEqual([
      ['INTERN', ['DIARIAS', 'OCUP']],
      [null, ['EXAMES']],
    ]);
  });
  it('acumulado até o mês, com as parcelas por setor e o atingimento', () => {
    const d = painel[0]!.indicadores[0]!;
    expect(d).toMatchObject({
      orcadoCent: 25_000,
      realizadoCent: 25_000,
      desvioCent: 0,
      atingimentoDecimos: 1000,
      situacao: 'no_orcado',
    });
    expect(d.porSetor.map((s) => [s.centroId, s.orcadoCent, s.realizadoCent, s.situacao])).toEqual([
      [1, 20_000, 20_000, 'no_orcado'],
      [2, 5_000, 5_000, 'no_orcado'],
    ]);
    expect(d.conta).toBe('orçado 250 = UTI 200 + Clínica 50; realizado 250 = UTI 200 + Clínica 50');
  });
  it('mensal só o mês e média só os meses com orçado', () => {
    const e = painel[1]!.indicadores[0]!;
    expect([e.orcadoCent, e.realizadoCent, e.atingimentoDecimos, e.situacao]).toEqual([
      40_000,
      30_000,
      750,
      'abaixo',
    ]);
    // Média: compara só os meses apurados (janeiro 80 × 70); o orçado médio do período (80 e 60) fica à parte.
    const o = painel[0]!.indicadores[1]!;
    expect([o.orcadoCent, o.realizadoCent, o.atingimentoDecimos, o.situacao, o.orcadoPeriodoCent]).toEqual([
      8_000,
      7_000,
      875,
      'abaixo',
      7_000,
    ]);
  });
  it('acumulado com mês ainda não apurado compara só os meses com realizado', () => {
    const p = montarPainelIndicadores(
      indicadores.slice(0, 1),
      [
        c(10, 1, '2033-01', 21_000, 21_000),
        c(10, 1, '2033-02', 18_000, null),
        c(10, 2, '2033-02', 6_000, null),
      ],
      '2033-02',
      nome,
    );
    const d = p[0]!.indicadores[0]!;
    expect([d.orcadoCent, d.realizadoCent, d.atingimentoDecimos, d.situacao, d.orcadoPeriodoCent]).toEqual([
      21_000,
      21_000,
      1000,
      'no_orcado',
      45_000,
    ]);
    expect(d.porSetor.map((s) => [s.centroId, s.orcadoCent, s.orcadoPeriodoCent, s.situacao])).toEqual([
      [1, 21_000, 39_000, 'no_orcado'],
      [2, 6_000, 6_000, 'sem_realizado'],
    ]);
    expect(d.conta).toBe(
      'orçado 210 = UTI 210; realizado 210 = UTI 210; comparado só nos meses apurados (orçado do período 450 = UTI 390 + Clínica 60)',
    );
  });
  it('sem realizado e sem orçado no período', () => {
    const p = montarPainelIndicadores(indicadores.slice(0, 1), [c(10, 2, '2033-03', 5_000, null)], '2033-03');
    expect(p[0]!.indicadores[0]!).toMatchObject({ situacao: 'sem_realizado', realizadoCent: null });
    const q = montarPainelIndicadores(indicadores.slice(1, 2), [c(11, 1, '2033-01', 1, 1)], '2033-03');
    expect(q[0]!.indicadores[0]!).toMatchObject({ situacao: 'sem_orcado', conta: 'sem orçado no período' });
  });
});
