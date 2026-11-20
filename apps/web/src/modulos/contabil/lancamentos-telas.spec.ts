// @vitest-environment jsdom
// Telas da contabilidade, etapa 2 (M54.2): os comuns (valor em reais, totais e conferência do lançamento manual, soma da
// conciliação, dias da competência); a tela dos lançamentos (desligada com o motivo, abas conforme o perfil, lista com
// filtros e paginação, detalhe com as partidas, estorno com justificativa, manual com o corpo certo e recusa antes do
// servidor quando não fecha); o razão com a conferência; a conciliação (marcar, somar, conciliar, desfazer); os
// períodos (parcelas, impedimentos com o caminho, encerrar e reabrir com a senha); e o "Contabilizar" da aba Fatos.
// Dados SINTÉTICOS; o fetch é simulado.
import type {
  ApoioLancamentos,
  DetalheLancamento,
  LancamentoListado,
  PendentesConciliacao,
  RazaoConta,
  SituacaoDoPeriodo,
} from '@sgh/contratos';
import { criarI18n, instalarUi, resolverMarca, SanteSelecao } from '@sgh/ui';
import { QueryClient, VueQueryPlugin } from '@tanstack/vue-query';
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { App } from 'vue';
import { mensagensWeb } from '../../i18n/pt-BR.js';
import {
  centavosDoTexto,
  diasDaCompetencia,
  novaIdempotencia,
  partidaVaziaManual,
  problemasDoManual,
  somaDaSelecao,
  totaisDoManual,
} from './comum-lancamentos.js';
import LancamentosTela from './LancamentosTela.vue';

if (!window.matchMedia) {
  window.matchMedia = (consulta: string) =>
    ({
      matches: false,
      media: consulta,
      onchange: null,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      addListener: () => undefined,
      removeListener: () => undefined,
      dispatchEvent: () => false,
    }) as MediaQueryList;
}
if (!('ResizeObserver' in window)) {
  (window as unknown as { ResizeObserver: unknown }).ResizeObserver = class {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  };
}
const ui = { install: (app: App) => instalarUi(app, resolverMarca(undefined).pacote) };
const montar = () =>
  mount(LancamentosTela as never, {
    attachTo: document.body,
    props: { hoje: '2026-10-28' } as never,
    global: {
      plugins: [
        criarI18n(mensagensWeb as unknown as Record<string, unknown>),
        ui,
        [VueQueryPlugin, { queryClient: new QueryClient({ defaultOptions: { queries: { retry: false } } }) }],
      ] as never,
      stubs: { RouterLink: { props: ['to'], template: '<a :href="to"><slot /></a>' } },
    },
  });

type Pedido = { url: string; metodo: string; corpo: unknown };
type Resposta = { status?: number; corpo: unknown };
function simular(rota: (url: string, metodo: string) => Resposta | null): Pedido[] {
  const pedidos: Pedido[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      const metodo = init?.method ?? 'GET';
      pedidos.push({ url: String(url), metodo, corpo: init?.body ? JSON.parse(String(init.body)) : null });
      const r = rota(String(url), metodo) ?? base(String(url));
      return new Response(JSON.stringify(r.corpo), {
        status: r.status ?? 200,
        headers: { 'content-type': 'application/json' },
      });
    }),
  );
  return pedidos;
}
afterEach(() => {
  vi.unstubAllGlobals();
  document.body.innerHTML = '';
});

/** Escolhe o valor de um combo (SanteSelecao) pelo data-testid. */
async function escolher(w: VueWrapper, testid: string, valor: unknown) {
  const c = w.findAllComponents(SanteSelecao).find((x) => x.attributes('data-testid') === testid);
  if (!c) throw new Error(`combo ${testid} não achado`);
  c.vm.$emit('update:modelValue', valor);
  await flushPromises();
}
async function digitar(w: VueWrapper, testid: string, texto: string) {
  const el = w.find(`[data-testid="${testid}"] input, [data-testid="${testid}"] textarea`);
  await el.setValue(texto);
  await flushPromises();
}

