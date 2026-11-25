// @vitest-environment jsdom
// Tela da programação físico-orçamentária, tetos e cotas SUS (F7, 06-SUS linha 54): a validação aparece na hora na
// importação, no teto e na cota e no remanejamento; incluir, importar e remanejar exigem faturamento.susProgramacao.editar
// e aprovar o remanejamento exige faturamento.susProgramacao.aprovar (e nunca o próprio pedido). Dados SINTÉTICOS; o
// fetch é simulado.
import { criarI18n, instalarUi, resolverMarca } from '@sgh/ui';
import { QueryClient, VueQueryPlugin } from '@tanstack/vue-query';
import { flushPromises, mount } from '@vue/test-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { App } from 'vue';
import { createMemoryHistory, createRouter, type Router } from 'vue-router';
import { definirSessaoDaTela } from '../../casca/sessao/pode.js';
import { mensagensWeb } from '../../i18n/pt-BR.js';
import ProgramacaoSusTela from './telas/ProgramacaoSusTela.vue';

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
// O combo (SanteSelecao) usa ResizeObserver, que o jsdom não tem.
if (!('ResizeObserver' in window)) {
  (window as unknown as { ResizeObserver: unknown }).ResizeObserver = class {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  };
}
const ui = { install: (app: App) => instalarUi(app, resolverMarca(undefined).pacote) };
const roteador = (): Router =>
  createRouter({
    history: createMemoryHistory(),
    routes: [{ path: '/:p(.*)*', component: { template: '<div />' } }],
  });
const montar = (c: unknown, r: Router = roteador()) =>
  mount(c as never, {
    global: {
      plugins: [
        r,
        criarI18n(mensagensWeb as unknown as Record<string, unknown>),
        ui,
        [VueQueryPlugin, { queryClient: new QueryClient({ defaultOptions: { queries: { retry: false } } }) }],
      ] as never,
      stubs: { RouterLink: { template: '<a><slot /></a>' } },
    },
  });

const M = mensagensWeb.faturamentoSus.programacao;
const saldo = (tipo: 'teto' | 'cota', id: number, extra: Record<string, unknown>) => ({
  tipo,
  id,
  descricao: `Limite sintético ${id}`,
  instrumento: 'bpa',
  quantidade: 100,
  valor: null,
  consumoQuantidade: 0,
  consumoValor: 0,
  saldoQuantidade: 100,
  saldoValor: null,
  percentual: 0,
  situacao: 'livre',
  bloqueia: false,
  registros: 0,
  excedentes: 0,
  versao: 1,
  ...extra,
});
const painel = (doUsuario: boolean) => ({
  competencia: '202611',
  periodo: { inicio: '2026-11-01', fim: '2026-11-30' },
  programacoes: [
    {
      id: 4,
      descricao: 'Programação sintética',
      contrato: null,
      contratoNumero: null,
      vigenciaInicio: '2026-11-01',
      vigenciaFim: null,
      formaEntrada: 'importacao',
      valorTotal: 1000,
      situacao: 'rascunho',
      itens: 2,
      versao: 1,
    },
  ],
  saldos: [
    saldo('teto', 8, {
      consumoQuantidade: 120,
      saldoQuantidade: -20,
      percentual: 120,
      situacao: 'excedido',
      bloqueia: true,
      excedentes: 3,
    }),
    saldo('cota', 9, { consumoQuantidade: 95, saldoQuantidade: 5, percentual: 95, situacao: 'alerta' }),
  ],
  registros: { bpa: 7, apac: 2, aih: 1 },
  remanejamentos: [
    {
      id: 11,
      cota: 9,
      tipo: 'setor',
      origem: 'Setor A',
      destino: 'Setor B',
      quantidade: 3,
      valor: null,
      motivo: 'Motivo sintético do pedido',
      situacao: 'solicitada',
      solicitadoEm: '2026-11-10T10:00:00',
      doUsuario,
      versao: 1,
    },
  ],
});

function simular(p: ReturnType<typeof painel>) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      const u = String(url);
      const corpo = u.includes('/opcoes')
        ? { contratos: [], setores: [{ id: 1, descricao: 'Setor sintético' }] }
        : p;
      return new Response(JSON.stringify(corpo), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }),
  );
}
afterEach(() => {
  vi.unstubAllGlobals();
  definirSessaoDaTela(null);
});
const sel = (id: string) => `[data-testid="${id}"]`;

