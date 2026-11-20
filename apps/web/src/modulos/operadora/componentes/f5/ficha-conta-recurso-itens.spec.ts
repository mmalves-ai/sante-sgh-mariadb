// @vitest-environment jsdom
// W0-10 (M8): a ficha do lote mostra o recurso por item que o prestador mandou pelo portal e a decisão é item a item
// (valor acatado de 0 até o recorrido e parecer de cada item, mais o parecer geral), no lugar da decisão pela guia. Dados
// SINTÉTICOS; a API é simulada.
import type { ApoioContas, ContaMedicaDetalhe, GuiaConta } from '@sgh/contratos';
import { criarI18n, instalarUi, resolverMarca } from '@sgh/ui';
import { QueryClient, VueQueryPlugin } from '@tanstack/vue-query';
import { flushPromises, mount } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { App } from 'vue';
import { mensagensWeb } from '../../../../i18n/pt-BR.js';
import FichaConta from './FichaConta.vue';

const api = vi.hoisted(() => ({
  baixarDemonstrativo: vi.fn(),
  concluirAnalise: vi.fn(),
  decidirRecurso: vi.fn(),
  decidirRecursoItens: vi.fn(),
  devolverConta: vi.fn(),
  glosarConta: vi.fn(),
  lerConta: vi.fn(),
  lerDemonstrativo: vi.fn(),
  lerDemonstrativoPagamento: vi.fn(),
  registrarRecurso: vi.fn(),
}));
vi.mock('../../api-contas.js', () => api);

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

const item = (id: number, sequencial: number, glosado: number) => ({
  id,
  sequencial,
  grupo: 'procedimento' as const,
  codigoDespesa: null,
  tabela: '22',
  codigo: `1010101${sequencial}`,
  descricao: `Procedimento sintético ${sequencial}`,
  data: '2026-11-10',
  quantidade: 1,
  valorUnitario: 50,
  apresentado: 50,
  glosado,
  motivo: 1801,
  motivoNome: 'Procedimento não autorizado',
  justificativa: 'Sem autorização prévia.',
  origem: 'auditor' as const,
  critica: null,
});
const recursoItem = (id: number, it: number, valor: number, decidido = false) => ({
  id,
  item: it,
  valor,
  justificativa: `Justificativa sintética do item ${it}.`,
  em: '2026-11-19T10:00:00',
  por: 'SGH.PORTAL.PRESTADOR',
  decisao: decidido
    ? {
        decisao: 'mantido' as const,
        valorAcatado: 0,
        parecer: 'Mantida.',
        em: '2026-11-19T11:00:00',
        por: 'AUD',
      }
    : null,
});
const guia = (x: Partial<GuiaConta>): GuiaConta => ({
  id: 300,
  ordem: 1,
  numeroGuiaPrestador: 'G-300',
  numeroGuiaOperadora: null,
  senha: null,
  carteirinha: '0000000000001',
  beneficiario: null,
  autorizacao: null,
  carater: null,
  inicio: '2026-11-10',
  fim: '2026-11-10',
  apresentado: 100,
  glosado: 30,
  acatado: 0,
  criticas: [],
  recurso: {
    situacao: 'pendente',
    valor: 25,
    justificativa: 'Recurso sintético da guia.',
    registradoEm: '2026-11-19T10:00:00',
    registradoPor: 'SGH.PORTAL.PRESTADOR',
    valorAcatado: null,
    parecer: null,
    decididoEm: null,
    decididoPor: null,
  },
  recursosItens: [recursoItem(9, 501, 15), recursoItem(10, 502, 10)],
  itens: [item(501, 1, 20), item(502, 2, 10)],
  ...x,
});
const conta = (g: GuiaConta[]): ContaMedicaDetalhe =>
  ({
    id: 30,
    protocolo: '202611180000030',
    operadora: 1,
    prestador: 21,
    prestadorNome: 'Clínica Sintética',
    numeroLote: 'L30',
    tipoGuia: 'sp-sadt',
    competencia: '2026-11',
    guias: g.length,
    recebidaEm: '2026-11-18T09:00:00',
    prazoPagamento: '2026-12-18',
    vencida: false,
    situacao: 'analisada',
    recursosPendentes: 1,
    apresentado: 100,
    glosado: 30,
    acatado: 0,
    liberado: 70,
    pago: 0,
    saldo: 70,
    versao: 6,
    operadoraNome: 'Operadora Sintética',
    registroAns: '900005',
    arquivo: { nome: 'l30.xml', bytes: 10, sha256: 'a', hashEpilogo: 'b', versaoTiss: '4.03.00' },
    analisadaEm: '2026-11-18T12:00:00',
    analisadaPor: 'AUD',
    observacao: null,
    motivoDevolucao: null,
    guiasDetalhe: g,
    eventos: [],
    acoes: ['decidir-recurso'],
  }) as unknown as ContaMedicaDetalhe;
