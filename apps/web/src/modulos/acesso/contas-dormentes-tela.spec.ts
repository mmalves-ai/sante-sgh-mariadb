// @vitest-environment jsdom
// W1-01 (parte 9b2b): a tela "Contas dormentes": parâmetros e estado do bloqueio, prévia, poupadas, exceções
// (incluir pela prévia, alterar o prazo, retirar; diálogo com motivo e a senha; senha errada fica no diálogo) e
// "Rodar agora" com o resultado e a recusa de rodada em andamento. Dados SINTÉTICOS; o fetch é simulado.
import { criarI18n, instalarUi, resolverMarca } from '@sgh/ui';
import { QueryClient, VueQueryPlugin } from '@tanstack/vue-query';
import { flushPromises, mount } from '@vue/test-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { App } from 'vue';
import { mensagensWeb } from '../../i18n/pt-BR.js';
import { definirSessaoDaTela } from '../../casca/sessao/pode.js';
import ContasDormentesTela from './telas/ContasDormentesTela.vue';

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

const conta = (login: string, situacao: string, extra: Record<string, unknown> = {}) => ({
  login,
  tipo: 'pessoal',
  situacao,
  diasSemAcesso: 120,
  limiteDias: 90,
  ultimoAcesso: '2026-07-22T10:00:00.000Z',
  ...extra,
});

