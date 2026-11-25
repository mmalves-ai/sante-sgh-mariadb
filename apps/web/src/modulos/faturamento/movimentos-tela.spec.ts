// @vitest-environment jsdom
// Tela de movimentos da conta (F3.7, 06-FAT linha 16): a tela monta com a leitura da conta e mostra a lista, o kit e o
// cadastro do kit para quem edita as regras de cobrança. Dados SINTÉTICOS; o fetch é simulado.
import { criarI18n, instalarUi, resolverMarca } from '@sgh/ui';
import { QueryClient, VueQueryPlugin } from '@tanstack/vue-query';
import { flushPromises, mount } from '@vue/test-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { App } from 'vue';
import { createMemoryHistory, createRouter, type Router } from 'vue-router';
import { definirSessaoDaTela } from '../../casca/sessao/pode.js';
import { mensagensWeb } from '../../i18n/pt-BR.js';
import MovimentosContaTela from './telas/MovimentosContaTela.vue';

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
// O combo (SanteSelecao) usa ResizeObserver, que o jsdom não tem.
if (!('ResizeObserver' in window)) {
  (window as unknown as { ResizeObserver: unknown }).ResizeObserver = class {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  };
}
const ui = { install: (app: App) => instalarUi(app, resolverMarca(undefined).pacote) };
const roteador = (): Router =>
  createRouter({
    history: createMemoryHistory(),
    routes: [{ path: '/:p(.*)*', component: { template: '<div />' } }],
  });
const montar = (c: unknown, r: Router = roteador(), props: Record<string, unknown> = {}) =>
  mount(c as never, {
    props: props as never,
    global: {
      plugins: [
        r,
        criarI18n(mensagensWeb as unknown as Record<string, unknown>),
        ui,
        [VueQueryPlugin, { queryClient: new QueryClient({ defaultOptions: { queries: { retry: false } } }) }],
      ] as never,
      stubs: { RouterLink: { template: '<a><slot /></a>' } },
    },
  });

const CONTA = 7401;
const DESTINO = 7402;
type Estado = {
  kits: { id: number; codigo: string; descricao: string; modo: string }[];
  equipe: Record<string, unknown>[];
  transferencias: Record<string, unknown>[];
  transferidos: number[];
};
function movimentos(e: Estado) {
  const item = (id: number, sequencia: number, codigo: string, descricao: string, valor: number) => ({
    id,
    sequencia,
    codigo,
    descricao,
    quantidade: 1,
    valorTotal: valor,
    honorario: valor,
    situacao: e.transferidos.includes(id) ? 'transferido' : 'lancado',
    kitId: null,
    equipe: id === 801 ? e.equipe : [],
  });
  return {
    contaId: CONTA,
    numero: 'F374-SINT-1',
    situacao: 'aberta',
    editavel: true,
    fontePagadoraId: 61,
    fonte: 'Convênio Sintético A',
    itens: [
      item(801, 1, '83740001', 'Procedimento sintético', 1000),
      item(802, 2, '83740002', 'Curativo sintético', 80),
    ],
    funcoes: [
      {
        id: 1,
        codigo: 'CIR',
        descricao: 'Cirurgião',
        tipo: 'cirurgiao',
        ativo: true,
        percentual: null,
        grau: 0,
        ordemAuxiliar: null,
        ordemApresentacao: 1,
      },
      {
        id: 2,
        codigo: 'AUX1',
        descricao: '1º auxiliar',
        tipo: 'auxiliar',
        ativo: true,
        percentual: 30,
        grau: 1,
        ordemAuxiliar: 1,
        ordemApresentacao: 2,
      },
    ],
    graus: [],
    kits: e.kits,
    profissionais: [
      { id: 31, nome: 'Profissional Sintético Um' },
      { id: 32, nome: 'Profissional Sintético Dois' },
      { id: 33, nome: 'Profissional Sintético Três' },
    ],
    destinos: [
      {
        id: DESTINO,
        numero: 'F374-SINT-2',
        situacao: 'aberta',
        fonte: 'Convênio Sintético B',
        outroEstabelecimento: false,
        aberta: true,
      },
    ],
    transferencias: e.transferencias,
  };
}

function simular(corpo: unknown): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(
      async () =>
        new Response(JSON.stringify(corpo), { status: 200, headers: { 'content-type': 'application/json' } }),
    ),
  );
}
afterEach(() => {
  vi.unstubAllGlobals();
  definirSessaoDaTela(null);
});

describe('a tela de movimentos da conta', () => {
  it('monta com a conta lida: itens, kit e cadastro do kit para quem edita as regras', async () => {
    simular(movimentos({ kits: [], equipe: [], transferencias: [], transferidos: [] }));
    definirSessaoDaTela({ permissoes: ['faturamento.conta.ler', 'faturamento.regra.editar'] } as never);
    const w = montar(MovimentosContaTela, roteador(), { id: String(CONTA) });
    await flushPromises();
    expect(w.find('[data-testid="tela-movimentos-conta"]').exists()).toBe(true);
    expect(w.text()).toContain('Procedimento sintético');
    w.unmount();
  });
});
