// M53-F7: a RAIS do ano-base (551 posições; 12 remunerações, 13º por parcela, desligamento; pendências) e a soma das
// remunerações do período. Dados sintéticos.
import { describe, expect, it } from 'vitest';
import { ficha } from '../esocial/fixtures-esocial.spec-util.js';
import { catalogos, empresa, NIS, trab } from './fixtures-obrigacoes.spec-util.js';
import { campoDaLinha, tamanhoDoLeiaute } from './leiaute-fixo.js';
import { type EntradaRais, LEIAUTE_RAIS, montarRais, pendenciasRais } from './rais.js';
import { remuneracoesDoPeriodo, totaisDaObrigacao } from './remuneracao.js';

const processos = [
  { id: 1, tipo: 'mensal' as const, competencia: '2018-01' },
  { id: 2, tipo: 'mensal' as const, competencia: '2018-02' },
  { id: 3, tipo: 'decimo1' as const, competencia: '2018-11' },
  { id: 4, tipo: 'decimo2' as const, competencia: '2018-12' },
  { id: 5, tipo: 'rescisao' as const, competencia: '2018-02' },
  { id: 6, tipo: 'mensal' as const, competencia: '2017-12' },
];
const resumos = new Map([
  [1, [{ vinculo: 1, porPapel: { baseFgts: 300_000, fgts: 24_000 } }]],
  [2, [{ vinculo: 1, porPapel: { baseFgts: 310_000, fgts: 24_800 } }]],
  [3, [{ vinculo: 1, porPapel: { baseFgts: 150_000, fgts: 12_000 } }]],
  [4, [{ vinculo: 1, porPapel: { baseFgts: 150_000 } }]],
  [5, [{ vinculo: 2, porPapel: { baseFgts: 50_000, fgts: 4_000, multaFgts: 20_000 } }]],
  [6, [{ vinculo: 1, porPapel: { baseFgts: 1 } }]],
]);
const meses = Array.from({ length: 12 }, (_, i) => `2018-${String(i + 1).padStart(2, '0')}`);

const entrada = (over: Partial<EntradaRais> = {}): EntradaRais => ({
  anoBase: '2018',
  empresa,
  trabalhadores: [
    trab({
      vinculo: 2,
      admissao: '2016-01-04',
      desligamento: '2018-02-10',
      modalidadeRescisao: 'pedido-demissao',
    }),
    trab({ vinculo: 1 }),
  ],
  remuneracoes: remuneracoesDoPeriodo(meses, processos, resumos),
  catalogos,
  hoje: '2026-10-28',
  ...over,
});

describe('remunerações do período', () => {
  it('por mês sem o 13º, o 13º por parcela com o mês, FGTS e rescisório; fora do período não entra', () => {
    const r = remuneracoesDoPeriodo(meses, processos, resumos);
    expect(r.get(1)).toEqual({
      vinculo: 1,
      remuneracao: 610_000,
      remuneracaoDecimo: 300_000,
      fgts: 60_800,
      rescisorio: 0,
      porMes: { '2018-01': 300_000, '2018-02': 310_000 },
      decimoAdiantamento: { valor: 150_000, mes: 11 },
      decimoFinal: { valor: 150_000, mes: 12 },
    });
    expect(r.get(2)!.rescisorio).toBe(20_000);
    const t = totaisDaObrigacao(entrada().trabalhadores, r, (x) => ({
      admitido: x.admissao.startsWith('2018'),
      desligado: !!x.desligamento,
    }));
    expect(t).toEqual({
      trabalhadores: 2,
      remuneracao: 660_000,
      remuneracaoDecimo: 300_000,
      baseFgts: 960_000,
      fgts: 64_800,
      rescisorio: 20_000,
      admissoes: 0,
      desligamentos: 1,
    });
    expect(
      totaisDaObrigacao([trab({ vinculo: 99 })], r, () => ({ admitido: true, desligado: false })),
    ).toMatchObject({
      remuneracao: 0,
      admissoes: 1,
    });
  });
});

