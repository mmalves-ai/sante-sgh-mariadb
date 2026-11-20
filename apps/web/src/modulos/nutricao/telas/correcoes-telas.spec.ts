// @vitest-environment jsdom
// W0-05 (testes de componente; dados SINTÉTICOS, fetch simulado):
// - DialogoCorrecao: o motivo com menos de 5 letras não grava; a crítica sem a senha não grava; a recusa do servidor
//   (409 com a lista dos bloqueios) aparece DENTRO do diálogo, que fica aberto;
// - ServicoSocialTela (a exportação: a impressão da tela): o registro estornado continua no documento, com a situação
//   escrita, quem, quando e o motivo, fora da classe que a impressão esconde; as ações ficam só no que não se imprime;
//   o botão imprimir chama a impressão do navegador; o estorno só aparece para o próprio autor.
import { urnProblema } from '@sgh/contratos';
import { criarI18n, instalarUi, resolverMarca } from '@sgh/ui';
import { QueryClient, VueQueryPlugin } from '@tanstack/vue-query';
import { flushPromises, mount } from '@vue/test-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { type App, defineComponent, h, ref } from 'vue';
import { createMemoryHistory, createRouter } from 'vue-router';
import { ErroApi } from '../../../casca/erros/problem-details.js';
import { CHAVE_SESSAO } from '../../../casca/sessao/sessao.js';
import { mensagensWeb } from '../../../i18n/pt-BR.js';
import DialogoCorrecao from '../componentes/DialogoCorrecao.vue';
import ServicoSocialTela from './ServicoSocialTela.vue';

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
// O Textarea do OpenVue observa o tamanho (auto-resize); o jsdom não tem o ResizeObserver.
if (!('ResizeObserver' in window)) {
  (window as unknown as { ResizeObserver: unknown }).ResizeObserver = class {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  };
}
const ui = { install: (app: App) => instalarUi(app, resolverMarca(undefined).pacote) };
function plugins(cliente = new QueryClient({ defaultOptions: { queries: { retry: false } } })) {
  return [
    criarI18n(mensagensWeb as unknown as Record<string, unknown>),
    ui,
    [VueQueryPlugin, { queryClient: cliente }],
  ] as never;
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  document.body.innerHTML = '';
});

function json(corpo: unknown, status = 200): Response {
  return new Response(JSON.stringify(corpo), {
    status,
    headers: { 'content-type': status >= 400 ? 'application/problem+json' : 'application/json' },
  });
}
const q = <T extends Element>(sel: string) => document.querySelector<T>(sel);
async function digitar(sel: string, valor: string): Promise<void> {
  const el = q<HTMLInputElement | HTMLTextAreaElement>(sel)!;
  el.value = valor;
  el.dispatchEvent(new Event('input'));
  await flushPromises();
}
const desligado = (b: HTMLButtonElement) => b.disabled || b.getAttribute('aria-disabled') === 'true';

describe('DialogoCorrecao', () => {
  function montar(critica: boolean, gravar: (x: { motivo: string; senha: string }) => Promise<unknown>) {
    const visivel = ref(true);
    const feito = vi.fn();
    const Pai = defineComponent({
      setup: () => () =>
        h(DialogoCorrecao, {
          visivel: visivel.value,
          'onUpdate:visivel': (v: boolean) => (visivel.value = v),
          titulo: 'Revogar',
          confirmar: 'Revogar',
          critica,
          gravar,
          onFeito: feito,
        }),
    });
    const w = mount(Pai, { global: { plugins: plugins() }, attachTo: document.body });
    return { w, visivel, feito };
  }

  it('motivo curto não grava; com 5 letras ou mais grava e fecha', async () => {
    const gravar = vi.fn(async () => ({ mensagem: 'ok' }));
    const { w, visivel, feito } = montar(false, gravar);
    await flushPromises();
    await digitar('[data-testid="correcao-motivo"]', 'abc');
    expect(desligado(q<HTMLButtonElement>('[data-testid="correcao-confirmar"]')!)).toBe(true);
    q<HTMLFormElement>('[data-testid="form-correcao"]')!.dispatchEvent(new Event('submit'));
    await flushPromises();
    expect(gravar).not.toHaveBeenCalled();
    await digitar('[data-testid="correcao-motivo"]', 'Registro no paciente errado');
    q<HTMLFormElement>('[data-testid="form-correcao"]')!.dispatchEvent(new Event('submit'));
    await flushPromises();
    expect(gravar).toHaveBeenCalledWith({ motivo: 'Registro no paciente errado', senha: '' });
    expect(visivel.value).toBe(false);
    expect(feito).toHaveBeenCalledWith({ mensagem: 'ok' });
    w.unmount();
  });

  it('crítica: sem a senha não grava; a recusa 409 com a lista aparece dentro e o diálogo fica aberto', async () => {
    const gravar = vi.fn(async () => {
      throw new ErroApi(
        {
          type: urnProblema('conflito-de-versao'),
          codigo: 'versao-com-ciclos',
          title: 'Há ciclos em andamento',
          detail: '1 ciclo(s) em andamento usam esta versão.',
          status: 409,
          bloqueios: ['Ciclo 1 da internação 950102'],
        } as never,
        409,
      );
    });
    const { w, visivel, feito } = montar(true, gravar);
    await flushPromises();
    await digitar('[data-testid="correcao-motivo"]', 'Esquema substituído pela diretriz nova');
    expect(desligado(q<HTMLButtonElement>('[data-testid="correcao-confirmar"]')!)).toBe(true);
    q<HTMLFormElement>('[data-testid="form-correcao"]')!.dispatchEvent(new Event('submit'));
    await flushPromises();
    expect(gravar).not.toHaveBeenCalled();
    await digitar('[data-testid="correcao-senha"]', 'Sintetico#2026');
    q<HTMLFormElement>('[data-testid="form-correcao"]')!.dispatchEvent(new Event('submit'));
    await flushPromises();
    expect(gravar).toHaveBeenCalledWith({
      motivo: 'Esquema substituído pela diretriz nova',
      senha: 'Sintetico#2026',
    });
    expect(visivel.value).toBe(true);
    expect(feito).not.toHaveBeenCalled();
    expect(q('[data-testid="correcao-erro"]')?.textContent).toMatch(/Ciclo 1 da internação 950102/);
    expect(q<HTMLInputElement>('[data-testid="correcao-senha"]')!.value).toBe('');
    w.unmount();
  });
});

