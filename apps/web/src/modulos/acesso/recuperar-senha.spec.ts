// @vitest-environment jsdom
// W1-01 (parte 7): "Esqueci a senha". O link na entrada só aparece com a recuperação liberada no estabelecimento; o
// pedido mostra a mensagem genérica do servidor; o link do e-mail gera a senha provisória (uma vez) e avisa a troca
// obrigatória; o link vencido ou usado avisa e não mostra senha. Dados SINTÉTICOS; o fetch é simulado.
import { criarI18n, instalarUi, resolverMarca } from '@sgh/ui';
import { QueryClient, VueQueryPlugin } from '@tanstack/vue-query';
import { flushPromises, mount } from '@vue/test-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { App } from 'vue';
import { createMemoryHistory, createRouter } from 'vue-router';
import { RESPOSTA_RECUPERACAO_SENHA } from '@sgh/contratos';
import { mensagensWeb } from '../../i18n/pt-BR.js';
import EntrarTela from './telas/EntrarTela.vue';
import RecuperarSenhaTela from './telas/RecuperarSenhaTela.vue';

// O seletor da entrada (SanteSelecao, OpenVue) usa matchMedia e ResizeObserver, que o jsdom não tem.
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

interface Pedido {
  metodo: string;
  url: string;
  corpo: Record<string, unknown> | null;
}

function simular(responder: (p: Pedido) => { status: number; corpo: unknown }): Pedido[] {
  const pedidos: Pedido[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      const p: Pedido = {
        metodo: init?.method ?? 'GET',
        url: String(url),
        corpo: init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : null,
      };
      pedidos.push(p);
      const r = responder(p);
      return new Response(JSON.stringify(r.corpo), {
        status: r.status,
        headers: { 'content-type': r.status >= 400 ? 'application/problem+json' : 'application/json' },
      });
    }),
  );
  return pedidos;
}

const ui = { install: (app: App) => instalarUi(app, resolverMarca(undefined).pacote) };

async function montar(componente: unknown, caminho: string) {
  const roteador = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/recuperar-senha', name: 'recuperar-senha', component: { template: '<div />' } },
      { path: '/:caminho(.*)*', component: { template: '<div />' } },
    ],
  });
  await roteador.push(caminho);
  const w = mount(componente as never, {
    attachTo: document.body,
    global: {
      plugins: [
        criarI18n(mensagensWeb as unknown as Record<string, unknown>),
        ui,
        roteador,
        [VueQueryPlugin, { queryClient: new QueryClient({ defaultOptions: { queries: { retry: false } } }) }],
      ] as never,
      stubs: { RouterLink: { props: ['to'], template: '<a :href="JSON.stringify(to)"><slot /></a>' } },
    },
  });
  await flushPromises();
  return { w, roteador };
}

afterEach(() => {
  vi.unstubAllGlobals();
  document.body.innerHTML = '';
});

const estabelecimentos = {
  rede: 'rede-teste',
  estabelecimentos: [{ codigo: 'aa', nome: 'Estabelecimento A', disponivel: true }],
};

describe('entrada: link "Esqueci a senha"', () => {
  for (const disponivel of [true, false]) {
    it(`com a recuperação ${disponivel ? 'liberada aparece' : 'desligada não aparece'}`, async () => {
      simular((p) => {
        if (p.url.includes('/api/sessao/recuperacao/disponivel'))
          return { status: 200, corpo: { disponivel } };
        if (p.url.includes('/api/sessao/certificado/disponivel'))
          return { status: 200, corpo: { disponivel: false, agenteLocal: null } };
        if (p.url.includes('/api/estabelecimentos')) return { status: 200, corpo: estabelecimentos };
        return { status: 404, corpo: {} };
      });
      const { w } = await montar(EntrarTela, '/entrar');
      await flushPromises();
      expect(w.find('[data-testid="link-esqueci-senha"]').exists()).toBe(disponivel);
      w.unmount();
    });
  }
});

describe('tela "Esqueci a senha"', () => {
  it('pede pelo usuário e mostra a mensagem genérica do servidor', async () => {
    const pedidos = simular(() => ({ status: 202, corpo: { mensagem: RESPOSTA_RECUPERACAO_SENHA } }));
    const { w } = await montar(RecuperarSenhaTela, '/recuperar-senha?estabelecimento=aa');
    await w.get('[data-testid="recuperar-login"]').setValue('SINT.USUARIO');
    await w.get('[data-testid="form-recuperar"]').trigger('submit');
    await flushPromises();
    expect(pedidos.at(-1)).toMatchObject({
      metodo: 'POST',
      url: '/api/sessao/recuperacao',
      corpo: { estabelecimento: 'aa', login: 'SINT.USUARIO' },
    });
    expect(w.get('[data-testid="recuperar-mensagem"]').text()).toContain(RESPOSTA_RECUPERACAO_SENHA);
    w.unmount();
  });

  it('muitos pedidos: avisa e mantém o formulário', async () => {
    simular(() => ({
      status: 429,
      corpo: { type: 'muitas-tentativas', title: 'Muitos pedidos', status: 429 },
    }));
    const { w } = await montar(RecuperarSenhaTela, '/recuperar-senha?estabelecimento=aa&login=SINT.USUARIO');
    await w.get('[data-testid="form-recuperar"]').trigger('submit');
    await flushPromises();
    expect(w.get('[data-testid="recuperar-erro"]').text()).toContain('Muitos pedidos');
    expect(w.find('[data-testid="form-recuperar"]').exists()).toBe(true);
    w.unmount();
  });

  it('sem estabelecimento: orienta a voltar à entrada', async () => {
    simular(() => ({ status: 404, corpo: {} }));
    const { w } = await montar(RecuperarSenhaTela, '/recuperar-senha');
    expect(w.find('[data-testid="recuperar-sem-estabelecimento"]').exists()).toBe(true);
    expect(w.find('[data-testid="form-recuperar"]').exists()).toBe(false);
    w.unmount();
  });

  it('o link do e-mail gera a senha provisória uma vez, avisa a troca obrigatória e tira o token do endereço', async () => {
    const token = 'A'.repeat(43);
    const pedidos = simular(() => ({
      status: 200,
      corpo: { senhaProvisoria: 'Prov#1234abcd', trocaObrigatoria: true },
    }));
    const { w, roteador } = await montar(RecuperarSenhaTela, `/recuperar-senha?token=${token}`);
    await flushPromises();
    expect(roteador.currentRoute.value.query['token']).toBeUndefined();
    await w.get('[data-testid="recuperar-gerar"]').trigger('click');
    await flushPromises();
    expect(pedidos.at(-1)).toMatchObject({
      metodo: 'POST',
      url: '/api/sessao/recuperacao/usar',
      corpo: { token },
    });
    expect(w.get('[data-testid="recuperar-provisoria"]').text()).toBe('Prov#1234abcd');
    expect(w.find('[data-testid="recuperar-troca-obrigatoria"]').exists()).toBe(true);
    w.unmount();
  });

  it('link vencido ou já usado: avisa e não mostra senha', async () => {
    simular(() => ({
      status: 400,
      corpo: { type: 'entrada-invalida', title: 'Link inválido', status: 400 },
    }));
    const { w } = await montar(RecuperarSenhaTela, `/recuperar-senha?token=${'B'.repeat(43)}`);
    await w.get('[data-testid="recuperar-gerar"]').trigger('click');
    await flushPromises();
    expect(w.find('[data-testid="recuperar-provisoria"]').exists()).toBe(false);
    expect(w.text()).toContain('inválido, já foi usado ou venceu');
    w.unmount();
  });
});
