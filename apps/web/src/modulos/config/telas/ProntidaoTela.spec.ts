// @vitest-environment jsdom
// Prontidão por setor (M35): a tela mostra o relatório gerado por estabelecimento (o bloqueio do Serrano, a proposta
// das ondas, os setores por onda com a lista do que libera o setor e as operações fora da liberação com o motivo), o
// público por papel com "<5" e o aviso quando o relatório não foi gerado. O cliente valida pelo contrato.
import { criarI18n, instalarUi, resolverMarca } from '@sgh/ui';
import { flushPromises, mount } from '@vue/test-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { type App, nextTick } from 'vue';
import { mensagensWeb } from '../../../i18n/pt-BR.js';
import { buscarCarga, contagemExibida } from '../api.js';
import ProntidaoTela from './ProntidaoTela.vue';

// O filtro de estabelecimento é o SanteSelecao (Select do OpenVue; ADR 0027): o jsdom não tem matchMedia nem
// ResizeObserver, que o combo usa ao abrir a lista (o mesmo preparo de prescricao.spec.ts).
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

/** Abre o combo e escolhe a opção pelo valor (o OpenVue anexa a lista ao body e escolhe no mousedown). */
const escolher = async (w: ReturnType<typeof mount>, testid: string, valor: string) => {
  await w.find(`[data-testid="${testid}"] [role="combobox"]`).trigger('click');
  await flushPromises();
  await nextTick();
  const opcao = document.body.querySelector<HTMLElement>(`[role="option"]:has([data-valor="${valor}"])`);
  expect(opcao, `opção ${valor} em ${testid}`).not.toBeNull();
  opcao!.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
  await flushPromises();
};

const i18n = () => criarI18n(mensagensWeb as unknown as Record<string, unknown>);
const itens = (situacao: string) =>
  ['construcao', 'operacoes', 'aceite', 'treinamento', 'estacoes', 'carga', 'apoio', 'pentest'].map(
    (item) => ({
      item,
      situacao,
      detalhe: `detalhe ${item}`,
    }),
  );
const setor = (id: string, onda: number, veredito: string, situacao = 'atendido') => ({
  id,
  nome: `Setor ${id}`,
  onda,
  veredito,
  marcos: [{ marco: 'M17', status: 'aguardando-validacao' }],
  operacoes: {
    total: 2,
    verdes: 1,
    fora: [{ nome: 'agenda.agendarSemProntuario', estado: 'especificada', motivo: 'D-SPR-1' }],
  },
  leituras: [],
  recursos: ['agenda.consulta'],
  itens: itens(situacao),
  duvidas: ['DP-3'],
  ordemFase4: veredito === 'nao-construido' ? ['M31'] : [],
});
const publico = [
  {
    papel: 'recepcao',
    nome: 'Recepção e atendimento',
    usuarios: null,
    menorQue5: true,
    referencia: 31,
    parcelas: [],
    ondas: [1, 2],
    cargaHoraria: '6 h',
    guias: 7,
  },
];
const relatorio = {
  formato: 1,
  geradoEm: '2026-10-23T10:00:00.000Z',
  estados: { verde: 525 },
  liberadas: 0,
  carga: {
    cenario: 'carga-somada',
    executadoEm: '2026-10-23T09:00:00.000Z',
    usuarios: 400,
    resultado: 'verde',
    indicativo: true,
    jornadas: [],
    outroSistema: [],
    mon: { transacaoMaisLongaMs: 80, acimaDoLimite: 0, escritas: 0 },
    arquivo: 'a.json',
  },
  hospitais: [
    {
      codigo: 'pc',
      nome: 'Hospital Geral',
      bloqueio: null,
      setores: [setor('agendamento', 1, 'pronto-com-ressalvas'), setor('faturamento', 4, 'nao-construido')],
      publico,
      publicoTotal: 728,
      chavesPreparadas: 120,
      chavesLigadas: 0,
      proposta: { onda0: [], onda1: ['agendamento'], foraDaProposta: [] },
    },
    {
      codigo: 'hs',
      nome: 'Hospital Serrano',
      bloqueio: 'HS-1: sem a cópia',
      setores: [setor('agendamento', 1, 'bloqueado', 'bloqueado')],
      publico,
      publicoTotal: null,
      chavesPreparadas: null,
      chavesLigadas: null,
      proposta: {
        onda0: [],
        onda1: [],
        foraDaProposta: [{ setor: 'agendamento', motivo: 'HS-1: sem a cópia' }],
      },
    },
  ],
};

