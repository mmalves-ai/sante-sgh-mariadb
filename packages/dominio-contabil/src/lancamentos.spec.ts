// Etapa 2 do M54 (regras 2, 3 e 5): contabilização dos fatos em lançamentos, manual, estorno, encerramento, razão e
// conciliação. Dados sintéticos (fixtures.spec-util.ts).
import type { PartidaGerada } from '@sgh/contratos';
import { describe, expect, it } from 'vitest';
import { contextoDeAplicacao } from './registro.js';
import { fato, PLANO, conta, regra } from './fixtures.spec-util.js';
import {
  type FatoCandidato,
  type LancamentoDoFato,
  chaveManual,
  competenciaBr,
  dataBr,
  impedimentosDoEncerramento,
  montarRazao,
  partidasDoManual,
  planoDaContabilizacao,
  planoDoEstorno,
  problemasDaConciliacao,
  problemasDoLancamentoManual,
  recusaDaReabertura,
  resumoDaContabilizacao,
  saldoNaNatureza,
} from './lancamentos.js';
import type { PeriodoContabil } from './periodo.js';

const DEPARA = [
  {
    convenio: 5,
    tipoConta: 'I',
    tipoLancamento: null,
    tipoAto: null,
    subtipoDiaria: null,
    contaExportacao: 1101,
  },
];
const ctx = contextoDeAplicacao(PLANO, DEPARA);
const publicadas = [{ id: 77, regra: regra() }];

const cand = (idFato: number, extra: Partial<FatoCandidato> = {}): FatoCandidato => ({
  ...fato(),
  idFato,
  situacao: 'pendente',
  ...extra,
});

const ENC: PeriodoContabil[] = [{ empresa: 1, competencia: '2027-01', situacao: 'encerrado' }];

