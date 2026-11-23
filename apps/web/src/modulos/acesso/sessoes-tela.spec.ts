// @vitest-environment jsdom
// W1-01 (parte 8b): "Minhas sessões" (lista, encerrar uma, encerrar as outras; a atual não se encerra), a seção
// "Sessões simultâneas por perfil" da Política de senha (incluir, alterar, retirar com motivo e senha; senha errada
// fica no diálogo; histórico) e a entrada mostrando a recusa `limite-sessoes`. Dados SINTÉTICOS; o fetch é simulado.
import { criarI18n, instalarUi, resolverMarca } from '@sgh/ui';
import { QueryClient, VueQueryPlugin } from '@tanstack/vue-query';
import { flushPromises, mount } from '@vue/test-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { App } from 'vue';
import { createMemoryHistory, createRouter } from 'vue-router';
import { mensagensWeb } from '../../i18n/pt-BR.js';
import LimitesSessaoSecao from './componentes/LimitesSessaoSecao.vue';
import MinhasSessoes from './componentes/MinhasSessoes.vue';
import EntrarTela from './telas/EntrarTela.vue';

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
const botaoDesligado = (id: string) =>
  (($(id)?.tagName === 'BUTTON' ? $(id) : $(id)?.querySelector('button')) as HTMLButtonElement | null)
    ?.disabled ?? null;

afterEach(async () => {
  await flushPromises();
  for (const w of montadas.splice(0)) w.unmount();
  vi.unstubAllGlobals();
  document.body.innerHTML = '';
});

const A = 'a'.repeat(24);
const B = 'b'.repeat(24);
const C = 'c'.repeat(24);
const sessao = (ref: string, atual: boolean, dispositivo: string | null = 'Firefox · Linux') => ({
  ref,
  inicio: '2026-11-18T11:00:00.000Z',
  ultimoUso: '2026-11-18T12:00:00.000Z',
  dispositivo,
  atual,
  bloqueada: false,
});

describe('Minhas sessões (W1-01 parte 8b)', () => {
  it('lista as sessões com a atual marcada e sem botão de encerrar nela; encerra uma e depois as outras', async () => {
    let lista = [sessao(A, true), sessao(B, false, 'Chrome · Windows'), sessao(C, false, null)];
    const ps = simular((p) => {
      if (p.url === '/api/sessao/sessoes') return { status: 200, corpo: lista };
      if (p.url === '/api/sessao/sessoes/encerrar') {
        const ref = p.corpo?.['ref'] as string | undefined;
        const antes = lista.length;
        lista = ref ? lista.filter((s) => s.ref !== ref) : lista.filter((s) => s.atual);
        return { status: 200, corpo: { encerradas: antes - lista.length } };
      }
      return { status: 404, corpo: {} };
    });
    await montar(MinhasSessoes);
    expect($('sessoes-lista')?.textContent).toContain('Chrome · Windows');
    expect($('sessoes-lista')?.textContent).toContain('Dispositivo não identificado');
    expect($(`sessao-${A}`)?.textContent).toContain('esta sessão');
    expect($(`sessao-encerrar-${A}`)).toBeNull();
    expect($('sessoes-encerrar-outras')?.textContent).toContain('Encerrar as 2 outras sessões');

    await clicar(`sessao-encerrar-${B}`);
    const um = ps.filter((p) => p.metodo === 'POST').at(-1);
    expect(um?.corpo).toEqual({ ref: B });
    expect(um?.csrf).not.toBeNull();
    expect($('sessoes-aviso')?.textContent).toContain('1 sessão encerrada');
    expect($(`sessao-${B}`)).toBeNull();
    expect($('sessoes-encerrar-outras')?.textContent).toContain('Encerrar a outra sessão');

    await clicar('sessoes-encerrar-outras');
    expect(ps.filter((p) => p.metodo === 'POST').at(-1)?.corpo).toEqual({});
    expect($(`sessao-${C}`)).toBeNull();
    expect($(`sessao-${A}`)).not.toBeNull();
    expect($('sessoes-encerrar-outras')).toBeNull();
  });

  it('a recusa do servidor aparece no aviso', async () => {
    simular((p) => {
      if (p.url === '/api/sessao/sessoes') return { status: 200, corpo: [sessao(A, true), sessao(B, false)] };
      return {
        status: 503,
        corpo: { type: 'indisponivel', title: 'Indisponível', status: 503, detail: 'Tente em instantes.' },
      };
    });
    await montar(MinhasSessoes);
    await clicar(`sessao-encerrar-${B}`);
    expect($('sessoes-recusa')?.textContent).toContain('Tente em instantes.');
  });
});

