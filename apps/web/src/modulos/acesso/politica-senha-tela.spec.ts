// @vitest-environment jsdom
// W1-01 (parte 5): a tela "Política de senha": a em vigor, as regras de base e as versões (em vigor, agendada,
// anterior, cancelada); publicar versão nova (com motivo, início e a senha num diálogo; senha errada fica no diálogo;
// a recusa do servidor aparece) e cancelar a agendada. Dados SINTÉTICOS; o fetch é simulado.
import { criarI18n, instalarUi, resolverMarca } from '@sgh/ui';
import { QueryClient, VueQueryPlugin } from '@tanstack/vue-query';
import { flushPromises, mount } from '@vue/test-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { App } from 'vue';
import { mensagensWeb } from '../../i18n/pt-BR.js';
import { definirSessaoDaTela } from '../../casca/sessao/pode.js';
import PoliticaSenhaTela from './telas/PoliticaSenhaTela.vue';

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

const versao = (n: number, estado: string, extra: Record<string, unknown> = {}) => ({
  versao: n,
  minimoCaracteres: 10 + n,
  exigeEspecial: true,
  exigeMinuscula: false,
  exigeMaiuscula: false,
  trocaDias: 90,
  reusoDias: 365,
  recusaNome: true,
  recusaNascimento: true,
  recusaComuns: true,
  senhasProibidas: ['Redesante'],
  vigenteDesde: '2026-11-01T03:00:00.000Z',
  motivo: `motivo ${n}`,
  criadoPor: 'SINT.GESTOR',
  criadoEm: '2026-10-30T12:00:00.000Z',
  estado,
  canceladaEm: null,
  canceladaPor: null,
  motivoCancelamento: null,
  ...extra,
});

