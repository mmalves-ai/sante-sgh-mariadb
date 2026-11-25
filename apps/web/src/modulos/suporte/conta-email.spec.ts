// @vitest-environment jsdom
// Tela "Suporte técnico": a conta da plataforma muda o próprio e-mail de entrada (pedido do dono: a primeira conta,
// criada na inicialização, tem o e-mail alterável depois de entrar) e o de um suporte. PUT com o CSRF próprio; 409
// vira "e-mail em uso". Dados sintéticos.
import { criarI18n, instalarUi, resolverMarca } from '@sgh/ui';
import { flushPromises, mount } from '@vue/test-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { App } from 'vue';
import { mensagensWeb } from '../../i18n/pt-BR.js';
import { alterarEmailConta } from './api-suporte.js';
import SuporteTecnicoTela from './telas/SuporteTecnicoTela.vue';

vi.mock('vue-router', () => ({ useRouter: () => ({ replace: vi.fn() }) }));

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
const i18n = () => criarI18n(mensagensWeb as unknown as Record<string, unknown>);

const eu = (email: string) => ({
  conta: { id: '1', email, nome: 'Plataforma', papel: 'PLATAFORMA' },
  podeEntrarComo: true,
  podeDesignar: true,
  podeAcessoTotal: true,
  expiraEm: '2026-11-24T20:00:00.000Z',
  segundoFatorObrigatorio: false,
});
const conta = (id: string, email: string, papel: 'PLATAFORMA' | 'SUPORTE') => ({
  id,
  email,
  nome: null,
  papel,
  ativo: true,
  senhaDefinida: true,
  segundoFator: false,
  criadoEm: '2026-11-24T10:00:00.000Z',
  atribuicoes: [],
});

function servidor(statusPut = 204) {
  let email = 'dono@sintetico.invalid';
  return vi.fn(async (url: string, init?: RequestInit) => {
    const metodo = init?.method ?? 'GET';
    if (metodo === 'PUT' && url === '/api/plataforma/contas/1/email') {
      if (statusPut === 204) email = (JSON.parse(String(init?.body)) as { email: string }).email;
      return new Response(
        statusPut === 204 ? null : JSON.stringify({ title: 'Conflito', status: statusPut }),
        {
          status: statusPut,
          headers: { 'content-type': 'application/problem+json' },
        },
      );
    }
    const corpo =
      url === '/api/plataforma/eu'
        ? eu(email)
        : url === '/api/plataforma/suportes'
          ? [conta('1', email, 'PLATAFORMA'), conta('2', 'suporte@sintetico.invalid', 'SUPORTE')]
          : [];
    return new Response(JSON.stringify(corpo), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
  document.body.innerHTML = '';
});

describe('e-mail da conta da plataforma', () => {
  it('cliente: PUT /api/plataforma/contas/:id/email com o CSRF próprio', async () => {
    document.cookie = 'sgh_pcsrf=csrf-sintetico';
    const f = vi.fn(async () => new Response(null, { status: 204 }));
    await alterarEmailConta('7', 'novo@sintetico.invalid', f as unknown as typeof fetch);
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('/api/plataforma/contas/7/email');
    expect(init.method).toBe('PUT');
    expect((init.headers as Record<string, string>)['x-csrf-plataforma']).toBe('csrf-sintetico');
    expect(JSON.parse(String(init.body))).toEqual({ email: 'novo@sintetico.invalid' });
  });

  it('tela: "Minha conta" altera o próprio e-mail e mostra o novo', async () => {
    const f = servidor();
    vi.stubGlobal('fetch', f);
    const w = mount(SuporteTecnicoTela, { global: { plugins: [i18n(), ui] }, attachTo: document.body });
    await flushPromises();
    expect(w.get('[data-testid="minha-conta-email"]').text()).toBe('dono@sintetico.invalid');
    expect(w.find('[data-testid="alterar-email-suporte@sintetico.invalid"]').exists()).toBe(true);
    await w.get('[data-testid="alterar-meu-email"]').trigger('click');
    await w.get('[data-testid="novo-email"]').setValue('dono.novo@sintetico.invalid');
    await w.get('[data-testid="form-email"]').trigger('submit');
    await flushPromises();
    expect(f.mock.calls.some(([u, i]) => u === '/api/plataforma/contas/1/email' && i?.method === 'PUT')).toBe(
      true,
    );
    expect(w.get('[data-testid="minha-conta-email"]').text()).toBe('dono.novo@sintetico.invalid');
    expect(w.get('[data-testid="suporte-mensagem"]').text()).toContain('E-mail alterado');
    w.unmount();
  });

  it('tela: e-mail em uso (409) avisa e mantém o atual', async () => {
    vi.stubGlobal('fetch', servidor(409));
    const w = mount(SuporteTecnicoTela, { global: { plugins: [i18n(), ui] }, attachTo: document.body });
    await flushPromises();
    await w.get('[data-testid="alterar-meu-email"]').trigger('click');
    await w.get('[data-testid="novo-email"]').setValue('suporte@sintetico.invalid');
    await w.get('[data-testid="form-email"]').trigger('submit');
    await flushPromises();
    expect(w.get('[data-testid="suporte-mensagem"]').text()).toBe('Já existe conta com este e-mail.');
    expect(w.get('[data-testid="minha-conta-email"]').text()).toBe('dono@sintetico.invalid');
    w.unmount();
  });
});