// ── Dados sintéticos ─────────────────────────────────────────────────────────────────────────────
const APOIO: ApoioLancamentos = {
  ligada: true,
  motivo: null,
  empresas: [1],
  hoje: '2026-10-28',
  podeVerFatos: true,
  podeLancar: true,
  podeEstornar: true,
  podeConciliar: true,
  podeEncerrar: true,
  podeReabrir: true,
  tipos: [
    { codigo: 'automatico', rotulo: 'Automático (dos módulos)' },
    { codigo: 'manual', rotulo: 'Manual' },
    { codigo: 'estorno', rotulo: 'Estorno' },
  ],
  contas: [
    { codigo: '1.1.1.01.0001', nome: 'Caixa sintético', natureza: 'devedora', exigeCentroCusto: false },
    { codigo: '3.1.1.01.0001', nome: 'Receita sintética', natureza: 'credora', exigeCentroCusto: true },
  ],
};
const lanc = (id: number, extra: Partial<LancamentoListado> = {}): LancamentoListado => ({
  id,
  empresa: 1,
  tipo: 'automatico',
  tipoRotulo: 'Automático (dos módulos)',
  data: '2026-10-05',
  competencia: '2026-10',
  historico: `Receita sintética ${id}`,
  debitosCentavos: 15000,
  creditosCentavos: 15000,
  origem: 3,
  tipoFatoRotulo: 'Receita da conta',
  estornaId: null,
  estornadoPor: null,
  criadoPor: 'SGH.CONTABIL',
  criadoEm: '2026-10-06T03:00:00Z',
  ...extra,
});
const DETALHE: DetalheLancamento = {
  ...lanc(7),
  partidas: [
    {
      id: 71,
      ordem: 1,
      lado: 'D',
      conta: '1.1.1.01.0001',
      contaNome: 'Caixa sintético',
      valorCentavos: 15000,
      centroCusto: null,
      historico: 'Receita sintética 7',
      conciliacao: null,
    },
    {
      id: 72,
      ordem: 2,
      lado: 'C',
      conta: '3.1.1.01.0001',
      contaNome: 'Receita sintética',
      valorCentavos: 15000,
      centroCusto: 4,
      historico: 'Receita sintética 7',
      conciliacao: 3,
    },
  ],
  fato: { id: 70, fonte: 'FCCTAEXT', documento: 'conta 70', data: '2026-10-05', tipo: 'receitaConta' },
  regra: { nome: 'Receita da conta', versao: 2 },
  justificativa: null,
  estornavel: true,
  motivoNaoEstornavel: null,
};
const RAZAO: RazaoConta = {
  empresa: 1,
  conta: '1.1.1.01.0001',
  contaNome: 'Caixa sintético',
  natureza: 'devedora',
  de: '2026-10-01',
  ate: '2026-10-31',
  saldoAnteriorCentavos: 10000,
  debitosCentavos: 15000,
  creditosCentavos: 5000,
  saldoFinalCentavos: 20000,
  conferencia: 'R$ 100,00 + R$ 150,00 − R$ 50,00 = R$ 200,00',
  movimentos: [
    {
      lancamento: 7,
      partida: 71,
      data: '2026-10-05',
      tipo: 'automatico',
      historico: 'Receita sintética 7',
      centroCusto: null,
      debitoCentavos: 15000,
      creditoCentavos: 0,
      saldoCentavos: 25000,
      conciliado: false,
    },
  ],
  pagina: 1,
  saldoInicialPaginaCentavos: 0,
  parcial: true,
};
const PENDENTES: PendentesConciliacao = {
  empresa: 1,
  conta: '1.1.1.01.0001',
  contaNome: 'Caixa sintético',
  itens: [
    {
      id: 71,
      lancamento: 7,
      data: '2026-10-05',
      lado: 'D',
      valorCentavos: 15000,
      historico: 'a',
      centroCusto: null,
    },
    {
      id: 81,
      lancamento: 8,
      data: '2026-10-06',
      lado: 'C',
      valorCentavos: 10000,
      historico: 'b',
      centroCusto: null,
    },
    {
      id: 91,
      lancamento: 9,
      data: '2026-10-07',
      lado: 'C',
      valorCentavos: 5000,
      historico: 'c',
      centroCusto: null,
    },
  ],
  debitosCentavos: 15000,
  creditosCentavos: 15000,
  parcial: false,
};
const SITUACAO: SituacaoDoPeriodo = {
  empresa: 1,
  competencia: '2026-09',
  situacao: 'aberto',
  lancamentos: 3,
  debitosCentavos: 30000,
  creditosCentavos: 30000,
  encerradoPor: null,
  encerradoEm: null,
  parcelas: [
    { tipo: 'automatico', lancamentos: 2, debitosCentavos: 25000, creditosCentavos: 25000 },
    { tipo: 'manual', lancamentos: 1, debitosCentavos: 5000, creditosCentavos: 5000 },
  ],
  fatos: { contabilizado: 2, semConta: 1 },
  impedimentos: [{ codigo: 'fatos-sem-conta', mensagem: '1 fato sem conta.', quantidade: 1 }],
  podeEncerrar: false,
  podeReabrir: false,
  motivoNaoReabre: null,
};

