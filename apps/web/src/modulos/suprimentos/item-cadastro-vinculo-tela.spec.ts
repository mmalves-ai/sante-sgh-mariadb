// @vitest-environment jsdom
// Ficha do item já gravado (F3.6, 05-SUP linha 28): ao abrir /suprimentos/itens/cadastro/:id, a ficha carrega e o
// painel do vínculo com a referência de preço aparece com os vigentes de cada publicação. Mesma massa SINTÉTICA do E2E
// apps/web/e2e/f36-vinculo-referencia.spec.ts; o fetch é simulado.
import { criarI18n, instalarUi, resolverMarca } from '@sgh/ui';
import { QueryClient, VueQueryPlugin } from '@tanstack/vue-query';
import { flushPromises, mount } from '@vue/test-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { App } from 'vue';
import { createMemoryHistory, createRouter } from 'vue-router';
import { mensagensWeb } from '../../i18n/pt-BR.js';
import ItemCadastroTela from './telas/ItemCadastroTela.vue';

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

const ui = { install: (app: App) => instalarUi(app, resolverMarca(undefined).pacote) };
const HOJE = '2026-03-15';
const fichaItem = {
  id: 9001,
  versao: 3,
  situacao: 'ativo',
  saldoTotal: 0,
  registrosNaData: [],
  nomesPrincipios: {},
  nomesFabricantes: {},
  codigo: 'MAT-SINT-1',
  nome: 'SERINGA SINTETICA 10 ML',
  nomeResumido: null,
  tipo: 'material',
  grupo: 1,
  subgrupo: null,
  unidadeEstoque: 11,
  unidadeCompra: null,
  fatorCompraEstoque: 1,
  unidadeConsumo: null,
  fatorEstoqueConsumo: 1,
  unidadePrescricao: null,
  fatorConsumoPrescricao: 1,
  fabricante: null,
  gtin: null,
  ncm: null,
  cest: null,
  classeRisco: null,
  controlaLote: false,
  controlaValidade: false,
  controlado: false,
  antimicrobiano: false,
  altaVigilancia: false,
  fracionavel: false,
  prescritivel: false,
  estoqueMinimo: null,
  estoqueMaximo: null,
  principiosAtivos: [],
  vias: [],
  codigosBarras: [],
  apresentacoes: [],
  estabilidades: [],
};
const apoio = {
  hoje: HOJE,
  grupos: [{ id: 1, codigo: 'G1', nome: 'MATERIAIS SINTETICOS' }],
  subgrupos: [],
  unidades: [{ id: 11, codigo: 'UN', nome: 'UNIDADE' }],
  vias: [],
  setores: [],
  centrosCusto: [],
  locais: [],
  guardas: [],
  diluentes: [],
};
const referencia = (id: number, fonte: string, codigo: string) => ({
  id,
  fonte,
  codigo,
  descricao: `REFERENCIA SINTETICA ${codigo}`,
  apresentacao: null,
  tipoProduto: 'material',
  situacao: 'ativo',
  unidade: 'CX',
  ean: null,
});
const vinculo = (id: number, r: ReturnType<typeof referencia>) => ({
  id,
  versao: 1,
  referencia: r,
  edicao: { id: 41, numero: 'ED-SINT-9' },
  fator: 10,
  inicio: '2026-01-01',
  fim: null,
  vigente: true,
});
const historico = [
  vinculo(51, referencia(301, 'simpro', 'SIMP-OLD')),
  vinculo(52, referencia(303, 'brasindice', 'BRAS-77')),
];

function simular() {
  const urls: string[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      urls.push(url);
      const corpo = url.includes('/referencias-preco')
        ? {
            hoje: HOJE,
            item: { id: 9001, codigo: 'MAT-SINT-1', nome: 'SERINGA SINTETICA 10 ML', unidade: 'UN' },
            vigentes: historico,
            historico,
          }
        : url.endsWith('/apoio')
          ? apoio
          : url.endsWith('/itens/9001')
            ? fichaItem
            : null;
      return corpo === null
        ? new Response(JSON.stringify({ title: 'Não simulado', status: 404 }), {
            status: 404,
            headers: { 'content-type': 'application/problem+json' },
          })
        : new Response(JSON.stringify(corpo), {
            status: 200,
            headers: { 'content-type': 'application/json' },
          });
    }),
  );
  return urls;
}

afterEach(() => vi.unstubAllGlobals());

describe('ficha do item com o painel do vínculo da referência de preço', () => {
  it('abre o item gravado pelo caminho da ficha e mostra o vigente de cada publicação', async () => {
    const urls = simular();
    const router = createRouter({
      history: createMemoryHistory(),
      routes: [{ path: '/suprimentos/itens/cadastro/:id(\\d+)?', component: ItemCadastroTela }],
    });
    await router.push('/suprimentos/itens/cadastro/9001');
    await router.isReady();
    const w = mount(ItemCadastroTela, {
      global: {
        plugins: [
          router,
          [VueQueryPlugin, { queryClient: new QueryClient() }],
          criarI18n(mensagensWeb as unknown as Record<string, unknown>),
          ui,
        ] as never,
      },
    });
    for (let i = 0; i < 5; i++) await flushPromises();
    expect(urls).toContain('/api/suprimentos/cadastro/itens/9001');
    expect(w.find('[data-testid="vinculo-referencia"]').exists()).toBe(true);
    expect(w.find('[data-testid="vinculo-referencia-vigente-simpro"]').text()).toContain('SIMP-OLD');
    expect(w.find('[data-testid="vinculo-referencia-vigente-brasindice"]').text()).toContain('BRAS-77');
  });
});
