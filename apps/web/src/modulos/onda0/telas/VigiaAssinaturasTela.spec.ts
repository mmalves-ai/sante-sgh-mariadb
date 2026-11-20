// @vitest-environment jsdom
// Aba "Vigilância diária" (M38): o resumo do período, o alerta do dia com divergência, a tabela com onde divergiu
// (tabela, coluna e o tipo, sem valor) e o aviso quando não há execução; erro da API, o alerta. A faixa da onda 0 e o
// aviso de indisponibilidade dos painéis.
import { criarI18n, instalarUi, resolverMarca } from '@sgh/ui';
import { QueryClient, VueQueryPlugin } from '@tanstack/vue-query';
import { flushPromises, mount } from '@vue/test-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { App } from 'vue';
import { ErroApi } from '../../../casca/erros/problem-details.js';
import { mensagensWeb } from '../../../i18n/pt-BR.js';
import AvisoIndisponivel from '../componentes/AvisoIndisponivel.vue';
import FaixaOnda0 from '../componentes/FaixaOnda0.vue';
import VigiaAssinaturasTela from './VigiaAssinaturasTela.vue';

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
const ui = { install: (app: App) => instalarUi(app, resolverMarca(undefined).pacote) };
const i18n = () => criarI18n(mensagensWeb as unknown as Record<string, unknown>);
const plugins = () => [
  i18n(),
  ui,
  [VueQueryPlugin, { queryClient: new QueryClient({ defaultOptions: { queries: { retry: false } } }) }],
];
const montar = (c: unknown, props: Record<string, unknown> = {}) =>
  mount(c as never, {
    props: props as never,
    global: {
      plugins: plugins() as never,
      stubs: { RouterLink: { template: '<a><slot /></a>' } },
    },
  });

const execucao = (data: string, divergentes: number) => ({
  resultado: {
    hospital: 'pc',
    data,
    operacao: 'auditoria.registrarEventoLegado',
    amostradas: 50,
    divergentes,
    elementos: divergentes
      ? [
          {
            tipo: 'classe',
            tabela: 'TBCABTRILHA',
            coluna: 'FUSO_HORARIO_LOCAL',
            classe: 'constante',
            ocorrencias: 1,
          },
        ]
      : [],
  },
  executadoEm: `${data}T06:00:00.000Z`,
});
const painel = (execucoes: unknown[]) => ({
  hospital: 'pc',
  de: '2026-10-01',
  ate: '2026-10-31',
  estabelecimentos: ['pc'],
  execucoes,
});
const sessao = {
  usuario: { id: '1', nome: 'X', login: 'X' },
  rede: 'r',
  estabelecimentos: [{ codigo: 'pc', nome: 'PC' }],
  estabelecimentoAtivo: 'pc',
  permissoes: ['cadastro.paciente.ler'],
  sintetica: true,
  bloqueioInatividadeSegundos: 0,
};
function porUrl(rotas: Record<string, unknown>) {
  return vi.fn(async (url: string) => {
    const chave = Object.keys(rotas).find((k) => String(url).startsWith(k));
    const corpo = chave ? rotas[chave] : {};
    if (corpo instanceof Response) return corpo;
    return new Response(JSON.stringify(corpo), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  });
}

afterEach(() => vi.unstubAllGlobals());

describe('Vigilância diária (M38)', () => {
  it('o resumo, o alerta do dia divergente e onde divergiu, sem valor', async () => {
    vi.stubGlobal(
      'fetch',
      porUrl({
        '/api/config/assinaturas/vigia': painel([execucao('2026-10-23', 0), execucao('2026-10-22', 1)]),
      }),
    );
    const w = montar(VigiaAssinaturasTela);
    await flushPromises();
    expect(w.get('h2').text()).toBe('Vigilância diária em produção');
    expect(w.get('[data-testid="vigia-resumo"]').text()).toContain(
      '2 dia(s) com execução; 1 com divergência',
    );
    expect(w.get('[data-testid="vigia-alerta"]').text()).toContain('pc no dia 2026-10-22');
    expect(w.get('[data-testid="vigia-2026-10-23"]').text()).toContain('sem divergência');
    expect(w.get('[data-testid="vigia-2026-10-22"]').text()).toContain(
      'TBCABTRILHA.FUSO_HORARIO_LOCAL (classe) (1)',
    );
  });

  it('sem execução, o aviso; erro da API, o alerta com o motivo', async () => {
    vi.stubGlobal('fetch', porUrl({ '/api/config/assinaturas/vigia': painel([]) }));
    const w = montar(VigiaAssinaturasTela);
    await flushPromises();
    expect(w.get('[data-testid="vigia-nenhuma"]').text()).toBe('Nenhuma execução da vigilância no período.');
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('x', { status: 403 })),
    );
    const e = montar(VigiaAssinaturasTela);
    await flushPromises();
    expect(e.get('[data-testid="vigia-erro"]').text()).toContain('Não foi possível ler a vigilância diária');
  });

  it('a faixa "só consulta" aparece só quando a escrita da tela está recusada', async () => {
    const telas = (escritaLiberada: boolean | null) => ({
      hospital: 'pc',
      telas: [
        {
          id: 'pacientes',
          recurso: 'cadastro.paciente.consulta',
          permissao: 'cadastro.paciente.ler',
          situacao: 'ligada',
          escritaLiberada,
        },
      ],
    });
    vi.stubGlobal('fetch', porUrl({ '/api/sessao': sessao, '/api/onda0/telas': telas(false) }));
    const w = montar(FaixaOnda0, { tela: 'pacientes' });
    await flushPromises();
    expect(w.get('[data-testid="faixa-onda0"]').text()).toContain('só de consulta para o seu setor');
    vi.stubGlobal('fetch', porUrl({ '/api/sessao': sessao, '/api/onda0/telas': telas(true) }));
    const v = montar(FaixaOnda0, { tela: 'pacientes' });
    await flushPromises();
    expect(v.find('[data-testid="faixa-onda0"]').exists()).toBe(false);
  });

  it('o aviso de indisponibilidade dos painéis (contingência), só para servidor fora', () => {
    const fora = montar(AvisoIndisponivel, { erro: new ErroApi(null, 503) });
    expect(fora.get('[data-testid="aviso-indisponivel-onda0"]').text()).toContain(
      'nenhum registro do hospital depende dele',
    );
    const negado = montar(AvisoIndisponivel, { erro: new ErroApi(null, 403) });
    expect(negado.find('[data-testid="aviso-indisponivel-onda0"]').exists()).toBe(false);
  });
});