let estado: Record<string, unknown> = {};
const base = () => ({
  hoje: '2026-11-19',
  parametros: { ligada: true, diasPessoal: 90, diasDispositivo: 180 },
  previa: [conta('SINT.ANA', 'bloquear')],
  poupadas: [
    conta('SINT.BETO', 'excecao', { motivoExcecao: 'licença médica até dezembro' }),
    conta('SINT.NOVO', 'nunca-entrou', { diasSemAcesso: null, ultimoAcesso: null }),
    conta('SINT.GESTOR', 'ultimo-gestor'),
  ],
  excecoes: [{ login: 'SINT.BETO', ate: '2026-12-31', motivo: 'licença médica até dezembro' }],
  historico: [
    {
      login: 'SINT.BETO',
      ate: '2026-12-31',
      situacao: 'vigente',
      motivo: 'licença médica até dezembro',
      criadoPor: 'SINT.GESTOR',
      criadoEm: '2026-11-01T12:00:00.000Z',
    },
  ],
  bloqueio: { ligada: true, motivo: null },
});
const tela = () => ({ ...base(), ...estado });

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
        (p.url === '/api/acesso/gestao/contas-dormentes' && p.metodo === 'GET'
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
  const w = mount(ContasDormentesTela as never, {
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
  $('dormentes-form')?.dispatchEvent(new Event('submit', { cancelable: true }));
  await flushPromises();
}

afterEach(async () => {
  await flushPromises();
  for (const w of montadas.splice(0)) w.unmount();
  vi.unstubAllGlobals();
  document.body.innerHTML = '';
  definirSessaoDaTela(null);
});

describe('ContasDormentesTela (W1-01 parte 9b2b): contas dormentes', () => {
  it('mostra parâmetros, prévia, poupadas com o motivo, exceções e histórico; sem faixa de só consulta', async () => {
    estado = {};
    simular(() => undefined);
    const w = await montar();
    expect($('dormentes-parametros')?.textContent).toContain('Conta pessoal: 90 dias sem acesso');
    expect($('dormentes-parametros')?.textContent).toContain('180 dias');
    expect($('dormentes-previa-SINT.ANA')?.textContent).toContain('120');
    expect($('dormentes-poupada-SINT.BETO')?.textContent).toContain('Exceção: licença médica até dezembro');
    expect($('dormentes-poupada-SINT.NOVO')?.textContent).toContain('Nunca entrou');
    expect($('dormentes-poupada-SINT.GESTOR')?.textContent).toContain('Último gestor');
    expect($('dormentes-excecao-SINT.BETO')?.textContent).toContain('31/12/2026');
    expect($('dormentes-historico')?.textContent).toContain('SINT.GESTOR');
    expect($('dormentes-bloqueio-desligado')).toBeNull();
    expect(w.text()).not.toMatch(/só consulta/i);
  });

  it('poupa uma conta da prévia com prazo, motivo e senha (senha errada fica no diálogo)', async () => {
    estado = {};
    let tentativas = 0;
    const ps = simular((p) => {
      if (p.metodo !== 'POST') return undefined;
      tentativas++;
      if (tentativas === 1)
        return { status: 401, corpo: { type: 'reautenticacao-necessaria', title: 'x', status: 401 } };
      estado = { previa: [] };
      return { status: 200, corpo: { id: '7', anterior: null, atual: '2027-01-31', destino: 'memoria' } };
    });
    await montar();
    await clicar('dormentes-poupar-SINT.ANA');
    await digitar('dormentes-ate', '2027-01-31');
    await digitar('dormentes-motivo', 'curto');
    await digitar('dormentes-senha', 'Sint#Senha2026');
    expect(
      ($('dormentes-confirmar')?.querySelector('button') ?? $('dormentes-confirmar')) as HTMLButtonElement,
    ).toHaveProperty('disabled', true);
    await digitar('dormentes-motivo', 'afastamento pelo INSS');
    await digitar('dormentes-senha', 'errada');
    await confirmar();
    expect($('dormentes-senha-erro')?.textContent).toContain('A senha não confere');
    expect($('dormentes-form')).not.toBeNull();
    await digitar('dormentes-senha', 'Sint#Senha2026');
    await confirmar();
    expect(ultimoPost(ps)).toMatchObject({
      url: '/api/acesso/gestao/contas-dormentes/excecoes',
      corpo: {
        login: 'SINT.ANA',
        ate: '2027-01-31',
        retirar: false,
        motivo: 'afastamento pelo INSS',
        senha: 'Sint#Senha2026',
      },
    });
    expect($('dormentes-aviso')?.textContent).toContain('Exceção de "SINT.ANA" gravada');
    expect($('dormentes-previa-nenhuma')).not.toBeNull();
  });

  it('altera o prazo (começa com o atual; vazio = sem prazo) e retira a exceção', async () => {
    estado = {};
    const ps = simular((p) =>
      p.metodo === 'POST'
        ? { status: 200, corpo: { id: '8', anterior: '2026-12-31', atual: null, destino: 'memoria' } }
        : undefined,
    );
    await montar();
    await clicar('dormentes-alterar-SINT.BETO');
    expect(($('dormentes-ate') as HTMLInputElement).value).toBe('2026-12-31');
    await digitar('dormentes-ate', '');
    await digitar('dormentes-motivo', 'licença prorrogada sem data');
    await digitar('dormentes-senha', 'Sint#Senha2026');
    await confirmar();
    expect(ultimoPost(ps)?.corpo).toMatchObject({ login: 'SINT.BETO', ate: null, retirar: false });

    await clicar('dormentes-retirar-SINT.BETO');
    expect($('dormentes-ate')).toBeNull();
    await digitar('dormentes-motivo', 'voltou ao trabalho hoje');
    await digitar('dormentes-senha', 'Sint#Senha2026');
    await confirmar();
    expect(ultimoPost(ps)?.corpo).toMatchObject({
      login: 'SINT.BETO',
      ate: null,
      retirar: true,
      motivo: 'voltou ao trabalho hoje',
    });
    expect($('dormentes-aviso')?.textContent).toContain('Exceção de "SINT.BETO" retirada');
  });

  it('recusa do servidor na exceção aparece fora do diálogo', async () => {
    estado = {};
    simular((p) =>
      p.metodo === 'POST'
        ? {
            status: 422,
            corpo: {
              type: 'recusa-de-negocio',
              title: 'Recusada',
              status: 422,
              detail: 'A exceção informada é igual à vigente.',
            },
          }
        : undefined,
    );
    await montar();
    await clicar('dormentes-alterar-SINT.BETO');
    await digitar('dormentes-motivo', 'mesmo prazo de antes');
    await digitar('dormentes-senha', 'Sint#Senha2026');
    await confirmar();
    expect($('dormentes-recusa')?.textContent).toContain('igual à vigente');
    expect($('dormentes-form')).toBeNull();
  });

  it('rodar agora pede a senha e mostra o resultado (bloqueadas, poupadas e falhas)', async () => {
    estado = {};
    const ps = simular((p) => {
      if (p.metodo !== 'POST') return undefined;
      estado = { previa: [] };
      return {
        status: 200,
        corpo: {
          hoje: '2026-11-19',
          ligada: true,
          motivo: null,
          bloqueadas: [conta('SINT.ANA', 'bloquear')],
          poupadas: [],
          falhas: [{ login: 'SINT.CAIO', codigo: 'conflito-versao' }],
        },
      };
    });
    await montar();
    await clicar('dormentes-rodar');
    expect($('dormentes-form')?.textContent).toContain('As contas da prévia (1)');
    await digitar('dormentes-senha', 'Sint#Senha2026');
    await confirmar();
    expect(ultimoPost(ps)).toMatchObject({
      url: '/api/acesso/gestao/contas-dormentes/rodar',
      corpo: { senha: 'Sint#Senha2026' },
    });
    expect($('dormentes-resultado')?.textContent).toContain('1 bloqueadas, 0 poupadas, 1 falhas');
    expect($('dormentes-resultado-bloqueadas')?.textContent).toContain('SINT.ANA');
    expect($('dormentes-resultado-falhas')?.textContent).toContain('SINT.CAIO: conflito-versao');
  });

  it('bloqueio desligado aparece com o motivo; rodada em andamento é recusada com aviso', async () => {
    estado = { bloqueio: { ligada: false, motivo: 'operação desligada pelo gestor' } };
    simular((p) =>
      p.metodo === 'POST'
        ? {
            status: 409,
            corpo: {
              type: 'recusa-de-negocio',
              title: 'Rodada em andamento',
              status: 409,
              codigo: 'rodada-em-andamento',
            },
          }
        : undefined,
    );
    await montar();
    expect($('dormentes-bloqueio-desligado')?.textContent).toContain('operação desligada pelo gestor');
    await clicar('dormentes-rodar');
    await digitar('dormentes-senha', 'Sint#Senha2026');
    await confirmar();
    expect($('dormentes-recusa')?.textContent).toContain('Já há uma rodada em andamento');
  });
});
