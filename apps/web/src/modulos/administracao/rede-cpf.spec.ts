// @vitest-environment jsdom
// W1-01 (parte 11c): "A pessoa na rede" na vista Identidade única: procura por CPF ou login (POST, o CPF no corpo),
// contas por estabelecimento com grupo e perfis, banco indisponível dito, e "Bloquear em todos" com motivo e senha
// no diálogo único, com o resultado por conta. Dados SINTÉTICOS; o fetch é simulado.
import type { Sessao } from '@sgh/contratos';
import { criarI18n, instalarUi, resolverMarca } from '@sgh/ui';
import { QueryClient, VueQueryPlugin } from '@tanstack/vue-query';
import { flushPromises, mount } from '@vue/test-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { App } from 'vue';
import { createMemoryHistory, createRouter } from 'vue-router';
import { definirSessaoDaTela } from '../../casca/sessao/pode.js';
import { mensagensWeb } from '../../i18n/pt-BR.js';
import RedeCpf from './componentes/RedeCpf.vue';

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

interface Pedido {
  metodo: string;
  url: string;
  corpo: Record<string, unknown> | null;
}
function simular(responder: (p: Pedido) => { status: number; corpo: unknown } | undefined): Pedido[] {
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
      const r = responder(p) ?? { status: 404, corpo: { type: 'nao-encontrado', title: 'x', status: 404 } };
      return new Response(JSON.stringify(r.corpo), {
        status: r.status,
        headers: { 'content-type': r.status >= 400 ? 'application/problem+json' : 'application/json' },
      });
    }),
  );
  return pedidos;
}
const ui = { install: (app: App) => instalarUi(app, resolverMarca(undefined).pacote) };
const montados: { unmount: () => void }[] = [];
afterEach(() => {
  for (const w of montados.splice(0)) w.unmount();
  vi.unstubAllGlobals();
  document.body.innerHTML = '';
});
async function montar(props: Record<string, unknown> = {}) {
  const roteador = createRouter({
    history: createMemoryHistory(),
    routes: [{ path: '/:caminho(.*)*', component: { template: '<div />' } }],
  });
  await roteador.push('/');
  const w = mount(RedeCpf as never, {
    attachTo: document.body,
    props: props as never,
    global: {
      plugins: [
        criarI18n(mensagensWeb as unknown as Record<string, unknown>),
        ui,
        roteador,
        [VueQueryPlugin, { queryClient: new QueryClient() }],
      ] as never,
      stubs: { RouterLink: { props: ['to'], template: '<a href="#"><slot /></a>' } },
    },
  });
  montados.push(w);
  return w;
}

const PAINEL = {
  estabelecimentos: [
    {
      codigo: 'pc',
      nome: 'Hospital PC',
      situacao: 'lido',
      contas: [
        { login: 'ANA', nome: 'Ana', grupo: 'MEDICOS', ativo: true, bloqueado: false, perfis: ['medico'] },
      ],
    },
    {
      codigo: 'hb',
      nome: 'Hospital HB',
      situacao: 'lido',
      contas: [{ login: 'ANA.HB', nome: 'Ana', grupo: 'ENF', ativo: true, bloqueado: true, perfis: [] }],
    },
    { codigo: 'hc', nome: 'Hospital HC', situacao: 'indisponivel', contas: [] },
  ],
  totalContas: 2,
  aBloquear: 1,
  destino: 'legado',
};

describe('A pessoa na rede (W1-01, parte 11c)', () => {
  it('procura pelo CPF no corpo do POST e mostra contas, perfis e o banco indisponível', async () => {
    definirSessaoDaTela({ permissoes: ['acesso.usuario.ler'] } as unknown as Sessao);
    const pedidos = simular((p) =>
      p.url.endsWith('/rede-cpf') ? { status: 200, corpo: PAINEL } : undefined,
    );
    const w = await montar();
    expect(pedidos).toHaveLength(0);
    await w.get('[data-testid="rede-cpf-valor"]').setValue('529.982.247-25');
    await w.get('[data-testid="rede-cpf-form"]').trigger('submit');
    await flushPromises();
    expect(pedidos[0]).toMatchObject({ metodo: 'POST', corpo: { cpf: '52998224725' } });
    expect(pedidos[0]!.url).not.toContain('52998224725');
    expect(w.get('[data-testid="rede-cpf-conta-pc-ANA"]').text()).toContain('medico');
    expect(w.get('[data-testid="rede-cpf-conta-hb-ANA.HB"]').text()).toContain('Bloqueado');
    expect(w.get('[data-testid="rede-cpf-est-hc"]').text()).toContain('não respondeu');
    expect(w.get('[data-testid="rede-cpf-resumo"]').text()).toContain('2 conta(s)');
    // Sem a permissão de bloquear, o botão não aparece.
    expect(w.find('[data-testid="rede-cpf-bloquear"]').exists()).toBe(false);
  });

  it('com o login vindo da ficha procura sozinho; "Bloquear em todos" pede motivo e senha e mostra o resultado', async () => {
    definirSessaoDaTela({
      permissoes: ['acesso.usuario.ler', 'acesso.usuario.bloquear'],
    } as unknown as Sessao);
    const pedidos = simular((p) =>
      p.url.endsWith('/rede-cpf/bloquear')
        ? {
            status: 200,
            corpo: {
              resultados: [
                { estabelecimento: 'pc', login: 'ANA', resultado: 'bloqueado', detalhe: null },
                { estabelecimento: 'hb', login: 'ANA.HB', resultado: 'ja-bloqueado', detalhe: null },
                { estabelecimento: 'hc', login: null, resultado: 'indisponivel', detalhe: 'Repita depois.' },
              ],
              bloqueados: 1,
              destino: 'legado',
            },
          }
        : p.url.endsWith('/rede-cpf')
          ? { status: 200, corpo: PAINEL }
          : undefined,
    );
    const w = await montar({ loginInicial: 'ANA' });
    await flushPromises();
    expect(pedidos[0]!.corpo).toEqual({ login: 'ANA' });
    await w.get('[data-testid="rede-cpf-bloquear"]').trigger('click');
    await flushPromises();
    const motivo = document.querySelector<HTMLTextAreaElement | HTMLInputElement>(
      '[data-testid="dialogo-motivo"]',
    )!;
    motivo.value = 'Desligamento confirmado pelo RH';
    motivo.dispatchEvent(new Event('input'));
    const senha = document.querySelector<HTMLInputElement>('[data-testid="dialogo-senha"]')!;
    senha.value = 'senha-sintetica';
    senha.dispatchEvent(new Event('input'));
    document
      .querySelector<HTMLFormElement>('[data-testid="form-gravacao"]')!
      .dispatchEvent(new Event('submit'));
    await flushPromises();
    const post = pedidos.find((p) => p.url.endsWith('/rede-cpf/bloquear'));
    expect(post?.corpo).toEqual({
      login: 'ANA',
      motivo: 'Desligamento confirmado pelo RH',
      senha: 'senha-sintetica',
    });
    const res = w.get('[data-testid="rede-cpf-resultado"]').text();
    expect(res).toContain('1 conta(s) bloqueada(s)');
    expect(res).toContain('Já estava bloqueada');
    expect(res).toContain('Banco indisponível');
  });
});
