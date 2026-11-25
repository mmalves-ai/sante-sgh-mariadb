// @vitest-environment jsdom
// W1-01 (parte 9c2b): a tela "Recertificação de acessos": campanhas com o relatório, abrir (escopo grupo pelas opções,
// prazo, motivo e senha; senha errada fica no diálogo), detalhe com as contas, manter, retirar com revogação de um
// perfil do retrato, efeito pendente no aviso único e encerrar. Dados SINTÉTICOS; o fetch é simulado.
import { criarI18n, instalarUi, resolverMarca, SanteSelecao } from '@sgh/ui';
import { QueryClient, VueQueryPlugin } from '@tanstack/vue-query';
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { App } from 'vue';
import { mensagensWeb } from '../../i18n/pt-BR.js';
import { definirSessaoDaTela } from '../../casca/sessao/pode.js';
import RecertificacaoTela from './telas/RecertificacaoTela.vue';

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

const relatorio = (extra: Record<string, number> = {}) => ({
  total: 2,
  mantidas: 0,
  bloqueadas: 0,
  revogadas: 0,
  pendentes: 2,
  atrasadas: 0,
  percentual: 0,
  ...extra,
});
const campanha = (id: string, extra: Record<string, unknown> = {}) => ({
  id,
  escopo: 'grupo',
  alvo: 'ENFERMAGEM',
  prazo: '2026-12-19',
  motivo: 'revisão semestral dos acessos',
  situacao: 'aberta',
  criadoPor: 'SINT.GESTOR',
  criadoEm: '2026-11-19T12:00:00.000Z',
  fechadoPor: null,
  fechadoEm: null,
  motivoFechamento: null,
  relatorio: relatorio(),
  ...extra,
});
const item = (login: string, extra: Record<string, unknown> = {}) => ({
  login,
  grupo: 'ENFERMAGEM',
  perfis: ['ENF-PLANTAO'],
  decisao: null,
  acao: null,
  perfil: null,
  motivo: null,
  decididoPor: null,
  decididoEm: null,
  ...extra,
});