function base(u: string): Resposta {
  if (u.startsWith('/api/contabil/lancamentos/apoio')) return { corpo: APOIO };
  if (u.startsWith('/api/contabil/lancamentos/detalhe')) return { corpo: DETALHE };
  if (u.startsWith('/api/contabil/lancamentos?'))
    return {
      corpo: {
        itens: [
          lanc(7),
          lanc(8, { tipo: 'manual', tipoRotulo: 'Manual', origem: null, tipoFatoRotulo: null }),
        ],
        total: 120,
        pagina: 1,
        tamanho: 50,
      },
    };
  if (u.startsWith('/api/contabil/razao')) return { corpo: RAZAO };
  if (u.startsWith('/api/contabil/conciliacao/pendentes')) return { corpo: PENDENTES };
  if (u.startsWith('/api/contabil/conciliacao?'))
    return {
      corpo: [
        {
          id: 3,
          conta: '1.1.1.01.0001',
          situacao: 'ativa',
          partidas: 2,
          valorCentavos: 8000,
          observacao: null,
          criadaPor: 'SINT.CONTADOR',
          criadaEm: '2026-10-10T12:00:00Z',
          desfeitaPor: null,
          desfeitaEm: null,
        },
      ],
    };
  if (u.startsWith('/api/contabil/periodos/situacao')) return { corpo: SITUACAO };
  if (u.startsWith('/api/contabil/periodos?'))
    return {
      corpo: {
        empresa: 1,
        itens: [
          {
            competencia: '2026-09',
            situacao: 'aberto',
            lancamentos: 3,
            debitosCentavos: 30000,
            creditosCentavos: 30000,
            encerradoPor: null,
            encerradoEm: null,
          },
        ],
      },
    };
  if (u.startsWith('/api/contabil/fatos/apoio'))
    return {
      corpo: {
        ligada: true,
        motivo: null,
        podeVerFatos: true,
        podePublicar: false,
        empresas: [1],
        origens: [],
        tiposFato: [],
      },
    };
  if (u.startsWith('/api/contabil/fatos/resumo')) return { corpo: { fontes: [], totais: {} } };
  if (u.startsWith('/api/contabil/fatos')) return { corpo: { itens: [], total: 0, pagina: 1, tamanho: 50 } };
  return { status: 404, corpo: { title: 'não simulado' } };
}

