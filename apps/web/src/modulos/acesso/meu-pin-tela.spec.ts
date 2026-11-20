// @vitest-environment jsdom
// W1-01 (parte 11b3a): seção "PIN da troca rápida" em Preferências > Segurança: situação, definir (com confirmação e
// senha), trocar, retirar com a senha, senha errada fica no diálogo e apaga a senha, formato recusado na tela sem ir
// ao servidor, bloqueado avisa, desligada não oferece gravação. Dados SINTÉTICOS; o fetch é simulado.
import { criarI18n, instalarUi, resolverMarca } from '@sgh/ui';
import { QueryClient, VueQueryPlugin } from '@tanstack/vue-query';
import { flushPromises, mount } from '@vue/test-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { App } from 'vue';
import { createMemoryHistory, createRouter } from 'vue-router';
import { mensagensWeb } from '../../i18n/pt-BR.js';
import MeuPin from './componentes/MeuPin.vue';

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
  csrf: string | null;
}

function simular(responder: (p: Pedido) => { status: number; corpo: unknown }): Pedido[] {
  const pedidos: Pedido[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      const h = (init?.headers ?? {}) as Record<string, string>;
      const p: Pedido = {
        metodo: init?.method ?? 'GET',
        url: String(url),
        corpo: init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : null,
        csrf: h['x-csrf'] ?? null,
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
const montadas: { unmount: () => void }[] = [];
async function montar(componente: unknown) {
  const roteador = createRouter({
    history: createMemoryHistory(),
    routes: [{ path: '/:caminho(.*)*', component: { template: '<div />' } }],
  });
  await roteador.push('/entrar');
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
  montadas.push(w);
  await flushPromises();
  return w;
}

const $ = (id: string) => document.querySelector<HTMLElement>(`[data-testid="${id}"]`);
async function digitar(id: string, valor: string) {
  const el = $(id);
  const input = (
    el?.tagName === 'INPUT' || el?.tagName === 'TEXTAREA' ? el : el?.querySelector('input,textarea')
  ) as HTMLInputElement | null;
  if (!input) throw new Error(`campo ${id} ausente`);
  input.value = valor;
  input.dispatchEvent(new Event('input'));
  await flushPromises();
}
async function clicar(id: string) {
  const el = $(id);
  const b = (el?.tagName === 'BUTTON' ? el : el?.querySelector('button')) as HTMLButtonElement | null;
  if (!b) throw new Error(`botão ${id} ausente`);
  b.click();
  await flushPromises();
}

afterEach(async () => {
  await flushPromises();
  for (const w of montadas.splice(0)) w.unmount();
  vi.unstubAllGlobals();
  document.body.innerHTML = '';
});

const situacao = (o: Partial<Record<string, unknown>> = {}) => ({
  ligada: true,
  digitosPin: 6,
  definido: false,
  bloqueado: false,
  criadoEm: null,
  ...o,
});
const SENHA_ERRADA = {
  type: 'nao-autenticado',
  title: 'Senha não confere',
  status: 401,
  detail: 'A senha não confere.',
};

describe('PIN da troca rápida (W1-01 parte 11b3a)', () => {
  it('define o PIN com confirmação e senha, depois troca; nada do PIN volta na tela', async () => {
    let atual = situacao();
    const ps = simular((p) => {
      if (p.url === '/api/sessao/pin' && p.metodo === 'GET') return { status: 200, corpo: atual };
      if (p.url === '/api/sessao/pin' && p.metodo === 'POST') {
        atual = situacao({ definido: true, criadoEm: '2026-11-19T10:00:00.000Z' });
        return { status: 200, corpo: atual };
      }
      return { status: 404, corpo: { type: 'nao-encontrado', title: 'x', status: 404 } };
    });
    await montar(MeuPin);
    expect($('pin-situacao')?.textContent).toContain('Nenhum PIN definido');
    expect($('pin-retirar')).toBeNull();

    await clicar('pin-definir');
    await digitar('pin-novo', '418093');
    await digitar('pin-confirmacao', '418093');
    await digitar('pin-senha-definir', 'Senha-sintetica-1');
    await clicar('pin-gravar');
    const post = ps.find((p) => p.metodo === 'POST');
    expect(post?.url).toBe('/api/sessao/pin');
    expect(post?.corpo).toEqual({ pin: '418093', senha: 'Senha-sintetica-1' });
    expect(post?.csrf).not.toBeNull();
    expect($('form-pin-definir')).toBeNull();
    expect($('pin-aviso')?.textContent).toContain('PIN definido.');
    expect($('pin-situacao')?.textContent).toContain('19/11/2026');
    expect(document.body.innerHTML).not.toContain('418093');

    await clicar('pin-definir');
    expect(($('pin-novo') as HTMLInputElement).value).toBe('');
    await digitar('pin-novo', '730184');
    await digitar('pin-confirmacao', '730184');
    await digitar('pin-senha-definir', 'Senha-sintetica-1');
    await clicar('pin-gravar');
    expect(ps.filter((p) => p.metodo === 'POST')).toHaveLength(2);
    expect($('pin-aviso')?.textContent).toContain('PIN trocado.');
  });

  it('recusa na tela o formato e a confirmação diferente, sem ir ao servidor', async () => {
    const ps = simular((p) =>
      p.metodo === 'GET'
        ? { status: 200, corpo: situacao({ digitosPin: 6 }) }
        : { status: 500, corpo: { type: 'erro-interno', title: 'x', status: 500 } },
    );
    await montar(MeuPin);
    await clicar('pin-definir');
    await digitar('pin-novo', '4180');
    await digitar('pin-confirmacao', '4180');
    await digitar('pin-senha-definir', 'Senha-sintetica-1');
    await clicar('pin-gravar');
    expect($('pin-recusa-local')?.textContent).toContain('de 6 a 8 dígitos');
    await digitar('pin-novo', '418093');
    await digitar('pin-confirmacao', '418094');
    await clicar('pin-gravar');
    expect($('pin-recusa-local')?.textContent).toContain('não são iguais');
    expect(ps.filter((p) => p.metodo === 'POST')).toHaveLength(0);
  });

  it('mostra a recusa do servidor (PIN trivial, senha errada) no diálogo e apaga a senha digitada', async () => {
    let tentativa = 0;
    simular((p) => {
      if (p.metodo === 'GET') return { status: 200, corpo: situacao() };
      tentativa += 1;
      return tentativa === 1
        ? {
            status: 422,
            corpo: {
              type: 'entrada-invalida',
              title: 'PIN recusado',
              status: 422,
              detail: 'O PIN não pode ser uma sequência nem repetir o mesmo dígito.',
            },
          }
        : { status: 401, corpo: SENHA_ERRADA };
    });
    await montar(MeuPin);
    await clicar('pin-definir');
    await digitar('pin-novo', '123456');
    await digitar('pin-confirmacao', '123456');
    await digitar('pin-senha-definir', 'Senha-sintetica-1');
    await clicar('pin-gravar');
    expect($('form-pin-definir')?.textContent).toContain('sequência');
    expect(($('pin-senha-definir') as HTMLInputElement).value).toBe('');
    await digitar('pin-novo', '418093');
    await digitar('pin-confirmacao', '418093');
    await digitar('pin-senha-definir', 'errada');
    await clicar('pin-gravar');
    expect($('form-pin-definir')?.textContent).toContain('A senha não confere.');
    expect($('pin-aviso')).toBeNull();
  });

  it('retira o PIN com a senha; senha errada fica no diálogo', async () => {
    let atual = situacao({ definido: true, criadoEm: '2026-11-18T10:00:00.000Z' });
    let tentativa = 0;
    const ps = simular((p) => {
      if (p.metodo === 'GET') return { status: 200, corpo: atual };
      if (p.url === '/api/sessao/pin/retirar') {
        tentativa += 1;
        if (tentativa === 1) return { status: 401, corpo: SENHA_ERRADA };
        atual = situacao();
        return { status: 200, corpo: atual };
      }
      return { status: 404, corpo: { type: 'nao-encontrado', title: 'x', status: 404 } };
    });
    await montar(MeuPin);
    expect($('pin-situacao')?.textContent).toContain('18/11/2026');
    await clicar('pin-retirar');
    await digitar('pin-senha-retirar', 'errada');
    await clicar('pin-confirmar-retirar');
    expect($('form-pin-retirar')?.textContent).toContain('A senha não confere.');
    expect(($('pin-senha-retirar') as HTMLInputElement).value).toBe('');
    await digitar('pin-senha-retirar', 'Senha-sintetica-1');
    await clicar('pin-confirmar-retirar');
    const ultimo = ps.filter((p) => p.metodo === 'POST').at(-1);
    expect(ultimo?.corpo).toEqual({ senha: 'Senha-sintetica-1' });
    expect($('form-pin-retirar')).toBeNull();
    expect($('pin-aviso')?.textContent).toContain('PIN retirado.');
    expect($('pin-situacao')?.textContent).toContain('Nenhum PIN definido');
    expect($('pin-retirar')).toBeNull();
  });

  it('PIN bloqueado avisa e oferece definir um novo; desligada não oferece gravação', async () => {
    simular(() => ({ status: 200, corpo: situacao({ definido: true, bloqueado: true }) }));
    await montar(MeuPin);
    expect($('pin-bloqueado')?.textContent).toContain('bloqueado');
    expect($('pin-definir')?.textContent).toContain('Trocar PIN');
    for (const w of montadas.splice(0)) w.unmount();
    vi.unstubAllGlobals();
    document.body.innerHTML = '';

    simular(() => ({ status: 200, corpo: situacao({ ligada: false }) }));
    await montar(MeuPin);
    expect($('pin-desligado')).not.toBeNull();
    expect($('pin-definir')).toBeNull();
    expect($('pin-retirar')).toBeNull();
  });
});