describe('planoDaContabilizacao (regras 2 e 3)', () => {
  it('fato ativo com regra e de-para vira lançamento automático equilibrado, com a regra e a chave do fato', () => {
    const f = cand(1);
    const [a] = planoDaContabilizacao({
      candidatos: [f],
      registrados: [f],
      lancamentos: new Map(),
      publicadas,
      ctx,
      periodos: [],
    });
    expect(a?.acao).toBe('lancar');
    if (a?.acao !== 'lancar') return;
    expect(a.regraId).toBe(77);
    expect(a.movido).toBe(false);
    expect(a.lancamento).toMatchObject({
      chave: 'fato:1',
      tipo: 'automatico',
      data: '2027-01-15',
      competencia: '2027-01',
      fatoId: 1,
      regra: { nome: 'Receita da conta', versao: 1 },
      historico: 'Receita da conta fechada conta 10',
    });
    expect(a.lancamento.partidas.map((p) => [p.lado, p.conta, p.valorCentavos])).toEqual([
      ['D', '1.1.2.01.0001', 150_000],
      ['C', '3.1.1.01.0001', 150_000],
    ]);
    // Determinístico: a mesma entrada dá a mesma ação (reprocessar dá o mesmo).
    expect(
      planoDaContabilizacao({
        candidatos: [f],
        registrados: [f],
        lancamentos: new Map(),
        publicadas,
        ctx,
        periodos: [],
      }),
    ).toEqual([a]);
  });

  it('fato de competência encerrada vai ao primeiro período aberto, com a data do fato no histórico', () => {
    const f = cand(1);
    const [a] = planoDaContabilizacao({
      candidatos: [f],
      registrados: [f],
      lancamentos: new Map(),
      publicadas,
      ctx,
      periodos: ENC,
    });
    if (a?.acao !== 'lancar') throw new Error('esperava lançar');
    expect(a.movido).toBe(true);
    expect(a.lancamento.data).toBe('2027-02-01');
    expect(a.lancamento.competencia).toBe('2027-02');
    expect(a.lancamento.historico).toContain('fato de 15/01/2027');
  });

  it('sem regra ou sem conta só marca a situação, com o motivo', () => {
    const semRegra = cand(1, { tipo: 'ajusteGlosa' });
    const semConta = cand(2, { id: 11, campos: { convenio: 999 } });
    const acoes = planoDaContabilizacao({
      candidatos: [semRegra, semConta],
      registrados: [semRegra, semConta],
      lancamentos: new Map(),
      publicadas,
      ctx,
      periodos: [],
    });
    expect(acoes.map((a) => [a.acao, a.situacao])).toEqual([
      ['marcar', 'semRegra'],
      ['marcar', 'semConta'],
    ]);
    expect(acoes[1]?.acao === 'marcar' && acoes[1].motivo).toContain('De-para');
  });

  it('o fato já lançado só tem a situação reparada (não lança de novo)', () => {
    const f = cand(1);
    const lanc: LancamentoDoFato = { id: 9, idFato: 1, partidas: [], estornadoPor: null };
    const [a] = planoDaContabilizacao({
      candidatos: [f],
      registrados: [f],
      lancamentos: new Map([[1, lanc]]),
      publicadas,
      ctx,
      periodos: [],
    });
    expect(a).toEqual({
      acao: 'marcar',
      idFato: 1,
      situacaoLida: f.situacao,
      situacao: 'contabilizado',
      motivo: null,
      regraId: null,
    });
  });

  it('o fato estornado antes de contabilizar fica substituído; o estorno dele não tem o que estornar', () => {
    const original = cand(1, { impressao: 'A' });
    const estorno = cand(2, { impressao: 'A', estorno: true, referencia: 'A' });
    const acoes = planoDaContabilizacao({
      candidatos: [original, estorno],
      registrados: [original, estorno],
      lancamentos: new Map(),
      publicadas,
      ctx,
      periodos: [],
    });
    expect(acoes.map((a) => a.situacao)).toEqual(['substituido', 'ignorado']);
  });

  it('o fato-estorno estorna o lançamento do original, com as partidas dele invertidas (não recalcula)', () => {
    const original = cand(1, { impressao: 'A', situacao: 'contabilizado' });
    const estorno = cand(2, { impressao: 'A', estorno: true, referencia: 'A', data: '2027-01-20' });
    const partidas: PartidaGerada[] = [
      { lado: 'D', conta: '1.1.2.01.0002', valorCentavos: 123, historico: 'h', centroCusto: null },
      { lado: 'C', conta: '3.1.1.01.0002', valorCentavos: 123, historico: 'h', centroCusto: 4 },
    ];
    const [a] = planoDaContabilizacao({
      candidatos: [estorno],
      registrados: [original, estorno],
      lancamentos: new Map([[1, { id: 50, idFato: 1, partidas, estornadoPor: null }]]),
      publicadas,
      ctx,
      periodos: [],
    });
    if (a?.acao !== 'lancar') throw new Error('esperava lançar');
    expect(a.lancamento.tipo).toBe('estorno');
    expect(a.lancamento.estornaId).toBe(50);
    expect(a.lancamento.historico.startsWith('Estorno: ')).toBe(true);
    expect(a.lancamento.partidas.map((p) => [p.lado, p.conta, p.valorCentavos, p.centroCusto])).toEqual([
      ['C', '1.1.2.01.0002', 123, null],
      ['D', '3.1.1.01.0002', 123, 4],
    ]);
  });

  it('o fato-estorno de lançamento já estornado à mão fica ignorado', () => {
    const original = cand(1, { impressao: 'A' });
    const estorno = cand(2, { impressao: 'A', estorno: true, referencia: 'A' });
    const [a] = planoDaContabilizacao({
      candidatos: [estorno],
      registrados: [original, estorno],
      lancamentos: new Map([[1, { id: 50, idFato: 1, partidas: [], estornadoPor: 51 }]]),
      publicadas,
      ctx,
      periodos: ENC,
    });
    expect(a).toMatchObject({ acao: 'marcar', situacao: 'ignorado' });
  });

  it('o estorno de fato de período encerrado vai ao primeiro aberto', () => {
    const original = cand(1, { impressao: 'A' });
    const estorno = cand(2, { impressao: 'A', estorno: true, referencia: 'A' });
    const p: PartidaGerada[] = [
      { lado: 'D', conta: 'x', valorCentavos: 1, historico: 'h', centroCusto: null },
      { lado: 'C', conta: 'y', valorCentavos: 1, historico: 'h', centroCusto: null },
    ];
    const [a] = planoDaContabilizacao({
      candidatos: [estorno],
      registrados: [original, estorno],
      lancamentos: new Map([[1, { id: 50, idFato: 1, partidas: p, estornadoPor: null }]]),
      publicadas,
      ctx,
      periodos: ENC,
    });
    expect(a?.acao === 'lancar' && [a.movido, a.lancamento.competencia]).toEqual([true, '2027-02']);
  });

  it('regra sem ID publicado leva regraId nulo; o resumo soma as parcelas', () => {
    const f = cand(1);
    const acoes = planoDaContabilizacao({
      candidatos: [f, cand(3, { id: 12, tipo: 'ajusteGlosa' })],
      registrados: [f],
      lancamentos: new Map(),
      publicadas: [{ id: 1, regra: regra({ nome: 'Outra' }) }],
      ctx,
      periodos: ENC,
    });
    expect(acoes[0]?.acao === 'lancar' && acoes[0].regraId).toBe(1);
    const sem = planoDaContabilizacao({
      candidatos: [f],
      registrados: [f],
      lancamentos: new Map(),
      publicadas: [{ id: 1, regra: regra() }].map((p) => ({ ...p, regra: { ...p.regra, empresa: 1 } })),
      ctx,
      periodos: [],
    });
    expect(sem[0]?.acao).toBe('lancar');
    const r = resumoDaContabilizacao(acoes);
    expect(r).toMatchObject({ lancamentos: 1, movidos: 1, debitos: 150_000, creditos: 150_000 });
    expect(r.porSituacao.contabilizado).toBe(1);
    expect(r.porSituacao.substituido).toBe(1);
  });
});