// ── Comuns ───────────────────────────────────────────────────────────────────────────────────────
describe('comuns dos lançamentos', () => {
  it('o valor digitado em reais vira centavos; o inválido é nulo', () => {
    expect(centavosDoTexto('1.234,56')).toBe(123456);
    expect(centavosDoTexto('1234,5')).toBe(123450);
    expect(centavosDoTexto('R$ 10')).toBe(1000);
    expect(centavosDoTexto('1234.56')).toBe(123456);
    expect(centavosDoTexto('1.234')).toBe(123400);
    expect(centavosDoTexto('0')).toBeNull();
    expect(centavosDoTexto('1,234')).toBeNull();
    expect(centavosDoTexto('abc')).toBeNull();
    expect(centavosDoTexto('')).toBeNull();
  });

  it('os totais do manual e a conferência: débitos = créditos, conta e centro de custo', () => {
    const d = { ...partidaVaziaManual('D'), conta: '1.1.1.01.0001', valor: '150,00' };
    const c = { ...partidaVaziaManual('C'), conta: '3.1.1.01.0001', valor: '100,00' };
    expect(totaisDoManual([d, c])).toEqual({
      debitos: 15000,
      creditos: 10000,
      diferenca: 5000,
      equilibrado: false,
    });
    const p = problemasDoManual({ data: '2026-10-28', historico: 'Ajuste', partidas: [d, c] }, APOIO.contas);
    expect(p).toContain('Partida 2: a conta exige o centro de custo.');
    expect(p.some((x) => x.startsWith('Débitos (R$') && x.includes('diferença de R$'))).toBe(true);
    const ok = problemasDoManual(
      {
        data: '2026-10-28',
        historico: 'Ajuste',
        partidas: [d, { ...c, valor: '150', centroCusto: '4' }],
      },
      APOIO.contas,
    );
    expect(ok).toEqual([]);
    expect(problemasDoManual({ data: '', historico: 'x', partidas: [d] }, APOIO.contas).slice(0, 4)).toEqual([
      'Informe a data do lançamento.',
      'O histórico precisa de ao menos 3 caracteres.',
      'O lançamento precisa de ao menos duas partidas.',
      'O lançamento precisa de ao menos um débito e um crédito.',
    ]);
  });

  it('a soma da conciliação fecha só com débitos = créditos e duas partidas ou mais', () => {
    expect(somaDaSelecao(PENDENTES.itens, new Set([71, 81]))).toEqual({
      partidas: 2,
      debitos: 15000,
      creditos: 10000,
      fecha: false,
    });
    expect(somaDaSelecao(PENDENTES.itens, new Set([71, 81, 91])).fecha).toBe(true);
  });

  it('os dias da competência e a chave UUID da intenção', () => {
    expect(diasDaCompetencia('2028-02')).toEqual({ de: '2028-02-01', ate: '2028-02-29' });
    expect(diasDaCompetencia('2026-10')).toEqual({ de: '2026-10-01', ate: '2026-10-31' });
    expect(novaIdempotencia()).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
  });
});