const apoio = {
  operadoras: [],
  prestadores: [],
  motivos: [],
  auditor: null,
  ligada: true,
  motivo: null,
  podeLer: true,
  podeReceber: true,
  podeAnalisar: true,
  podePagar: false,
  hoje: '2026-11-19',
  parametros: { diasPagamento: 30, maximoKilobytes: 700 },
} as unknown as ApoioContas;

const ui = { install: (app: App) => instalarUi(app, resolverMarca(undefined).pacote) };
const montadas: { unmount: () => void }[] = [];
async function montar() {
  const w = mount(FichaConta, {
    attachTo: document.body,
    props: { id: 30, apoio },
    global: {
      plugins: [
        criarI18n(mensagensWeb as unknown as Record<string, unknown>),
        ui,
        [VueQueryPlugin, { queryClient: new QueryClient({ defaultOptions: { queries: { retry: false } } }) }],
      ] as never,
    },
  });
  montadas.push(w);
  await flushPromises();
  return w;
}
const botao = (id: string) => {
  const b = document.querySelector<HTMLElement>(`[data-testid="${id}"]`);
  return b === null ? null : b.tagName === 'BUTTON' ? (b as HTMLButtonElement) : b.querySelector('button')!;
};
const clicar = async (id: string) => {
  const b = botao(id);
  expect(b, id).not.toBeNull();
  b!.click();
  await flushPromises();
};
const escrever = async (id: string, v: string) => {
  const el = document.getElementById(id) as HTMLInputElement | HTMLTextAreaElement;
  expect(el, id).not.toBeNull();
  el.value = v;
  el.dispatchEvent(new Event('input'));
  await flushPromises();
};

beforeEach(() => {
  for (const f of Object.values(api)) f.mockReset();
});
afterEach(() => {
  for (const w of montadas.splice(0)) w.unmount();
  document.body.innerHTML = '';
});

describe('W0-10 (M8): ficha do lote, recurso por item', () => {
  it('mostra os itens recorridos e decide item a item (no lugar da decisão pela guia), com o corpo completo', async () => {
    api.lerConta.mockResolvedValue(conta([guia({})]));
    api.decidirRecursoItens.mockResolvedValue({
      ok: true,
      id: 30,
      versao: 7,
      situacao: 'analisada',
      protocolo: '202611180000030',
      mensagem: 'ok',
      avisos: [],
    });
    await montar();
    const lista = document.querySelector('[data-testid="conta-guia-1-recurso-itens"]')!.textContent!;
    expect(lista).toContain('Item 1 · 10101011');
    expect(lista).toContain('aguardando decisão');
    expect(botao('conta-guia-1-decidir')).toBeNull();
    await clicar('conta-guia-1-decidir-itens');
    expect(document.body.textContent).toContain('O prestador recorreu de 2 item(ns)');
    expect(document.body.textContent).toContain('Recurso sintético da guia.');
    expect(botao('conta-dialogo-confirmar')!.disabled).toBe(true);
    // Acatado acima do recorrido (15) não passa.
    await escrever('conta-acatado-item-501', '16');
    await escrever('conta-parecer-item-501', 'Autorização comprovada em parte.');
    await escrever('conta-acatado-item-502', '0');
    await escrever('conta-parecer-item-502', 'Sem comprovação da autorização.');
    await escrever('conta-parecer-itens', 'Recurso analisado item a item.');
    expect(botao('conta-dialogo-confirmar')!.disabled).toBe(true);
    await escrever('conta-acatado-item-501', '10,5');
    expect(botao('conta-dialogo-confirmar')!.disabled).toBe(false);
    await clicar('conta-dialogo-confirmar');
    expect(api.decidirRecursoItens).toHaveBeenCalledWith(30, 300, {
      versao: 6,
      decisoes: [
        { item: 501, valorAcatado: 10.5, parecer: 'Autorização comprovada em parte.' },
        { item: 502, valorAcatado: 0, parecer: 'Sem comprovação da autorização.' },
      ],
      parecer: 'Recurso analisado item a item.',
    });
    expect(api.decidirRecurso).not.toHaveBeenCalled();
  });

  it('o recurso pela guia (sem itens) segue com a decisão pela guia; o item decidido mostra a decisão', async () => {
    api.lerConta.mockResolvedValue(
      conta([
        guia({ recursosItens: [] }),
        guia({
          id: 301,
          ordem: 2,
          numeroGuiaPrestador: 'G-301',
          recursosItens: [recursoItem(11, 501, 15, true)],
        }),
      ]),
    );
    await montar();
    expect(botao('conta-guia-1-decidir')).not.toBeNull();
    expect(botao('conta-guia-1-decidir-itens')).toBeNull();
    expect(document.querySelector('[data-testid="conta-recurso-item-501"]')!.textContent).toContain(
      'Mantida.',
    );
    // Itens todos decididos: nada pendente por item, volta a decisão pela guia (o servidor confere).
    expect(botao('conta-guia-2-decidir-itens')).toBeNull();
  });
});
