// @vitest-environment jsdom
// Telas do OPME (M46, etapa 3; correções da revisão): a aba do rastreio reverso na conciliação só aparece com a
// permissão do rastreio (suprimentos.lote.rastrear); a tela própria do rastreio busca só pelo lote (sem o item) e mostra
// as saídas do lote no estoque com a origem. Dados SINTÉTICOS; o fetch é simulado.
import { criarI18n, instalarUi, resolverMarca } from '@sgh/ui';
import { QueryClient, VueQueryPlugin } from '@tanstack/vue-query';
import { flushPromises, mount } from '@vue/test-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { App } from 'vue';
import { definirSessaoDaTela } from '../../casca/sessao/pode.js';
import { mensagensWeb } from '../../i18n/pt-BR.js';
import OpmeConciliacaoTela from './telas/OpmeConciliacaoTela.vue';
import OpmeRastreioTela from './telas/OpmeRastreioTela.vue';

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
const montar = (c: unknown) =>
  mount(c as never, {
    global: {
      plugins: [
        criarI18n(mensagensWeb as unknown as Record<string, unknown>),
        ui,
        [VueQueryPlugin, { queryClient: new QueryClient({ defaultOptions: { queries: { retry: false } } }) }],
      ] as never,
      stubs: { RouterLink: { template: '<a><slot /></a>' } },
    },
  });

function simular(rota: (url: string) => unknown): string[] {
  const urls: string[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      urls.push(String(url));
      return new Response(JSON.stringify(rota(String(url))), {
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

const conciliacao = {
  de: '2026-10-01',
  ate: '2026-10-31',
  linhas: [],
  indicador: { numerador: 0, denominador: 0, percentual: null },
  cortada: false,
};

describe('a aba do rastreio reverso segue a permissão', () => {
  it('o faturista sem suprimentos.lote.rastrear não vê a aba; com ela, vê', async () => {
    simular(() => conciliacao);
    definirSessaoDaTela({ permissoes: ['suprimentos.opme.conciliar'] } as never);
    const sem = montar(OpmeConciliacaoTela);
    await flushPromises();
    expect(sem.find('[data-testid="opmez-aba-rastreio"]').exists()).toBe(false);
    sem.unmount();
    definirSessaoDaTela({ permissoes: ['suprimentos.opme.conciliar', 'suprimentos.lote.rastrear'] } as never);
    const com = montar(OpmeConciliacaoTela);
    await flushPromises();
    expect(com.find('[data-testid="opmez-aba-rastreio"]').exists()).toBe(true);
    com.unmount();
  });
});

describe('a tela própria do rastreio reverso', () => {
  it('só com lote.rastrear: busca pelo lote sem o item (sem a busca de itens) e mostra as saídas do estoque', async () => {
    const urls = simular(() => ({
      item: null,
      itemNome: null,
      lote: 'L-77',
      serie: null,
      registroAnvisa: null,
      expostos: [],
      saidasDoLote: 0,
      saidasEstoque: [
        {
          saida: { ano: 2026, mes: 10, doc: 7001 },
          data: '2026-10-20',
          item: 950001,
          atendimento: 77999,
          paciente: 99001,
          quantidade: 1,
          origem: 'estoque',
        },
      ],
      cortada: false,
    }));
    definirSessaoDaTela({ permissoes: ['suprimentos.lote.rastrear'] } as never);
    const w = montar(OpmeRastreioTela);
    await flushPromises();
    expect(w.find('[data-testid="opmez-termo"]').exists()).toBe(false);
    await w.find('[data-testid="opmez-lote"]').setValue('L-77');
    await w.find('[data-testid="opmez-rastrear"]').trigger('click');
    await flushPromises();
    expect(urls.some((u) => u.includes('/suprimentos/opme/rastreio?lote=L-77') && !u.includes('item='))).toBe(
      true,
    );
    expect(w.find('[data-testid="opmez-saida-7001"]').text()).toContain('Outra saída do estoque');
    w.unmount();
  });
});
