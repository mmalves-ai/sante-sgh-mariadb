// @vitest-environment jsdom
// Comunicações recebidas pela operadora (04-INT linha 80, C1-108): a lista mostra a pendente com a carteira não
// identificada e o botão de responder só para quem recebe contas; a identificação envia a carteira com a versão e mostra
// o aviso. Dados SINTÉTICOS; o fetch é simulado.
import { criarI18n, instalarUi, resolverMarca } from '@sgh/ui';
import { QueryClient, VueQueryPlugin } from '@tanstack/vue-query';
import { flushPromises, mount } from '@vue/test-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { App } from 'vue';
import { definirSessaoDaTela } from '../../../casca/sessao/pode.js';
import { mensagensWeb } from '../../../i18n/pt-BR.js';
import ComunicacoesRecebidas from './ComunicacoesRecebidas.vue';

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
  mount(ComunicacoesRecebidas as never, {
    global: {
      plugins: [
        criarI18n(mensagensWeb as unknown as Record<string, unknown>),
        ui,
        [VueQueryPlugin, { queryClient: new QueryClient({ defaultOptions: { queries: { retry: false } } }) }],
      ] as never,
    },
  });
const item = {
  id: 1,
  versao: 1,
  prestador: 'CLINICA SINTETICA',
  numeroTransacao: '91',
  numeroCarteira: 'SINT-1',
  beneficiario: null,
  matricula: null,
  recemNascido: true,
  tipoEvento: 'internacao',
  eventoEm: '2026-11-24',
  tipoInternacao: 'clinica',
  motivoEncerramento: null,
  recebidoEm: '2026-11-25T10:00:00Z',
  situacao: 'recebida',
  motivoRecusa: null,
  respondidoEm: null,
};
const resposta = (corpo: unknown) =>
  new Response(JSON.stringify(corpo), { status: 200, headers: { 'content-type': 'application/json' } });

afterEach(() => vi.unstubAllGlobals());

describe('ComunicacoesRecebidas', () => {
  it('só leitura: lista a pendente sem o botão de responder', async () => {
    definirSessaoDaTela({ permissoes: ['operadora.conta.ler'] } as never);
    vi.stubGlobal('fetch', vi.fn(async () => resposta({ itens: [item] })));
    const w = montar();
    await flushPromises();
    const linha = w.get('[data-testid="comunicacao-1"]');
    expect(linha.text()).toContain('SINT-1');
    expect(linha.text()).toContain('Não identificado');
    expect(linha.text()).toContain('(recém-nascido)');
    expect(w.find('[data-testid="comunicacao-responder-1"]').exists()).toBe(false);
  });

  it('quem recebe contas identifica a carteira e vê o aviso', async () => {
    definirSessaoDaTela({ permissoes: ['operadora.conta.ler', 'operadora.conta.receber'] } as never);
    const chamadas: { url: string; corpo: unknown }[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init?: RequestInit) => {
        if (init?.method === 'POST') {
          chamadas.push({ url, corpo: JSON.parse(String(init.body)) });
          return resposta({ id: 1, versao: 2, beneficiario: 7 });
        }
        if (url.endsWith('/motivos-recusa')) return resposta({ itens: [] });
        return resposta({ itens: [item] });
      }),
    );
    const w = montar();
    await flushPromises();
    await w.get('[data-testid="comunicacao-responder-1"]').trigger('click');
    await w.get('[data-testid="comunicacao-carteira"] input').setValue('SINT.MAT-1');
    await w.get('[data-testid="comunicacao-identificar"]').trigger('click');
    await flushPromises();
    expect(chamadas).toEqual([
      { url: '/api/operadora/troca-tiss/comunicacoes/1/carteira', corpo: { versao: 1, carteira: 'SINT.MAT-1' } },
    ]);
    expect(w.get('[data-testid="comunicacao-aviso"]').text()).toContain('Carteira identificada.');
  });
});