describe('lançamento manual (regras 3 e 5)', () => {
  const plano = [...PLANO, conta('4.1.1.01.0001', { grupo: 'despesa', exigeCentroCusto: true })];
  const base = {
    empresa: 1,
    data: '2027-02-10',
    partidas: [
      { lado: 'D' as const, conta: '4.1.1.01.0001', valorCentavos: 500, centroCusto: 3, historico: null },
      { lado: 'C' as const, conta: '1.1.2.01.0001', valorCentavos: 500, centroCusto: null, historico: 'x' },
    ],
  };

  it('equilibrado, em período aberto e com o centro exigido: sem problema', () => {
    expect(problemasDoLancamentoManual(base, plano, ENC)).toEqual([]);
  });

  it('D-FUTURO-542: a data depois de hoje é recusada; hoje e antes passam', () => {
    expect(problemasDoLancamentoManual(base, plano, ENC, '2027-02-10')).toEqual([]);
    const r = problemasDoLancamentoManual({ ...base, data: '2062-10-01' }, plano, ENC, '2027-02-10');
    expect(r).toHaveLength(1);
    expect(r[0]).toMatch(/01\/10\/2062 é futura/);
  });

  it('recusa período encerrado, conta sintética, inativa ou inexistente, centro faltando e desequilíbrio', () => {
    const r = problemasDoLancamentoManual(
      {
        empresa: 1,
        data: '2027-01-31',
        partidas: [
          { lado: 'D', conta: '4.1.1.01.0001', valorCentavos: 500, centroCusto: null, historico: null },
          { lado: 'D', conta: '4.1.1.01.0001', valorCentavos: 1, centroCusto: null, historico: null },
          { lado: 'C', conta: '1.1', valorCentavos: 100, centroCusto: null, historico: null },
          { lado: 'C', conta: '1.1', valorCentavos: 100, centroCusto: null, historico: null },
          { lado: 'C', conta: '3.1.1.01.0009', valorCentavos: 100, centroCusto: null, historico: null },
          { lado: 'C', conta: '9.9', valorCentavos: 100, centroCusto: null, historico: null },
        ],
      },
      plano,
      ENC,
    );
    expect(r).toEqual([
      'O período 01/2027 está encerrado: lance numa data de período aberto.',
      'A conta 4.1.1.01.0001 exige centro de custo.',
      'A conta 1.1 é sintética: só conta analítica recebe lançamento.',
      'A conta 3.1.1.01.0009 está inativa.',
      'A conta 9.9 não existe no plano.',
      'Débitos (501) diferentes dos créditos (400): diferença de 101 centavos.',
    ]);
  });

  it('as partidas sem histórico próprio levam o do lançamento', () => {
    expect(partidasDoManual(base.partidas, 'Ajuste').map((p) => p.historico)).toEqual(['Ajuste', 'x']);
    expect(chaveManual('ABC-1')).toBe('manual:abc-1');
  });
});