const REGISTRO = {
  tipo: 'avaliacao',
  redeApoio: 'fragil',
  vulnerabilidades: [],
  risco: 'medio',
  encaminhamentos: [],
  parecer: 'Parecer SINTETICO',
  sigilo: false,
  orientacoes: null,
  barreira: null,
  em: '2026-11-17T10:00',
  adendoDe: null,
  motivoAdendo: null,
} as const;

const SOCIAL = {
  internacao: 950_005,
  paciente: 99_505,
  nome: 'LUCIA SINTETICA ROCHA',
  leito: { bloco: '2A', acomodacao: '203', leito: 'A' },
  admissao: '2026-11-14T08:00',
  idade: 11,
  registros: [
    { ...REGISTRO, id: 2, por: 'SINT.SOCIAL', situacao: 'ativo', correcao: null },
    { ...REGISTRO, id: 3, por: 'SINT.OUTRA', situacao: 'ativo', correcao: null },
    {
      ...REGISTRO,
      id: 1,
      por: 'SINT.SOCIAL',
      situacao: 'estornado',
      correcao: {
        acao: 'estorno',
        idNovo: null,
        motivo: 'Registro feito na internação errada',
        por: 'SINT.SOCIAL',
        em: '2026-11-17T11:00',
      },
    },
  ],
  barreiras: [],
  daCategoria: true,
  lidoEm: '2026-11-18T09:00',
};

describe('ServicoSocialTela (impressão com o estornado visível)', () => {
  async function montar() {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (String(url).includes('/api/servico-social/gravacao'))
          return json({
            ligada: true,
            motivo: null,
            operacoes: { registrar: { pode: true, motivo: null } },
            categoria: 'servico-social',
          });
        if (String(url).includes('/api/servico-social/internacoes/950005')) return json(SOCIAL);
        return json({ type: urnProblema('nao-encontrado'), title: 'x', status: 404 }, 404);
      }),
    );
    const cliente = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: 600_000 } } });
    cliente.setQueryData(CHAVE_SESSAO, {
      usuario: { id: 'SINT.SOCIAL', login: 'SINT.SOCIAL' },
      permissoes: [],
    });
    const router = createRouter({
      history: createMemoryHistory(),
      routes: [{ path: '/servico-social/:reg', component: ServicoSocialTela }],
    });
    await router.push('/servico-social/950005');
    await router.isReady();
    const w = mount(ServicoSocialTela, {
      global: { plugins: [...(plugins(cliente) as unknown[]), router] as never },
      attachTo: document.body,
    });
    await flushPromises();
    return w;
  }

  it('o estornado fica no que se imprime, com a situação, quem, quando e o motivo; ações só fora da impressão', async () => {
    const w = await montar();
    const estornado = w.find('[data-testid="social-registro-1"]');
    expect(estornado.exists()).toBe(true);
    expect(estornado.attributes('data-situacao')).toBe('estornado');
    expect(estornado.classes()).toContain('inativo');
    expect(estornado.classes()).not.toContain('nao-imprimir');
    expect(w.find('[data-testid="social-situacao-1"]').text()).toBe('Estornado');
    expect(w.find('[data-testid="social-correcao-1"]').text()).toMatch(
      /Estornado em .* por SINT\.SOCIAL: Registro feito na internação errada/,
    );
    // Nada de ação no estornado; no ativo, as ações só no bloco que a impressão esconde.
    expect(w.find('[data-testid="social-adendo-1"]').exists()).toBe(false);
    expect(w.find('[data-testid="social-estornar-1"]').exists()).toBe(false);
    const acoes = w.find('[data-testid="social-adendo-2"]').element.closest('.acoes-registro');
    expect(acoes?.classList.contains('nao-imprimir')).toBe(true);
    // O estorno só para o próprio autor; o adendo para a categoria.
    expect(w.find('[data-testid="social-estornar-2"]').exists()).toBe(true);
    expect(w.find('[data-testid="social-estornar-3"]').exists()).toBe(false);
    expect(w.find('[data-testid="social-adendo-3"]').exists()).toBe(true);
    const imprimir = vi.fn();
    vi.stubGlobal('print', imprimir);
    window.print = imprimir;
    await w.find('[data-testid="social-imprimir"]').trigger('click');
    expect(imprimir).toHaveBeenCalledTimes(1);
    w.unmount();
  });
});
