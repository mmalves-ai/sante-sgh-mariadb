// @vitest-environment jsdom
// Tela do lote TISS (06-FAT linha 31): a fatura ao convênio gravada com o lote aparece no detalhe (número, situação,
// contas, valor apresentado, protocolo e entrega) e o recibo do protocolo volta no histórico; o lote anterior à fatura
// diz que não há fatura. Dados SINTÉTICOS; a API é simulada.
import type { LoteDetalhe } from '@sgh/contratos';
import { criarI18n, instalarUi, resolverMarca } from '@sgh/ui';
import { QueryClient, VueQueryPlugin } from '@tanstack/vue-query';
import { flushPromises, mount } from '@vue/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { App } from 'vue';
import { mensagensWeb } from '../../i18n/pt-BR.js';

const lerLote = vi.fn<(id: number) => Promise<LoteDetalhe>>();
vi.mock('./api-tiss.js', () => ({
  lerLote: (id: number) => lerLote(id),
  enviarLote: vi.fn(),
  novaChave: () => 'k',
  lerGravacao: async () => ({ operacoes: {}, funcionalidades: {}, destinoEnvio: 'simulador' }),
  lerApoio: async () => ({}),
}));
vi.mock('vue-router', () => ({
  useRouter: () => ({ push: vi.fn() }),
  RouterLink: { template: '<a><slot /></a>' },
}));

const { default: LoteTela } = await import('./telas/LoteTela.vue');

const ui = { install: (app: App) => instalarUi(app, resolverMarca(undefined).pacote) };
const montar = () =>
  mount(LoteTela as never, {
    props: { id: '77' } as never,
    global: {
      plugins: [
        criarI18n(mensagensWeb as unknown as Record<string, unknown>),
        ui,
        [VueQueryPlugin, { queryClient: new QueryClient({ defaultOptions: { queries: { retry: false } } }) }],
      ] as never,
      stubs: { RouterLink: { template: '<a><slot /></a>' } },
    },
  });

const base: LoteDetalhe = {
  id: 77,
  convenio: 5,
  convenioNome: 'Convênio sintético',
  tipoGuia: 2,
  tipoGuiaNome: 'SP/SADT',
  transacao: 1,
  numero: 'L77',
  sequencial: '1',
  protocolo: 'PRT9',
  congelado: true,
  dataHora: '2026-11-24T12:00:00.000Z',
  contas: 2,
  valor: 300,
  situacao: 'protocolado',
  situacaoRotulo: 'Protocolado',
  inferida: false,
  aviso: null,
  xml: null,
  diasSemProtocolo: null,
  contasDoLote: [],
  historico: [
    {
      acao: 'registrado',
      protocolo: 'PRT9',
      data: '2026-11-24',
      recibo: 'REC-1',
      situacao: 1,
      situacaoNome: 'Recebido',
      autor: 'sintetico',
      em: '2026-11-24T12:00:00.000Z',
    },
  ],
  mensagens: [],
};

describe('tela do lote TISS: fatura e recibo', () => {
  beforeEach(() => lerLote.mockReset());

  it('mostra a fatura gravada com o lote e o recibo no histórico do protocolo', async () => {
    lerLote.mockResolvedValue({
      ...base,
      fatura: {
        numero: 'F-123',
        situacao: 'protocolada',
        contas: 2,
        valorApresentado: 300,
        protocolo: 'PRT9',
        entrega: '2026-11-24',
      },
    });
    const w = montar();
    await flushPromises();
    expect(lerLote).toHaveBeenCalledWith(77);
    const f = w.get('[data-testid="lt-fatura"]').text();
    expect(f).toContain('F-123');
    expect(f).toContain('Protocolada');
    expect(f).toContain('PRT9');
    expect(f).toMatch(/300/);
    expect(w.find('[data-testid="lt-sem-fatura"]').exists()).toBe(false);
    expect(w.get('[data-testid="lt-historico"]').text()).toContain('REC-1');
  });

  it('lote anterior à fatura: diz que não há fatura gravada', async () => {
    lerLote.mockResolvedValue({ ...base, fatura: null });
    const w = montar();
    await flushPromises();
    expect(w.get('[data-testid="lt-sem-fatura"]').text()).toContain('não há fatura');
    expect(w.find('[data-testid="lt-fatura"]').exists()).toBe(false);
  });
});
