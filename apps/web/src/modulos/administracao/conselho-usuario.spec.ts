// @vitest-environment jsdom
// W1-01 (parte 11d): "Registro no conselho" na ficha do usuário: registros do papel ativo com a última conferência e o
// efeito nos atos privativos pela regra do estabelecimento; "Registrar conferência" (situação, dia, fonte, observação)
// pede a senha no diálogo único e a tela mostra o bloqueio na hora; quem confere o próprio registro não vê o
// formulário; sem registro, dito. Dados SINTÉTICOS; o fetch é simulado.
import { criarI18n, instalarUi, resolverMarca } from '@sgh/ui';
import { QueryClient, VueQueryPlugin } from '@tanstack/vue-query';
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { App } from 'vue';
import { createMemoryHistory, createRouter } from 'vue-router';
import { mensagensWeb } from '../../i18n/pt-BR.js';
import ConselhoUsuario from './componentes/ConselhoUsuario.vue';

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
function simular(responder: (p: Pedido) => { status: number; corpo: unknown } | undefined): Pedido[] {
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
      const r = responder(p) ?? { status: 404, corpo: { type: 'nao-encontrado', title: 'x', status: 404 } };
      return new Response(JSON.stringify(r.corpo), {
        status: r.status,
        headers: { 'content-type': r.status >= 400 ? 'application/problem+json' : 'application/json' },
      });
    }),
  );
  return pedidos;
}
const ui = { install: (app: App) => instalarUi(app, resolverMarca(undefined).pacote) };
const montados: { unmount: () => void }[] = [];
afterEach(() => {
  for (const w of montados.splice(0)) w.unmount();
  vi.unstubAllGlobals();
  document.body.innerHTML = '';
});
async function montar(props: Record<string, unknown> = {}) {
  const roteador = createRouter({
    history: createMemoryHistory(),
    routes: [{ path: '/:caminho(.*)*', component: { template: '<div />' } }],
  });
  await roteador.push('/');
  const w = mount(ConselhoUsuario as never, {
    attachTo: document.body,
    props: props as never,
    global: {
      plugins: [
        criarI18n(mensagensWeb as unknown as Record<string, unknown>),
        ui,
        roteador,
        [VueQueryPlugin, { queryClient: new QueryClient() }],
      ] as never,
      stubs: { RouterLink: { props: ['to'], template: '<a href="#"><slot /></a>' } },
    },
  });
  montados.push(w);
  return w;
}

async function selecionar(w: VueWrapper, testid: string, v: unknown): Promise<void> {
  const c = w.findAllComponents({ name: 'SanteSelecao' }).find((x) => x.attributes('data-testid') === testid);
  if (!c) throw new Error(`sem a seleção ${testid}`);
  c.vm.$emit('update:modelValue', v);
  await flushPromises();
}

const hoje = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date());
const registro = (v: Record<string, unknown> = {}) => ({
  registro: 77,
  sigla: 'CRM',
  numero: '12345',
  uf: 'MG',
  ocupacao: 'MEDICO CLINICO',
  estado: 'nao-conferido',
  liberaAtosPrivativos: true,
  motivo: 'Registro ainda não conferido no conselho.',
  ultima: null,
  ...v,
});
const TELA = {
  login: 'SINT.MED',
  parametros: {
    bloqueio: 'irregular',
    validadeDias: 365,
    consultaAutomatica: false,
    motivoConsultaAutomatica: 'A consulta automática ao conselho depende do convênio (dono).',
  },
  registros: [registro()],
  atosPrivativos: true,
  motivoBloqueio: null,
  historico: [],
  podeConferir: true,
};
const DEPOIS = {
  ...TELA,
  registros: [
    registro({
      estado: 'irregular',
      liberaAtosPrivativos: false,
      motivo: 'Registro suspenso no conselho.',
      ultima: { situacao: 'suspenso', conferidoEm: hoje, fonte: 'documento' },
    }),
  ],
  atosPrivativos: false,
  motivoBloqueio: 'Registro suspenso no conselho.',
  historico: [
    {
      id: '1',
      registro: 77,
      situacao: 'suspenso',
      conferidoEm: hoje,
      fonte: 'documento',
      observacao: 'ofício do conselho regional',
      criadoPor: 'SINT.GESTOR',
      criadoEm: null,
    },
  ],
};