// ── Tela ─────────────────────────────────────────────────────────────────────────────────────────
describe('tela dos lançamentos e razão', () => {
  it('desligada, mostra o motivo e não lê os lançamentos', async () => {
    const pedidos = simular((u) =>
      u.startsWith('/api/contabil/lancamentos/apoio')
        ? { corpo: { ...APOIO, ligada: false, motivo: 'A contabilidade está desligada nesta unidade.' } }
        : null,
    );
    const w = montar();
    await flushPromises();
    expect(w.find('[data-testid="contabil-desligada"]').text()).toContain('desligada');
    expect(pedidos.some((p) => p.url.startsWith('/api/contabil/lancamentos?'))).toBe(false);
  });

  it('sem a permissão dos fatos, não oferece a aba Fatos', async () => {
    simular((u) =>
      u.startsWith('/api/contabil/lancamentos/apoio') ? { corpo: { ...APOIO, podeVerFatos: false } } : null,
    );
    const w = montar();
    await flushPromises();
    expect(w.find('[data-testid="lancamentos-aba-razao"]').exists()).toBe(true);
    expect(w.find('[data-testid="lancamentos-aba-fatos"]').exists()).toBe(false);
  });

  it('lista, filtra, pagina e abre o detalhe com as partidas, o fato e a regra', async () => {
    const pedidos = simular(() => null);
    const w = montar();
    await flushPromises();
    expect(w.findAll('[data-testid^="lancamento-detalhe-"]')).toHaveLength(2);
    expect(w.find('[data-testid="lancamentos-paginacao"]').text()).toContain(
      'Página 1 de 3 (120 lançamentos)',
    );
    await escolher(w, 'lancamentos-tipo', 'manual');
    expect(pedidos.some((p) => p.url.includes('tipo=manual'))).toBe(true);
    await w.find('[data-testid="lancamentos-proxima"]').trigger('click');
    await flushPromises();
    expect(pedidos.some((p) => p.url.includes('tipo=manual') && p.url.includes('pagina=2'))).toBe(true);
    await w.find('[data-testid="lancamento-detalhe-7"]').trigger('click');
    await flushPromises();
    const det = w.find('[data-testid="lancamento-detalhe"]').text();
    expect(det).toContain('Receita da conta (versão 2)');
    expect(w.find('[data-testid="lancamento-fato"]').text()).not.toContain('FCCTAEXT');
    expect(w.findAll('[data-testid^="partida-"]')).toHaveLength(2);
    expect(w.find('[data-testid="partida-72"]').text()).toContain('Conciliada');
    expect(w.find('[data-testid="lancamento-totais"]').text()).toContain('= créditos');
  });

  it('estorna só com a justificativa, e o corpo leva o lançamento e a justificativa', async () => {
    const pedidos = simular((u, m) =>
      m === 'POST' && u === '/api/contabil/lancamentos/estornar'
        ? { corpo: { ok: true, id: 9, competencia: '2026-10', mensagem: 'Lançamento 7 estornado pelo 9.' } }
        : null,
    );
    const w = montar();
    await flushPromises();
    await w.find('[data-testid="lancamento-detalhe-7"]').trigger('click');
    await flushPromises();
    await w.find('[data-testid="lancamento-estornar"]').trigger('click');
    expect(w.find('[data-testid="estorno-gravar"]').attributes('disabled')).toBeDefined();
    await digitar(w, 'estorno-justificativa', 'Conta de receita errada no fato sintético.');
    await w.find('[data-testid="estorno-gravar"]').trigger('click');
    await flushPromises();
    expect(pedidos.find((p) => p.metodo === 'POST')?.corpo).toEqual({
      empresa: 1,
      id: 7,
      justificativa: 'Conta de receita errada no fato sintético.',
    });
    expect(w.find('[data-testid="lancamento-resultado"]').text()).toContain('estornado');
  });

  it('o lançamento não estornável mostra o motivo e não oferece o estorno', async () => {
    simular((u) =>
      u.startsWith('/api/contabil/lancamentos/detalhe')
        ? { corpo: { ...DETALHE, estornavel: false, motivoNaoEstornavel: 'já foi estornado' } }
        : null,
    );
    const w = montar();
    await flushPromises();
    await w.find('[data-testid="lancamento-detalhe-7"]').trigger('click');
    await flushPromises();
    expect(w.find('[data-testid="lancamento-nao-estornavel"]').text()).toContain('já foi estornado');
    expect(w.find('[data-testid="lancamento-estornar"]').exists()).toBe(false);
  });

  it('o manual que não fecha é recusado na tela; o que fecha vai com centavos e a chave UUID', async () => {
    const pedidos = simular((u, m) =>
      m === 'POST' && u === '/api/contabil/lancamentos/manual'
        ? { corpo: { ok: true, id: 12, competencia: '2026-10', mensagem: 'Lançamento 12 gravado.' } }
        : null,
    );
    const w = montar();
    await flushPromises();
    await w.find('[data-testid="lancamento-novo"]').trigger('click');
    await digitar(w, 'manual-historico', 'Ajuste sintético');
    await escolher(w, 'manual-conta-0', '1.1.1.01.0001');
    await escolher(w, 'manual-conta-1', '3.1.1.01.0001');
    await digitar(w, 'manual-valor-0', '150,00');
    await digitar(w, 'manual-valor-1', '100,00');
    await digitar(w, 'manual-centro-1', '4');
    expect(w.find('[data-testid="manual-totais"]').text()).toContain('diferença R$');
    await w.find('[data-testid="manual-gravar"]').trigger('click');
    await flushPromises();
    expect(w.find('[data-testid="manual-problemas"]').text()).toContain('diferentes dos créditos');
    expect(pedidos.some((p) => p.metodo === 'POST')).toBe(false);
    await digitar(w, 'manual-valor-1', '150');
    await w.find('[data-testid="manual-gravar"]').trigger('click');
    await flushPromises();
    const corpo = pedidos.find((p) => p.metodo === 'POST')?.corpo as Record<string, unknown>;
    expect(corpo).toMatchObject({
      empresa: 1,
      data: '2026-10-28',
      historico: 'Ajuste sintético',
      partidas: [
        { lado: 'D', conta: '1.1.1.01.0001', valorCentavos: 15000, centroCusto: null, historico: null },
        { lado: 'C', conta: '3.1.1.01.0001', valorCentavos: 15000, centroCusto: 4, historico: null },
      ],
    });
    expect(String(corpo['idempotencia'])).toMatch(/^[0-9a-f-]{36}$/);
    expect(w.find('[data-testid="lancamento-resultado"]').text()).toContain('12');
  });

  it('a recusa do servidor (período encerrado) aparece com o motivo e o caminho, no texto da aplicação', async () => {
    simular((u, m) =>
      m === 'POST' && u === '/api/contabil/lancamentos/manual'
        ? {
            status: 409,
            corpo: {
              title: 'Operação recusada',
              codigo: 'periodo-encerrado',
              detail: 'texto do servidor que a tela não mostra',
            },
          }
        : null,
    );
    const w = montar();
    await flushPromises();
    await w.find('[data-testid="lancamento-novo"]').trigger('click');
    await digitar(w, 'manual-historico', 'Ajuste sintético');
    await escolher(w, 'manual-conta-0', '1.1.1.01.0001');
    await escolher(w, 'manual-conta-1', '3.1.1.01.0001');
    await digitar(w, 'manual-valor-0', '150,00');
    await digitar(w, 'manual-valor-1', '150,00');
    await digitar(w, 'manual-centro-1', '4');
    await w.find('[data-testid="manual-gravar"]').trigger('click');
    await flushPromises();
    const r = w.find('[data-testid="recusa-contabil"]');
    expect(r.exists()).toBe(true);
    expect(r.text()).toContain('está encerrado');
    expect(r.text()).toContain('reabertura');
    expect(w.text()).not.toContain('texto do servidor');
  });

  it('sem a permissão de lançar e de estornar, só consulta', async () => {
    simular((u) =>
      u.startsWith('/api/contabil/lancamentos/apoio')
        ? { corpo: { ...APOIO, podeLancar: false, podeEstornar: false } }
        : null,
    );
    const w = montar();
    await flushPromises();
    expect(w.find('[data-testid="lancamento-novo"]').exists()).toBe(false);
    await w.find('[data-testid="lancamento-detalhe-7"]').trigger('click');
    await flushPromises();
    expect(w.find('[data-testid="lancamento-estornar"]').exists()).toBe(false);
  });
});

