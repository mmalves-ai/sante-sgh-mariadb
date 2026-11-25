// @vitest-environment jsdom
// Tela de glosas (06-FAT linhas 29 e 34): o recurso em lote. Depois de decidir "recorrer", o item fica pronto para o
// recurso e a grade oferece "marcar todos" e "montar o recurso" numa ação só; sem item pronto, o bloco não aparece.
// O recurso montado em lote leva os itens marcados num pedido só. Dados SINTÉTICOS; a API é simulada.
import type { ItemGlosaLido } from '@sgh/contratos';
import { criarI18n, instalarUi, resolverMarca } from '@sgh/ui';
import { QueryClient, VueQueryPlugin } from '@tanstack/vue-query';
import { flushPromises, mount } from '@vue/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { App } from 'vue';
import { mensagensWeb } from '../../i18n/pt-BR.js';

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

const itensGlosa = vi.fn<(conta: number) => Promise<ItemGlosaLido[]>>();
const decidir = vi.fn();
const recorrer = vi.fn();
const ligada = { ligada: true, motivo: null };
vi.mock('./api-tiss.js', () => ({
  itensGlosa: (conta: number) => itensGlosa(conta),
  decidir: (...a: unknown[]) => decidir(...a),
  recorrer: (...a: unknown[]) => recorrer(...a),
  registrarDesfecho: vi.fn(),
  lerEvidencia: vi.fn(),
  lerGrade: vi.fn(),
  lerMotivos: async () => [],
  novaChave: () => 'k',
  lerGravacao: async () => ({
    operacoes: {
      decidirGlosa: ligada,
      'faturamento.registrarRecurso': ligada,
      'faturamento.registrarRetornoRecurso': ligada,
    },
    funcionalidades: {},
    destinoEnvio: 'simulador',
  }),
  lerApoio: async () => ({ hoje: '2026-11-25', convenios: [] }),
}));
vi.mock('vue-router', () => ({
  useRoute: () => ({ query: { conta: '9201' } }),
  useRouter: () => ({ push: vi.fn() }),
  RouterLink: { template: '<a><slot /></a>' },
}));

const { default: GlosasTela } = await import('./telas/GlosasTela.vue');

const ui = { install: (app: App) => instalarUi(app, resolverMarca(undefined).pacote) };
const montar = () =>
  mount(GlosasTela as never, {
    global: {
      plugins: [
        criarI18n(mensagensWeb as unknown as Record<string, unknown>),
        ui,
        [VueQueryPlugin, { queryClient: new QueryClient({ defaultOptions: { queries: { retry: false } } }) }],
      ] as never,
      stubs: { RouterLink: { template: '<a><slot /></a>' } },
    },
  });

function item(id: number, x: Partial<ItemGlosaLido> = {}): ItemGlosaLido {
  return {
    item: id,
    versao: '2026-11-25T00:00:00.001Z',
    sequencial: id - 70_000,
    conta: 9201,
    convenio: 91,
    competencia: '2026-11',
    tipo: 3,
    codigo: '40302199',
    descricao: 'EXAME SINTÉTICO',
    quantidade: 1,
    valorCobrado: 200,
    conciliado: true,
    valorPago: 120,
    quantidadePaga: 1,
    dataPagamento: '2026-11-25',
    glosa: 80,
    motivo: 1705,
    motivoNome: 'MOTIVO SINTÉTICO',
    reapresenta: true,
    valorRecurso: 0,
    quantidadeRecurso: 0,
    dataRecurso: null,
    valorRetorno: 0,
    dataRetorno: null,
    motivoRetorno: 0,
    estado: 'pendente',
    desfecho: null,
    prazoRecurso: null,
    alertaPrazo: 'prazo não cadastrado',
    decisao: null,
    ...x,
  };
}
const emRecursoDaCarga = item(70_009, {
  estado: 'recorrida',
  valorRecurso: 200,
  quantidadeRecurso: 1,
  dataRecurso: '2026-11-25',
  alertaPrazo: null,
});
const decidido = item(70_008, {
  estado: 'recorrida',
  alertaPrazo: null,
  decisao: { motivo: 'Justificativa sintética', por: 'SINT', em: '2026-11-25T10:00:00Z', temEvidencia: true },
});

describe('tela de glosas: recurso em lote', () => {
  beforeEach(() => {
    itensGlosa.mockReset();
    decidir.mockReset();
    recorrer.mockReset();
  });

  it('sem item decidido "recorrer", o bloco do recurso em lote não aparece', async () => {
    itensGlosa.mockResolvedValue([item(70_008), emRecursoDaCarga]);
    const w = montar();
    await flushPromises();
    expect(w.find('[data-testid="gl-itens"]').exists()).toBe(true);
    expect(w.find('[data-testid="gl-marcar-todos"]').exists()).toBe(false);
  });

  it('decidir "recorrer" deixa o item pronto: marcar todos e montar o recurso num pedido só', async () => {
    itensGlosa.mockResolvedValueOnce([item(70_008), emRecursoDaCarga]);
    itensGlosa.mockResolvedValue([decidido, emRecursoDaCarga]);
    decidir.mockResolvedValue({
      mensagem: 'Glosa marcada para recurso.',
      repetida: false,
      ids: {},
      avisos: [],
    });
    recorrer.mockResolvedValue({ mensagem: 'Recurso registrado.', repetida: false, ids: {}, avisos: [] });
    const w = montar();
    await flushPromises();
    await w.find('[data-testid="gl-decidir-70008"]').trigger('click');
    await w.find('[data-testid="gl-texto"]').setValue('Procedimento realizado conforme a prescrição');
    await w.find('[data-testid="gl-acao"]').trigger('submit');
    await flushPromises();
    expect(decidir).toHaveBeenCalledTimes(1);
    expect(w.find('[data-testid="gl-mensagem"]').text()).toContain('recurso');
    const todos = w.find('[data-testid="gl-marcar-todos"]');
    expect(todos.exists()).toBe(true);
    // Só o decidido "recorrer" é marcável; o que já está em recurso desde a carga fica de fora.
    expect(w.find('[data-testid="gl-sel-70008"]').exists()).toBe(true);
    expect(w.find('[data-testid="gl-sel-70009"]').exists()).toBe(false);
    await todos.setValue(true);
    const montarBotao = w.find('[data-testid="gl-montar-recurso"]');
    expect(montarBotao.attributes('disabled')).toBeUndefined();
    await montarBotao.trigger('click');
    await w.find('[data-testid="gl-acao"]').trigger('submit');
    await flushPromises();
    expect(recorrer).toHaveBeenCalledTimes(1);
    expect(recorrer.mock.calls[0]![0]).toMatchObject({
      itens: [{ item: 70_008, valor: null }],
      dataProtocolo: '2026-11-25',
    });
  });
});
