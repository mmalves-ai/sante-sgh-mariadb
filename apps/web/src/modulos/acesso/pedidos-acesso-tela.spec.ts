// @vitest-environment jsdom
// W1-01 (parte 10c): as telas do pedido de acesso. "Sem permissão" mostra o botão "Pedir acesso" (só com a
// permissão de preferências); "Meus pedidos" abre o formulário vindo do 403 (?novo=1), pede com perfil, setor (combo
// com busca), período e motivo, cancela o próprio com motivo e senha; "Pedidos de acesso" (gestão) aprova o 1º nível,
// concede no 2º, recusa só com motivo e mantém a senha errada no diálogo. Dados SINTÉTICOS; o fetch é simulado.
import { criarI18n, instalarUi, resolverMarca, SanteSelecao } from '@sgh/ui';
import { QueryClient, VueQueryPlugin } from '@tanstack/vue-query';
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { App, Component } from 'vue';
import type { Sessao } from '@sgh/contratos';
import { definirSessaoDaTela } from '../../casca/sessao/pode.js';
import { mensagensWeb } from '../../i18n/pt-BR.js';
import MeusPedidosAcessoTela from './telas/MeusPedidosAcessoTela.vue';
import NaoEncontradaTela from './telas/NaoEncontradaTela.vue';
import PedidosAcessoTela from './telas/PedidosAcessoTela.vue';

const rota = vi.hoisted(() => ({ query: {} as Record<string, string> }));
vi.mock('vue-router', async (original) => ({
  ...(await original<typeof import('vue-router')>()),
  useRoute: () => rota,
}));

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