describe('aba Razão', () => {
  it('consulta só ao pedir e mostra o saldo, a conferência e o aviso de lista cortada', async () => {
    const pedidos = simular(() => null);
    const w = montar();
    await flushPromises();
    await w.find('[data-testid="lancamentos-aba-razao"]').trigger('click');
    await flushPromises();
    expect(w.find('[data-testid="razao-escolha"]').exists()).toBe(true);
    await escolher(w, 'razao-conta', '1.1.1.01.0001');
    expect(pedidos.some((p) => p.url.startsWith('/api/contabil/razao'))).toBe(false);
    await w.find('[data-testid="razao-consultar"]').trigger('click');
    await flushPromises();
    const p = pedidos.find((x) => x.url.startsWith('/api/contabil/razao'))!;
    expect(p.url).toContain('conta=1.1.1.01.0001');
    expect(p.url).toContain('de=2026-10-01');
    expect(p.url).toContain('ate=2026-10-31');
    expect(w.find('[data-testid="razao-conferencia"]').text()).toBe(RAZAO.conferencia);
    expect(w.find('[data-testid="razao-parcial"]').exists()).toBe(true);
    expect(w.find('[data-testid="razao-movimento-71"]').text()).toContain('Automático');
    // Paginado no servidor: a próxima página pede pagina=2.
    expect(w.find('[data-testid="razao-pagina-anterior"]').exists()).toBe(false);
    await w.find('[data-testid="razao-proxima-pagina"]').trigger('click');
    await flushPromises();
    expect(pedidos.some((x) => x.url.startsWith('/api/contabil/razao') && x.url.includes('pagina=2'))).toBe(
      true,
    );
  });
});

