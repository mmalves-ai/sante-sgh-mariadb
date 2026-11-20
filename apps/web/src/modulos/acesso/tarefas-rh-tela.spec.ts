// @vitest-environment jsdom
// W1-01 (parte 11a3): a tela "Tarefas do RH": parâmetros, tarefas abertas (criar acesso leva à criação do usuário com
// o nome e o perfil sugerido; concluir com o login criado; dispensar; suspender = bloqueio, desligado sem receita),
// resolvidas consultáveis, mapa cargo → perfil (trocar, retirar, histórico), senha errada no diálogo e efeito
// pendente; e a criação do usuário aberta pela query. Dados SINTÉTICOS; o fetch é simulado.
import type { Sessao } from '@sgh/contratos';
import { criarI18n, instalarUi, resolverMarca } from '@sgh/ui';
import { QueryClient, VueQueryPlugin } from '@tanstack/vue-query';
import { flushPromises, mount } from '@vue/test-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { App, Component } from 'vue';
import { createMemoryHistory, createRouter } from 'vue-router';
import { mensagensWeb } from '../../i18n/pt-BR.js';
import { definirSessaoDaTela } from '../../casca/sessao/pode.js';
import UsuariosTela from '../administracao/telas/UsuariosTela.vue';
import TarefasRhTela from './telas/TarefasRhTela.vue';

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

const tarefa = (tipo: string, vinculo: number, extra: Record<string, unknown> = {}) => ({
  tipo,
  vinculo,
  ref: tipo === 'suspender-acesso' ? `ferias:${vinculo}` : `vinculo:${vinculo}`,
  nome: `COLABORADOR SINTETICO ${vinculo}`,
  cargo: 'TECNICO DE ENFERMAGEM',
  setor: 'POSTO 2',
  desde: '2026-11-10',
  login: null,
  perfilSugerido: null,
  detalhe: [],
  ...extra,
});
const CRIAR = tarefa('criar-acesso', 11, { perfilSugerido: 'assistencial' });
const REVISAR = tarefa('revisar-acesso', 12, { login: 'SINT.REV', detalhe: ['Cargo: AUXILIAR → TECNICO'] });
const SUSPENDER = tarefa('suspender-acesso', 13, { login: 'SINT.FERIAS' });
const k = (x: { tipo: string; vinculo: number; ref: string }) => `${x.tipo}-${x.vinculo}-${x.ref}`;

