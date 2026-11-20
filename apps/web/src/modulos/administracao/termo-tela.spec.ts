// @vitest-environment jsdom
// W1-01 (parte 6b): a tela "Termo de uso": versões (vigente e anteriores) com os aceites de cada uma, o texto e os
// aceites paginados de uma versão anterior, publicar versão nova (texto, motivo e a senha num diálogo; senha errada
// fica no diálogo; a recusa do servidor aparece). Sem faixa de "só consulta". Dados SINTÉTICOS; o fetch é simulado.
import { criarI18n, instalarUi, resolverMarca } from '@sgh/ui';
import { QueryClient, VueQueryPlugin } from '@tanstack/vue-query';
import { flushPromises, mount } from '@vue/test-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { App } from 'vue';
import { mensagensWeb } from '../../i18n/pt-BR.js';
import { definirSessaoDaTela } from '../../casca/sessao/pode.js';
import TermoTela from './telas/TermoTela.vue';

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
type Responder = (p: Pedido) => { status: number; corpo: unknown } | undefined;

const A = '/api/administracao/acesso/termo';
const TEXTO_1 = 'Termo de uso sintético, versão um, com texto suficiente.';
let versoes: { id: number; desde: string; vigente: boolean; publicadoPor: string; aceites: number }[] = [];
let publicarPossivel = true;
const detalhe = (id: number, pagina: number) => {
  const v = versoes.find((x) => x.id === id);
  if (!v) return undefined;
  return {
    id,
    texto: id === 1 ? TEXTO_1 : `Texto da versão ${id}, sintético.`,
    desde: v.desde,
    vigente: v.vigente,
    aceites: v.aceites,
    pagina,
    porPagina: 50,
    itens: [{ login: `SINT.P${pagina}`, em: '2026-11-01' }],
  };
};