describe('W1-01 (parte 11d): registro no conselho na ficha do usuário', () => {
  it('mostra o registro e a regra; registra a conferência com a senha e mostra o bloqueio na hora', async () => {
    const pedidos = simular((p) =>
      p.url.endsWith('/conselho/conferencias')
        ? { status: 200, corpo: { anterior: null, atual: 'suspenso', tela: DEPOIS } }
        : p.url.endsWith('/conselho')
          ? { status: 200, corpo: TELA }
          : undefined,
    );
    const w = await montar({ login: 'SINT.MED' });
    await flushPromises();
    expect(pedidos[0]!.url).toBe('/api/acesso/gestao/usuarios/SINT.MED/conselho');
    expect(w.get('[data-testid="ficha-conselho-reg-77"]').text()).toContain('CRM 12345 MG');
    expect(w.get('[data-testid="ficha-conselho-reg-77"]').text()).toContain('não conferido');
    expect(w.get('[data-testid="ficha-conselho-regra"]').text()).toContain('inativo, suspenso');
    expect(w.get('[data-testid="ficha-conselho-automatica"]').text()).toContain('convênio');
    expect(w.find('[data-testid="ficha-conselho-liberado"]').exists()).toBe(true);
    // Sem observação, o botão fica desligado.
    expect(w.get('[data-testid="ficha-conselho-conferir"]').attributes('disabled')).toBeDefined();
    await selecionar(w, 'ficha-conselho-situacao', 'suspenso');
    await selecionar(w, 'ficha-conselho-fonte', 'documento');
    await w.get('[data-testid="ficha-conselho-observacao"]').setValue('ofício do conselho regional');
    await w.get('[data-testid="ficha-conselho-form"]').trigger('submit');
    await flushPromises();
    const senha = document.querySelector<HTMLInputElement>('[data-testid="dialogo-senha"]')!;
    senha.value = 'senha-sintetica';
    senha.dispatchEvent(new Event('input'));
    document
      .querySelector<HTMLFormElement>('[data-testid="form-gravacao"]')!
      .dispatchEvent(new Event('submit'));
    await flushPromises();
    const post = pedidos.find((p) => p.url.endsWith('/conselho/conferencias'));
    expect(post?.corpo).toEqual({
      registro: 77,
      situacao: 'suspenso',
      conferidoEm: hoje,
      fonte: 'documento',
      observacao: 'ofício do conselho regional',
      senha: 'senha-sintetica',
    });
    expect(w.get('[data-testid="ficha-conselho-bloqueado"]').text()).toContain('suspenso no conselho');
    expect(w.get('[data-testid="ficha-conselho-historico"]').text()).toContain('SINT.GESTOR');
    expect(w.find('[data-testid="ficha-conselho-feito"]').exists()).toBe(true);
  });

  it('o próprio registro não se confere; sem registro, dito', async () => {
    simular((p) =>
      p.url.endsWith('/SINT.MED/conselho')
        ? { status: 200, corpo: { ...TELA, podeConferir: false } }
        : p.url.endsWith('/SINT.ADM/conselho')
          ? { status: 200, corpo: { ...TELA, registros: [], atosPrivativos: false, podeConferir: false } }
          : undefined,
    );
    const w = await montar({ login: 'SINT.MED' });
    await flushPromises();
    expect(w.find('[data-testid="ficha-conselho-form"]').exists()).toBe(false);
    expect(w.find('[data-testid="ficha-conselho-propria"]').exists()).toBe(true);
    const v = await montar({ login: 'SINT.ADM' });
    await flushPromises();
    expect(v.find('[data-testid="ficha-conselho-sem-registro"]').exists()).toBe(true);
  });
});