const responder = (corpo: unknown) =>
  vi.fn(
    async () =>
      new Response(JSON.stringify(corpo), { status: 200, headers: { 'content-type': 'application/json' } }),
  );

afterEach(() => vi.unstubAllGlobals());

const montar = () =>
  mount(ProntidaoTela, {
    global: { plugins: [i18n(), ui], stubs: { RouterLink: { template: '<a><slot /></a>' } } },
  });

describe('Prontidão por setor (M35)', () => {
  it('o pc com a proposta, os setores por onda, a lista e as operações fora com o motivo; o público com <5', async () => {
    vi.stubGlobal('fetch', responder({ relatorio }));
    const w = montar();
    await flushPromises();
    expect(w.find('h1').text()).toBe('Prontidão por setor');
    expect(w.get('[data-testid="proposta-onda1"]').text()).toContain('Setor agendamento');
    expect(w.get('[data-testid="proposta-onda0"]').text()).toContain('nenhum setor');
    expect(w.get('[data-testid="prontidao-chaves"]').text()).toContain('120');
    expect(w.get('[data-testid="onda-1"]').text()).toContain('pronto para homologar, com ressalvas');
    expect(w.get('[data-testid="onda-4"]').text()).toContain('Ordem de construção na Fase 4: M31');
    expect(w.get('[data-testid="fora-agendamento"]').text()).toContain('D-SPR-1');
    expect(w.get('[data-testid="itens-agendamento"]').text()).toContain('Aceite do chave-usuário');
    expect(w.get('[data-testid="prontidao-publico"]').text()).toContain('<5');
    expect(w.get('[data-testid="prontidao-carga"]').text()).toContain('metas atendidas');
    expect(w.find('[data-testid="prontidao-bloqueio"]').exists()).toBe(false);
  });

  it('o hs em bloqueio, sem a lista de operações fora; sem relatório, o aviso; erro da API, o alerta', async () => {
    vi.stubGlobal('fetch', responder({ relatorio }));
    const w = montar();
    await flushPromises();
    await escolher(w, 'filtro-hospital', 'hs');
    expect(w.get('[data-testid="prontidao-bloqueio"]').text()).toContain('HS-1');
    expect(w.find('[data-testid="fora-agendamento"]').exists()).toBe(false);
    expect(w.text()).toContain('Fora da proposta: Setor agendamento');

    vi.stubGlobal('fetch', responder({ relatorio: null }));
    const v = montar();
    await flushPromises();
    expect(v.get('[data-testid="prontidao-vazia"]').text()).toContain('ainda não foi gerado');

    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('x', { status: 500 })),
    );
    const e = montar();
    await flushPromises();
    expect(e.get('[role="alert"]').text()).toContain('500');
  });

  it('cliente: a carga somada e a contagem exibida', async () => {
    expect(await buscarCarga(responder({ carga: null }) as unknown as typeof fetch)).toBeNull();
    expect(
      (await buscarCarga(responder({ carga: relatorio.carga }) as unknown as typeof fetch))?.usuarios,
    ).toBe(400);
    expect(contagemExibida(3, true)).toBe('<5');
    expect(contagemExibida(null, false)).toBe('—');
    expect(contagemExibida(12, false)).toBe('12');
  });
});