describe('estorno (D-ESTORNO-54)', () => {
  const original = {
    id: 10,
    empresa: 1,
    tipo: 'manual' as const,
    data: '2027-01-10',
    historico: 'Ajuste',
    estornadoPor: null,
    partidas: [
      { lado: 'D' as const, conta: 'a', valorCentavos: 9, historico: 'h', centroCusto: null },
      { lado: 'C' as const, conta: 'b', valorCentavos: 9, historico: 'h', centroCusto: null },
    ],
  };

  it('inverte as partidas, aponta para o original e usa hoje sem data pedida', () => {
    const r = planoDoEstorno(original, [], '2027-02-03', 'Lançado na conta errada');
    if (!r.ok) throw new Error(r.motivo);
    expect(r.lancamento).toMatchObject({
      chave: 'estorno:10',
      tipo: 'estorno',
      estornaId: 10,
      data: '2027-02-03',
      competencia: '2027-02',
      justificativa: 'Lançado na conta errada',
    });
    expect(r.lancamento.partidas.map((p) => p.lado)).toEqual(['C', 'D']);
  });

  it('recusa estorno de estorno, o já estornado, data antes do original e período encerrado', () => {
    const j = 'justificativa longa';
    expect(planoDoEstorno({ ...original, tipo: 'estorno' }, [], '2027-02-03', j)).toMatchObject({
      codigo: 'estorno-de-estorno',
    });
    expect(planoDoEstorno({ ...original, estornadoPor: 11 }, [], '2027-02-03', j)).toMatchObject({
      codigo: 'ja-estornado',
    });
    expect(planoDoEstorno(original, [], '2027-02-03', j, '2027-01-01')).toMatchObject({
      codigo: 'data-anterior',
    });
    expect(planoDoEstorno(original, ENC, '2027-02-03', j, '2027-01-20')).toMatchObject({
      codigo: 'periodo-encerrado',
    });
    expect(planoDoEstorno(original, [], '2027-02-03', j, '2027-01-20').ok).toBe(true);
    // D-FUTURO-542: o estorno também não vai para o futuro.
    expect(planoDoEstorno(original, [], '2027-02-03', j, '2062-10-01')).toMatchObject({
      ok: false,
      codigo: 'data-futura',
    });
    expect(planoDoEstorno(original, [], '2027-02-03', j, '2027-02-03').ok).toBe(true);
  });
});

describe('encerramento com bloqueio e reabertura', () => {
  const ok = {
    competencia: '2027-01',
    hoje: '2027-02-05',
    encerrado: false,
    fatos: { contabilizado: 10, ignorado: 1 },
    debitos: 100,
    creditos: 100,
    anteriorAbertaComMovimento: null,
  };

  it('sem pendência, competência passada e equilibrada: pode encerrar', () => {
    expect(impedimentosDoEncerramento(ok)).toEqual([]);
  });

  it('lista cada impedimento com a contagem', () => {
    const r = impedimentosDoEncerramento({
      ...ok,
      hoje: '2027-01-20',
      fatos: { pendente: 2, semRegra: 3, semConta: 4 },
      debitos: 100,
      creditos: 90,
      anteriorAbertaComMovimento: '2026-12',
    });
    expect(r.map((x) => [x.codigo, x.quantidade])).toEqual([
      ['futuro', 0],
      ['anterior-aberto', 1],
      ['fatos-pendentes', 2],
      ['fatos-sem-regra', 3],
      ['fatos-sem-conta', 4],
      ['desequilibrio', 10],
    ]);
    expect(r[1]?.mensagem).toBe('Encerre antes o período 12/2026.');
  });

  it('já encerrado é o único impedimento', () => {
    expect(impedimentosDoEncerramento({ ...ok, encerrado: true }).map((x) => x.codigo)).toEqual([
      'ja-encerrado',
    ]);
  });

  it('só o último encerrado se reabre', () => {
    const p: PeriodoContabil[] = [
      { empresa: 1, competencia: '2027-01', situacao: 'encerrado' },
      { empresa: 1, competencia: '2027-02', situacao: 'encerrado' },
      { empresa: 2, competencia: '2027-03', situacao: 'encerrado' },
      { empresa: 1, competencia: '2027-03', situacao: 'aberto' },
    ];
    expect(recusaDaReabertura(p, 1, '2027-02')).toBeNull();
    expect(recusaDaReabertura(p, 1, '2027-01')).toContain('Reabra antes o período 02/2027');
    expect(recusaDaReabertura(p, 1, '2027-03')).toContain('não está encerrado');
  });
});