let permissoes = ['acesso.preferencia.ler', 'acesso.preferencia.editar'];
const sessao = () => ({
  usuario: { id: '1', nome: 'X', login: 'SINT.USUARIO' },
  rede: 'r',
  estabelecimentos: [{ codigo: 'pc', nome: 'PC' }],
  estabelecimentoAtivo: 'pc',
  permissoes,
  sintetica: true,
  bloqueioInatividadeSegundos: 0,
});
const SETORES = [
  { valor: 'UTI-1', rotulo: 'UTI adulto (sintético)' },
  { valor: 'INT-1', rotulo: 'Internação 1º andar (sintético)' },
];
const pedido = (id: string, extra: Record<string, unknown> = {}) => ({
  id,
  login: 'SINT.USUARIO',
  perfil: 'faturamento',
  setor: 'UTI-1',
  inicio: '2026-11-19',
  fim: '2026-11-30',
  motivo: 'cobrir as férias da equipe',
  situacao: 'pendente',
  nivel: 'setor',
  criadoEm: '2026-11-19T12:00:00.000Z',
  setorPor: null,
  setorEm: null,
  acessosPor: null,
  acessosEm: null,
  fechadoPor: null,
  fechadoEm: null,
  motivoFechamento: null,
  concessao: null,
  ...extra,
});
let meus: Record<string, unknown> = {};
let gestao: Record<string, unknown> = {};
const meusBase = () => ({
  hoje: '2026-11-19',
  periodoMaximoDias: 365,
  perfis: ['faturamento', 'recepcao'],
  setores: SETORES,
  pedidos: [],
  ...meus,
});
const gestaoBase = () => ({
  hoje: '2026-11-19',
  pedidos: [pedido('7'), pedido('3', { situacao: 'recusado', nivel: null, fechadoPor: 'SINT.GESTOR' })],
  setorSemGestor: true,
  setores: SETORES,
  ...gestao,
});

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
      const r =
        responder(p) ??
        (p.metodo === 'GET' && p.url === '/api/sessao'
          ? { status: 200, corpo: sessao() }
          : p.metodo === 'GET' && p.url === '/api/acesso/pedidos'
            ? { status: 200, corpo: meusBase() }
            : p.metodo === 'GET' && p.url === '/api/acesso/gestao/pedidos'
              ? { status: 200, corpo: gestaoBase() }
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
const montadas: VueWrapper[] = [];
async function montar(tela: Component, props: Record<string, unknown> = {}) {
  const w = mount(tela as never, {
    attachTo: document.body,
    props: props as never,
    global: {
      plugins: [
        criarI18n(mensagensWeb as unknown as Record<string, unknown>),
        ui,
        [VueQueryPlugin, { queryClient: new QueryClient({ defaultOptions: { queries: { retry: false } } }) }],
      ] as never,
      stubs: {
        RouterLink: {
          props: ['to'],
          template:
            "<a :href=\"typeof to === 'string' ? to : to.path + '?novo=' + to.query.novo\"><slot /></a>",
        },
      },
    },
  });
  montadas.push(w);
  await flushPromises();
  await flushPromises();
  return w;
}
const posts = (ps: Pedido[]) => ps.filter((p) => p.metodo === 'POST');
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
interface Combo {
  props: () => Record<string, unknown>;
  vm: { $emit: (evento: string, valor: unknown) => void };
}
const combo = (w: VueWrapper, rotulo: string): Combo | undefined =>
  (w.findAllComponents(SanteSelecao) as unknown as Combo[]).find((x) => x.props().rotulo === rotulo);
async function escolher(w: VueWrapper, rotulo: string, valor: string) {
  const c = combo(w, rotulo);
  if (!c) throw new Error(`combo ${rotulo} ausente`);
  c.vm.$emit('update:modelValue', valor);
  await flushPromises();
}
const desligado = (id: string) =>
  (($(id)?.querySelector('button') ?? $(id)) as HTMLButtonElement | null)?.disabled ?? true;
async function enviar(form: string) {
  $(form)?.dispatchEvent(new Event('submit', { cancelable: true }));
  await flushPromises();
}

afterEach(async () => {
  await flushPromises();
  for (const w of montadas.splice(0)) w.unmount();
  vi.unstubAllGlobals();
  document.body.innerHTML = '';
  meus = {};
  gestao = {};
  rota.query = {};
  definirSessaoDaTela(null);
  permissoes = ['acesso.preferencia.ler', 'acesso.preferencia.editar'];
});

describe('Pedido de acesso (W1-01 parte 10c): tela 403, meus pedidos e gestão em dois níveis', () => {
  it('a tela "Sem permissão" leva ao pedido com o formulário aberto; sem a permissão, o botão não aparece', async () => {
    definirSessaoDaTela(sessao() as unknown as Sessao);
    simular(() => undefined);
    await montar(NaoEncontradaTela, { motivo: 'sem-permissao' });
    expect($('pedir-acesso')?.getAttribute('href')).toBe('/preferencias/pedidos-acesso?novo=1');
    expect($('pedir-acesso')?.textContent).toContain('Pedir acesso');
    for (const w of montadas.splice(0)) w.unmount();
    permissoes = ['cadastro.paciente.ler'];
    definirSessaoDaTela(sessao() as unknown as Sessao);
    simular(() => undefined);
    await montar(NaoEncontradaTela, { motivo: 'sem-permissao' });
    expect($('pedir-acesso')).toBeNull();
  });

  it('pede pelo formulário aberto do 403 (perfil, setor com busca, período, motivo) sem senha', async () => {
    rota.query = { novo: '1' };
    const ps = simular((p) => {
      if (p.metodo !== 'POST') return undefined;
      meus = { pedidos: [pedido('11')] };
      return { status: 201, corpo: { id: '11', destino: 'memoria' } };
    });
    const w = await montar(MeusPedidosAcessoTela);
    expect($('mp-form')).not.toBeNull();
    expect(w.text()).not.toMatch(/só consulta/i);
    const setor = combo(w, 'Setor');
    expect(setor?.props().busca).toBe(true);
    expect((setor?.props().opcoes as { valor: string }[]).map((o) => o.valor)).toEqual(['UTI-1', 'INT-1']);
    await escolher(w, 'Perfil', 'faturamento');
    await escolher(w, 'Setor', 'UTI-1');
    expect(($('mp-inicio') as HTMLInputElement).value).toBe('2026-11-19');
    await digitar('mp-fim', '2026-11-30');
    await digitar('mp-motivo', 'curto');
    expect(desligado('mp-confirmar')).toBe(true);
    await digitar('mp-motivo', 'cobrir as férias da equipe');
    expect(desligado('mp-confirmar')).toBe(false);
    await enviar('mp-form');
    expect(posts(ps)).toEqual([
      {
        metodo: 'POST',
        url: '/api/acesso/pedidos',
        corpo: {
          perfil: 'faturamento',
          setor: 'UTI-1',
          inicio: '2026-11-19',
          fim: '2026-11-30',
          motivo: 'cobrir as férias da equipe',
        },
      },
    ]);
    expect($('mp-aviso')?.textContent).toContain('Pedido do perfil faturamento enviado');
    const linha = $('mp-pedido-11')?.textContent ?? '';
    expect(linha).toContain('UTI adulto (sintético)');
    expect(linha).toContain('Aguardando o 1º nível');
  });

  it('cancela o próprio pedido com motivo e senha (senha errada fica no diálogo); concedido não se cancela', async () => {
    meus = {
      pedidos: [
        pedido('11', { situacao: 'aprovado-setor', nivel: 'acessos', setorPor: 'SINT.GESTOR' }),
        pedido('4', { situacao: 'concedido', nivel: null, perfil: 'recepcao', concessao: '90' }),
        // Revisão (achado 2): 'aprovado' (concessão a caminho) também não se cancela.
        pedido('5', { situacao: 'aprovado', nivel: null, perfil: 'faturista' }),
      ],
    };
    let tentativas = 0;
    const ps = simular((p) => {
      if (p.metodo !== 'POST') return undefined;
      tentativas++;
      if (tentativas === 1)
        return { status: 401, corpo: { type: 'reautenticacao-necessaria', title: 'x', status: 401 } };
      return { status: 200, corpo: { id: '11', situacao: 'cancelado', destino: 'memoria' } };
    });
    await montar(MeusPedidosAcessoTela);
    expect($('mp-pedido-11')?.textContent).toContain('1º nível: SINT.GESTOR');
    expect($('mp-cancelar-4')).toBeNull();
    expect($('mp-cancelar-5')).toBeNull();
    await clicar('mp-cancelar-11');
    await digitar('mp-motivo', 'não preciso mais do perfil');
    await digitar('mp-senha', 'errada');
    await enviar('mp-form');
    expect($('mp-senha-erro')?.textContent).toContain('A senha não confere');
    expect($('mp-form')).not.toBeNull();
    await digitar('mp-senha', 'Sint#Senha2026');
    await enviar('mp-form');
    expect(posts(ps).at(-1)).toMatchObject({
      url: '/api/acesso/pedidos/11/cancelar',
      corpo: { motivo: 'não preciso mais do perfil', senha: 'Sint#Senha2026' },
    });
    expect($('mp-aviso')?.textContent).toContain('cancelado');
  });

  it('gestão: lista os que esperam decisão, aprova o 1º nível e concede no 2º com a senha', async () => {
    let n = 0;
    const ps = simular((p) => {
      if (p.metodo !== 'POST') return undefined;
      n++;
      if (n === 1) {
        gestao = {
          pedidos: [pedido('7', { situacao: 'aprovado-setor', nivel: 'acessos', setorPor: 'SINT.GESTOR' })],
        };
        return {
          status: 200,
          corpo: { id: '7', situacao: 'aprovado-setor', concessao: null, destino: 'memoria' },
        };
      }
      gestao = { pedidos: [] };
      return { status: 200, corpo: { id: '7', situacao: 'concedido', concessao: '91', destino: 'memoria' } };
    });
    const w = await montar(PedidosAcessoTela);
    expect($('pg-sem-gestor')).not.toBeNull();
    expect($('pg-pedido-3')).toBeNull(); // recusado: fora do filtro "esperam decisão"
    expect($('pg-pedido-7')?.textContent).toContain('Aguarda o 1º nível');
    await escolher(w, 'Mostrar', 'todos');
    expect($('pg-pedido-3')?.textContent).toContain('Recusado');
    await clicar('pg-aprovar-7');
    await digitar('pg-senha', 'Sint#Senha2026');
    await enviar('pg-form');
    expect(posts(ps).at(-1)).toMatchObject({
      url: '/api/acesso/gestao/pedidos/7/decisao',
      corpo: { decisao: 'aprovar', motivo: '', senha: 'Sint#Senha2026' },
    });
    expect($('pg-aviso')?.textContent).toContain('aprovado no 1º nível');
    expect($('pg-pedido-7')?.textContent).toContain('Aguarda o 2º nível');
    await clicar('pg-aprovar-7');
    await digitar('pg-senha', 'Sint#Senha2026');
    await enviar('pg-form');
    expect($('pg-aviso')?.textContent).toContain(
      'Perfil faturamento concedido a SINT.USUARIO até 30/11/2026',
    );
  });

  it('gestão: recusar exige motivo; a recusa do servidor (segregação) vai ao aviso único', async () => {
    const ps = simular((p) =>
      p.metodo === 'POST'
        ? {
            status: 422,
            corpo: {
              type: 'regra-negocio',
              title: 'Recusado',
              status: 422,
              detail: 'Quem decidiu o 1º nível não decide o 2º.',
            },
          }
        : undefined,
    );
    await montar(PedidosAcessoTela);
    await clicar('pg-recusar-7');
    await digitar('pg-senha', 'Sint#Senha2026');
    expect(desligado('pg-confirmar')).toBe(true);
    await digitar('pg-motivo', 'perfil incompatível com a função');
    expect(desligado('pg-confirmar')).toBe(false);
    await enviar('pg-form');
    expect(posts(ps).at(-1)?.corpo).toMatchObject({
      decisao: 'recusar',
      motivo: 'perfil incompatível com a função',
    });
    expect($('pg-recusa')?.textContent).toContain('Quem decidiu o 1º nível não decide o 2º.');
    expect($('pg-form')).toBeNull();
  });

  it('revisão (pedido preso): o "aprovado" sem concessão aparece em "esperam decisão" com "Conceder o perfil" (só senha)', async () => {
    let n = 0;
    gestao = {
      pedidos: [
        pedido('8', {
          situacao: 'aprovado',
          nivel: null,
          setorPor: 'SINT.GESTOR',
          acessosPor: 'SINT.VINCULOS',
        }),
        pedido('9', { situacao: 'concedido', nivel: null, concessao: '90' }),
      ],
    };
    const ps = simular((p) => {
      if (p.metodo !== 'POST') return undefined;
      n++;
      if (n === 1)
        return { status: 401, corpo: { type: 'reautenticacao-necessaria', title: 'x', status: 401 } };
      gestao = { pedidos: [] };
      return { status: 200, corpo: { id: '8', situacao: 'concedido', concessao: '91', destino: 'memoria' } };
    });
    await montar(PedidosAcessoTela);
    expect($('pg-pedido-8')?.textContent).toContain('Aprovado; perfil ainda não concedido');
    expect($('pg-pedido-9')).toBeNull();
    expect($('pg-aprovar-8')).toBeNull();
    await clicar('pg-conceder-8');
    expect($('pg-texto-conceder')?.textContent).toContain('concedido de 19/11/2026 a 30/11/2026');
    expect($('pg-motivo')).toBeNull();
    expect(desligado('pg-confirmar')).toBe(true);
    await digitar('pg-senha', 'Errada#2026');
    await enviar('pg-form');
    expect($('pg-senha-erro')).not.toBeNull();
    await digitar('pg-senha', 'Sint#Senha2026');
    await enviar('pg-form');
    expect(posts(ps).at(-1)).toMatchObject({
      url: '/api/acesso/gestao/pedidos/8/conceder',
      corpo: { senha: 'Sint#Senha2026' },
    });
    expect($('pg-aviso')?.textContent).toContain(
      'Perfil faturamento concedido a SINT.USUARIO até 30/11/2026',
    );
  });
});