describe('a tela da programação, dos tetos e das cotas SUS', () => {
  it('só leitura: o saldo à vista, sem importar, incluir, remanejar, inativar, ativar nem aprovar', async () => {
    simular(painel(false));
    definirSessaoDaTela({ permissoes: ['faturamento.susProgramacao.ler'] } as never);
    const w = montar(ProgramacaoSusTela);
    await flushPromises();
    expect(w.find(sel('saldo-teto-8')).text()).toContain(M.situacoes.excedido);
    expect(w.find(sel('saldo-teto-8')).text()).toContain(M.saldos.bloqueia.trim());
    expect(w.find(sel('saldo-cota-9')).text()).toContain(M.situacoes.alerta);
    expect(w.find(sel('programacao-registros')).text()).toContain('7');
    for (const id of [
      'form-importar',
      'form-limite',
      'remanejar-9',
      'inativar-teto-8',
      'ativar-4',
      'aprovar-11',
    ])
      expect(w.find(sel(id)).exists(), id).toBe(false);
    w.unmount();
  });

  it('com editar: a importação e o limite validam na hora e liberam o botão quando corrigidos', async () => {
    simular(painel(false));
    definirSessaoDaTela({ permissoes: ['faturamento.susProgramacao.editar'] } as never);
    const w = montar(ProgramacaoSusTela);
    await flushPromises();
    expect(w.find(sel('ativar-4')).exists()).toBe(true);
    expect(w.find(sel('aprovar-11')).exists()).toBe(false);

    expect(w.find(sel('imp-problemas')).text()).toContain(M.importacao.problemas.conteudo);
    expect(w.find(sel('imp-enviar')).attributes('disabled')).toBeDefined();
    await w.find(sel('imp-conteudo')).setValue('0301010072;10;5,00;0\n# comentário\n');
    expect(w.find(sel('imp-problemas')).exists()).toBe(false);
    expect(w.find(sel('imp-enviar')).attributes('disabled')).toBeUndefined();

    expect(w.find(sel('lim-problemas')).text()).toContain(M.limite.problemas.valores);
    await w.find(sel('lim-codigo')).setValue('123');
    await w.find(sel('lim-financiamento')).setValue('6');
    const problemas = w.find(sel('lim-problemas')).text();
    expect(problemas).toContain(M.limite.problemas.codigo);
    expect(problemas).toContain(M.limite.problemas.financiamento);
    await w.find(sel('lim-codigo')).setValue('0301010072');
    await w.find(sel('lim-financiamento')).setValue('06');
    await w.find(sel('lim-valor')).setValue('1000');
    expect(w.find(sel('lim-problemas')).exists()).toBe(false);
    expect(w.find(sel('lim-incluir')).attributes('disabled')).toBeUndefined();
    w.unmount();
  });

  it('o remanejamento na própria linha confere o saldo livre e o motivo; o próprio pedido não se aprova', async () => {
    simular(painel(true));
    definirSessaoDaTela({
      permissoes: ['faturamento.susProgramacao.editar', 'faturamento.susProgramacao.aprovar'],
    } as never);
    const w = montar(ProgramacaoSusTela);
    await flushPromises();
    await w.find(sel('remanejar-9')).trigger('click');
    await w.find(sel('rem-quantidade')).setValue('8');
    const problemas = w.find(sel('rem-problemas')).text();
    expect(problemas).toContain(M.remanejamento.problemas.saldo.replace('{saldo}', '5'));
    expect(problemas).toContain(M.remanejamento.problemas.setor);
    expect(problemas).toContain(M.remanejamento.problemas.motivo);
    expect(w.find(sel('rem-pedir')).attributes('disabled')).toBeDefined();
    await w.find(sel('rem-quantidade')).setValue('4');
    await w.find(sel('rem-motivo')).setValue('Motivo sintético do remanejamento');
    expect(w.find(sel('rem-problemas')).text()).not.toContain(M.remanejamento.problemas.motivo);
    // Pedido do próprio usuário: sem aprovar nem recusar, com o aviso de que outra pessoa decide.
    expect(w.find(sel('aprovar-11')).exists()).toBe(false);
    expect(w.find(sel('remanejamento-11')).text()).toContain(M.remanejamento.outraPessoa.trim());
    w.unmount();
  });

  it('com aprovar e pedido de outra pessoa: aprovar e recusar à vista', async () => {
    simular(painel(false));
    definirSessaoDaTela({ permissoes: ['faturamento.susProgramacao.aprovar'] } as never);
    const w = montar(ProgramacaoSusTela);
    await flushPromises();
    expect(w.find(sel('aprovar-11')).exists()).toBe(true);
    expect(w.find(sel('recusar-11')).exists()).toBe(true);
    expect(w.find(sel('form-limite')).exists()).toBe(false);
    w.unmount();
  });
});
