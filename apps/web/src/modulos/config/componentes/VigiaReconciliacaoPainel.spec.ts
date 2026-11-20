// @vitest-environment jsdom
// Revisão do W0-02: o painel do relatório da vigia de reconciliação (exclusões de cadastro feitas fora do sistema):
// situação da vigia, última rodada e a lista com o rótulo do cadastro (nunca o nome da tabela).
import { criarI18n, instalarUi, resolverMarca } from '@sgh/ui';
import { QueryClient, VueQueryPlugin } from '@tanstack/vue-query';
import { flushPromises, mount } from '@vue/test-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { App } from 'vue';
import { mensagensWeb } from '../../../i18n/pt-BR.js';
import VigiaReconciliacaoPainel from './VigiaReconciliacaoPainel.vue';

const ui = { install: (app: App) => instalarUi(app, resolverMarca(undefined).pacote) };

function responder(corpo: unknown): string[] {
  const urls: string[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      urls.push(String(url));
      return new Response(JSON.stringify(corpo), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }),
  );
  return urls;
}
const montar = () =>
  mount(VigiaReconciliacaoPainel, {
    global: {
      plugins: [
        criarI18n(mensagensWeb as unknown as Record<string, unknown>),
        ui,
        [VueQueryPlugin, { queryClient: new QueryClient({ defaultOptions: { queries: { retry: false } } }) }],
      ] as never,
    },
  });

afterEach(() => vi.unstubAllGlobals());

describe('VigiaReconciliacaoPainel', () => {
  it('ligada: a última rodada e as exclusões feitas fora do sistema, pelo rótulo do cadastro', async () => {
    const urls = responder({
      ligada: true,
      disponivel: true,
      intervaloMinutos: 60,
      ultimaRodada: { em: '2026-11-18T10:00:00.000Z', tabelas: 12, achados: 1 },
      linhas: [
        {
          rotulo: 'Tipos de limpeza',
          detectadoEm: '2026-11-18T10:00:00.000Z',
          contagemAntes: 4,
          contagemDepois: 3,
          foraDoSistema: 1,
          chaves: ['9'],
        },
      ],
    });
    const w = montar();
    await flushPromises();
    await flushPromises();
    expect(urls[0]).toBe('/api/cadastros/dominios/vigia/exclusoes-fora');
    expect(w.get('[data-testid="vigia-situacao"]').text()).toContain('Vigia ligada');
    expect(w.get('[data-testid="vigia-ultima-rodada"]').text()).toContain('12 cadastros conferidos');
    const linha = w.get('[data-testid="vigia-linha-0"]').text();
    expect(linha).toContain('Tipos de limpeza');
    expect(linha).toContain('4 → 3');
    expect(linha).toContain('9');
    w.unmount();
  });

  it('sem a fonte do banco: avisa que não há rodada e que nada foi encontrado', async () => {
    responder({ ligada: false, disponivel: false, intervaloMinutos: 60, ultimaRodada: null, linhas: [] });
    const w = montar();
    await flushPromises();
    await flushPromises();
    expect(w.find('[data-testid="vigia-indisponivel"]').exists()).toBe(true);
    expect(w.get('[data-testid="vigia-vazio"]').text()).toContain('Nenhuma exclusão');
    w.unmount();
  });
});