describe('aba Conciliação', () => {
  it('marca, soma, só concilia quando fecha e manda as partidas marcadas', async () => {
    const pedidos = simular((u, m) =>
      m === 'POST' && u === '/api/contabil/conciliacao/registrar'
        ? { corpo: { ok: true, id: 4, mensagem: 'Conciliação 4 registrada.' } }
        : null,
    );
    const w = montar();
    await flushPromises();
    await w.find('[data-testid="lancamentos-aba-conciliacao"]').trigger('click');
    await flushPromises();
    await escolher(w, 'conciliacao-conta', '1.1.1.01.0001');
    await w.find('[data-testid="marcar-71"]').setValue(true);
    await w.find('[data-testid="marcar-81"]').setValue(true);
    expect(w.find('[data-testid="conciliacao-soma"]').text()).toContain('ainda não fecham');
    expect(w.find('[data-testid="conciliacao-conciliar"]').attributes('disabled')).toBeDefined();
    await w.find('[data-testid="marcar-91"]').setValue(true);
    expect(w.find('[data-testid="conciliacao-soma"]').text()).toContain('pode conciliar');
    await w.find('[data-testid="conciliacao-conciliar"]').trigger('click');
    await flushPromises();
    expect(pedidos.find((p) => p.metodo === 'POST')?.corpo).toEqual({
      empresa: 1,
      conta: '1.1.1.01.0001',
      partidas: [71, 81, 91],
      observacao: null,
    });
    expect(w.find('[data-testid="conciliacao-mensagem"]').text()).toContain('registrada');
  });

  it('desfaz só com a justificativa', async () => {
    const pedidos = simular((u, m) =>
      m === 'POST' && u === '/api/contabil/conciliacao/desfazer'
        ? { corpo: { ok: true, id: 3, mensagem: 'Conciliação 3 desfeita.' } }
        : null,
    );
    const w = montar();
    await flushPromises();
    await w.find('[data-testid="lancamentos-aba-conciliacao"]').trigger('click');
    await flushPromises();
    await escolher(w, 'conciliacao-conta', '1.1.1.01.0001');
    await w.find('[data-testid="conciliacao-desfazer-3"]').trigger('click');
    expect(w.find('[data-testid="desfazer-confirmar"]').attributes('disabled')).toBeDefined();
    await digitar(w, 'desfazer-justificativa', 'Partidas marcadas por engano.');
    await w.find('[data-testid="desfazer-confirmar"]').trigger('click');
    await flushPromises();
    expect(pedidos.find((p) => p.metodo === 'POST')?.corpo).toEqual({
      empresa: 1,
      id: 3,
      justificativa: 'Partidas marcadas por engano.',
    });
  });
});

