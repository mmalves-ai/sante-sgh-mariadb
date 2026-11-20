// @vitest-environment jsdom
// Telas dos consignados e da manipulação (M46, etapa 4): os textos cobrem todo tipo de movimento e toda situação da ordem
// sem citar o sistema anterior; o saldo por fornecedor sai com as parcelas impressas e o indicador com o numerador e o
// denominador; a manipulação mostra a fila dos itens validados com o leito e as iniciais e, com a funcionalidade em
// consulta, as ações desabilitadas e o motivo. Dados SINTÉTICOS; o fetch é simulado.
import { CODIGOS_MOVIMENTO_CONSIGNADO, SITUACOES_MANIPULACAO } from '@sgh/contratos';
import { criarI18n, instalarUi, resolverMarca } from '@sgh/ui';
import { QueryClient, VueQueryPlugin } from '@tanstack/vue-query';
import { flushPromises, mount } from '@vue/test-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { App } from 'vue';
import { definirSessaoDaTela } from '../../casca/sessao/pode.js';
import { mensagensWeb } from '../../i18n/pt-BR.js';
import { mensagensConsignado, mensagensManipulacao } from './i18n-consignado.js';
import ConsignadosTela from './telas/ConsignadosTela.vue';
import ManipulacaoTela from './telas/ManipulacaoTela.vue';

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
const ui = { install: (app: App) => instalarUi(app, resolverMarca(undefined).pacote) };
const montar = (c: unknown) =>
  mount(c as never, {
    global: {
      plugins: [
        criarI18n(mensagensWeb as unknown as Record<string, unknown>),
        ui,
        [VueQueryPlugin, { queryClient: new QueryClient({ defaultOptions: { queries: { retry: false } } }) }],
      ] as never,
      stubs: { RouterLink: { template: '<a><slot /></a>' } },
    },
  });

function simular(rota: (url: string) => unknown): string[] {
  const urls: string[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      urls.push(String(url));
      return new Response(JSON.stringify(rota(String(url))), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }),
  );
  return urls;
}
afterEach(() => {
  vi.unstubAllGlobals();
  definirSessaoDaTela(null);
});

const gravacao = (ligada: boolean, ops: string[]) => ({
  ligada,
  motivo: ligada
    ? null
    : 'O controle ainda não foi liberado neste estabelecimento: as telas ficam em consulta.',
  operacoes: Object.fromEntries(ops.map((o) => [o, { pode: ligada, motivo: null }])),
});

describe('textos dos consignados e da manipulação', () => {
  it('cobrem os movimentos e as situações e não citam o sistema anterior', () => {
    for (const t of CODIGOS_MOVIMENTO_CONSIGNADO) expect(mensagensConsignado.tipos[t]).toBeTruthy();
    for (const s of SITUACOES_MANIPULACAO) expect(mensagensManipulacao.situacoes[s.codigo]).toBeTruthy();
    const valores = (o: object): string[] =>
      Object.values(o).flatMap((v) => (typeof v === 'string' ? [v] : valores(v as object)));
    expect([...valores(mensagensConsignado), ...valores(mensagensManipulacao)].join('\n')).not.toMatch(
      /spdata|legado|sistema anterior|GESALCON|GECAPELAMP|GEGRUPOMP|GELANSAI|GECADNFS/i,
    );
  });
});

describe('a tela dos consignados', () => {
  it('o saldo com as parcelas e o indicador com o numerador e o denominador', async () => {
    simular(() => ({
      hoje: '2026-10-26',
      saldos: [
        {
          fornecedor: 7001,
          fornecedorNome: 'DISTRIBUIDORA SINTÉTICA ALFA LTDA',
          item: 950003,
          itemNome: 'PROTESE SINTETICA',
          remessas: 3,
          reposicoes: 1,
          consumidos: 2,
          devolvidos: 0,
          saldo: 2,
          aRepor: 1,
          aFaturar: 1,
          saldoCadastro: null,
        },
      ],
      consumos: [],
      movimentos: [],
      indicador: { consumos: 2, semReposicao: 1, semFaturamento: 1, atrasados: 0, diasAlerta: 7 },
      semFornecedor: 0,
      cortada: false,
      gravacao: gravacao(true, ['registrar']),
    }));
    definirSessaoDaTela({
      permissoes: ['suprimentos.consignado.ler', 'suprimentos.consignado.registrar'],
    } as never);
    const w = montar(ConsignadosTela);
    await flushPromises();
    expect(w.find('[data-testid="consig-saldo-valor-7001-950003"]').text()).toContain('3 + 1 − 2 − 0 = 2');
    expect(w.find('[data-testid="consig-indicador"]').text()).toContain(
      '1 de 2 consumos consignados sem faturamento',
    );
    expect(w.find('[data-testid="consig-desligado"]').exists()).toBe(false);
    w.unmount();
  });
});