let versoes: unknown[] = [];
const tela = () => ({
  legado: {
    minimoCaracteres: 6,
    exigeEspecial: false,
    exigeMinuscula: false,
    exigeMaiuscula: false,
    trocaDias: null,
    reusoDias: null,
  },
  minimoDoNovo: 8,
  efetiva: {
    minimoCaracteres: 12,
    exigeEspecial: true,
    exigeMinuscula: false,
    exigeMaiuscula: false,
    trocaDias: 90,
    reusoDias: 365,
    recusaNome: true,
    recusaNascimento: true,
    recusaComuns: true,
  },
  versoes,
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
        (p.url === '/api/acesso/gestao/politica-senha' && p.metodo === 'GET'
          ? { status: 200, corpo: tela() }
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
  const w = mount(PoliticaSenhaTela as never, {
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
  $('politica-senha-form')?.dispatchEvent(new Event('submit', { cancelable: true }));
  await flushPromises();
}

afterEach(async () => {
  await flushPromises();
  for (const w of montadas.splice(0)) w.unmount();
  vi.unstubAllGlobals();
  document.body.innerHTML = '';
  definirSessaoDaTela(null);
});

describe('PoliticaSenhaTela (W1-01 parte 5): política de senha por versão', () => {
  it('sem versão: valem as regras de base; a em vigor e as de base aparecem, sem faixa de só consulta', async () => {
    versoes = [];
    simular(() => undefined);
    const w = await montar();
    expect($('politica-senha-nenhuma')).not.toBeNull();
    expect($('politica-senha-efetiva')?.textContent).toContain('Mínimo de 12 caracteres');
    expect($('politica-senha-efetiva')?.textContent).toContain('Recusa senhas comuns e vazadas');
    expect($('politica-senha-base')?.textContent).toContain(
      'Mínimo de 6 caracteres (o sistema exige pelo menos 8)',
    );
    expect(w.text()).not.toMatch(/só consulta/i);
    expect($('politica-senha-publicar')).not.toBeNull();
  });

  it('publica versão nova com motivo e senha (senha errada fica no diálogo); a lista local vai sem linhas vazias', async () => {
    versoes = [versao(1, 'em-vigor')];
    let tentativas = 0;
    const ps = simular((p) => {
      if (p.metodo !== 'POST') return undefined;
      tentativas++;
      if (tentativas === 1)
        return { status: 401, corpo: { type: 'reautenticacao-necessaria', title: 'x', status: 401 } };
      versoes = [versao(2, 'em-vigor', { minimoCaracteres: 14 }), versao(1, 'anterior')];
      return { status: 200, corpo: { id: '9', versao: 2, anterior: 1, diferenca: [] } };
    });
    await montar();
    expect($('politica-senha-estado-1')?.textContent).toContain('Em vigor');
    await clicar('politica-senha-publicar');
    // O formulário começa com as regras da última versão.
    expect(($('politica-senha-minimo') as HTMLInputElement).value).toBe('11');
    await digitar('politica-senha-minimo', '14');
    await digitar('politica-senha-proibidas', 'Redesante\n\n  HospitalX  \n');
    await digitar('politica-senha-motivo', 'auditoria SBIS');
    expect(
      ($('politica-senha-confirmar')?.querySelector('button') ??
        $('politica-senha-confirmar')) as HTMLButtonElement,
    ).toHaveProperty('disabled', true);
    await digitar('politica-senha-senha', 'errada');
    await confirmar();
    expect($('politica-senha-senha-erro')?.textContent).toContain('A senha não confere');
    expect($('politica-senha-form')).not.toBeNull();
    await digitar('politica-senha-senha', 'Sint#Senha2026');
    await confirmar();
    const post = ultimoPost(ps);
    expect(post?.url).toBe('/api/acesso/gestao/politica-senha');
    expect(post?.corpo).toMatchObject({
      minimoCaracteres: 14,
      trocaDias: 90,
      reusoDias: 365,
      exigeEspecial: true,
      recusaComuns: true,
      senhasProibidas: ['Redesante', 'HospitalX'],
      motivo: 'auditoria SBIS',
      senha: 'Sint#Senha2026',
    });
    expect(typeof post?.corpo?.['vigenteDesde']).toBe('string');
    expect($('politica-senha-aviso')?.textContent).toContain('Versão 2 publicada');
    expect($('politica-senha-estado-1')?.textContent).toContain('Anterior');
    expect($('politica-senha-estado-2')?.textContent).toContain('Em vigor');
  });

  it('recusa do servidor (nada mudou) aparece fora do diálogo', async () => {
    versoes = [versao(1, 'em-vigor')];
    simular((p) =>
      p.metodo === 'POST'
        ? {
            status: 422,
            corpo: {
              type: 'sem-mudanca',
              title: 'Recusada',
              status: 422,
              detail: 'As regras informadas são iguais às da última versão publicada.',
            },
          }
        : undefined,
    );
    await montar();
    await clicar('politica-senha-publicar');
    await digitar('politica-senha-motivo', 'mesma coisa');
    await digitar('politica-senha-senha', 'Sint#Senha2026');
    await confirmar();
    expect($('politica-senha-recusa')?.textContent).toContain('iguais às da última versão');
    expect($('politica-senha-form')).toBeNull();
  });

  it('cancela a versão agendada com motivo e senha; a em vigor não tem o botão', async () => {
    versoes = [versao(2, 'agendada'), versao(1, 'em-vigor')];
    const ps = simular((p) => {
      if (p.metodo !== 'POST') return undefined;
      versoes = [
        versao(2, 'cancelada', { motivoCancelamento: 'agendada por engano' }),
        versao(1, 'em-vigor'),
      ];
      return { status: 200, corpo: { id: '9', versao: 2 } };
    });
    await montar();
    expect($('politica-senha-cancelar-1')).toBeNull();
    await clicar('politica-senha-cancelar-2');
    await digitar('politica-senha-motivo', 'agendada por engano');
    await digitar('politica-senha-senha', 'Sint#Senha2026');
    await confirmar();
    expect(ultimoPost(ps)).toMatchObject({
      url: '/api/acesso/gestao/politica-senha/2/cancelar',
      corpo: { motivo: 'agendada por engano', senha: 'Sint#Senha2026' },
    });
    expect($('politica-senha-aviso')?.textContent).toContain('Versão 2 cancelada');
    expect($('politica-senha-estado-2')?.textContent).toMatch(/Cancelada\s+\(agendada por engano\)/);
  });
});