describe('Sessões simultâneas por perfil (W1-01 parte 8b)', () => {
  it('sem limite avisa; inclui o padrão com motivo e senha (senha errada fica no diálogo), altera e retira', async () => {
    let vigentes: { perfil: string; limite: number }[] = [];
    const historico: Record<string, unknown>[] = [];
    let tentativas = 0;
    const ps = simular((p) => {
      if (p.url !== '/api/acesso/gestao/limites-sessao') return { status: 404, corpo: {} };
      if (p.metodo === 'GET')
        return { status: 200, corpo: { vigentes, historico, perfis: ['medico', 'recepcao'] } };
      tentativas++;
      if (tentativas === 1)
        return { status: 401, corpo: { type: 'reautenticacao-necessaria', title: 'x', status: 401 } };
      const c = p.corpo as { perfil: string; limite: number | null; motivo: string };
      const anterior = vigentes.find((v) => v.perfil === c.perfil)?.limite ?? null;
      vigentes = vigentes.filter((v) => v.perfil !== c.perfil);
      if (c.limite !== null) vigentes.push({ perfil: c.perfil, limite: c.limite });
      historico.unshift({
        perfil: c.perfil,
        limite: c.limite,
        situacao: c.limite === null ? 'retirado' : 'vigente',
        motivo: c.motivo,
        criadoPor: 'SINT.GESTOR',
        criadoEm: '2026-11-18T12:00:00.000Z',
      });
      return {
        status: 200,
        corpo: { id: String(tentativas), anterior, limite: c.limite, operacao: 'acesso.definirLimiteSessao' },
      };
    });
    await montar(LimitesSessaoSecao);
    expect($('limites-sessao-nenhum')).not.toBeNull();

    await clicar('limites-sessao-incluir');
    await digitar('limites-sessao-limite', '2');
    await digitar('limites-sessao-motivo', 'norma interna');
    expect(botaoDesligado('limites-sessao-confirmar')).toBe(true);
    await digitar('limites-sessao-senha', 'errada');
    $('limites-sessao-form')?.dispatchEvent(new Event('submit', { cancelable: true }));
    await flushPromises();
    expect($('limites-sessao-senha-erro')?.textContent).toContain('A senha não confere');
    expect($('limites-sessao-form')).not.toBeNull();
    await digitar('limites-sessao-senha', 'Sint#Senha2026');
    $('limites-sessao-form')?.dispatchEvent(new Event('submit', { cancelable: true }));
    await flushPromises();
    const post = ps.filter((p) => p.metodo === 'POST').at(-1);
    expect(post?.corpo).toEqual({ perfil: '*', limite: 2, motivo: 'norma interna', senha: 'Sint#Senha2026' });
    expect($('limites-sessao-aviso')?.textContent).toContain('2 sessões');
    expect($('limite-sessao-*')?.textContent).toContain('Padrão (todos os perfis)');

    await clicar('limite-sessao-alterar-*');
    expect(($('limites-sessao-limite') as HTMLInputElement).value).toBe('2');
    await digitar('limites-sessao-limite', '3');
    await digitar('limites-sessao-motivo', 'ajuste');
    await digitar('limites-sessao-senha', 'Sint#Senha2026');
    $('limites-sessao-form')?.dispatchEvent(new Event('submit', { cancelable: true }));
    await flushPromises();
    expect($('limite-sessao-*')?.textContent).toContain('3');

    await clicar('limite-sessao-retirar-*');
    await digitar('limites-sessao-motivo', 'sem restrição');
    await digitar('limites-sessao-senha', 'Sint#Senha2026');
    $('limites-sessao-form')?.dispatchEvent(new Event('submit', { cancelable: true }));
    await flushPromises();
    expect(ps.filter((p) => p.metodo === 'POST').at(-1)?.corpo).toMatchObject({ perfil: '*', limite: null });
    expect($('limites-sessao-aviso')?.textContent).toContain('retirado');
    expect($('limites-sessao-nenhum')).not.toBeNull();
    const h = $('limites-sessao-historico')?.textContent ?? '';
    expect(h).toContain('Histórico (3)');
    expect(h).toContain('sem limite');
    expect(h).toContain('norma interna');
  });

  it('a recusa do servidor (perfil inválido) fecha o diálogo e aparece no aviso', async () => {
    simular((p) => {
      if (p.metodo === 'GET') return { status: 200, corpo: { vigentes: [], historico: [], perfis: [] } };
      return {
        status: 400,
        corpo: {
          type: 'entrada-invalida',
          title: 'Perfil inválido',
          status: 400,
          detail: 'Escolha um perfil da lista.',
        },
      };
    });
    await montar(LimitesSessaoSecao);
    await clicar('limites-sessao-incluir');
    await digitar('limites-sessao-limite', '1');
    await digitar('limites-sessao-motivo', 'teste');
    await digitar('limites-sessao-senha', 'Sint#Senha2026');
    $('limites-sessao-form')?.dispatchEvent(new Event('submit', { cancelable: true }));
    await flushPromises();
    expect($('limites-sessao-form')).toBeNull();
    expect($('limites-sessao-recusa')?.textContent).toContain('Escolha um perfil da lista.');
  });
});

