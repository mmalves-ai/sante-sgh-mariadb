// @vitest-environment jsdom
// Tela "Centros de custo e critérios de rateio" (M54, etapa 4): os comuns (competências, quantidades, leitura do número,
// filtro dos centros, parcelas e soma); a rota com a permissão; os textos sem nome de outro sistema e com todas as
// pendências e recusas; a estrutura com a contagem, a sugestão, as pendências e a sequência; a classificação gravada
// com a versão lida; a liberação desligada sem as ações; as estatísticas com a origem, a herança e o total com as
// parcelas; a coleta e o lançamento manual; a aba dos cadastros embutidos. Dados SINTÉTICOS; o fetch é simulado.
import {
  type ApoioCustos,
  type CentroCustoEstrutura,
  ESTATISTICAS_CUSTO,
  type ListaEstruturaCustos,
  type MatrizEstatisticas,
  TIPOS_PENDENCIA_ESTRUTURA,
  type ValorEstatistica,
} from '@sgh/contratos';
import { criarI18n, instalarUi, resolverMarca } from '@sgh/ui';
import { QueryClient, VueQueryPlugin } from '@tanstack/vue-query';
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { App } from 'vue';
import { mensagensWeb } from '../../i18n/pt-BR.js';
import CentrosCustoTela from './CentrosCustoTela.vue';
import {
  competenciasAte,
  filtrarCentros,
  lerQuantidade,
  parcelasDaEstatistica,
  quantidade,
  rotuloCompetencia,
} from './comum-custos.js';
import { mensagensCustos } from './i18n.js';
import { rotasCustos } from './rotas.js';

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
  mount(CentrosCustoTela as never, {
    attachTo: document.body,
    props: { hoje: '2026-03-20' } as never,
    global: {
      plugins: [
        criarI18n(mensagensWeb as unknown as Record<string, unknown>),
        ui,
        [VueQueryPlugin, { queryClient: new QueryClient({ defaultOptions: { queries: { retry: false } } }) }],
      ] as never,
      stubs: {
        RouterLink: { template: '<a><slot /></a>' },
        GrupoDominiosTela: {
          props: ['subitem', 'embutida'],
          template: '<div data-testid="grupo-stub">{{ subitem }}</div>',
        },
      },
    },
  });

type Pedido = { url: string; metodo: string; corpo: unknown };
function simular(rota: (url: string, metodo: string) => { status?: number; corpo: unknown }): Pedido[] {
  const pedidos: Pedido[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      const metodo = init?.method ?? 'GET';
      pedidos.push({
        url: String(url),
        metodo,
        corpo: typeof init?.body === 'string' ? JSON.parse(init.body) : null,
      });
      const r = rota(String(url), metodo);
      return new Response(JSON.stringify(r.corpo), {
        status: r.status ?? 200,
        headers: {
          'content-type': r.status && r.status >= 400 ? 'application/problem+json' : 'application/json',
        },
      });
    }),
  );
  return pedidos;
}
afterEach(() => {
  vi.unstubAllGlobals();
  document.body.innerHTML = '';
});

const apoio = (ligada = true, editar = true, registrar = true): ApoioCustos => ({
  classes: [
    { valor: 'produtivo', rotulo: 'Produtivo', descricao: 'Atende o paciente.' },
    { valor: 'auxiliar', rotulo: 'Auxiliar', descricao: 'Apoia os produtivos.' },
    { valor: 'administrativo', rotulo: 'Administrativo', descricao: 'Administra.' },
  ],
  estatisticas: ESTATISTICAS_CUSTO,
  fontes: [
    { valor: 'internacoes', rotulo: 'Internações do período (estimativa)' },
    { valor: 'manual', rotulo: 'Lançamento manual' },
    { valor: 'leitos', rotulo: 'Leitos das acomodações' },
  ],
  tiposDado: [
    { id: 1, nome: 'Lançamento' },
    { id: 2, nome: 'Referência' },
  ],
  unidades: [{ codigo: 0, nome: 'Unidade sintética' }],
  gruposExportacao: [{ id: 1, nome: 'Próprio', ativo: true }],
  acoes: { editar: ligada && editar, registrarEstatistica: ligada && registrar },
  liberacao: { ligada },
});
const centro = (id: number, codigo: number, nome: string, extra: Partial<CentroCustoEstrutura> = {}) =>
  ({
    id,
    codigo,
    nome,
    sigla: null,
    ativo: true,
    produtivoCadastro: null,
    classificacao: null,
    sugestao: null,
    ...extra,
  }) as CentroCustoEstrutura;
