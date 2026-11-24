import { describe, expect, it } from 'vitest';
import {
  itensDoFiltro,
  montarComparativo,
  situacaoDoValor,
  tendenciaDe,
  validarFiltroResultado,
  validarGrupoResultado,
  type ValorComparativo,
} from './grupos-resultado.js';

const v = (p: Partial<ValorComparativo>): ValorComparativo => ({
  resultado: 1,
  em: '2026-11-20T08:00',
  exame: 10,
  analito: 100,
  nomeAnalito: 'Creatinina',
  sequencia: 1,
  numero: 1,
  texto: null,
  unidade: 'mg/dL',
  refMin: 0.6,
  refMax: 1.2,
  refTexto: null,
  critMin: null,
  critMax: null,
  critico: false,
  preliminar: false,
  ...p,
});

describe('cadastro do grupo comparativo', () => {
  it('aceita grupo com exames distintos', () => {
    expect(
      validarGrupoResultado({
        nome: 'Função renal',
        tipoExame: 'laboratorio',
        itens: [
          { exame: 1, exameAnalito: null, rotulo: null },
          { exame: 2, exameAnalito: 5, rotulo: 'K' },
        ],
      }),
    ).toEqual([]);
  });
  it('recusa grupo vazio, item repetido e analito redundante com o exame inteiro', () => {
    expect(
      validarGrupoResultado({ nome: 'X', tipoExame: 'laboratorio', itens: [] }).map((e) => e.codigo),
    ).toEqual(['nome-invalido', 'grupo-vazio']);
    const e = validarGrupoResultado({
      nome: 'Renal',
      tipoExame: 'laboratorio',
      itens: [
        { exame: 1, exameAnalito: null, rotulo: null },
        { exame: 1, exameAnalito: null, rotulo: null },
        { exame: 1, exameAnalito: 9, rotulo: null },
      ],
    }).map((x) => x.codigo);
    expect(e).toEqual(['item-repetido', 'item-redundante']);
  });
});

describe('filtro salvo', () => {
  const base = {
    nome: 'UTI',
    padrao: true,
    escopo: 'atual' as const,
    incluirPendentes: false,
    somenteLiberados: true,
    somenteMeusPedidos: false,
    periodoDias: 7,
    grupos: [1],
    exames: [],
  };
  it('aceita filtro com grupo e período', () => expect(validarFiltroResultado(base)).toEqual([]));
  it('recusa período fora da faixa, filtro vazio e repetição', () => {
    expect(
      validarFiltroResultado({ ...base, periodoDias: 0, grupos: [], exames: [] }).map((e) => e.codigo),
    ).toEqual(['periodo-invalido', 'filtro-vazio']);
    expect(validarFiltroResultado({ ...base, grupos: [1, 1] }).map((e) => e.codigo)).toEqual([
      'criterio-repetido',
    ]);
  });
});

describe('situação da célula', () => {
  it('faixa numérica do laudo, faixa do texto e sem faixa', () => {
    expect(situacaoDoValor(v({ numero: 2 }))).toBe('acima');
    expect(situacaoDoValor(v({ numero: 0.3 }))).toBe('abaixo');
    expect(situacaoDoValor(v({ numero: 1 }))).toBe('normal');
    expect(situacaoDoValor(v({ refMin: null, refMax: null, refTexto: '< 5', numero: 7 }))).toBe('acima');
    expect(situacaoDoValor(v({ refMin: null, refMax: null, refTexto: 'ver laudo', numero: 7 }))).toBe(
      'sem-faixa',
    );
  });
  it('crítico pela marca do laudo ou pelo limite crítico', () => {
    expect(situacaoDoValor(v({ critico: true }))).toBe('critico');
    expect(situacaoDoValor(v({ numero: 7, critMax: 6.5 }))).toBe('critico');
  });
});

