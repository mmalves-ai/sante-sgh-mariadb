import { describe, expect, it } from 'vitest';
import { estornoDe } from './derivacao.js';
import { fato, PLANO, regra } from './fixtures.spec-util.js';
import {
  contextoDeAplicacao,
  fatosAtivos,
  fatosParaGravar,
  impressaoSemColisao,
  simularRegra,
} from './registro.js';

const ITENS = [
  {
    convenio: 5,
    tipoConta: 'A',
    tipoLancamento: null,
    tipoAto: null,
    subtipoDiaria: null,
    contaExportacao: 1101,
  },
  {
    convenio: 5,
    tipoConta: 'A',
    tipoLancamento: 2,
    tipoAto: null,
    subtipoDiaria: null,
    contaExportacao: 9999,
  },
  {
    convenio: 6,
    tipoConta: 'A',
    tipoLancamento: null,
    tipoAto: null,
    subtipoDiaria: null,
    contaExportacao: null,
  },
  {
    convenio: null,
    tipoConta: 'A',
    tipoLancamento: 3,
    tipoAto: null,
    subtipoDiaria: null,
    contaExportacao: 1102,
  },
];

describe('registro dos fatos', () => {
  it('ativo é o fato não estornado que nenhum estorno referencia', () => {
    const a = fato({ impressao: 'A' });
    const b = fato({ impressao: 'B', valorCentavos: 10 });
    const ea = estornoDe(a, '2027-02-01', null);
    expect(fatosAtivos([a, ea, b])).toEqual([b]);
    expect(fatosAtivos([a])).toEqual([a]);
    // O estorno de outra linha não desliga o fato desta.
    expect(fatosAtivos([a, { ...ea, id: 99 }])).toEqual([a]);
  });

  it('reocorrência (A → B → A) ganha impressão nova, estável e sem colisão', () => {
    const a = fato({ impressao: 'A' });
    expect(impressaoSemColisao(a, new Set())).toBe('A');
    const i2 = impressaoSemColisao(a, new Set(['A']));
    expect(i2).not.toBe('A');
    expect(impressaoSemColisao(a, new Set(['A']))).toBe(i2);
    expect(impressaoSemColisao(a, new Set(['A', i2]))).not.toBe(i2);
  });

  it('fatos para gravar: a colisão é por linha, tipo e lado; dois novos iguais no mesmo lote também não colidem', () => {
    const a = fato({ impressao: 'A' });
    const ea = { ...estornoDe(a, '2027-02-01', null), impressao: 'A' };
    const [x, y, z] = fatosParaGravar([a, a, ea], [a]);
    expect(x!.impressao).not.toBe('A');
    expect(y!.impressao).not.toBe(x!.impressao);
    // O estorno é outro lado: a mesma impressão não colide com o fato.
    expect(z!.impressao).toBe('A');
    expect(fatosParaGravar([a], [])[0]).toBe(a);
  });
});

describe('contexto de aplicação e simulação', () => {
  it('de-para por convênio (sem detalhe) e por tipo de lançamento (sem convênio); a primeira linha vale', () => {
    const c = contextoDeAplicacao(PLANO, ITENS);
    expect(c.dePara.get('convenio|5')?.contaExportacao).toBe(1101);
    expect(c.dePara.get('convenio|6')?.contaExportacao).toBeNull();
    expect(c.dePara.get('tipoLancamento|3')?.contaExportacao).toBe(1102);
    expect(c.dePara.has('tipoLancamento|2')).toBe(false);
    expect(c.chaveDoCampo('convenio', fato())).toBe('convenio|5');
    expect(c.chaveDoCampo('naoExiste', fato())).toBe('naoExiste|');
  });

  it('no formato do pc (colunas NOT NULL, 0 é sem detalhe): o nível do convênio é a linha sem ato nem subtipo', () => {
    const linha = (convenio: number, tl: number, ato: number, sub: number, conta: number | null) => ({
      convenio,
      tipoConta: 'A',
      tipoLancamento: tl,
      tipoAto: ato,
      subtipoDiaria: sub,
      contaExportacao: conta,
    });
    const c = contextoDeAplicacao(PLANO, [
      linha(5, 1, 10, 1, 7001), // ato e subtipo: detalhe, não é o nível do convênio
      linha(5, 1, 0, 0, 1101),
      linha(5, 3, 0, 0, 9999), // a segunda linha do mesmo convênio não vence
      linha(6, 3, 4, 0, 7002),
      linha(7, 0, 0, 0, 1103), // a linha toda sem detalhe vence a com tipo de lançamento
      linha(7, 1, 0, 0, 9998),
    ]);
    expect(c.dePara.get('convenio|5')?.contaExportacao).toBe(1101);
    expect(c.dePara.has('convenio|6')).toBe(false);
    expect(c.dePara.get('convenio|7')?.contaExportacao).toBe(1103);
    expect([...c.dePara.keys()].some((k) => k.startsWith('tipoLancamento|'))).toBe(false);
  });

  it('simula sem gravar: contagens por situação, amostra, recusas e totais com as parcelas', () => {
    const c = contextoDeAplicacao(PLANO, ITENS);
    const fatos = [
      fato({ id: 1, impressao: '1' }),
      fato({ id: 2, impressao: '2', valorCentavos: 50_000 }),
      fato({ id: 3, impressao: '3', campos: { convenio: 6 } }),
      fato({ id: 4, impressao: '4', data: '2026-12-31', competencia: '2026-12' }),
    ];
    const r = simularRegra(fatos, [regra()], c, 1);
    expect(r.fatos).toBe(4);
    expect(r.porSituacao).toMatchObject({ contabilizado: 2, semConta: 1, semRegra: 1, pendente: 0 });
    expect(r.lancamentos).toHaveLength(1);
    expect(r.todos).toHaveLength(2);
    expect(r.recusas).toHaveLength(1);
    expect(r.totais).toEqual({
      debitos: 200_000,
      creditos: 200_000,
      equilibrado: true,
      parcelas: [
        { lado: 'D', conta: '1.1.2.01.0001', valorCentavos: 200_000 },
        { lado: 'C', conta: '3.1.1.01.0001', valorCentavos: 200_000 },
      ],
    });
  });
});