describe('leiaute da RAIS', () => {
  it('registros de 551 posições', () => {
    for (const l of Object.values(LEIAUTE_RAIS)) expect(tamanhoDoLeiaute(l)).toBe(551);
  });

  it('0, 1, um 2 por empregado (em ordem de vínculo) e 9 com os totais', () => {
    const a = montarRais(entrada());
    expect(a.nomeArquivo).toBe('RAIS2018.txt');
    const ls = a.conteudo.split('\r\n').filter(Boolean);
    expect(ls.map((l) => l.slice(22, 23))).toEqual(['0', '1', '2', '2', '9']);
    for (const l of ls) expect(l).toHaveLength(551);
    const L = LEIAUTE_RAIS;
    expect(campoDaLinha(L['1'], ls[1]!, 'anoBase')).toBe('2018');
    expect(campoDaLinha(L['1'], ls[1]!, 'tipoRais')).toBe('0');
    expect(campoDaLinha(L['0'], ls[0]!, 'dataGeracao')).toBe('28102026');
    expect(campoDaLinha(L['2'], ls[2]!, 'nis')).toBe(NIS);
    expect(campoDaLinha(L['2'], ls[2]!, 'rem01')).toBe('000300000');
    expect(campoDaLinha(L['2'], ls[2]!, 'rem02')).toBe('000310000');
    expect(campoDaLinha(L['2'], ls[2]!, 'rem03')).toBe('000000000');
    expect(campoDaLinha(L['2'], ls[2]!, 'decimoAdiantamento')).toBe('000150000');
    expect(campoDaLinha(L['2'], ls[2]!, 'mesFinal')).toBe('12');
    expect(campoDaLinha(L['2'], ls[2]!, 'vinculo')).toBe('10');
    expect(campoDaLinha(L['2'], ls[2]!, 'causaDesligamento')).toBe('00');
    expect(campoDaLinha(L['2'], ls[3]!, 'causaDesligamento')).toBe('21');
    expect(campoDaLinha(L['2'], ls[3]!, 'dataDesligamento')).toBe('1002');
    expect(campoDaLinha(L['2'], ls[3]!, 'multaRescisao')).toBe('00020000');
    expect(campoDaLinha(L['9'], ls[4]!, 'totalRegistros2')).toBe('000002');
    expect(campoDaLinha(L['9'], ls[4]!, 'sequencia')).toBe('000005');
  });

  it('sem empregados: RAIS negativa; sem remuneração, CPF ou salário: zeros', () => {
    const neg = montarRais(entrada({ trabalhadores: [] })).conteudo.split('\r\n');
    expect(campoDaLinha(LEIAUTE_RAIS['1'], neg[1]!, 'tipoRais')).toBe('1');
    const z = montarRais(
      entrada({ trabalhadores: [trab({ vinculo: 50, cpf: null, salario: null })], remuneracoes: new Map() }),
    ).conteudo.split('\r\n');
    expect(campoDaLinha(LEIAUTE_RAIS['2'], z[2]!, 'cpf')).toBe('0'.repeat(11));
    expect(campoDaLinha(LEIAUTE_RAIS['2'], z[2]!, 'salario')).toBe('0'.repeat(9));
    expect(campoDaLinha(LEIAUTE_RAIS['2'], z[2]!, 'mesAdiantamento')).toBe('00');
  });
});

describe('pendências da RAIS', () => {
  it('ficha, NIS, CBO, vínculo e desligamento sem correspondência, código fora do catálogo', () => {
    expect(pendenciasRais(entrada())).toEqual([]);
    const ps = pendenciasRais(
      entrada({
        trabalhadores: [
          trab({ vinculo: 1, ficha: null }),
          trab({ vinculo: 2, ficha: { ...ficha, nis: null, cboCargo: null } }),
          trab({ vinculo: 3, ficha: { ...ficha, nis: NIS, categoria: '901' } }),
          trab({ vinculo: 4, desligamento: '2018-06-01', modalidadeRescisao: null }),
          trab({ vinculo: 5, desligamento: '2018-06-01', modalidadeRescisao: 'falecimento' }),
          trab({ vinculo: 6, ficha: { ...ficha, nis: NIS, categoria: '103' } }),
          trab({ vinculo: 7, ficha: { ...ficha, nis: NIS, tipoAdmissao: 2 } }),
        ],
        catalogos: {
          vinculosRais: new Set(['10']),
          desligamentosRais: new Set(['11']),
          admissoesRais: new Set(['2']),
        },
      }),
    );
    expect(ps.map((p) => [p.codigo, p.vinculos])).toEqual([
      ['sem-ficha', [1]],
      ['sem-nis', [2]],
      ['sem-cbo', [2]],
      ['categoria-sem-correspondencia', [3, 4]],
      ['codigo-fora-do-catalogo', [5, 6, 7]],
    ]);
  });
});