const classif = (
  classe: 'produtivo' | 'auxiliar' | 'administrativo',
  ordem: number | null,
  criterio: string | null,
) => ({
  classe,
  ordemRateio: ordem,
  criterio: criterio as never,
  unidadeMensuracao: null,
  observacao: null,
  versao: 3,
  alteradoPor: 'SINT.CUSTOS',
  alteradoEm: '2026-03-01T12:00:00Z',
});
const CENTROS = [
  centro(11, 101, 'UTI sintética', { classificacao: classif('produtivo', null, null), sigla: 'UTI' }),
  centro(12, 201, 'Lavanderia sintética', { classificacao: classif('auxiliar', 1, 'pacienteDia') }),
  centro(13, 301, 'Diretoria sintética', { sugestao: 'administrativo', produtivoCadastro: false }),
  centro(14, 102, 'Internação sintética', { sugestao: 'produtivo', produtivoCadastro: true }),
];
const estrutura = (): ListaEstruturaCustos => ({
  centros: CENTROS,
  pendencias: [
    {
      tipo: 'sem-classe',
      bloqueia: true,
      centros: [13, 14],
      mensagem: '2 centros ativos sem classe.',
    },
  ],
  contagem: { produtivo: 1, auxiliar: 1, administrativo: 0, semClasse: 2, total: 4 },
  sequencia: [{ id: 12, ordem: 1, criterio: 'pacienteDia' }],
});
const valor = (q: number, extra: Partial<ValorEstatistica> = {}): ValorEstatistica => ({
  id: 1,
  quantidade: q,
  origem: 'coletada',
  fonte: 'internacoes',
  estimada: true,
  herdadaDe: null,
  observacao: null,
  registradoPor: 'SINT.CUSTOS',
  registradoEm: '2026-03-02T12:00:00Z',
  ...extra,
});
const matriz = (): MatrizEstatisticas => ({
  competencia: '2026-03',
  linhas: [
    { centro: 14, valores: { pacienteDia: valor(120) } },
    {
      centro: 11,
      valores: { pacienteDia: valor(30.5, { origem: 'manual', fonte: 'manual', estimada: false }) },
    },
  ],
  totais: { pacienteDia: 150.5 },
  ultimaColeta: {
    id: 9,
    competencia: '2026-03',
    fontes: [
      {
        fonte: 'internacoes',
        grupos: 3,
        centros: 2,
        semCentro: 1,
        estimada: true,
        aviso: 'Censo do mês não fechado.',
      },
    ],
    gravadas: 2,
    substituidas: 0,
    duracaoMs: 1200,
    coletadaPor: 'SINT.CUSTOS',
    coletadaEm: '2026-03-02T12:00:00Z',
  },
  avisos: ['Paciente-dia estimado pelas internações.'],
});

function rotaPadrao(o: { apoio?: ApoioCustos; recusa?: string } = {}) {
  return (url: string, metodo: string) => {
    if (url === '/api/custos/apoio') return { corpo: o.apoio ?? apoio() };
    if (url === '/api/custos/centros') return { corpo: estrutura() };
    if (url.startsWith('/api/custos/centros/') && metodo === 'POST') {
      if (o.recusa)
        return {
          status: 409,
          corpo: { type: 'about:blank', title: 'Recusa', status: 409, codigo: o.recusa, detail: 'recusado' },
        };
      return { corpo: { centro: CENTROS[3], mudou: true } };
    }
    if (url.startsWith('/api/custos/estatisticas?')) return { corpo: matriz() };
    if (url === '/api/custos/estatisticas/coleta')
      return { corpo: { ...matriz().ultimaColeta, gravadas: 5 } };
    if (url === '/api/custos/estatisticas/lancamentos')
      return { corpo: { valor: valor(10, { origem: 'manual' }), substituidas: 1 } };
    return { status: 404, corpo: {} };
  };
}

