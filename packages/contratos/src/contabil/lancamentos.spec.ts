import { describe, expect, it } from 'vitest';
import { EVENTOS_AUDITAVEIS } from '../auditoria/eventos.js';
import { CATALOGO_DECLARADO } from '../permissoes/catalogo.js';
import { FORMATO_CODIGO_PERMISSAO } from '../permissoes/tipos.js';
import {
  esquemaConciliarContabil,
  esquemaContabilizar,
  esquemaEstornarLancamento,
  esquemaFiltroLancamentos,
  esquemaFiltroRazao,
  esquemaLancamentoManual,
  esquemaReabrirPeriodoContabil,
  ROTAS_CONTABIL_F2,
  TETO_LANCAMENTOS_PAGINA,
} from './lancamentos.js';
import { ROTAS_CONTABIL_F1 } from './rotas.js';

const manual = {
  empresa: 1,
  data: '2027-02-10',
  historico: 'Ajuste de saldo',
  idempotencia: '0b6c1d3e-5f6a-4b7c-8d9e-0f1a2b3c4d5e',
  partidas: [
    { lado: 'D', conta: '4.1.1.01.0001', valorCentavos: 500, centroCusto: 3 },
    { lado: 'C', conta: '1.1.2.01.0001', valorCentavos: 500 },
  ],
};

describe('entradas da contabilidade (etapa 2)', () => {
  it('lançamento manual: centavos inteiros positivos, ao menos duas partidas e a chave de idempotência', () => {
    const r = esquemaLancamentoManual.parse(manual);
    expect(r.partidas[1]).toMatchObject({ centroCusto: null, historico: null });
    expect(esquemaLancamentoManual.safeParse({ ...manual, idempotencia: 'x' }).success).toBe(false);
    expect(
      esquemaLancamentoManual.safeParse({
        ...manual,
        partidas: [{ ...manual.partidas[0], valorCentavos: 1.5 }],
      }).success,
    ).toBe(false);
    expect(
      esquemaLancamentoManual.safeParse({
        ...manual,
        partidas: [manual.partidas[0], { ...manual.partidas[1], valorCentavos: 0 }],
      }).success,
    ).toBe(false);
  });

  it('estorno e reabertura exigem justificativa', () => {
    expect(esquemaEstornarLancamento.safeParse({ empresa: 1, id: 3, justificativa: 'curta' }).success).toBe(
      false,
    );
    expect(
      esquemaEstornarLancamento.safeParse({ empresa: 1, id: 3, justificativa: 'Conta errada no débito' })
        .success,
    ).toBe(true);
    expect(
      esquemaReabrirPeriodoContabil.safeParse({ empresa: 1, competencia: '2027-01', justificativa: 'x' })
        .success,
    ).toBe(false);
  });

  it('filtros com teto; razão de no máximo 12 meses e início antes do fim', () => {
    expect(esquemaFiltroLancamentos.parse({ empresa: 1 }).tamanho).toBe(50);
    expect(
      esquemaFiltroLancamentos.safeParse({ empresa: 1, tamanho: TETO_LANCAMENTOS_PAGINA + 1 }).success,
    ).toBe(false);
    const r = { empresa: 1, conta: '1.1', de: '2027-01-01', ate: '2027-12-31' };
    expect(esquemaFiltroRazao.safeParse(r).success).toBe(true);
    expect(esquemaFiltroRazao.safeParse({ ...r, ate: '2028-01-01' }).success).toBe(false);
    expect(esquemaFiltroRazao.safeParse({ ...r, ate: '2026-12-31' }).success).toBe(false);
    expect(esquemaContabilizar.parse({ empresa: 1 }).incluirRecusados).toBe(false);
    expect(esquemaConciliarContabil.safeParse({ empresa: 1, conta: '1.1', partidas: [1] }).success).toBe(
      false,
    );
  });
});

describe('rotas, permissões e eventos da etapa 2', () => {
  it('as permissões estão no catálogo com opção do outro sistema; encerrar e reabrir são críticas', () => {
    const codigos = new Set(Object.values(ROTAS_CONTABIL_F2).map((r) => r.permissao));
    expect([...codigos].sort()).toEqual([
      'contabil.conciliacao.registrar',
      'contabil.lancamento.criar',
      'contabil.lancamento.estornar',
      'contabil.lancamento.ler',
      'contabil.periodo.encerrar',
      'contabil.periodo.reabrir',
    ]);
    for (const c of codigos) {
      const p = CATALOGO_DECLARADO.find((x) => x.codigo === c);
      expect(p, c).toBeDefined();
      expect(FORMATO_CODIGO_PERMISSAO.test(c)).toBe(true);
      expect(p!.opcoesLegado.length).toBeGreaterThan(0);
    }
    // D-PERM-FATOS-542: quem acompanha os fatos (82, 83, 84, 81) abre a tela dos lançamentos, onde a aba Fatos mora.
    const ler = CATALOGO_DECLARADO.find((x) => x.codigo === 'contabil.lancamento.ler')!.opcoesLegado;
    for (const o of CATALOGO_DECLARADO.find((x) => x.codigo === 'contabil.fato.ler')!.opcoesLegado)
      expect(ler, String(o)).toContain(o);
    for (const c of ['contabil.periodo.encerrar', 'contabil.periodo.reabrir'])
      expect(CATALOGO_DECLARADO.find((x) => x.codigo === c)!.criticidade).toBe('critica');
  });

  it('nenhum caminho repete o da etapa 1', () => {
    const f1 = new Set<string>(Object.values(ROTAS_CONTABIL_F1).map((r) => r.caminho));
    const f2 = Object.values(ROTAS_CONTABIL_F2).map((r) => r.caminho);
    expect(f2.filter((c) => f1.has(c))).toEqual([]);
    expect(new Set(f2).size).toBe(f2.length);
  });

  it('os eventos auditáveis existem', () => {
    const codigos = new Set<string>(Object.values(EVENTOS_AUDITAVEIS).map((e) => e.codigo));
    for (const c of [
      'contabil.lancamento.incluido',
      'contabil.lancamento.estornado',
      'contabil.fatos.contabilizados',
      'contabil.conciliacao.registrada',
      'contabil.conciliacao.desfeita',
      'contabil.periodo.encerrado',
      'contabil.periodo.reaberto',
    ])
      expect(codigos.has(c), c).toBe(true);
  });
});
