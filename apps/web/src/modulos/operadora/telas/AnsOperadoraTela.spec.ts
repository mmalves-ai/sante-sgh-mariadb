// @vitest-environment jsdom
// Envios à ANS (M56.7, correção da revisão): quem só tem `operadora.ans.ler` consulta os envios e os avisos, mas não vê
// as ações de criar ("Novo envio" e "Registrar aviso"); com `operadora.ans.gerar`, vê as duas. Dados SINTÉTICOS; o
// fetch é simulado.
import { criarI18n, instalarUi, resolverMarca } from '@sgh/ui';
import { QueryClient, VueQueryPlugin } from '@tanstack/vue-query';
import { flushPromises, mount } from '@vue/test-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { App } from 'vue';
import { definirSessaoDaTela } from '../../../casca/sessao/pode.js';
import { mensagensWeb } from '../../../i18n/pt-BR.js';
import AnsOperadoraTela from './AnsOperadoraTela.vue';

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
const montar = () =>
  mount(AnsOperadoraTela as never, {
    global: {
      plugins: [
        criarI18n(mensagensWeb as unknown as Record<string, unknown>),
        ui,
        [VueQueryPlugin, { queryClient: new QueryClient({ defaultOptions: { queries: { retry: false } } }) }],
      ] as never,
      stubs: {
        RouterLink: { template: '<a><slot /></a>' },
        SituacaoOperadora: true,
        CatalogosAns: true,
        GrupoDominiosTela: true,
      },
    },
  });

const apoio = {
  destino: 'simulador',
  leiaute: 'sintetico',
  operadoras: [{ id: 1, nome: 'Operadora Sintética', registroAns: '900001' }],
  obrigacoes: [],
  motivosSib: [],
  camposSib: [],
  valoresTps: [],
  situacao: { vale: true, motivo: null },
};
const envios = {
  itens: [],
  proxima: null,
  totais: { gerados: 0, aguardandoRetorno: 0, rejeitados: 0, ressarcimentosEmPrazo: 0 },
};

function simular(): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      const u = String(url);
      const corpo = u.includes('/api/operadora/ans/apoio') ? apoio : envios;
      return new Response(JSON.stringify(corpo), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }),
  );
}
afterEach(() => {
  vi.unstubAllGlobals();
  definirSessaoDaTela(null);
});

async function acoes(permissoes: string[]): Promise<{ novo: boolean; aviso: boolean }> {
  simular();
  definirSessaoDaTela({ permissoes } as never);
  const w = montar();
  await flushPromises();
  expect(w.find('[data-testid="ans-buscar"]').exists()).toBe(true);
  const novo = w.find('[data-testid="ans-novo"]').exists();
  await w.find('[data-testid="ans-aba-ressarcimento"]').trigger('click');
  await flushPromises();
  const aviso = w.find('[data-testid="ans-novo-aviso"]').exists();
  w.unmount();
  return { novo, aviso };
}

describe('as ações de criar da tela dos envios à ANS seguem operadora.ans.gerar', () => {
  it('só com operadora.ans.ler: consulta, sem "Novo envio" e sem "Registrar aviso"', async () => {
    expect(await acoes(['operadora.ans.ler'])).toEqual({ novo: false, aviso: false });
  });
  it('com operadora.ans.gerar: as duas ações aparecem', async () => {
    expect(await acoes(['operadora.ans.ler', 'operadora.ans.gerar'])).toEqual({ novo: true, aviso: true });
  });
});