describe('tendência', () => {
  it('pelos dois últimos valores, com 5% de estabilidade', () => {
    expect(tendenciaDe([1])).toEqual({ tendencia: null, variacao: null });
    expect(tendenciaDe([1, 2])).toEqual({ tendencia: 'subindo', variacao: 100 });
    expect(tendenciaDe([2, 1])).toEqual({ tendencia: 'descendo', variacao: -50 });
    expect(tendenciaDe([1, 1.02])).toEqual({ tendencia: 'estavel', variacao: 2 });
  });
});

describe('matriz comparativa', () => {
  it('ordem do grupo, colunas cronológicas, item de analito só com ele, contagens', () => {
    const valores = [
      v({ resultado: 1, em: '2026-11-20T08:00', numero: 1 }),
      v({ resultado: 2, em: '2026-11-21T08:00', numero: 1.8 }),
      v({
        resultado: 1,
        em: '2026-11-20T08:00',
        analito: 101,
        nomeAnalito: 'Ureia',
        sequencia: 2,
        numero: 40,
      }),
      v({
        resultado: 3,
        em: '2026-11-21T09:00',
        exame: 20,
        analito: 200,
        nomeAnalito: 'Potássio',
        numero: 7,
        critMax: 6.5,
        refMin: 3.5,
        refMax: 5,
      }),
      v({ resultado: 3, em: '2026-11-21T09:00', exame: 20, analito: 201, nomeAnalito: 'Sódio', numero: 140 }),
      v({ resultado: 9, em: '2026-11-19T08:00', exame: 99, analito: 999, nomeAnalito: 'Fora' }),
    ];
    const c = montarComparativo(
      [
        { exame: 20, analito: 200, rotulo: 'K' },
        { exame: 10, analito: null, rotulo: 'ignorado no inteiro' },
      ],
      valores,
    );
    expect(c.colunas).toEqual(['2026-11-20T08:00', '2026-11-21T08:00', '2026-11-21T09:00']);
    expect(c.linhas.map((l) => l.rotulo)).toEqual(['K', 'Creatinina', 'Ureia']);
    expect(c.linhas[1]!.celulas.map((x) => x.situacao)).toEqual(['normal', 'acima']);
    expect(c.linhas[1]!.tendencia).toBe('subindo');
    expect(c.linhas[1]!.faixa).toBe('0.6 a 1.2 mg/dL');
    expect(c.criticos).toBe(1);
    expect(c.foraDaFaixa).toBe(2); // creatinina 1,8 e ureia 40 (faixa do laudo da massa)
  });
  it('valor preliminar na última coluna não move a tendência nem entra nas contagens', () => {
    const c = montarComparativo(
      [{ exame: 30, analito: null, rotulo: null }],
      [
        v({ resultado: 1, exame: 30, em: '2026-11-18T08:00', numero: 4, refMin: 3.5, refMax: 5.1 }),
        v({
          resultado: 2,
          exame: 30,
          em: '2026-11-19T08:00',
          numero: 7,
          refMin: 3.5,
          refMax: 5.1,
          critMax: 6.5,
        }),
        v({
          resultado: 3,
          exame: 30,
          em: '2026-11-20T08:00',
          numero: 5.9,
          refMin: 3.5,
          refMax: 5.1,
          critMax: 6.5,
          preliminar: true,
        }),
      ],
    );
    const l = c.linhas[0]!;
    expect(l.celulas.map((x) => x.preliminar)).toEqual([false, false, true]);
    expect(l.celulas[2]!.situacao).toBe('acima');
    // Liberados: 4 → 7, subindo 75%; o 5,9 preliminar não vira "descendo".
    expect(l.tendencia).toBe('subindo');
    expect(l.variacao).toBe(75);
    expect(c.criticos).toBe(1);
    expect(c.foraDaFaixa).toBe(0);
  });

  it('itens do filtro: grupos em ordem e exames avulsos sem repetir', () => {
    expect(itensDoFiltro([[{ exame: 1, analito: null, rotulo: null }]], [1, 2]).map((i) => i.exame)).toEqual([
      1, 2,
    ]);
  });
});