function textos(o: unknown, caminho = ''): Array<[string, string]> {
  if (typeof o === 'string') return [[caminho, o]];
  if (o && typeof o === 'object')
    return Object.entries(o).flatMap(([k, v]) => textos(v, caminho ? `${caminho}.${k}` : k));
  return [];
}
async function selecionar(w: VueWrapper, testid: string, v: unknown): Promise<void> {
  const c = w.findAllComponents({ name: 'SanteSelecao' }).find((x) => x.attributes('data-testid') === testid);
  if (!c) throw new Error(`sem a seleção ${testid}`);
  c.vm.$emit('update:modelValue', v);
  await flushPromises();
}

describe('comuns dos custos (M54.4)', () => {
  it('competências e rótulo', () => {
    expect(competenciasAte('2026-02-10', 3)).toEqual(['2026-02', '2026-01', '2025-12']);
    expect(rotuloCompetencia('2026-03')).toBe('março de 2026');
    expect(rotuloCompetencia('x')).toBe('x');
  });
  it('quantidade com as casas e leitura do número digitado', () => {
    expect(quantidade(1234.5, 2)).toBe('1.234,50');
    expect(quantidade(1234, 0)).toBe('1.234');
    expect(lerQuantidade('37,5')).toBe(37.5);
    expect(lerQuantidade('1.234,56')).toBe(1234.56);
    expect(lerQuantidade('12.5')).toBe(12.5);
    expect(lerQuantidade('125')).toBe(125);
    expect(lerQuantidade('1,234')).toBeNull();
    expect(lerQuantidade('-1')).toBeNull();
    expect(lerQuantidade('')).toBeNull();
  });
  it('filtro pela classe, sem classe, código exato, nome sem acento e sigla', () => {
    expect(filtrarCentros(CENTROS, 'todas', '').map((c) => c.id)).toEqual([11, 12, 13, 14]);
    expect(filtrarCentros(CENTROS, 'auxiliar', '').map((c) => c.id)).toEqual([12]);
    expect(filtrarCentros(CENTROS, 'semClasse', '').map((c) => c.id)).toEqual([13, 14]);
    expect(filtrarCentros(CENTROS, 'todas', '301').map((c) => c.id)).toEqual([13]);
    expect(filtrarCentros(CENTROS, 'todas', 'internacao').map((c) => c.id)).toEqual([14]);
    expect(filtrarCentros(CENTROS, 'todas', 'uti').map((c) => c.id)).toEqual([11]);
  });
  it('parcelas em ordem de código do centro e soma em centésimos', () => {
    const cod = new Map(CENTROS.map((c) => [c.id, c.codigo]));
    const r = parcelasDaEstatistica(
      [
        { centro: 14, valores: { pacienteDia: valor(0.1) } },
        { centro: 11, valores: { pacienteDia: valor(0.2) } },
        { centro: 12, valores: {} },
      ],
      'pacienteDia',
      (id) => cod.get(id) ?? id,
    );
    expect(r.parcelas.map((p) => p.centro)).toEqual([11, 14]);
    expect(r.soma).toBe(0.3);
  });
});

describe('rota e textos (M54.4)', () => {
  it('a rota abre com custos.centro.ler (e as da etapa 5 com as suas)', () => {
    expect(rotasCustos.map((r) => [r.path, r.meta?.['permissao']])).toEqual([
      ['/custos/centros', 'custos.centro.ler'],
      ['/custos/apuracao', 'custos.apuracao.ler'],
      ['/custos/resultado', 'custos.resultado.ler'],
    ]);
  });
  it('nenhum texto cita o outro sistema nem nome de tabela', () => {
    const achados = textos(mensagensCustos).filter(([, t]) =>
      /spdata|legado|sistema atual|sistema antigo|\bTB[A-Z]{3,}|\bCT[A-Z]{3,}|SGH_/i.test(t),
    );
    expect(achados).toEqual([]);
  });
  it('cada estatística do catálogo tem rótulo e unidade; cada pendência é conhecida', () => {
    for (const e of ESTATISTICAS_CUSTO) expect(e.rotulo && e.unidade).toBeTruthy();
    expect(TIPOS_PENDENCIA_ESTRUTURA.length).toBeGreaterThan(0);
  });
});

