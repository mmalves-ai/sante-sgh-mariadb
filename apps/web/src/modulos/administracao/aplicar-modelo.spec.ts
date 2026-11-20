// @vitest-environment jsdom
// W1-01 (parte 12a): "Aplicar acessos de outro usuário" na ficha: busca o modelo (sem o próprio usuário nem conta
// bloqueada), mostra a diferença e o que fica de fora (com o motivo), e só aplica com motivo e a senha no diálogo
// único, mandando a conferência da prévia; o resultado vem passo a passo; prévia desatualizada aparece como erro.
// Dados SINTÉTICOS; o fetch é simulado.
import { criarI18n, instalarUi, resolverMarca } from '@sgh/ui';
import { QueryClient, VueQueryPlugin } from '@tanstack/vue-query';
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { App } from 'vue';
import { createMemoryHistory, createRouter } from 'vue-router';
import { mensagensWeb } from '../../i18n/pt-BR.js';
import AplicarModelo from './componentes/AplicarModelo.vue';

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
  const w = mount(AplicarModelo as never, {
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

const USUARIOS = [
  { login: 'SINT.ALVO', nome: 'Alvo', grupo: 'SAME', ativo: true, bloqueado: false },
  { login: 'SINT.MODELO', nome: 'Modelo', grupo: 'ATENDIMENTO', ativo: true, bloqueado: false },
  { login: 'SINT.PRESO', nome: 'Bloqueado', grupo: 'ATENDIMENTO', ativo: true, bloqueado: true },
];
const CONFERENCIA = 'a'.repeat(64);
const PREVIA = {
  alvo: 'SINT.ALVO',
  modelo: 'SINT.MODELO',
  modo: 'somar',
  grupo: { de: 'SAME', para: 'ATENDIMENTO' },
  papeisConceder: [{ papel: 3, nome: 'Operador de backup' }],
  papeisReativar: [],
  papeisRetirar: [],
  perfisConceder: [{ perfil: 'controle-infeccao', fim: '2027-01-10T03:00:00.000Z' }],
  perfisRetirar: [],
  iguais: 1,
  ignorados: [{ tipo: 'perfil', item: 'administrador-sistema', motivo: 'privilegio-nominal' }],
  passos: 3,
  conferencia: CONFERENCIA,
};
const RESULTADO = {
  alvo: 'SINT.ALVO',
  modelo: 'SINT.MODELO',
  passos: [
    { acao: 'trocar-grupo', item: 'ATENDIMENTO', feito: true, erro: null },
    {
      acao: 'conceder-papel',
      item: '3 Operador de backup',
      feito: false,
      erro: 'O usuário já tem este papel.',
    },
    { acao: 'conceder-perfil', item: 'controle-infeccao', feito: true, erro: null },
  ],
  feitos: 2,
  falhas: 1,
  destino: 'memoria',
};

async function buscarModelo(w: VueWrapper): Promise<void> {
  await w.get('[data-testid="ficha-modelo-termo"]').setValue('SINT');
  await w.get('[data-testid="ficha-modelo-busca"]').trigger('submit');
  await flushPromises();
}
async function confirmarSenha(): Promise<void> {
  const senha = document.querySelector<HTMLInputElement>('[data-testid="dialogo-senha"]')!;
  senha.value = 'senha-sintetica';
  senha.dispatchEvent(new Event('input'));
  document
    .querySelector<HTMLFormElement>('[data-testid="form-gravacao"]')!
    .dispatchEvent(new Event('submit'));
  await flushPromises();
}

describe('W1-01 (parte 12a): aplicar acessos de um usuário-modelo na ficha', () => {
  it('busca o modelo, mostra a diferença e o que fica de fora, e aplica com motivo, senha e a conferência', async () => {
    const pedidos = simular((p) =>
      p.url.startsWith('/api/acesso/gestao/usuarios?')
        ? { status: 200, corpo: USUARIOS }
        : p.url.endsWith('/modelo/previa')
          ? { status: 200, corpo: PREVIA }
          : p.url.endsWith('/modelo/aplicar')
            ? { status: 200, corpo: RESULTADO }
            : undefined,
    );
    const w = await montar({ login: 'SINT.ALVO' });
    await buscarModelo(w);
    const opcoes = w
      .findAllComponents({ name: 'SanteSelecao' })
      .find((x) => x.attributes('data-testid') === 'ficha-modelo-login')!
      .props('opcoes') as { valor: string }[];
    // Nem o próprio usuário nem a conta bloqueada servem de modelo.
    expect(opcoes.map((o) => o.valor)).toEqual(['', 'SINT.MODELO']);
    await selecionar(w, 'ficha-modelo-modo', 'somar');
    await w.get('[data-testid="ficha-modelo-previa"]').trigger('submit');
    await w
      .get('[data-testid="ficha-modelo-previa"]')
      .element.closest('form')!
      .dispatchEvent(new Event('submit'));
    await flushPromises();
    const previa = pedidos.find((p) => p.url.endsWith('/modelo/previa'));
    expect(previa?.url).toBe('/api/acesso/gestao/usuarios/SINT.ALVO/modelo/previa');
    expect(previa?.corpo).toEqual({ modelo: 'SINT.MODELO', modo: 'somar' });
    const dif = w.get('[data-testid="ficha-modelo-diferenca"]').text();
    expect(dif).toContain('SAME → ATENDIMENTO');
    expect(dif).toContain('Conceder o papel 3 Operador de backup');
    expect(dif).toContain('Conceder o perfil controle-infeccao até 10/01/2027');
    expect(w.get('[data-testid="ficha-modelo-ignorados"]').text()).toContain('só por concessão nominal');
    // Sem motivo, nada a aplicar.
    expect(w.get('[data-testid="ficha-modelo-aplicar"]').attributes('disabled')).toBeDefined();
    expect(pedidos.some((p) => p.url.endsWith('/modelo/aplicar'))).toBe(false);
    await w.get('[data-testid="ficha-modelo-motivo"]').setValue('mesma função da recepção');
    await w
      .get('[data-testid="ficha-modelo-aplicar"]')
      .element.closest('form')!
      .dispatchEvent(new Event('submit'));
    await flushPromises();
    await confirmarSenha();
    const aplicar = pedidos.find((p) => p.url.endsWith('/modelo/aplicar'));
    expect(aplicar?.corpo).toEqual({
      modelo: 'SINT.MODELO',
      modo: 'somar',
      conferencia: CONFERENCIA,
      motivo: 'mesma função da recepção',
      senha: 'senha-sintetica',
    });
    const res = w.get('[data-testid="ficha-modelo-resultado"]').text();
    expect(res).toContain('2 feita(s), 1 recusada(s)');
    expect(res).toContain('O usuário já tem este papel.');
    expect(w.emitted('aplicado')).toHaveLength(1);
  });

  it('nada a aplicar e prévia desatualizada', async () => {
    let desatualizada = false;
    simular((p) =>
      p.url.startsWith('/api/acesso/gestao/usuarios?')
        ? { status: 200, corpo: USUARIOS }
        : p.url.endsWith('/modelo/previa')
          ? desatualizada
            ? {
                status: 409,
                corpo: {
                  type: 'recusa-de-negocio',
                  title: 'Prévia desatualizada',
                  status: 409,
                  detail:
                    'Os acessos do modelo ou do usuário mudaram depois da prévia: confira a diferença de novo.',
                  codigo: 'previa-desatualizada',
                },
              }
            : {
                status: 200,
                corpo: {
                  ...PREVIA,
                  grupo: null,
                  papeisConceder: [],
                  perfisConceder: [],
                  ignorados: [],
                  passos: 0,
                },
              }
          : undefined,
    );
    const w = await montar({ login: 'SINT.ALVO' });
    await buscarModelo(w);
    await w
      .get('[data-testid="ficha-modelo-previa"]')
      .element.closest('form')!
      .dispatchEvent(new Event('submit'));
    await flushPromises();
    expect(w.find('[data-testid="ficha-modelo-nada"]').exists()).toBe(true);
    expect(w.find('[data-testid="ficha-modelo-aplicar"]').exists()).toBe(false);
    desatualizada = true;
    await w
      .get('[data-testid="ficha-modelo-previa"]')
      .element.closest('form')!
      .dispatchEvent(new Event('submit'));
    await flushPromises();
    expect(w.findComponent({ name: 'MensagemErro' }).exists()).toBe(true);
    expect(w.find('[data-testid="ficha-modelo-diferenca"]').exists()).toBe(false);
  });
});