describe('aba Períodos', () => {
  it('mostra as parcelas com o total, os fatos e o impedimento com o caminho; sem encerrar', async () => {
    simular(() => null);
    const w = montar();
    await flushPromises();
    await w.find('[data-testid="lancamentos-aba-periodos"]').trigger('click');
    await flushPromises();
    await w.find('[data-testid="periodo-abrir-2026-09"]').trigger('click');
    await flushPromises();
    expect(w.find('[data-testid="parcela-automatico"]').text()).toContain('R$');
    expect(w.find('[data-testid="parcela-total"]').text()).toContain('3');
    expect(w.find('[data-testid="periodo-parcelas-texto"]').text()).toMatch(/Automático.*\+ Manual.*=/);
    expect(w.find('[data-testid="periodo-fatos"]').text()).toContain('Contabilizado: 2');
    expect(w.find('[data-testid="impedimento-fatos-sem-conta"] a').attributes('href')).toBe(
      '/financeiro/contabil/exportacao',
    );
    expect(w.find('[data-testid="periodo-encerrar"]').exists()).toBe(false);
  });

  it('encerra com a senha (que não fica no campo) e reabre com justificativa e senha', async () => {
    let encerrado = false;
    const pedidos = simular((u, m) => {
      if (u.startsWith('/api/contabil/periodos/situacao'))
        return {
          corpo: encerrado
            ? { ...SITUACAO, situacao: 'encerrado', impedimentos: [], podeEncerrar: false, podeReabrir: true }
            : { ...SITUACAO, impedimentos: [], podeEncerrar: true },
        };
      if (m === 'POST' && u === '/api/contabil/periodos/encerrar') {
        encerrado = true;
        return { corpo: { ok: true, competencia: '2026-09', situacao: 'encerrado', mensagem: 'Encerrado.' } };
      }
      if (m === 'POST' && u === '/api/contabil/periodos/reabrir')
        return { corpo: { ok: true, competencia: '2026-09', situacao: 'aberto', mensagem: 'Reaberto.' } };
      return null;
    });
    const w = montar();
    await flushPromises();
    await w.find('[data-testid="lancamentos-aba-periodos"]').trigger('click');
    await flushPromises();
    await w.find('[data-testid="periodo-abrir-2026-09"]').trigger('click');
    await flushPromises();
    expect(w.find('[data-testid="periodo-sem-impedimento"]').exists()).toBe(true);
    expect(w.find('[data-testid="encerrar-confirmar"]').attributes('disabled')).toBeDefined();
    await w.find('[data-testid="encerrar-senha"]').setValue('senha-sintetica');
    await w.find('[data-testid="encerrar-confirmar"]').trigger('click');
    await flushPromises();
    expect(pedidos.find((p) => p.metodo === 'POST')?.corpo).toEqual({
      empresa: 1,
      competencia: '2026-09',
      observacao: null,
      senha: 'senha-sintetica',
    });
    expect(w.find('[data-testid="periodo-mensagem"]').text()).toBe('Encerrado.');
    expect(w.find('[data-testid="periodo-reabrir"]').exists()).toBe(true);
    expect((w.find('[data-testid="reabrir-senha"]').element as HTMLInputElement).value).toBe('');
    await digitar(w, 'reabrir-justificativa', 'Lançamento de ajuste esquecido.');
    await w.find('[data-testid="reabrir-senha"]').setValue('senha-sintetica');
    await w.find('[data-testid="reabrir-confirmar"]').trigger('click');
    await flushPromises();
    expect(pedidos.filter((p) => p.metodo === 'POST')[1]?.corpo).toEqual({
      empresa: 1,
      competencia: '2026-09',
      justificativa: 'Lançamento de ajuste esquecido.',
      senha: 'senha-sintetica',
    });
  });
});

describe('aba Fatos: contabilizar', () => {
  it('contabiliza os fatos aguardando e mostra o resultado com os totais', async () => {
    const pedidos = simular((u, m) =>
      m === 'POST' && u === '/api/contabil/lancamentos/contabilizar'
        ? {
            corpo: {
              empresa: 1,
              competencia: null,
              fatos: 3,
              porSituacao: {
                pendente: 0,
                contabilizado: 2,
                semRegra: 1,
                semConta: 0,
                substituido: 0,
                ignorado: 0,
              },
              lancamentos: 2,
              movidosDePeriodo: 0,
              totais: { debitos: 30000, creditos: 30000 },
              restam: false,
              mensagem: '2 lançamento(s) gravado(s) de 3 fato(s); 1 sem regra e 0 sem conta.',
            },
          }
        : null,
    );
    const w = montar();
    await flushPromises();
    await w.find('[data-testid="lancamentos-aba-fatos"]').trigger('click');
    await flushPromises();
    await w.find('[data-testid="contabilizar-acionar"]').trigger('click');
    await flushPromises();
    expect(pedidos.find((p) => p.metodo === 'POST')?.corpo).toEqual({ empresa: 1, incluirRecusados: false });
    expect(w.find('[data-testid="contabilizar-resultado"]').text()).toContain('2 lançamentos');
  });
});
