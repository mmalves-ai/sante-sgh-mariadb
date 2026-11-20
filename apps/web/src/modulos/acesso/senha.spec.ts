// @vitest-environment jsdom
// W1-01: tela "Trocar a senha". Com a troca liberada, o formulário pede a atual, a nova e a confirmação; a recusa da
// política lista as regras pelos códigos; a senha atual errada avisa; a troca certa limpa os campos e oferece
// continuar. Sem a troca liberada, a tela explica e não mostra o formulário. Dados SINTÉTICOS; o fetch é simulado.
import { criarI18n, instalarUi, resolverMarca } from '@sgh/ui';
import { QueryClient, VueQueryPlugin } from '@tanstack/vue-query';
import { flushPromises, mount } from '@vue/test-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { App } from 'vue';
import { createMemoryHistory, createRouter } from 'vue-router';
import { mensagensWeb } from '../../i18n/pt-BR.js';
import SenhaTela from './telas/SenhaTela.vue';

interface Pedido {
  metodo: string;
  url: string;
  corpo: Record<string, unknown> | null;
}

const sessao = (extra: Record<string, unknown> = {}) => ({
  usuario: { id: '1', nome: 'Usuário sintético', login: 'SINT.USUARIO' },
  rede: 'rede-teste',
  estabelecimentos: [],
  estabelecimentoAtivo: 'aa',
  permissoes: ['acesso.senha.trocar'],
  sintetica: false,
  bloqueioInatividadeSegundos: 900,
  ...extra,
});

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
async function montar() {
  const roteador = createRouter({
    history: createMemoryHistory(),
    routes: [{ path: '/:caminho(.*)*', component: { template: '<div />' } }],
  });
  await roteador.push('/senha');
  const w = mount(SenhaTela as never, {
    attachTo: document.body,
    global: {
      plugins: [
        criarI18n(mensagensWeb as unknown as Record<string, unknown>),
        ui,
        roteador,
        [VueQueryPlugin, { queryClient: new QueryClient({ defaultOptions: { queries: { retry: false } } }) }],
      ] as never,
      stubs: { RouterLink: { props: ['to'], template: '<a :href="to"><slot /></a>' } },
    },
  });
  await flushPromises();
  return w;
}

async function preencher(w: Awaited<ReturnType<typeof montar>>, atual: string, nova: string, conf = nova) {
  await w.get('[data-testid="senha-atual"]').setValue(atual);
  await w.get('[data-testid="senha-nova"]').setValue(nova);
  await w.get('[data-testid="senha-confirmacao"]').setValue(conf);
  await w.get('[data-testid="form-senha"]').trigger('submit');
  await flushPromises();
}

afterEach(() => {
  vi.unstubAllGlobals();
  document.body.innerHTML = '';
});

describe('SenhaTela', () => {
  it('sem a troca liberada: explica e não mostra o formulário', async () => {
    simular(() => ({ status: 200, corpo: sessao({ trocaSenhaPeloNovo: false }) }));
    const w = await montar();
    expect(w.find('[data-testid="senha-indisponivel"]').exists()).toBe(true);
    expect(w.find('[data-testid="form-senha"]').exists()).toBe(false);
    w.unmount();
  });

  it('troca obrigatória: mostra o motivo; recusa da política lista as regras; a troca certa limpa e oferece continuar', async () => {
    let tentativa = 0;
    const pedidos = simular((p) => {
      if (p.metodo === 'GET')
        return { status: 200, corpo: sessao({ trocaSenhaPeloNovo: true, trocaSenha: 'senha-expirada' }) };
      tentativa++;
      if (tentativa === 1)
        return {
          status: 422,
          corpo: {
            type: 'urn:sgh:problema:entrada-invalida',
            title: 'Senha nova recusada',
            status: 422,
            codigo: 'senha-politica',
            falhas: ['curta', 'sem-numero'],
          },
        };
      if (tentativa === 2)
        return {
          status: 401,
          corpo: { type: 'urn:sgh:problema:nao-autenticado', title: 'x', status: 401 },
        };
      return { status: 200, corpo: sessao({ trocaSenhaPeloNovo: true, trocaSenha: null }) };
    });
    const w = await montar();
    expect(w.get('[data-testid="senha-motivo"]').text()).toContain('expirou');

    await preencher(w, 'Atual#2026', 'abc');
    const falhas = w.get('[data-testid="senha-falhas"]').text();
    expect(falhas).toContain('é curta demais');
    expect(falhas).toContain('precisa ter número');
    // A senha digitada não fica na tela depois do pedido.
    expect((w.get('[data-testid="senha-nova"]').element as HTMLInputElement).value).toBe('');

    await preencher(w, 'errada', 'Nova#2026x');
    expect(w.get('[data-testid="senha-aviso"]').text()).toContain('senha atual não confere');

    await preencher(w, 'Atual#2026', 'Nova#2026x');
    expect(w.find('[data-testid="senha-trocada"]').exists()).toBe(true);
    expect(w.find('[data-testid="senha-continuar"]').exists()).toBe(true);
    const posts = pedidos.filter((p) => p.metodo === 'POST');
    expect(posts.at(-1)).toMatchObject({
      url: '/api/sessao/senha',
      corpo: { senhaAtual: 'Atual#2026', senhaNova: 'Nova#2026x', confirmacao: 'Nova#2026x' },
    });
    w.unmount();
  });

  it('confirmação diferente: avisa e não envia', async () => {
    const pedidos = simular(() => ({ status: 200, corpo: sessao({ trocaSenhaPeloNovo: true }) }));
    const w = await montar();
    await preencher(w, 'Atual#2026', 'Nova#2026x', 'Outra#2026x');
    expect(pedidos.filter((p) => p.metodo === 'POST')).toHaveLength(0);
    w.unmount();
  });
});