describe('razão e conciliação', () => {
  const mov = (partida: number, lado: 'D' | 'C', valorCentavos: number) => ({
    lancamento: partida,
    partida,
    data: '2027-01-05',
    tipo: 'manual' as const,
    historico: 'h',
    centroCusto: null,
    lado,
    valorCentavos,
    conciliado: false,
  });

  it('saldo corrido na natureza devedora, com a conferência das parcelas', () => {
    const r = montarRazao(
      'devedora',
      { debitos: 10_000, creditos: 2_000 },
      [mov(1, 'D', 500), mov(2, 'C', 200)],
      { debitos: 500, creditos: 200 },
      10,
    );
    expect(r.saldoAnteriorCentavos).toBe(8_000);
    expect(r.movimentos.map((m) => m.saldoCentavos)).toEqual([8_500, 8_300]);
    expect(r.saldoFinalCentavos).toBe(8_300);
    expect(r.conferencia).toBe('80,00 + 5,00 (débitos) − 2,00 (créditos) = 83,00');
    expect(r.parcial).toBe(false);
  });

  it('credora inverte o sinal; o teto corta a lista mas não os totais', () => {
    const r = montarRazao(
      'credora',
      { debitos: 0, creditos: 0 },
      [mov(1, 'D', 500), mov(2, 'C', 200)],
      { debitos: 500, creditos: 200 },
      1,
    );
    expect(r.movimentos).toHaveLength(1);
    expect(r.parcial).toBe(true);
    expect(r.saldoFinalCentavos).toBe(-300);
    expect(r.conferencia).toBe('0,00 + 2,00 (créditos) − 5,00 (débitos) = -3,00');
    expect(saldoNaNatureza('credora', 1, 3)).toBe(2);
  });

  it('paginado: a página seguinte começa no saldo depois dos movimentos das anteriores; os totais são do intervalo', () => {
    const todos = [mov(1, 'D', 500), mov(2, 'C', 200), mov(3, 'D', 100)];
    const totais = { debitos: 600, creditos: 200 };
    const p1 = montarRazao('devedora', { debitos: 1_000, creditos: 0 }, todos.slice(0, 2), totais, 1);
    const p2 = montarRazao('devedora', { debitos: 1_000, creditos: 0 }, todos.slice(1, 3), totais, 1, {
      debitos: 500,
      creditos: 0,
    });
    expect(p1.saldoInicialPaginaCentavos).toBe(1_000);
    expect(p1.movimentos.at(-1)!.saldoCentavos).toBe(1_500);
    expect(p2.saldoInicialPaginaCentavos).toBe(1_500);
    expect(p2.movimentos.map((m) => m.saldoCentavos)).toEqual([1_300]);
    expect([p1.parcial, p2.parcial]).toEqual([true, true]);
    expect(p2.saldoFinalCentavos).toBe(1_400);
    expect(p2.saldoAnteriorCentavos).toBe(1_000);
  });

  const p = (id: number, lado: 'D' | 'C', valorCentavos: number, extra = {}) => ({
    id,
    empresa: 1,
    conta: '1.1.2.01.0001',
    lado,
    valorCentavos,
    conciliacao: null,
    ...extra,
  });

  it('concilia partidas da conta com débitos = créditos', () => {
    expect(
      problemasDaConciliacao([1, 2, 3], [p(1, 'D', 300), p(2, 'C', 100), p(3, 'C', 200)], 1, '1.1.2.01.0001'),
    ).toEqual([]);
  });

  it('recusa repetida, não achada, de outra conta, já conciliada, um lado só e desequilíbrio', () => {
    expect(problemasDaConciliacao([1, 1, 9], [p(1, 'D', 300)], 1, '1.1.2.01.0001')).toEqual([
      'A mesma partida foi escolhida mais de uma vez.',
      'Partidas não encontradas: 9.',
      'A conciliação precisa de partidas a débito e a crédito.',
    ]);
    expect(
      problemasDaConciliacao(
        [1, 2],
        [p(1, 'D', 300, { conta: 'x', conciliacao: 4 }), p(2, 'C', 100)],
        1,
        '1.1.2.01.0001',
      ),
    ).toEqual([
      'Só se conciliam partidas da conta 1.1.2.01.0001.',
      '1 partida(s) já conciliada(s).',
      'Débitos (300) diferentes dos créditos (100): diferença de 200 centavos.',
    ]);
  });

  it('formatos de data e competência', () => {
    expect(dataBr('2027-01-05')).toBe('05/01/2027');
    expect(competenciaBr('2027-01')).toBe('01/2027');
  });
});