describe('tela dos centros de custo (M54.4)', () => {
  it('estrutura: contagem com o total, sugestão, pendência com os centros e a sequência', async () => {
    simular(rotaPadrao());
    const w = montar();
    await flushPromises();
    expect(w.find('[data-testid="custos-contagem"]').text()).toContain(
      '1 produtivo(s) + 1 auxiliar(es) + 0 administrativo(s) + 2 sem classe = 4 centro(s) ativo(s)',
    );
    expect(w.find('[data-testid="custos-centro-301"]').text()).toContain('Sugerida: Administrativo');
    expect(w.find('[data-testid="custos-centro-101"]').text()).toContain('não rateia (recebe)');
    expect(w.find('[data-testid="custos-centro-201"]').text()).toContain('Paciente-dia');
    const p = w.find('[data-testid="custos-pendencia-sem-classe"]').text();
    expect(p).toContain('bloqueia a apuração');
    expect(p).toContain('301 Diretoria sintética; 102 Internação sintética');
    expect(w.find('[data-testid="custos-sequencia"]').text()).toContain(
      '1º 201 Lavanderia sintética, pelo critério Paciente-dia',
    );
    expect(w.find('[data-testid="custos-aviso-gravacao"]').exists()).toBe(false);
    w.unmount();
  });

  it('a busca e o filtro de classe reduzem a lista', async () => {
    simular(rotaPadrao());
    const w = montar();
    await flushPromises();
    await w
      .find('[data-testid="custos-filtro-termo"] input, input[data-testid="custos-filtro-termo"]')
      .setValue('lavand');
    expect(w.findAll('[data-testid^="custos-centro-"]')).toHaveLength(1);
    await w
      .find('[data-testid="custos-filtro-termo"] input, input[data-testid="custos-filtro-termo"]')
      .setValue('');
    await selecionar(w, 'custos-filtro-classe', 'semClasse');
    expect(w.findAll('[data-testid^="custos-centro-"]').map((x) => x.attributes('data-testid'))).toEqual([
      'custos-centro-301',
      'custos-centro-102',
    ]);
    await w
      .find('[data-testid="custos-filtro-termo"] input, input[data-testid="custos-filtro-termo"]')
      .setValue('zzz');
    expect(w.find('[data-testid="custos-nenhum"]').exists()).toBe(true);
    w.unmount();
  });

  it('classificar pela sugestão (produtivo) grava sem ordem nem critério, com a versão nula', async () => {
    const pedidos = simular(rotaPadrao());
    const w = montar();
    await flushPromises();
    await w.find('[data-testid="custos-classificar-102"]').trigger('click');
    expect(w.find('[data-testid="custos-ordem"]').exists()).toBe(false);
    await w.find('[data-testid="custos-classificar"]').trigger('submit');
    await flushPromises();
    const post = pedidos.find((p) => p.metodo === 'POST');
    expect(post?.url).toBe('/api/custos/centros/14');
    expect(post?.corpo).toEqual({
      classe: 'produtivo',
      ordemRateio: null,
      criterio: null,
      unidadeMensuracao: null,
      observacao: null,
      versao: null,
    });
    expect(w.find('[data-testid="custos-gravado"]').text()).toContain('102 Internação sintética');
    w.unmount();
  });

  it('auxiliar pede ordem e critério; grava com a versão lida; a recusa vira texto', async () => {
    const pedidos = simular(rotaPadrao({ recusa: 'desatualizado' }));
    const w = montar();
    await flushPromises();
    await w.find('[data-testid="custos-classificar-201"]').trigger('click');
    expect((w.find('[data-testid="custos-ordem"]').element as HTMLInputElement).value).toBe('1');
    await w.find('[data-testid="custos-ordem"]').setValue('abc');
    expect(w.text()).toContain('Informe a ordem como número inteiro de 1 a 999.');
    expect(w.find('[data-testid="custos-gravar-classificacao"]').attributes('disabled')).toBeDefined();
    await w.find('[data-testid="custos-ordem"]').setValue('2');
    await w.find('[data-testid="custos-classificar"]').trigger('submit');
    await flushPromises();
    const post = pedidos.find((p) => p.metodo === 'POST');
    expect(post?.corpo).toMatchObject({
      classe: 'auxiliar',
      ordemRateio: 2,
      criterio: 'pacienteDia',
      versao: 3,
    });
    expect(w.find('[data-testid="recusa-custos"]').text()).toContain('Outra pessoa alterou');
    w.unmount();
  });

  it('liberação desligada: o aviso aparece e nenhuma ação de gravar', async () => {
    simular(rotaPadrao({ apoio: apoio(false) }));
    const w = montar();
    await flushPromises();
    expect(w.find('[data-testid="custos-aviso-gravacao"]').text()).toContain('ainda não foi liberada');
    expect(w.find('[data-testid="custos-classificar-102"]').exists()).toBe(false);
    await w.find('[data-testid="custos-aba-estatisticas"]').trigger('click');
    await flushPromises();
    expect(w.find('[data-testid="custos-coletar"]').exists()).toBe(false);
    w.unmount();
  });

  it('estatísticas: origem, estimada, total com as parcelas, resumo da coleta e avisos', async () => {
    const pedidos = simular(rotaPadrao());
    const w = montar();
    await flushPromises();
    await w.find('[data-testid="custos-aba-estatisticas"]').trigger('click');
    await flushPromises();
    expect(pedidos.some((p) => p.url === '/api/custos/estatisticas?competencia=2026-03')).toBe(true);
    expect(w.find('[data-testid="custos-total"]').text()).toBe(
      'Total de Paciente-dia: 31 + 120 = 151 paciente-dia',
    );
    expect(w.find('[data-testid="custos-valor-101"]').text()).toContain('Lançada à mão');
    expect(w.find('[data-testid="custos-valor-102"]').text()).toContain('estimada');
    expect(w.find('[data-testid="custos-fonte-internacoes"]').text()).toContain('Censo do mês não fechado.');
    expect(w.find('[data-testid="custos-avisos"]').text()).toContain('estimado pelas internações');
    w.unmount();
  });

  it('coletar e lançar à mão', async () => {
    const pedidos = simular(rotaPadrao());
    const w = montar();
    await flushPromises();
    await w.find('[data-testid="custos-aba-estatisticas"]').trigger('click');
    await flushPromises();
    await w.find('[data-testid="custos-coletar"]').trigger('click');
    await flushPromises();
    expect(pedidos.find((p) => p.url === '/api/custos/estatisticas/coleta')?.corpo).toEqual({
      competencia: '2026-03',
    });
    expect(w.find('[data-testid="custos-coletada"]').text()).toContain('5 valor(es) gravado(s)');
    await w.find('[data-testid="custos-lancar"]').trigger('click');
    await selecionar(w, 'custos-lanc-centro', 12);
    await w.find('[data-testid="custos-lanc-quantidade"]').setValue('1,234');
    expect(w.text()).toContain('Informe um número de até duas casas decimais');
    await w.find('[data-testid="custos-lanc-quantidade"]').setValue('37,5');
    await w.find('[data-testid="custos-form-lancamento"]').trigger('submit');
    await flushPromises();
    expect(pedidos.find((p) => p.url === '/api/custos/estatisticas/lancamentos')?.corpo).toEqual({
      competencia: '2026-03',
      centro: 12,
      codigo: 'pacienteDia',
      quantidade: 37.5,
      observacao: null,
    });
    expect(w.find('[data-testid="custos-lancado"]').text()).toContain('201 Lavanderia sintética');
    w.unmount();
  });

  it('a aba dos cadastros embute o grupo do custeio', async () => {
    simular(rotaPadrao());
    const w = montar();
    await flushPromises();
    await w.find('[data-testid="custos-aba-cadastros"]').trigger('click');
    await flushPromises();
    expect(w.find('[data-testid="grupo-stub"]').text()).toBe('custosCadastros');
    w.unmount();
  });
});