describe('o faturamento do consignado (revisão do M46.4)', () => {
  it('a nota da entrada é escolhida na lista das notas do fornecedor com o item, sem digitar o documento', async () => {
    const urls = simular((url) =>
      url.includes('/consignados/notas')
        ? {
            itens: [{ ano: 2026, mes: 10, doc: 55, numero: '000123456', serie: '1', emissao: '2026-10-20' }],
          }
        : {
            hoje: '2026-10-26',
            saldos: [],
            consumos: [
              {
                consumo: 4641,
                agendamento: 704,
                atendimento: 77101,
                fornecedor: 7001,
                item: 950003,
                itemNome: 'PROTESE SINTETICA',
                quantidade: 1,
                lote: 'L-C1',
                serie: null,
                em: '2026-10-26T08:30',
                reposicao: null,
                faturamento: null,
              },
            ],
            movimentos: [],
            indicador: { consumos: 1, semReposicao: 1, semFaturamento: 1, atrasados: 0, diasAlerta: 7 },
            semFornecedor: 0,
            cortada: false,
            gravacao: gravacao(true, ['registrar']),
          },
    );
    definirSessaoDaTela({
      permissoes: ['suprimentos.consignado.ler', 'suprimentos.consignado.registrar'],
    } as never);
    const w = montar(ConsignadosTela);
    await flushPromises();
    await w.find('[data-testid="consig-aba-consumos"]').trigger('click');
    await w.find('[data-testid="consig-escolher-4641"]').trigger('change');
    await w.find('[data-testid="consig-acao-faturar"]').trigger('click');
    await flushPromises();
    expect(urls.some((u) => u.includes('/consignados/notas?fornecedor=7001&item=950003'))).toBe(true);
    expect(w.find('[data-testid="consig-fat-nota"]').exists()).toBe(true);
    expect(w.find('[data-testid="consig-fat-doc"]').exists()).toBe(false);
    expect(w.find('[data-testid="consig-fat-sem-notas"]').exists()).toBe(false);
    w.unmount();
  });
});

describe('a tela da manipulação', () => {
  it('a fila com o leito e as iniciais; em consulta, a abertura desabilitada com o motivo', async () => {
    simular(() => ({
      hoje: '2026-10-26',
      de: '2026-10-24',
      ate: '2026-10-26',
      itens: [
        {
          itemPrescrito: 9464001,
          avaliacao: 4640001,
          atendimento: 77101,
          leito: 'UTI-03',
          iniciais: 'S.I.',
          produto: 5005,
          produtoNome: 'CEFTRIAXONA 1 G FRASCO-AMPOLA',
          validadoPor: null,
          validadoEm: '2026-10-26T08:00',
          ordem: null,
        },
      ],
      ordens: [],
      capelas: [],
      locais: [],
      centros: [],
      regraSobra: { versao: '2026-10-26', horasMaximas: 24 },
      cortada: false,
      gravacao: gravacao(false, ['abrir', 'conferir', 'suprimentos.registrarSaida']),
    }));
    definirSessaoDaTela({ permissoes: ['suprimentos.manipulacao.ler'] } as never);
    const w = montar(ManipulacaoTela);
    await flushPromises();
    const linha = w.find('[data-testid="manip-item-9464001"]');
    expect(linha.text()).toContain('UTI-03');
    expect(linha.text()).toContain('S.I.');
    expect(linha.text()).toContain('pela regra automática');
    expect(w.find('[data-testid="manip-desligado"]').exists()).toBe(true);
    expect(w.find('[data-testid="manip-abrir-9464001"]').attributes('disabled')).toBeDefined();
    w.unmount();
  });
});