describe('entrada: recusa pelo limite de sessões (W1-01 parte 8b)', () => {
  it('mostra o detalhe do servidor (409 limite-sessoes)', async () => {
    const detalhe = 'Você já tem 2 sessões abertas, o limite do seu perfil.';
    simular((p) => {
      if (p.url.includes('/api/sessao/recuperacao/disponivel'))
        return { status: 200, corpo: { disponivel: false } };
      if (p.url.includes('/api/sessao/certificado/disponivel'))
        return { status: 200, corpo: { disponivel: false, agenteLocal: null } };
      if (p.url.includes('/api/estabelecimentos'))
        return {
          status: 200,
          corpo: {
            rede: 'rede-teste',
            estabelecimentos: [{ codigo: 'aa', nome: 'Estabelecimento A', disponivel: true }],
          },
        };
      if (p.url === '/api/sessao' && p.metodo === 'POST')
        return {
          status: 409,
          corpo: {
            type: 'recusa-de-negocio',
            title: 'Limite de sessões simultâneas',
            status: 409,
            detail: detalhe,
            codigo: 'limite-sessoes',
          },
        };
      return { status: 404, corpo: {} };
    });
    await montar(EntrarTela);
    await digitar('campo-login', 'SINT.USUARIO');
    await digitar('campo-senha', 'Sint#Senha2026');
    document.querySelector('form.entrar__form')?.dispatchEvent(new Event('submit', { cancelable: true }));
    await flushPromises();
    expect($('erro-entrar')?.textContent).toBe(detalhe);
  });
});

describe('entrada: falha do servidor não vira "senha errada"', () => {
  const estabelecimentos = (p: { url: string; metodo: string }) => {
    if (p.url.includes('/api/sessao/recuperacao/disponivel'))
      return { status: 200, corpo: { disponivel: false } };
    if (p.url.includes('/api/sessao/certificado/disponivel'))
      return { status: 200, corpo: { disponivel: false, agenteLocal: null } };
    if (p.url.includes('/api/estabelecimentos'))
      return {
        status: 200,
        corpo: {
          rede: 'rede-teste',
          estabelecimentos: [{ codigo: 'aa', nome: 'Estabelecimento A', disponivel: true }],
        },
      };
    return null;
  };
  const entrarCom = async (status: number, codigo: string) => {
    simular((p) => {
      const base = estabelecimentos(p);
      if (base) return base;
      if (p.url === '/api/sessao' && p.metodo === 'POST')
        return { status, corpo: { type: `urn:sgh:problema:${codigo}`, title: 'x', status, codigo } };
      return { status: 404, corpo: {} };
    });
    await montar(EntrarTela);
    await digitar('campo-login', 'SINT.USUARIO');
    await digitar('campo-senha', 'Sint#Senha2026');
    document.querySelector('form.entrar__form')?.dispatchEvent(new Event('submit', { cancelable: true }));
    await flushPromises();
    return $('erro-entrar')?.textContent;
  };
  it('503 da trilha de auditoria: serviço indisponível', async () => {
    expect(await entrarCom(503, 'trilha-indisponivel')).toBe(
      'O serviço está indisponível. Tente de novo em instantes.',
    );
  });
  it('401 da credencial: usuário ou senha inválidos', async () => {
    expect(await entrarCom(401, 'credencial-invalida')).toBe('Usuário ou senha inválidos.');
  });
});
