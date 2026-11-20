// @vitest-environment jsdom
// Domínios na onda 0 (M38, campo 7): a ação de escrita que a permissão deixa e o executor recusaria (`recusadas` da
// descrição) aparece desabilitada, com o aviso "só consulta nesta etapa"; sem recusa, habilitada e sem aviso.
import { criarI18n, instalarUi, resolverMarca } from '@sgh/ui';
import { QueryClient, VueQueryPlugin } from '@tanstack/vue-query';
import { flushPromises, mount } from '@vue/test-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { App } from 'vue';
import { mensagensWeb } from '../../../i18n/pt-BR.js';
import DominioTela from './DominioTela.vue';

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

const descricao = (recusadas?: Record<string, string>) => ({
  modulo: 'cadastro',
  recurso: 'estadoCivil',
  rotulo: { singular: 'Estado civil', plural: 'Estados civis' },
  subitem: 'x',
  rota: '/cadastros/dominios/cadastro/estadoCivil',
  natureza: 'editavel',
  acoes: ['ler', 'criar', 'editar', 'inativar'],
  permitidas: ['ler', 'criar', 'editar', 'inativar'],
  campos: [
    {
      campo: 'codigo',
      rotulo: 'Código',
      tipo: 'texto',
      obrigatorio: true,
      editavel: false,
      naInclusao: true,
      naLista: true,
    },
    {
      campo: 'descricao',
      rotulo: 'Descrição',
      tipo: 'texto',
      obrigatorio: true,
      editavel: true,
      naInclusao: true,
      naLista: true,
    },
  ],
  campoCodigo: 'codigo',
  campoDescricao: 'descricao',
  campoSituacao: 'situacao',
  exportarExigeJustificativa: false,
  estados: { incluir: 'verde', alterar: 'verde', inativar: 'verde' },
  ...(recusadas ? { recusadas } : {}),
});
const lista = {
  itens: [{ codigo: '1', ativo: true, valores: { codigo: '1', descricao: 'Item sintético' }, versao: 'v1' }],
  total: 1,
  truncada: false,
  pagina: 1,
  porPagina: 20,
};

function servidor(recusadas?: Record<string, string>) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      const corpo = String(url).includes('/itens') ? lista : descricao(recusadas);
      return new Response(JSON.stringify(corpo), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }),
  );
}

const montar = () =>
  mount(DominioTela, {
    props: { modulo: 'cadastro', recurso: 'estadoCivil' },
    global: {
      plugins: [
        criarI18n(mensagensWeb as unknown as Record<string, unknown>),
        ui,
        [VueQueryPlugin, { queryClient: new QueryClient({ defaultOptions: { queries: { retry: false } } }) }],
      ] as never,
      stubs: { RouterLink: { template: '<a><slot /></a>' } },
    },
  });

afterEach(() => {
  vi.unstubAllGlobals();
});

const desabilitado = (w: ReturnType<typeof montar>, id: string) =>
  w.get(`[data-testid="${id}"]`).attributes('disabled') !== undefined;

describe('DominioTela na onda 0 (M38)', () => {
  it('operação não liberada: Incluir, Alterar e Inativar desabilitados, com o aviso de só consulta', async () => {
    const motivo = 'Operação ainda não liberada neste estabelecimento.';
    servidor({ criar: motivo, editar: motivo, inativar: motivo });
    const w = montar();
    await flushPromises();
    await flushPromises();
    expect(desabilitado(w, 'botao-incluir')).toBe(true);
    expect(desabilitado(w, 'alterar-1')).toBe(true);
    expect(desabilitado(w, 'inativar-1')).toBe(true);
    expect(w.get('[data-testid="dominio-escrita-recusada"]').text()).toContain('só de consulta');
  });

  it('só a inclusão recusada: ela desabilitada com o motivo; as demais habilitadas', async () => {
    servidor({ criar: 'A inclusão ainda não foi liberada.' });
    const w = montar();
    await flushPromises();
    await flushPromises();
    expect(desabilitado(w, 'botao-incluir')).toBe(true);
    expect(desabilitado(w, 'alterar-1')).toBe(false);
    expect(w.get('[data-testid="dominio-escrita-recusada"]').text()).toContain(
      'A inclusão ainda não foi liberada.',
    );
  });

  it('sem recusa: as ações habilitadas e sem aviso', async () => {
    servidor();
    const w = montar();
    await flushPromises();
    await flushPromises();
    expect(desabilitado(w, 'botao-incluir')).toBe(false);
    expect(desabilitado(w, 'inativar-1')).toBe(false);
    expect(w.find('[data-testid="dominio-escrita-recusada"]').exists()).toBe(false);
  });
});

describe('DominioTela aberta num item (M53.2: o detalhe da rubrica leva ao cadastro)', () => {
  function servidorItem(recusadas?: Record<string, string>): string[] {
    const urls: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        const u = String(url);
        urls.push(u);
        const corpo = /\/itens\/1$/.test(u)
          ? lista.itens[0]
          : u.includes('/itens')
            ? lista
            : descricao(recusadas);
        return new Response(JSON.stringify(corpo), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }),
    );
    return urls;
  }
  const montarAberta = () =>
    mount(DominioTela, {
      attachTo: document.body,
      props: { modulo: 'cadastro', recurso: 'estadoCivil', abrir: { codigo: '1', busca: 'Item sintético' } },
      global: {
        plugins: [
          criarI18n(mensagensWeb as unknown as Record<string, unknown>),
          ui,
          [
            VueQueryPlugin,
            { queryClient: new QueryClient({ defaultOptions: { queries: { retry: false } } }) },
          ],
        ] as never,
        stubs: { RouterLink: { template: '<a><slot /></a>' } },
      },
    });

  it('a lista vem filtrada pelo item e a alteração dele abre uma vez', async () => {
    const urls = servidorItem();
    const w = montarAberta();
    await flushPromises();
    await flushPromises();
    const listas = urls.filter((u) => u.includes('/itens?'));
    expect(listas.length).toBeGreaterThan(0);
    expect(listas.every((u) => u.includes('busca=Item'))).toBe(true);
    expect(urls.filter((u) => /\/itens\/1$/.test(u))).toHaveLength(1);
    expect(document.body.textContent).toContain('estado civil 1');
    w.unmount();
    document.body.innerHTML = '';
  });

  it('com a alteração recusada (gravação desligada): só filtra, não abre a alteração', async () => {
    const urls = servidorItem({ editar: 'Operação ainda não liberada.' });
    const w = montarAberta();
    await flushPromises();
    await flushPromises();
    expect(urls.some((u) => /\/itens\/1$/.test(u))).toBe(false);
    w.unmount();
    document.body.innerHTML = '';
  });
});
