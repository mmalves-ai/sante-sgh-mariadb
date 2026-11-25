// @vitest-environment jsdom
// Tela "Orçamento empresarial" (M54, etapa 7): os comuns (reais ↔ centavos sem ponto flutuante, ajuste percentual,
// grade: o que mudou, repetir, repartir, totais, conta com as parcelas); a rota com a permissão; os textos sem nome de
// outro sistema; as versões com o total e as parcelas; criar do realizado com ajuste; a grade gravando só o que mudou
// com a versão lida; a linha nova; a aprovação com o motivo da recusa visível e a segregação; o descarte com motivo; a
// liberação desligada sem as ações; o comparativo com o desvio, a avaliação, a conta das parcelas e os avisos.
// Dados SINTÉTICOS; o fetch é simulado.
import type {
  ApoioOrcamento,
  ComparativoOrcamento,
  LinhaOrcamento,
  OrcamentoDetalhe,
  OrcamentoVersao,
} from '@sgh/contratos';
import { criarI18n, instalarUi, resolverMarca } from '@sgh/ui';
import { QueryClient, VueQueryPlugin } from '@tanstack/vue-query';
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { App } from 'vue';
import { mensagensWeb } from '../../i18n/pt-BR.js';
import {
  anosDoOrcamento,
  contaComParcelas,
  entradaDaGrade,
  gradeDasLinhas,
  lerAjuste,
  lerReais,
  linhaMudou,
  novaLinhaGrade,
  percentual,
  reais,
  repartirAno,
  repetirMes,
  totaisDaGrade,
} from './comum-orcamento.js';
import { mensagensOrcamento } from './i18n.js';
import OrcamentoTela from './OrcamentoTela.vue';
import { rotasOrcamento } from './rotas.js';

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
  mount(OrcamentoTela as never, {
    attachTo: document.body,
    props: { hoje: '2026-03-20' } as never,
    global: {
      plugins: [
        criarI18n(mensagensWeb as unknown as Record<string, unknown>),
        ui,
        [VueQueryPlugin, { queryClient: new QueryClient({ defaultOptions: { queries: { retry: false } } }) }],
      ] as never,
      stubs: {
        RouterLink: { props: ['to'], template: '<a :href="to"><slot /></a>' },
        SanteDialogo: {
          props: ['visivel', 'titulo'],
          template: '<div v-if="visivel" :data-titulo="titulo"><slot /></div>',
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

const apoio = (o: Partial<ApoioOrcamento> = {}): ApoioOrcamento => ({
  naturezas: [
    { codigo: 'despesa', rotulo: 'Despesa', descricao: 'Despesas sintéticas.' },
    { codigo: 'receita', rotulo: 'Receita', descricao: 'Receitas sintéticas.' },
    { codigo: 'consumo', rotulo: 'Consumo de estoque', descricao: 'Consumo sintético.' },
  ],
  centros: [
    { id: 11, codigo: 101, nome: 'UTI sintética', ativo: true },
    { id: 12, codigo: 201, nome: 'Lavanderia sintética', ativo: true },
    { id: 13, codigo: 999, nome: 'Inativo sintético', ativo: false },
  ],
  itens: [
    {
      grupo: 3,
      subgrupo: 1,
      item: 2,
      nome: 'Energia sintética',
      grupoNome: 'Utilidades',
      natureza: 'despesa',
      ativo: true,
    },
    {
      grupo: 1,
      subgrupo: 1,
      item: 1,
      nome: 'Diárias sintéticas',
      grupoNome: 'Serviços',
      natureza: 'receita',
      ativo: true,
    },
  ],
  parametros: { anoInicial: 2020, mesInicial: 1, digitaCentro: true, regime: null },
  chaveLigada: true,
  acoes: { editar: true, aprovar: true },
  ...o,
});

const versao = (o: Partial<OrcamentoVersao> = {}): OrcamentoVersao => ({
  id: 7,
  empresa: 1,
  ano: 2026,
  numero: 2,
  descricao: 'Orçamento sintético',
  situacao: 'rascunho',
  base: 'vazio',
  linhas: 2,
  totalCentavos: 1_500_000,
  totaisPorNatureza: { despesa: 1_200_000, receita: 300_000, consumo: 0 },
  versao: 4,
  criadoPor: 'SINT.ORCAMENTO',
  criadoEm: '2026-03-01T10:00:00',
  alteradoPor: 'SINT.ORCAMENTO',
  alteradoEm: '2026-03-02T11:30:00',
  aprovadoPor: null,
  aprovadoEm: null,
  observacaoAprovacao: null,
  descartadoPor: null,
  motivoDescarte: null,
  ...o,
});

const linha = (o: Partial<LinhaOrcamento>): LinhaOrcamento => ({
  centro: 11,
  natureza: 'despesa',
  grupo: 3,
  subgrupo: 1,
  item: 2,
  meses: Array<number>(12).fill(100_000),
  totalCentavos: 1_200_000,
  observacao: null,
  ...o,
});

const detalhe = (o: Partial<OrcamentoDetalhe> = {}): OrcamentoDetalhe => ({
  orcamento: versao(),
  linhas: [
    linha({}),
    linha({
      centro: 0,
      natureza: 'receita',
      grupo: 1,
      subgrupo: 1,
      item: 1,
      meses: [300_000, ...Array<number>(11).fill(0)],
      totalCentavos: 300_000,
    }),
  ],
  acoes: {
    editar: true,
    aprovar: false,
    descartar: true,
    motivoSemAprovar: 'Quem montou a versão não a aprova.',
  },
  ...o,
});

const comparativo = (): ComparativoOrcamento => ({
  orcamento: versao(),
  mesAte: 3,
  visao: 'linha',
  centro: null,
  item: null,
  linhas: [
    {
      centro: 11,
      natureza: 'despesa',
      grupo: 3,
      subgrupo: 1,
      item: 2,
      rotuloCentro: '101 · UTI sintética',
      rotuloItem: '3.1.2 · Energia sintética',
      orcadoCentavos: 300_000,
      realizadoCentavos: 330_000,
      desvioCentavos: 30_000,
      desvioPercentual: 10,
      favoravel: false,
      naoOrcado: false,
      orcadoMeses: [],
      realizadoMeses: [],
    },
    {
      centro: 12,
      natureza: 'consumo',
      grupo: 0,
      subgrupo: 0,
      item: 0,
      rotuloCentro: '201 · Lavanderia sintética',
      rotuloItem: 'Consumo de estoque (custo médio)',
      orcadoCentavos: 0,
      realizadoCentavos: 5_000,
      desvioCentavos: 5_000,
      desvioPercentual: null,
      favoravel: false,
      naoOrcado: true,
      orcadoMeses: [],
      realizadoMeses: [],
    },
  ],
  totais: [
    {
      natureza: 'despesa',
      orcadoCentavos: 300_000,
      realizadoCentavos: 330_000,
      desvioCentavos: 30_000,
      desvioPercentual: 10,
      favoravel: false,
      parcelasOrcado: [{ rotulo: '101 · UTI sintética', centavos: 300_000 }],
      parcelasRealizado: [{ rotulo: '101 · UTI sintética', centavos: 330_000 }],
    },
  ],
  realizadoSemCentroCentavos: { despesa: 12_345, receita: 0 },
  avisos: ['O realizado do ano ainda está aberto: o último movimento lido é de 15/03/2026.'],
  lidoEm: '2026-03-20T09:00:00',
});

function rotaPadrao(
  o: {
    apoio?: ApoioOrcamento;
    detalhe?: OrcamentoDetalhe;
    recusa?: string;
    versoes?: OrcamentoVersao[];
  } = {},
) {
  return (url: string, metodo: string) => {
    if (url === '/api/financeiro/orcamento/apoio') return { corpo: o.apoio ?? apoio() };
    if (url.startsWith('/api/financeiro/orcamento/versoes?') || url === '/api/financeiro/orcamento/versoes') {
      if (metodo === 'POST') return { status: 201, corpo: { id: 8, numero: 3, linhas: 40, descartadas: 2 } };
      return {
        corpo: { versoes: o.versoes ?? [versao(), versao({ id: 5, numero: 1, situacao: 'aprovado' })] },
      };
    }
    if (o.recusa && metodo === 'POST')
      return {
        status: 409,
        corpo: { type: 'about:blank', title: 'Recusa', status: 409, codigo: o.recusa, detail: 'recusado' },
      };
    if (/\/versoes\/\d+\/comparativo/u.test(url)) return { corpo: comparativo() };
    if (/\/versoes\/\d+\/linhas$/u.test(url))
      return {
        corpo: {
          versao: 5,
          mudou: true,
          incluidas: 1,
          alteradas: 1,
          removidas: 0,
          totalAntes: 1_500_000,
          totalDepois: 1_600_000,
        },
      };
    if (/\/versoes\/\d+\/aprovacao$/u.test(url)) return { corpo: { substituida: 5 } };
    if (/\/versoes\/\d+\/descarte$/u.test(url)) return { corpo: { descartada: true } };
    if (/\/versoes\/\d+$/u.test(url)) return { corpo: o.detalhe ?? detalhe() };
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
async function abrirVersao(w: VueWrapper): Promise<void> {
  await flushPromises();
  await w.find('[data-testid="orc-abrir-2"]').trigger('click');
  await flushPromises();
}
const K1 = '11|despesa|3.1.2';
const K2 = '0|receita|1.1.1';

describe('comuns do orçamento (M54.7)', () => {
  it('reais ↔ centavos sem ponto flutuante', () => {
    expect(reais(123456)).toBe('1.234,56');
    expect(reais(5)).toBe('0,05');
    expect(reais(-30000)).toBe('-300,00');
    expect(reais(100_000_000_00)).toBe('100.000.000,00');
    expect(lerReais('1.234,56')).toBe(123456);
    expect(lerReais('1234,5')).toBe(123450);
    expect(lerReais('1234.56')).toBe(123456);
    expect(lerReais('R$ 10')).toBe(1000);
    expect(lerReais('0,1')).toBe(10);
    expect(lerReais('')).toBe(0);
    expect(lerReais('-1')).toBeNull();
    expect(lerReais('1,234')).toBeNull();
    expect(lerReais('abc')).toBeNull();
    expect(lerReais('99999999999999,99')).toBeNull();
    // 0,1 + 0,2 em reais soma 30 centavos exatos.
    expect((lerReais('0,1') ?? 0) + (lerReais('0,2') ?? 0)).toBe(30);
  });
  it('ajuste em centésimos de ponto, percentual e anos', () => {
    expect(lerAjuste('5')).toBe(500);
    expect(lerAjuste('-2,5')).toBe(-250);
    expect(lerAjuste('+10,25%')).toBe(1025);
    expect(lerAjuste('')).toBe(0);
    expect(lerAjuste('-101')).toBeNull();
    expect(lerAjuste('1001')).toBeNull();
    expect(lerAjuste('x')).toBeNull();
    expect(percentual(10)).toBe('+10,00%');
    expect(percentual(-3.5)).toBe('-3,50%');
    expect(percentual(null)).toBe('—');
    expect(anosDoOrcamento('2026-03-20')).toEqual([2027, 2026, 2025, 2024, 2023, 2022, 2021, 2020]);
  });
  it('grade: o que mudou, repetir, repartir, totais e só as linhas mudadas na entrada', () => {
    const g = gradeDasLinhas([linha({})]);
    expect(linhaMudou(g[0]!)).toBe(false);
    g[0]!.textos[0] = '2.000,00';
    expect(linhaMudou(g[0]!)).toBe(true);
    repetirMes(g[0]!, 0);
    expect(g[0]!.textos.every((x) => x === '2.000,00')).toBe(true);
    const n = novaLinhaGrade({ centro: 0, natureza: 'consumo', grupo: 0, subgrupo: 0, item: 0 });
    expect(linhaMudou(n)).toBe(false); // linha nova vazia não vai
    repartirAno(n, 100_005);
    expect(n.textos[0]).toBe('83,34');
    expect(n.textos[8]).toBe('83,34');
    expect(n.textos[9]).toBe('83,33');
    const t = totaisDaGrade([...g, n]);
    expect(t.despesa.ano).toBe(2_400_000);
    expect(t.consumo.ano).toBe(100_005);
    expect(t.consumo.meses[0]).toBe(8_334);
    const inval = novaLinhaGrade({ centro: 12, natureza: 'despesa', grupo: 3, subgrupo: 1, item: 2 });
    inval.textos[3] = 'x';
    const e = entradaDaGrade([...g, n, inval]);
    expect(e.invalidas).toBe(1);
    expect(e.linhas.map((l) => [l.centro, l.natureza, l.meses[0]])).toEqual([
      [11, 'despesa', 200_000],
      [0, 'consumo', 8_334],
    ]);
  });
  it('conta com as parcelas impressas', () => {
    expect(
      contaComParcelas(
        [
          { rotulo: 'A', centavos: 100 },
          { rotulo: 'B', centavos: 250 },
        ],
        350,
      ),
    ).toBe('R$ 1,00 (A) + R$ 2,50 (B) = R$ 3,50');
    expect(contaComParcelas([], 0)).toBe('R$ 0,00');
  });
});

describe('rota e textos (M54.7)', () => {
  it('a rota abre com financeiro.orcamento.ler', () => {
    expect(rotasOrcamento.map((r) => [r.path, r.meta?.['permissao']])).toEqual([
      ['/financeiro/orcamento', 'financeiro.orcamento.ler'],
      ['/financeiro/orcamento/projetos', 'financeiro.orcamento.ler'],
      ['/financeiro/orcamento/controle', 'financeiro.orcamento.ler'],
    ]);
  });
  it('nenhum texto cita o outro sistema, nome de tabela ou caractere especial do vue-i18n', () => {
    const achados = textos(mensagensOrcamento).filter(
      ([, t]) =>
        /spdata|legado|sistema atual|sistema antigo|SGH_|[|@]/i.test(t) ||
        /\b(MO|MF|TB|GE)[A-Z]{3,}/u.test(t),
    );
    expect(achados).toEqual([]);
  });
});

describe('tela do orçamento empresarial (M54.7)', () => {
  it('versões do ano com o total e as parcelas por natureza; parâmetros só leitura', async () => {
    const pedidos = simular(rotaPadrao());
    const w = montar();
    await flushPromises();
    expect(pedidos.some((p) => p.url === '/api/financeiro/orcamento/versoes?ano=2026')).toBe(true);
    const v = w.find('[data-testid="orc-versao-2"]').text();
    expect(v).toContain('Em elaboração');
    expect(v).toContain('R$ 15.000,00');
    expect(v).toContain('Receita R$ 3.000,00 · Despesa R$ 12.000,00 · Consumo R$ 0,00');
    expect(w.find('[data-testid="orc-aviso-gravacao"]').exists()).toBe(false);
    await w.find('[data-testid="orc-aba-parametros"]').trigger('click');
    const p = w.find('[data-testid="orc-parametros"]').text();
    expect(p).toContain('2020');
    expect(p).toContain('Não informado');
    expect(w.find('[data-testid="orc-consulta-parametros"]').attributes('href')).toBe(
      '/consultas/item/financeiro.orcamento-empresarial',
    );
    w.unmount();
  });

  it('criar do realizado do ano anterior com ajuste de +5% abre a versão nova', async () => {
    const pedidos = simular(rotaPadrao());
    const w = montar();
    await flushPromises();
    await w.find('[data-testid="orc-nova"]').trigger('click');
    await w
      .find('[data-testid="orc-nova-descricao"] input, input[data-testid="orc-nova-descricao"]')
      .setValue('Revisão sintética');
    await w.find('input[type="radio"][value="realizado"]').setValue(true);
    await w.find('[data-testid="orc-nova-ajuste"]').setValue('5');
    await w.find('[data-testid="orc-form-nova"]').trigger('submit');
    await flushPromises();
    const post = pedidos.find((p) => p.metodo === 'POST');
    expect(post?.url).toBe('/api/financeiro/orcamento/versoes');
    expect(post?.corpo).toEqual({
      ano: 2026,
      empresa: 1,
      descricao: 'Revisão sintética',
      base: { tipo: 'realizado', ajusteCentesimos: 500 },
    });
    expect(w.find('[data-testid="orc-criada"]').exists()).toBe(false); // a versão nova já abriu
    expect(pedidos.some((p) => p.url === '/api/financeiro/orcamento/versoes/8')).toBe(true);
    w.unmount();
  });

  it('grade: altera um mês, inclui linha e grava só o que mudou com a versão lida', async () => {
    const pedidos = simular(rotaPadrao());
    const w = montar();
    await abrirVersao(w);
    expect(w.find('[data-testid="orc-motivo-sem-aprovar"]').text()).toContain(
      'Quem montou a versão não a aprova.',
    );
    expect(w.find('[data-testid="orc-aprovar"]').attributes('disabled')).toBeDefined();
    expect(w.find(`[data-testid="orc-total-${K1}"]`).text()).toBe('12.000,00');
    expect(w.find('[data-testid="orc-total-natureza-despesa"]').text()).toContain(
      '1 linha(s), R$ 12.000,00 no ano',
    );
    expect(w.find('[data-testid="orc-pendentes"]').text()).toContain('Nenhuma alteração');
    await w.find(`[data-testid="orc-mes-${K1}-2"]`).setValue('1.500,00');
    expect(w.find(`[data-testid="orc-total-${K1}"]`).text()).toBe('12.500,00');
    // linha nova: centro 201, consumo, 1.200,00 no ano
    await selecionar(w, 'orc-incluir-centro', 12);
    await selecionar(w, 'orc-incluir-natureza', 'consumo');
    await w.find('[data-testid="orc-incluir-anual"]').setValue('1.200,00');
    await w.find('[data-testid="orc-form-incluir"]').trigger('submit');
    await flushPromises();
    expect(w.find('[data-testid="orc-linha-12|consumo|0.0.0"]').exists()).toBe(true);
    expect(w.find('[data-testid="orc-pendentes"]').text()).toContain('2 linha(s) alterada(s)');
    // a mesma linha de novo é recusada na tela
    await w.find('[data-testid="orc-form-incluir"]').trigger('submit');
    expect(w.find('[data-testid="orc-incluir-aviso"]').text()).toContain('já está na grade');
    await w.find('[data-testid="orc-gravar"]').trigger('click');
    await flushPromises();
    const post = pedidos.find((p) => p.metodo === 'POST');
    expect(post?.url).toBe('/api/financeiro/orcamento/versoes/7/linhas');
    const corpo = post?.corpo as { versao: number; linhas: Array<{ centro: number; meses: number[] }> };
    expect(corpo.versao).toBe(4);
    expect(corpo.linhas.map((l) => [l.centro, l.meses[1], l.meses[11]])).toEqual([
      [11, 150_000, 100_000],
      [12, 10_000, 10_000],
    ]);
    expect(w.find('[data-testid="orc-mensagem"]').text()).toContain(
      '1 incluída(s), 1 alterada(s), 0 removida(s). Total do ano de R$ 15.000,00 para R$ 16.000,00.',
    );
    w.unmount();
  });

  it('valor inválido bloqueia a gravação e marca o mês; desfazer volta ao lido', async () => {
    simular(rotaPadrao());
    const w = montar();
    await abrirVersao(w);
    await w.find(`[data-testid="orc-mes-${K2}-1"]`).setValue('12,345');
    expect(w.find('[data-testid="orc-invalidas"]').text()).toContain('1 linha(s) com valor inválido');
    expect(w.find(`[data-testid="orc-linha-${K2}"]`).text()).toContain('Valor inválido em jan.');
    expect(w.find('[data-testid="orc-gravar"]').attributes('disabled')).toBeDefined();
    await w.find('[data-testid="orc-desfazer"]').trigger('click');
    expect(w.find('[data-testid="orc-invalidas"]').exists()).toBe(false);
    expect((w.find(`[data-testid="orc-mes-${K2}-1"]`).element as HTMLInputElement).value).toBe('3.000,00');
    w.unmount();
  });

  it('filtro por centro e por texto', async () => {
    simular(rotaPadrao());
    const w = montar();
    await abrirVersao(w);
    await selecionar(w, 'orc-filtro-centro', 0);
    expect(w.findAll('[data-testid^="orc-linha-"]').map((x) => x.attributes('data-testid'))).toEqual([
      `orc-linha-${K2}`,
    ]);
    await selecionar(w, 'orc-filtro-centro', null);
    await w.find('[data-testid="orc-filtro-termo"]').setValue('energia');
    expect(w.findAll('[data-testid^="orc-linha-"]')).toHaveLength(1);
    await w.find('[data-testid="orc-filtro-termo"]').setValue('zzz');
    expect(w.find('[data-testid="orc-grade-nenhuma"]').exists()).toBe(true);
    w.unmount();
  });

  it('aprovar (outra pessoa) com observação; a recusa por segregação vira texto', async () => {
    const d = detalhe({ acoes: { editar: false, aprovar: true, descartar: false, motivoSemAprovar: null } });
    const pedidos = simular(rotaPadrao({ detalhe: d }));
    const w = montar();
    await abrirVersao(w);
    expect(w.find('[data-testid="orc-form-incluir"]').exists()).toBe(false);
    expect(w.find(`[data-testid="orc-mes-${K1}-1"]`).exists()).toBe(false);
    await w.find('[data-testid="orc-aprovar"]').trigger('click');
    await w
      .find('[data-testid="orc-aprovar-observacao"] textarea, textarea[data-testid="orc-aprovar-observacao"]')
      .setValue('Conferido pela controladoria');
    await w.find('[data-testid="orc-form-aprovar"]').trigger('submit');
    await flushPromises();
    const post = pedidos.find((p) => p.metodo === 'POST');
    expect(post?.url).toBe('/api/financeiro/orcamento/versoes/7/aprovacao');
    expect(post?.corpo).toEqual({ versao: 4, observacao: 'Conferido pela controladoria' });
    expect(w.find('[data-testid="orc-mensagem"]').text()).toContain('substituiu a versão anterior');
    w.unmount();

    simular(rotaPadrao({ detalhe: d, recusa: 'segregacao' }));
    const w2 = montar();
    await abrirVersao(w2);
    await w2.find('[data-testid="orc-aprovar"]').trigger('click');
    await w2.find('[data-testid="orc-form-aprovar"]').trigger('submit');
    await flushPromises();
    expect(w2.find('[data-testid="recusa-orcamento"]').text()).toContain('outra pessoa aprova');
    w2.unmount();
  });

  it('descartar exige o motivo', async () => {
    const pedidos = simular(rotaPadrao());
    const w = montar();
    await abrirVersao(w);
    await w.find('[data-testid="orc-descartar"]').trigger('click');
    expect(w.find('[data-testid="orc-descartar-confirmar"]').attributes('disabled')).toBeDefined();
    await w
      .find('[data-testid="orc-descartar-motivo"] textarea, textarea[data-testid="orc-descartar-motivo"]')
      .setValue('Versão de teste sintética');
    await w.find('[data-testid="orc-form-descartar"]').trigger('submit');
    await flushPromises();
    const post = pedidos.find((p) => p.metodo === 'POST');
    expect(post?.url).toBe('/api/financeiro/orcamento/versoes/7/descarte');
    expect(post?.corpo).toEqual({ versao: 4, motivo: 'Versão de teste sintética' });
    expect(w.find('[data-testid="orc-mensagem"]').text()).toContain('Versão descartada.');
    w.unmount();
  });

  it('liberação desligada: aviso e sem criar; versão aprovada fechada', async () => {
    const d = detalhe({
      orcamento: versao({
        situacao: 'aprovado',
        aprovadoPor: 'SINT.ORCAMENTO.APROVA',
        aprovadoEm: '2026-03-03T08:00:00',
      }),
      acoes: { editar: false, aprovar: false, descartar: false, motivoSemAprovar: null },
    });
    simular(rotaPadrao({ apoio: apoio({ chaveLigada: false }), detalhe: d }));
    const w = montar();
    await flushPromises();
    expect(w.find('[data-testid="orc-aviso-gravacao"]').text()).toContain('ainda não foi liberado');
    expect(w.find('[data-testid="orc-nova"]').exists()).toBe(false);
    await abrirVersao(w);
    expect(w.find('[data-testid="orc-fechada"]').exists()).toBe(true);
    expect(w.find('[data-testid="orc-aprovar"]').exists()).toBe(false);
    expect(w.find('[data-testid="orc-aprovado-por"]').text()).toContain(
      'SINT.ORCAMENTO.APROVA em 03/03/2026 08:00',
    );
    w.unmount();
  });

  it('comparativo: desvio, avaliação, não orçado, conta das parcelas, sem centro e avisos', async () => {
    const pedidos = simular(rotaPadrao());
    const w = montar();
    await abrirVersao(w);
    await w.find('[data-testid="orc-aba-comparativo"]').trigger('click');
    await flushPromises();
    expect(
      pedidos.some((p) => p.url === '/api/financeiro/orcamento/versoes/7/comparativo?visao=linha&mesAte=3'),
    ).toBe(true);
    const l1 = w.find(`[data-testid="orc-comp-${K1}"]`).text();
    expect(l1).toContain('3.300,00');
    expect(l1).toContain('+10,00%');
    expect(l1).toContain('Desfavorável');
    expect(w.find('[data-testid="orc-comp-12|consumo|0.0.0"]').text()).toContain('Não orçado');
    expect(w.find('[data-testid="orc-comp-total-despesa"]').text()).toContain(
      'Despesa: orçado R$ 3.000,00, realizado R$ 3.300,00, desvio R$ 300,00 (+10,00%), Desfavorável',
    );
    expect(w.find('[data-testid="orc-comp-conta-realizado-despesa"]').text()).toBe(
      'R$ 3.300,00 (101 · UTI sintética) = R$ 3.300,00',
    );
    expect(w.find('[data-testid="orc-comp-sem-centro"]').text()).toContain('despesa R$ 123,45');
    expect(w.find('[data-testid="orc-comp-aviso-0"]').text()).toContain('ainda está aberto');
    await selecionar(w, 'orc-comp-visao', 'centro');
    await selecionar(w, 'orc-comp-mes', 12);
    expect(pedidos.some((p) => p.url.endsWith('/comparativo?visao=centro&mesAte=12'))).toBe(true);
    // Recorte por centro e por item (com busca), mandado ao servidor.
    const sel = (id: string) =>
      w.findAllComponents({ name: 'SanteSelecao' }).find((x) => x.attributes('data-testid') === id)!;
    expect(sel('orc-comp-centro').props('busca')).toBe(true);
    expect(sel('orc-comp-item').props('busca')).toBe(true);
    await selecionar(w, 'orc-comp-centro', 11);
    expect(pedidos.some((p) => p.url.endsWith('/comparativo?visao=centro&mesAte=12&centro=11'))).toBe(true);
    await selecionar(w, 'orc-comp-item', '3.1.2');
    expect(
      pedidos.some((p) => p.url.endsWith('/comparativo?visao=centro&mesAte=12&centro=11&item=3.1.2')),
    ).toBe(true);
    await selecionar(w, 'orc-comp-centro', null);
    expect(pedidos.some((p) => p.url.endsWith('/comparativo?visao=centro&mesAte=12&item=3.1.2'))).toBe(true);
    w.unmount();
  });
});
