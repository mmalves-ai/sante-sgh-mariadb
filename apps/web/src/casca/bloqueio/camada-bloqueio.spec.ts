// W1-01 (parte 11b3b): a tela bloqueada oferece "Trocar de usuário com PIN" (login + PIN; POST /api/sessao/troca-rapida
// com o CSRF da sessão bloqueada). Certo: a sessão nova (outra pessoa) entra no cache e a tela desbloqueia; recusa
// genérica fica no formulário e apaga o PIN; desligada no estabelecimento, a opção some. Sessão sintética: sem a
// opção. Dados SINTÉTICOS; o fetch é simulado.
import { urnProblema } from '@sgh/contratos';
import { criarI18n, instalarUi, resolverMarca } from '@sgh/ui';
import { QueryClient, VueQueryPlugin } from '@tanstack/vue-query';
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { App } from 'vue';
import { mensagensWeb } from '../../i18n/pt-BR.js';
import { CHAVE_SESSAO } from '../sessao/sessao.js';
import CamadaBloqueio from './CamadaBloqueio.vue';
import { usarBloqueio } from './bloqueio.js';

vi.mock('vue-router', async (original) => ({
  ...(await original<typeof import('vue-router')>()),
  useRouter: () => ({ replace: vi.fn() }),
}));

interface Pedido {
  metodo: string;
  url: string;
  corpo: Record<string, unknown> | null;
  csrf: string | null;
}
const novaSessao = {
  usuario: { id: '2', nome: 'Recepção sintética', login: 'SINT.RECEPCAO' },
  rede: 'r',
  estabelecimentos: [{ codigo: 'aa', nome: 'AA' }],
  estabelecimentoAtivo: 'aa',
  permissoes: [],
  sintetica: false,
  bloqueioInatividadeSegundos: 600,
};

function simular(respostas: { status: number; corpo: unknown }[]): Pedido[] {
  const pedidos: Pedido[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      const h = new Headers(init?.headers);
      pedidos.push({
        metodo: init?.method ?? 'GET',
        url: String(url),
        corpo: init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : null,
        csrf: h.get('x-csrf'),
      });
      const r = respostas.shift() ?? { status: 500, corpo: {} };
      return new Response(JSON.stringify(r.corpo), {
        status: r.status,
        headers: { 'content-type': r.status >= 400 ? 'application/problem+json' : 'application/json' },
      });
    }),
  );
  return pedidos;
}

const ui = { install: (app: App) => instalarUi(app, resolverMarca(undefined).pacote) };
const montadas: VueWrapper[] = [];
let cliente: QueryClient;
async function montar(sintetica = false) {
  const pinia = createPinia();
  setActivePinia(pinia);
  cliente = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  cliente.setQueryData(CHAVE_SESSAO, {
    ...novaSessao,
    usuario: { id: '1', nome: 'B', login: 'SINT.MEDICO' },
  });
  const w = mount(CamadaBloqueio as never, {
    attachTo: document.body,
    props: { sintetica } as never,
    global: {
      plugins: [
        pinia,
        criarI18n(mensagensWeb as unknown as Record<string, unknown>),
        ui,
        [VueQueryPlugin, { queryClient: cliente }],
      ] as never,
    },
  });
  montadas.push(w);
  usarBloqueio().bloquear();
  await flushPromises();
  return w;
}
const $ = (id: string) => document.querySelector<HTMLElement>(`[data-testid="${id}"]`);
async function digitar(id: string, valor: string) {
  const el = $(id) as HTMLInputElement | null;
  if (!el) throw new Error(`campo ${id} ausente`);
  el.value = valor;
  el.dispatchEvent(new Event('input'));
  await flushPromises();
}
async function clicar(id: string) {
  const el = $(id);
  const b = (el?.tagName === 'BUTTON' ? el : el?.querySelector('button')) as HTMLButtonElement | null;
  if (!b) throw new Error(`botão ${id} ausente`);
  b.click();
  await flushPromises();
}
async function enviar(form: string) {
  $(form)?.dispatchEvent(new Event('submit', { cancelable: true }));
  await flushPromises();
}

afterEach(() => {
  for (const w of montadas.splice(0)) w.unmount();
  vi.unstubAllGlobals();
  document.body.innerHTML = '';
  document.cookie = 'sgh_csrf=; Max-Age=0; Path=/';
});

describe('tela bloqueada: troca rápida de usuário por PIN (W1-01 parte 11b3b)', () => {
  it('login + PIN: recusa genérica fica no formulário; certo troca a sessão no cache e desbloqueia', async () => {
    document.cookie = 'sgh_csrf=csrf-da-bloqueada; Path=/';
    const ps = simular([
      {
        status: 401,
        corpo: { type: urnProblema('nao-autenticado'), title: 'x', status: 401, detail: 'genérica' },
      },
      { status: 201, corpo: novaSessao },
    ]);
    await montar();
    expect($('form-troca-pin')).toBeNull();
    await clicar('abrir-troca-pin');
    // Formato conferido na tela antes de ir ao servidor.
    await digitar('login-troca-pin', 'SINT.RECEPCAO');
    await digitar('pin-troca', '12');
    await enviar('form-troca-pin');
    expect(ps).toHaveLength(0);
    expect($('erro-troca-pin')?.textContent).toContain('4 a 8 dígitos');
    await digitar('pin-troca', '905372');
    await enviar('form-troca-pin');
    expect(ps.at(-1)).toMatchObject({
      metodo: 'POST',
      url: '/api/sessao/troca-rapida',
      corpo: { login: 'SINT.RECEPCAO', pin: '905372' },
      csrf: 'csrf-da-bloqueada',
    });
    expect($('erro-troca-pin')?.textContent).toContain('Não foi possível trocar de usuário');
    expect(($('pin-troca') as HTMLInputElement).value).toBe('');
    expect(usarBloqueio().bloqueada).toBe(true);
    await digitar('pin-troca', '384716');
    await enviar('form-troca-pin');
    expect(usarBloqueio().bloqueada).toBe(false);
    expect(cliente.getQueryData<{ usuario: { login: string } }>(CHAVE_SESSAO)?.usuario.login).toBe(
      'SINT.RECEPCAO',
    );
    // Nada do PIN fica no navegador.
    expect(JSON.stringify(localStorage)).not.toContain('384716');
  });

  it('troca rápida desligada no estabelecimento: avisa e a opção some', async () => {
    simular([
      {
        status: 409,
        corpo: { type: urnProblema('operacao-bloqueada'), title: 'Troca rápida desligada', status: 409 },
      },
    ]);
    await montar();
    await clicar('abrir-troca-pin');
    await digitar('login-troca-pin', 'SINT.RECEPCAO');
    await digitar('pin-troca', '384716');
    await enviar('form-troca-pin');
    expect($('form-troca-pin')).toBeNull();
    expect($('abrir-troca-pin')).toBeNull();
    expect($('erro-desbloqueio')?.textContent).toContain('desligada');
    expect(usarBloqueio().bloqueada).toBe(true);
  });

  it('sessão sintética: sem a troca por PIN', async () => {
    simular([]);
    await montar(true);
    expect($('abrir-troca-pin')).toBeNull();
  });
});