function simular(responder: Responder): Pedido[] {
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
      const m = /\/versoes\/(\d+)(?:\?pagina=(\d+))?$/.exec(p.url);
      const d = m && p.metodo === 'GET' ? detalhe(Number(m[1]), Number(m[2] ?? 1)) : undefined;
      const r =
        responder(p) ??
        (p.url === `${A}/versoes` && p.metodo === 'GET'
          ? {
              status: 200,
              corpo: {
                versoes,
                publicarPossivel,
                motivo: publicarPossivel ? null : 'Desligada neste estabelecimento (motivo sintético).',
                destino: 'memoria',
              },
            }
          : d
            ? { status: 200, corpo: d }
            : { status: 404, corpo: { type: 'nao-encontrado', title: 'x', status: 404 } });
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
async function montar() {
  const w = mount(TermoTela as never, {
    attachTo: document.body,
    global: {
      plugins: [
        criarI18n(mensagensWeb as unknown as Record<string, unknown>),
        ui,
        [VueQueryPlugin, { queryClient: new QueryClient({ defaultOptions: { queries: { retry: false } } }) }],
      ] as never,
      stubs: { RouterLink: { props: ['to'], template: '<a :href="to"><slot /></a>' } },
    },
  });
  montadas.push(w);
  await flushPromises();
  return w;
}
const ultimoPost = (ps: Pedido[]) => ps.filter((p) => p.metodo === 'POST').at(-1);
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
async function confirmar() {
  $('termo-form')?.dispatchEvent(new Event('submit', { cancelable: true }));
  await flushPromises();
}

afterEach(async () => {
  await flushPromises();
  for (const w of montadas.splice(0)) w.unmount();
  vi.unstubAllGlobals();
  document.body.innerHTML = '';
  definirSessaoDaTela(null);
});

describe('TermoTela (W1-01 parte 6b): versões do termo de uso', () => {
  it('mostra a vigente com os aceites, as anteriores consultáveis com paginação, sem só consulta', async () => {
    versoes = [
      { id: 3, desde: '2026-11-18', vigente: true, publicadoPor: 'SINT.GESTOR', aceites: 2 },
      { id: 1, desde: '2020-12-16', vigente: false, publicadoPor: 'ADMIN', aceites: 120 },
    ];
    publicarPossivel = true;
    const ps = simular(() => undefined);
    const w = await montar();
    expect($('termo-versao-3')?.textContent).toContain('Vigente');
    expect($('termo-versao-1')?.textContent).toContain('Anterior');
    expect($('termo-texto')?.textContent).toContain('Texto da versão 3');
    await clicar('termo-ver-1');
    expect($('termo-detalhe-titulo')?.textContent).toContain('Versão 1');
    expect($('termo-texto')?.textContent).toContain(TEXTO_1);
    expect($('termo-aceites')?.textContent).toContain('120');
    await clicar('termo-pagina-seguinte');
    expect(ps.some((p) => p.url === `${A}/versoes/1?pagina=2`)).toBe(true);
    expect($('termo-aceites-lista')?.textContent).toContain('SINT.P2');
    expect(w.text()).not.toMatch(/só consulta|especificada|cenário controlado/i);
    expect($('termo-publicar')?.querySelector('button') ?? $('termo-publicar')).toHaveProperty(
      'disabled',
      false,
    );
  });

  it('publica versão nova com texto, motivo e senha (senha errada fica no diálogo); a recusa aparece', async () => {
    versoes = [{ id: 1, desde: '2020-12-16', vigente: true, publicadoPor: 'ADMIN', aceites: 5 }];
    publicarPossivel = true;
    let tentativas = 0;
    const ps = simular((p) => {
      if (p.metodo !== 'POST') return undefined;
      tentativas++;
      if (tentativas === 1)
        return { status: 401, corpo: { type: 'reautenticacao-necessaria', title: 'x', status: 401 } };
      if (tentativas === 3)
        return {
          status: 409,
          corpo: {
            type: 'termo-desatualizado',
            title: 'Operação recusada',
            status: 409,
            detail: 'Outra versão do termo foi publicada.',
          },
        };
      versoes = [
        { id: 7, desde: '2026-11-18', vigente: true, publicadoPor: 'SINT.GESTOR', aceites: 0 },
        { id: 1, desde: '2020-12-16', vigente: false, publicadoPor: 'ADMIN', aceites: 5 },
      ];
      return {
        status: 200,
        corpo: { id: 7, anterior: 1, operacao: 'acesso.publicarTermo', destino: 'memoria' },
      };
    });
    await montar();
    await clicar('termo-publicar');
    // O texto começa com o da vigente.
    expect(($('termo-novo-texto') as HTMLTextAreaElement).value).toBe(TEXTO_1);
    await digitar('termo-novo-texto', 'Termo de uso sintético, versão dois, revisado pela comissão.');
    await digitar('termo-motivo', 'Revisão anual do termo');
    expect(
      ($('termo-confirmar')?.querySelector('button') ?? $('termo-confirmar')) as HTMLButtonElement,
    ).toHaveProperty('disabled', true);
    await digitar('termo-senha', 'errada');
    await confirmar();
    expect($('termo-senha-erro')?.textContent).toContain('Senha incorreta');
    expect($('termo-form')).not.toBeNull();
    await digitar('termo-senha', 'Sint#Senha2026');
    await confirmar();
    const post = ultimoPost(ps);
    expect(post?.url).toBe(`${A}/publicar`);
    expect(post?.corpo).toEqual({
      termoAnterior: 1,
      texto: 'Termo de uso sintético, versão dois, revisado pela comissão.',
      motivo: 'Revisão anual do termo',
      senha: 'Sint#Senha2026',
    });
    expect($('termo-aviso')?.textContent).toContain('Versão 7 publicada');
    expect($('termo-versao-7')?.textContent).toContain('Vigente');
    expect($('termo-versao-1')?.textContent).toContain('Anterior');
    // Uma segunda publicação recusada pelo servidor: a recusa aparece fora do diálogo.
    await clicar('termo-publicar');
    await digitar('termo-novo-texto', 'Termo de uso sintético, versão três, outra revisão.');
    await digitar('termo-motivo', 'Outra revisão do termo');
    await digitar('termo-senha', 'Sint#Senha2026');
    await confirmar();
    expect($('termo-recusa')?.textContent).toContain('Outra versão do termo foi publicada');
  });

  it('sem termo vigente: convida a publicar a primeira; desligado: o botão fica inativo com o motivo', async () => {
    versoes = [];
    publicarPossivel = false;
    simular(() => undefined);
    await montar();
    expect($('termo-nenhum')).not.toBeNull();
    expect($('termo-publicar-motivo')?.textContent).toContain('motivo sintético');
    expect($('termo-publicar')?.querySelector('button') ?? $('termo-publicar')).toHaveProperty(
      'disabled',
      true,
    );
  });
});