let estado: Record<string, unknown> = {};
const tarefas = () => ({
  hoje: '2026-11-19',
  tarefas: [CRIAR, REVISAR, SUSPENDER],
  resolvidas: [
    {
      id: '5',
      tipo: 'criar-acesso',
      vinculo: 9,
      ref: 'vinculo:9',
      situacao: 'feita',
      login: 'SINT.NOVA',
      motivo: 'acesso criado na admissão',
      resolvidoPor: 'SINT.GESTOR',
      resolvidoEm: '2026-11-18T12:00:00.000Z',
    },
  ],
  parametros: { suspenderAfastamento: true, diasMinimosAfastamento: 15 },
  bloqueio: { ligada: true, motivo: null },
  ...estado,
});
const mapa = () => ({
  vigentes: { 'TECNICO DE ENFERMAGEM': 'assistencial' },
  historico: [
    {
      id: '3',
      cargo: 'TECNICO DE ENFERMAGEM',
      perfil: 'assistencial',
      situacao: 'vigente',
      motivo: 'padrão da enfermagem',
      criadoPor: 'SINT.GESTOR',
      criadoEm: '2026-11-01T12:00:00.000Z',
    },
  ],
  perfis: ['assistencial', 'recepcao'],
  cargos: ['TECNICO DE ENFERMAGEM', 'RECEPCIONISTA'],
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
        (p.metodo === 'GET' && p.url === '/api/acesso/gestao/rh/tarefas'
          ? { status: 200, corpo: tarefas() }
          : p.metodo === 'GET' && p.url === '/api/acesso/gestao/rh/perfis-cargo'
            ? { status: 200, corpo: mapa() }
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
async function montar(tela: Component = TarefasRhTela, caminho = '/') {
  const roteador = createRouter({
    history: createMemoryHistory(),
    routes: [{ path: '/:caminho(.*)*', component: { template: '<div />' } }],
  });
  await roteador.push(caminho);
  const w = mount(tela as never, {
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
  montadas.push(w);
  await flushPromises();
  return { w, roteador };
}
const ultimoPost = (ps: Pedido[]) => ps.filter((p) => p.metodo === 'POST').at(-1);
const $ = (id: string) => document.querySelector<HTMLElement>(`[data-testid="${id}"]`);
const botao = (id: string) =>
  ($(id)?.tagName === 'BUTTON' ? $(id) : $(id)?.querySelector('button')) as HTMLButtonElement | null;
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
  const b = botao(id);
  if (!b) throw new Error(`botão ${id} ausente`);
  b.click();
  await flushPromises();
}
async function confirmar() {
  $('rh-form')?.dispatchEvent(new Event('submit', { cancelable: true }));
  await flushPromises();
}

afterEach(async () => {
  await flushPromises();
  for (const w of montadas.splice(0)) w.unmount();
  vi.unstubAllGlobals();
  document.body.innerHTML = '';
  definirSessaoDaTela(null);
  estado = {};
});

describe('TarefasRhTela (W1-01 parte 11a3): tarefas do RH e mapa cargo → perfil', () => {
  it('mostra parâmetros, tarefas, resolvidas e o mapa; criar acesso leva à criação com nome e perfil', async () => {
    simular(() => undefined);
    const { w } = await montar();
    expect($('rh-parametros')?.textContent).toContain('ligada (a partir de 15 dias)');
    expect($(`rh-tarefa-${k(CRIAR)}`)?.textContent).toContain('Criar acesso');
    expect($(`rh-tarefa-${k(CRIAR)}`)?.textContent).toContain('assistencial');
    expect($(`rh-tarefa-${k(REVISAR)}`)?.textContent).toContain('Cargo: AUXILIAR → TECNICO');
    const href = $(`rh-criar-${k(CRIAR)}`)?.getAttribute('href') ?? '';
    expect(href.startsWith('/administracao/acesso/usuarios?')).toBe(true);
    const q = new URLSearchParams(href.split('?')[1]);
    expect([q.get('novo'), q.get('nome'), q.get('perfil')]).toEqual([
      '1',
      'COLABORADOR SINTETICO 11',
      'assistencial',
    ]);
    expect($(`rh-ficha-${k(REVISAR)}`)?.getAttribute('href')).toBe('/administracao/acesso/usuarios/SINT.REV');
    expect($('rh-resolvidas')?.textContent).toContain('SINT.NOVA');
    expect($('rh-cargo-TECNICO DE ENFERMAGEM')?.textContent).toContain('assistencial');
    expect($('rh-mapa-historico')?.textContent).toContain('padrão da enfermagem');
    expect($('rh-bloqueio-desligado')).toBeNull();
    expect(w.text()).not.toMatch(/só consulta/i);
  });

  it('conclui criar acesso com o login criado (senha errada fica no diálogo)', async () => {
    let tentativas = 0;
    const ps = simular((p) => {
      if (p.metodo !== 'POST') return undefined;
      tentativas++;
      if (tentativas === 1)
        return { status: 401, corpo: { type: 'reautenticacao-necessaria', title: 'x', status: 401 } };
      estado = { tarefas: [REVISAR, SUSPENDER] };
      return { status: 200, corpo: { id: '6', bloqueado: false, destino: 'memoria' } };
    });
    await montar();
    await clicar(`rh-feita-${k(CRIAR)}`);
    await digitar('rh-motivo', 'acesso criado hoje pela ficha');
    await digitar('rh-senha', 'Sint#Senha2026');
    expect(botao('rh-confirmar')?.disabled).toBe(true);
    await digitar('rh-login', 'SINT.COLAB11');
    await digitar('rh-senha', 'errada');
    await confirmar();
    expect($('rh-senha-erro')?.textContent).toContain('A senha não confere');
    expect($('rh-form')).not.toBeNull();
    await digitar('rh-senha', 'Sint#Senha2026');
    await confirmar();
    expect(ultimoPost(ps)).toMatchObject({
      url: '/api/acesso/gestao/rh/tarefas/resolver',
      corpo: {
        tipo: 'criar-acesso',
        vinculo: 11,
        ref: 'vinculo:11',
        situacao: 'feita',
        login: 'SINT.COLAB11',
        motivo: 'acesso criado hoje pela ficha',
        senha: 'Sint#Senha2026',
      },
    });
    expect($('rh-aviso')?.textContent).toContain('Tarefa de COLABORADOR SINTETICO 11 concluída');
    expect($(`rh-tarefa-${k(CRIAR)}`)).toBeNull();
  });

  it('dispensa a revisão sem login e suspende pelo bloqueio; motivo curto não sai', async () => {
    const ps = simular((p) =>
      p.metodo === 'POST'
        ? {
            status: 200,
            corpo: { id: '7', bloqueado: p.corpo?.['tipo'] === 'suspender-acesso', destino: 'memoria' },
          }
        : undefined,
    );
    await montar();
    await clicar(`rh-dispensar-${k(REVISAR)}`);
    expect($('rh-login')).toBeNull();
    await digitar('rh-motivo', 'curto');
    await digitar('rh-senha', 'Sint#Senha2026');
    expect(botao('rh-confirmar')?.disabled).toBe(true);
    await digitar('rh-motivo', 'mesmo setor, perfil continua certo');
    await confirmar();
    expect(ultimoPost(ps)?.corpo).toMatchObject({
      tipo: 'revisar-acesso',
      situacao: 'dispensada',
      login: null,
    });
    expect($('rh-aviso')?.textContent).toContain('dispensada');

    await clicar(`rh-feita-${k(SUSPENDER)}`);
    expect(document.body.textContent).toContain('O usuário SINT.FERIAS será bloqueado agora');
    await digitar('rh-motivo', 'férias de 30 dias a partir de hoje');
    await digitar('rh-senha', 'Sint#Senha2026');
    await confirmar();
    expect(ultimoPost(ps)?.corpo).toMatchObject({ tipo: 'suspender-acesso', situacao: 'feita', login: null });
    expect($('rh-aviso')?.textContent).toContain('usuário SINT.FERIAS bloqueado');
  });

  it('com o bloqueio desligado avisa e não deixa suspender; efeito pendente aparece na recusa', async () => {
    estado = { bloqueio: { ligada: false, motivo: 'receita do bloqueio desligada' } };
    simular((p) =>
      p.metodo === 'POST'
        ? {
            status: 409,
            corpo: {
              type: 'recusa-de-negocio',
              title: 'Operação recusada',
              status: 409,
              detail: 'Resolução gravada; o bloqueio falhou.',
              codigo: 'efeito-pendente',
            },
          }
        : undefined,
    );
    await montar();
    expect($('rh-bloqueio-desligado')?.textContent).toContain('receita do bloqueio desligada');
    expect(botao(`rh-feita-${k(SUSPENDER)}`)?.disabled).toBe(true);
    await clicar(`rh-dispensar-${k(SUSPENDER)}`);
    await digitar('rh-motivo', 'colaborador voltou antes do prazo');
    await digitar('rh-senha', 'Sint#Senha2026');
    await confirmar();
    expect($('rh-recusa')?.textContent).toContain('Efeito pendente. Resolução gravada; o bloqueio falhou.');
  });

  it('troca o perfil sugerido de um cargo e retira a sugestão (linha nova com motivo e senha)', async () => {
    const ps = simular((p) =>
      p.metodo === 'POST'
        ? { status: 200, corpo: { id: '9', anterior: 'assistencial', perfil: null, destino: 'memoria' } }
        : undefined,
    );
    await montar();
    await clicar('rh-cargo-trocar-TECNICO DE ENFERMAGEM');
    await digitar('rh-motivo', 'técnicos passam a usar o perfil revisado');
    await digitar('rh-senha', 'Sint#Senha2026');
    await confirmar();
    expect(ultimoPost(ps)).toMatchObject({
      url: '/api/acesso/gestao/rh/perfis-cargo',
      corpo: { cargo: 'TECNICO DE ENFERMAGEM', perfil: 'assistencial', senha: 'Sint#Senha2026' },
    });
    expect($('rh-aviso')?.textContent).toContain('Cargo TECNICO DE ENFERMAGEM: perfil sugerido assistencial');

    await clicar('rh-cargo-retirar-TECNICO DE ENFERMAGEM');
    await digitar('rh-motivo', 'cargo extinto no plano de cargos');
    await digitar('rh-senha', 'Sint#Senha2026');
    await confirmar();
    expect(ultimoPost(ps)?.corpo).toMatchObject({ cargo: 'TECNICO DE ENFERMAGEM', perfil: null });
    expect($('rh-aviso')?.textContent).toContain('Sugestão do cargo TECNICO DE ENFERMAGEM retirada');
  });

  it('a lista de usuários abre a criação com o nome e o perfil sugerido vindos da tarefa', async () => {
    definirSessaoDaTela({ permissoes: ['acesso.usuario.ler', 'acesso.usuario.criar'] } as unknown as Sessao);
    simular(() => undefined);
    const { roteador } = await montar(
      UsuariosTela,
      '/administracao/acesso/usuarios?novo=1&nome=COLABORADOR%20SINTETICO%2011&perfil=assistencial',
    );
    await flushPromises();
    expect($('form-novo-usuario')).not.toBeNull();
    expect(($('novo-nome')?.querySelector('input') ?? ($('novo-nome') as HTMLInputElement))?.value).toBe(
      'COLABORADOR SINTETICO 11',
    );
    expect($('novo-perfil-sugerido')?.textContent).toContain('Perfil sugerido pelo cargo: assistencial');
    expect(roteador.currentRoute.value.query['novo']).toBeUndefined();
  });
});
