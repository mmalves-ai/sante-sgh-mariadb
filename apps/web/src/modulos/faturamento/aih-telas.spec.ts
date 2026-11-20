// @vitest-environment jsdom
// Telas da AIH e do retorno do gestor (M51, etapa 4): desligada, a tela diz o pré-requisito e não oferece faixa nem
// laudo; ligada, a faixa e o laudo seguem as permissões do catálogo (faturamento.susAih.registrarFaixa e
// faturamento.susAih.registrar); o retorno do gestor só importa com a AIH ou o BPA ligados e com
// faturamento.susRetorno.importar. Dados SINTÉTICOS; o fetch é simulado.
import { criarI18n, instalarUi, resolverMarca } from '@sgh/ui';
import { QueryClient, VueQueryPlugin } from '@tanstack/vue-query';
import { flushPromises, mount } from '@vue/test-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { App } from 'vue';
import { createMemoryHistory, createRouter, type Router } from 'vue-router';
import { definirSessaoDaTela } from '../../casca/sessao/pode.js';
import { mensagensWeb } from '../../i18n/pt-BR.js';
import AihTela from './telas/AihTela.vue';
import LeitosUtiSusTela from './telas/LeitosUtiSusTela.vue';
import RetornoSusTela from './telas/RetornoSusTela.vue';

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
const montar = (c: unknown, r: Router = roteador()) =>
  mount(c as never, {
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

const painel = (liberado: boolean, retornoBpaLiberado = false) => ({
  liberado,
  retornoBpaLiberado,
  parametros: { cnes: true, diretorClinico: false, diariasUti: 2 },
  faixas: [],
  leitosUti: [
    { tipo: 1, nome: 'UTI ADULTO TIPO II', leitos: 10 },
    { tipo: 2, nome: 'UTI PEDIATRICA TIPO II', leitos: 0 },
  ],
  porSituacao: {},
  leiauteConferido: false,
});

function simular(p: ReturnType<typeof painel>): string[] {
  const urls: string[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      const u = String(url);
      urls.push(u);
      const corpo = u.includes('/aih/painel')
        ? p
        : u.includes('/retorno')
          ? { itens: [], total: 0, glosado: 0 }
          : u.includes('/aih?') || u.endsWith('/aih')
            ? { itens: [], total: 0, porSituacao: {} }
            : [];
      return new Response(JSON.stringify(corpo), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }),
  );
  return urls;
}
afterEach(() => {
  vi.unstubAllGlobals();
  definirSessaoDaTela(null);
});

const TODAS = [
  'faturamento.susAih.registrar',
  'faturamento.susAih.registrarFaixa',
  'faturamento.susRetorno.importar',
];

describe('a tela da AIH', () => {
  it('desligada: o pré-requisito à vista, sem faixa nem laudo, mesmo com todas as permissões', async () => {
    simular(painel(false));
    definirSessaoDaTela({ permissoes: TODAS } as never);
    const w = montar(AihTela);
    await flushPromises();
    expect(w.find('[data-testid="aih-desligado"]').exists()).toBe(true);
    expect(w.text()).toContain(mensagensWeb.faturamentoSus.aih.desligado);
    expect(w.text()).toContain(mensagensWeb.faturamentoSus.aih.leiauteNaoConferido);
    expect(w.find('[data-testid="form-faixa"]').exists()).toBe(false);
    expect(w.find('[data-testid="aih-laudo"]').exists()).toBe(false);
    w.unmount();
  });

  it('ligada: a faixa e o laudo seguem as permissões; os parâmetros sem dado da pessoa', async () => {
    simular(painel(true));
    definirSessaoDaTela({ permissoes: ['faturamento.susAih.registrar'] } as never);
    const so = montar(AihTela);
    await flushPromises();
    expect(so.find('[data-testid="aih-desligado"]').exists()).toBe(false);
    expect(so.find('[data-testid="aih-laudo"]').exists()).toBe(true);
    expect(so.find('[data-testid="form-faixa"]').exists()).toBe(false);
    // O CNES e o diretor aparecem como informado ou falta, nunca o número.
    const parametros = so.find('[data-testid="aih-parametros"]').text();
    expect(parametros).toContain(mensagensWeb.faturamentoSus.aih.informado);
    expect(parametros).toContain(mensagensWeb.faturamentoSus.aih.falta);
    expect(so.find('[data-testid="aih-leitos-resumo"]').text()).toBe('UTI ADULTO TIPO II: 10');
    so.unmount();

    definirSessaoDaTela({ permissoes: ['faturamento.susAih.registrarFaixa'] } as never);
    const faixa = montar(AihTela);
    await flushPromises();
    expect(faixa.find('[data-testid="form-faixa"]').exists()).toBe(true);
    expect(faixa.find('[data-testid="aih-laudo"]').exists()).toBe(false);
    faixa.unmount();
  });

  it('os leitos de UTI habilitados mostram o resumo por tipo', async () => {
    simular(painel(true));
    definirSessaoDaTela({ permissoes: TODAS } as never);
    const w = montar(LeitosUtiSusTela);
    await flushPromises();
    expect(w.find('[data-testid="tabela-leitos-por-tipo"]').text()).toContain('UTI ADULTO TIPO II');
    w.unmount();
  });
});

describe('a tela do retorno do gestor', () => {
  it('com a AIH e o BPA desligados não há importação', async () => {
    simular(painel(false, false));
    definirSessaoDaTela({ permissoes: TODAS } as never);
    const w = montar(RetornoSusTela);
    await flushPromises();
    expect(w.find('[data-testid="retorno-desligado"]').exists()).toBe(true);
    expect(w.find('[data-testid="retorno-importar"]').exists()).toBe(false);
    w.unmount();
  });

  it('o atalho do BPA (?instrumento=bpa) abre o retorno já filtrado pelo BPA', async () => {
    const urls = simular(painel(false, true));
    definirSessaoDaTela({ permissoes: TODAS } as never);
    const r = roteador();
    await r.push('/faturamento/sus/retorno?instrumento=bpa');
    const w = montar(RetornoSusTela, r);
    await flushPromises();
    expect(w.find('[data-testid="retorno-desligado"]').exists()).toBe(false);
    expect(urls.some((u) => u.includes('/retorno?') && u.includes('instrumento=bpa'))).toBe(true);
    w.unmount();
  });

  it('ligada, a importação segue faturamento.susRetorno.importar', async () => {
    simular(painel(true));
    definirSessaoDaTela({ permissoes: ['faturamento.susAih.registrar'] } as never);
    const sem = montar(RetornoSusTela);
    await flushPromises();
    expect(sem.find('[data-testid="retorno-desligado"]').exists()).toBe(false);
    expect(sem.find('[data-testid="retorno-importar"]').exists()).toBe(false);
    sem.unmount();

    definirSessaoDaTela({ permissoes: ['faturamento.susRetorno.importar'] } as never);
    const com = montar(RetornoSusTela);
    await flushPromises();
    expect(com.find('[data-testid="retorno-importar"]').exists()).toBe(true);
    expect(com.find('[data-testid="form-retorno"]').exists()).toBe(true);
    com.unmount();
  });
});