let lista: Record<string, unknown> = {};
let detalhe: Record<string, unknown> = {};
const listaBase = () => ({
  hoje: '2026-11-19',
  prazoPadrao: '2026-12-19',
  prazoMaximoDias: 90,
  campanhas: [
    campanha('5', {
      escopo: 'todos',
      alvo: null,
      situacao: 'encerrada',
      relatorio: relatorio({ mantidas: 1, bloqueadas: 1, pendentes: 0, percentual: 100 }),
    }),
  ],
  bloqueio: { ligada: true, motivo: null },
  alvos: {
    todos: 2,
    grupos: [{ valor: 'ENFERMAGEM', contas: 2 }],
    setores: [{ valor: 'B1', contas: 1 }],
  },
  ...lista,
});
const detalheBase = () => ({
  hoje: '2026-11-19',
  campanha: campanha('9'),
  itens: [item('SINT.ANA'), item('SINT.BETO')],
  ...detalhe,
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
        (p.metodo === 'GET' && p.url === '/api/acesso/gestao/recertificacoes'
          ? { status: 200, corpo: listaBase() }
          : p.metodo === 'GET' && p.url === '/api/acesso/gestao/recertificacoes/9'
            ? { status: 200, corpo: detalheBase() }
            : p.metodo === 'GET' && p.url.endsWith('/usuarios-opcoes')
              ? {
                  status: 200,
                  corpo: {
                    escopos: {},
                    grupos: [
                      { nome: 'ENFERMAGEM', ativo: true },
                      { nome: 'ANTIGO', ativo: false },
                    ],
                    setores: [{ valor: 'B1', rotulo: 'Bloco 1' }],
                  },
                }
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
async function montar() {
  const w = mount(RecertificacaoTela as never, {
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
/** Escolhe no combo (SanteSelecao com busca) pelo rótulo do campo. */
async function escolher(w: VueWrapper, rotulo: string, valor: string) {
  const c = combo(w, rotulo);
  if (!c) throw new Error(`combo ${rotulo} ausente`);
  c.vm.$emit('update:modelValue', valor);
  await flushPromises();
}
const opcoesDo = (w: VueWrapper, rotulo: string) =>
  (combo(w, rotulo)?.props().opcoes ?? []) as { valor: string }[];
const desligado = (id: string) =>
  (($(id)?.querySelector('button') ?? $(id)) as HTMLButtonElement | null)?.disabled ?? true;
async function confirmar() {
  $('recert-form')?.dispatchEvent(new Event('submit', { cancelable: true }));
  await flushPromises();
}

afterEach(async () => {
  await flushPromises();
  for (const w of montadas.splice(0)) w.unmount();
  vi.unstubAllGlobals();
  document.body.innerHTML = '';
  definirSessaoDaTela(null);
  lista = {};
  detalhe = {};
});

describe('RecertificacaoTela (W1-01 parte 9c2b): recertificação de acessos', () => {
  it('lista as campanhas com o relatório; bloqueio desligado aparece; sem faixa de só consulta', async () => {
    lista = { bloqueio: { ligada: false, motivo: 'receita em revisão' } };
    simular(() => undefined);
    const w = await montar();
    const linha = $('recert-campanha-5')?.textContent ?? '';
    expect(linha).toContain('Todas as contas');
    expect(linha).toContain('Encerrada');
    expect(linha).toContain('1 mantidas, 1 bloqueadas');
    expect(linha).toContain('100% decidido');
    expect($('recert-bloqueio-desligado')?.textContent).toContain('receita em revisão');
    expect(w.text()).not.toMatch(/só consulta/i);
  });

  it('abre campanha de um grupo (só grupos ativos) com prazo, motivo e senha; senha errada fica no diálogo', async () => {
    let tentativas = 0;
    const ps = simular((p) => {
      if (p.metodo !== 'POST') return undefined;
      tentativas++;
      if (tentativas === 1)
        return { status: 401, corpo: { type: 'reautenticacao-necessaria', title: 'x', status: 401 } };
      lista = { campanhas: [campanha('9')] };
      return { status: 200, corpo: { id: '9', itens: 2, destino: 'memoria' } };
    });
    const w = await montar();
    await clicar('recert-abrir');
    expect(($('recert-prazo') as HTMLInputElement).value).toBe('2026-12-19');
    await escolher(w, 'Escopo', 'grupo');
    expect(opcoesDo(w, 'Grupo').map((o) => o.valor)).toEqual(['ENFERMAGEM']);
    await escolher(w, 'Grupo', 'ENFERMAGEM');
    await digitar('recert-motivo', 'curto');
    await digitar('recert-senha', 'Sint#Senha2026');
    expect(desligado('recert-confirmar')).toBe(true);
    await digitar('recert-motivo', 'revisão semestral dos acessos');
    await digitar('recert-senha', 'errada');
    await confirmar();
    expect($('recert-senha-erro')?.textContent).toContain('A senha não confere');
    expect($('recert-form')).not.toBeNull();
    await digitar('recert-senha', 'Sint#Senha2026');
    await confirmar();
    expect(posts(ps).at(-1)).toMatchObject({
      url: '/api/acesso/gestao/recertificacoes',
      corpo: {
        escopo: 'grupo',
        alvo: 'ENFERMAGEM',
        prazo: '2026-12-19',
        motivo: 'revisão semestral dos acessos',
        senha: 'Sint#Senha2026',
      },
    });
    expect($('recert-aviso')?.textContent).toContain('Campanha aberta com 2 conta(s)');
    expect($('recert-item-SINT.ANA')?.textContent).toContain('Pendente');
  });

  it('mantém uma conta e retira outra revogando um perfil do retrato; decidida não mostra mais as ações', async () => {
    lista = { campanhas: [campanha('9')] };
    const ps = simular((p) => {
      if (p.metodo !== 'POST') return undefined;
      const c = p.corpo as { login: string; decisao: string; acao: string | null; perfil: string | null };
      const itens = (detalheBase().itens as ReturnType<typeof item>[]).map((i) =>
        i.login === c.login
          ? { ...i, ...c, decididoPor: 'SINT.GESTOR', decididoEm: '2026-11-19T13:00:00.000Z' }
          : i,
      );
      detalhe = { itens };
      return { status: 200, corpo: { ...c, destino: 'memoria' } };
    });
    const w = await montar();
    await clicar('recert-ver-9');
    expect($('recert-detalhe')?.textContent).toContain('Grupo: ENFERMAGEM');
    await clicar('recert-manter-SINT.ANA');
    await digitar('recert-senha', 'Sint#Senha2026');
    await confirmar();
    expect(posts(ps).at(-1)).toMatchObject({
      url: '/api/acesso/gestao/recertificacoes/9/decisoes',
      corpo: { login: 'SINT.ANA', decisao: 'manter', acao: null, perfil: null, motivo: '' },
    });
    expect($('recert-aviso')?.textContent).toContain('Acesso de "SINT.ANA" mantido');
    expect($('recert-manter-SINT.ANA')).toBeNull();

    await clicar('recert-retirar-SINT.BETO');
    await escolher(w, 'Como retirar', 'revogacao');
    await digitar('recert-motivo', 'mudou de setor em outubro');
    await digitar('recert-senha', 'Sint#Senha2026');
    expect(desligado('recert-confirmar')).toBe(true);
    await escolher(w, 'Perfil a revogar', 'ENF-PLANTAO');
    await confirmar();
    expect(posts(ps).at(-1)?.corpo).toEqual({
      login: 'SINT.BETO',
      decisao: 'retirar',
      acao: 'revogacao',
      perfil: 'ENF-PLANTAO',
      motivo: 'mudou de setor em outubro',
      senha: 'Sint#Senha2026',
    });
    expect($('recert-item-SINT.BETO')?.textContent).toContain('perfil ENF-PLANTAO revogado');
  });

  it('efeito pendente e operação desligada vão ao aviso único; encerrar fecha a campanha', async () => {
    lista = { campanhas: [campanha('9')] };
    let n = 0;
    const ps = simular((p) => {
      if (p.metodo !== 'POST') return undefined;
      n++;
      if (n === 1)
        return {
          status: 409,
          corpo: {
            type: 'recusa-de-negocio',
            title: 'Efeito não aplicado',
            status: 409,
            detail: 'A decisão ficou registrada, mas o bloqueio não foi aplicado(a).',
            codigo: 'efeito-pendente',
          },
        };
      if (n === 2)
        return {
          status: 409,
          corpo: {
            type: 'operacao-bloqueada',
            title: 'Operação desligada',
            status: 409,
            detail: 'receita em revisão',
            codigo: 'operacao-desligada',
          },
        };
      detalhe = { campanha: campanha('9', { situacao: 'encerrada', fechadoPor: 'SINT.GESTOR' }) };
      return { status: 200, corpo: { id: '9', situacao: 'encerrada', pendentes: 1, destino: 'memoria' } };
    });
    await montar();
    await clicar('recert-ver-9');
    await clicar('recert-retirar-SINT.ANA');
    await digitar('recert-motivo', 'desligado do setor');
    await digitar('recert-senha', 'Sint#Senha2026');
    await confirmar();
    expect(posts(ps).at(-1)?.corpo).toMatchObject({ acao: 'bloqueio', perfil: null });
    expect($('recert-recusa')?.textContent).toContain('Efeito pendente. A decisão ficou registrada');
    expect($('recert-form')).toBeNull();

    await clicar('recert-retirar-SINT.BETO');
    await digitar('recert-motivo', 'desligado do setor');
    await digitar('recert-senha', 'Sint#Senha2026');
    await confirmar();
    expect($('recert-recusa')?.textContent).toContain(
      'Operação desligada neste estabelecimento: receita em revisão',
    );

    await clicar('recert-encerrar');
    await digitar('recert-motivo', 'prazo da revisão terminou');
    await digitar('recert-senha', 'Sint#Senha2026');
    await confirmar();
    expect(posts(ps).at(-1)).toMatchObject({
      url: '/api/acesso/gestao/recertificacoes/9/fechar',
      corpo: { situacao: 'encerrada', motivo: 'prazo da revisão terminou', senha: 'Sint#Senha2026' },
    });
    expect($('recert-aviso')?.textContent).toContain('Campanha encerrada (1 pendente(s)');
    expect($('recert-encerrar')).toBeNull();
  });
});
