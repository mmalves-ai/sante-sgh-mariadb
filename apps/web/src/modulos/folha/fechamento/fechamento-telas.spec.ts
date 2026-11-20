// @vitest-environment jsdom
// Fechamento do período da folha e periódicos do eSocial (M53.7, etapa F6): os comuns (anos, período sugerido, entrada
// do fechamento, quando a prévia permite fechar, ações do painel); toda pendência e recusa do contrato tem texto, sem nome
// de outro sistema; a aba do fechamento (lista do ano, conferência com pendências e com a prova da soma, fechar, reabrir
// com motivo, perfil de consulta sem gravar); a aba dos periódicos (contagens, gerar o S-1200 dos sem evento pela prévia
// e gravar, o S-1299 liberado pelo painel, recusa traduzida). Dados SINTÉTICOS; o fetch é simulado.
import {
  CODIGOS_PENDENCIA_FECHAMENTO,
  type PainelPeriodicosEsocial,
  RECUSAS_FECHAMENTO_FOLHA,
} from '@sgh/contratos';
import { criarI18n, instalarUi, resolverMarca } from '@sgh/ui';
import { QueryClient, VueQueryPlugin } from '@tanstack/vue-query';
import { flushPromises, mount } from '@vue/test-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { type App, nextTick } from 'vue';
import { CHAVE_SESSAO } from '../../../casca/sessao/sessao.js';
import { mensagensWeb } from '../../../i18n/pt-BR.js';
import EsocialTela from '../esocial/EsocialTela.vue';
import { pedidosDoPainel } from '../esocial/comum-periodicos.js';
import { mensagensEsocial } from '../esocial/i18n.js';
import { mensagensFolha } from '../i18n.js';
import AbaFechamentoFolha from './AbaFechamentoFolha.vue';
import { anosAte, entradaFechar, periodoSugerido, prontoParaFechar } from './comum-fechamento.js';
import { mensagensFechamento } from './i18n.js';

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
const HOJE = '2026-10-28';
const TODAS = [
  'pessoas.folha.abrir',
  'pessoas.folha.ler',
  'pessoas.folha.fechar',
  'pessoas.esocial.ler',
  'pessoas.esocial.gerar',
];

function plugins(permissoes: readonly string[]) {
  const cliente = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  cliente.setQueryData(CHAVE_SESSAO, {
    usuario: { id: '1', nome: 'Sintético', login: 'SINT.DP.FOLHA' },
    rede: 'r',
    estabelecimentos: [{ codigo: 'pc', nome: 'PC' }],
    estabelecimentoAtivo: 'pc',
    permissoes,
    sintetica: true,
    bloqueioInatividadeSegundos: 0,
  });
  return [
    criarI18n(mensagensWeb as unknown as Record<string, unknown>),
    ui,
    [VueQueryPlugin, { queryClient: cliente }],
  ] as never;
}

type Pedido = { url: string; metodo: string; corpo: unknown };
type Resposta = { status?: number; corpo: unknown };
function simular(rota: (p: Pedido) => Resposta | null): Pedido[] {
  const pedidos: Pedido[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      const p = {
        url: String(url),
        metodo: init?.method ?? 'GET',
        corpo: init?.body ? JSON.parse(String(init.body)) : null,
      };
      pedidos.push(p);
      const r = rota(p) ?? { corpo: { itens: [] } };
      return new Response(JSON.stringify(r.corpo), {
        status: r.status ?? 200,
        headers: {
          'content-type': r.status && r.status >= 400 ? 'application/problem+json' : 'application/json',
        },
      });
    }),
  );
  return pedidos;
}
afterEach(() => {
  vi.unstubAllGlobals();
  document.body.innerHTML = '';
});

const clicar = async (seletor: string) => {
  const b = document.querySelector<HTMLElement>(seletor);
  expect(b, seletor).not.toBeNull();
  b!.click();
  await flushPromises();
  await flushPromises();
};
const escolher = async (testid: string, valor: string) => {
  document.querySelector<HTMLElement>(`[data-testid="${testid}"] [role="combobox"]`)!.click();
  await flushPromises();
  await nextTick();
  const opcao = document.body.querySelector<HTMLElement>(`[role="option"]:has([data-valor="${valor}"])`);
  expect(opcao, `opção ${valor} em ${testid}`).not.toBeNull();
  opcao!.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
  await flushPromises();
};
const digitar = async (testid: string, valor: string) => {
  const i = document.querySelector<HTMLInputElement | HTMLTextAreaElement>(
    `[data-testid="${testid}"] input, [data-testid="${testid}"] textarea`,
  )!;
  expect(i, testid).not.toBeNull();
  i.value = valor;
  i.dispatchEvent(new Event('input'));
  i.dispatchEvent(new Event('blur'));
  i.dispatchEvent(new Event('change'));
  await flushPromises();
};
const texto = (seletor: string) => document.querySelector(seletor)?.textContent ?? '';
const existe = (testid: string) => document.querySelector(`[data-testid="${testid}"]`) !== null;

// ── Dados sintéticos ──────────────────────────────────────────────────────────────────────────────────────────
const totais = (liquido: number) => ({
  processos: 1,
  proventos: liquido + 20_000,
  descontos: 20_000,
  liquido,
  inss: 15_000,
  irrf: 5_000,
  fgts: 8_000,
  encargos: 30_000,
});
const processo = (id: number, liquido: number | null = 100_000) => ({
  id,
  tipo: 'decimo2',
  competencia: '2025-12',
  numero: 1,
  resumo: 'f'.repeat(64),
  pagamento: '2025-12-18',
  colaboradores: 2,
  liquido,
});
const fechamento = (id: number, x: Record<string, unknown> = {}) => ({
  id,
  empresa: 1,
  apuracao: 'mensal',
  periodo: '2026-09',
  numero: 1,
  situacao: 'fechada',
  pagamento: '2026-10-05',
  processos: [{ ...processo(70), tipo: 'mensal', competencia: '2026-09', pagamento: '2026-10-05' }],
  totais: totais(100_000),
  resumo: 'a'.repeat(64),
  fechadoPor: 'SINT.DP.FOLHA',
  fechadoEm: '2026-10-06T09:00:00',
  reabertoPor: null,
  reabertoEm: null,
  motivo: null,
  versao: 0,
  ...x,
});
const resultado = (pendencias: unknown[], fechado = false) => ({
  fechado,
  simulado: !fechado,
  fechamento: fechado ? fechamento(9, { apuracao: 'anual', periodo: '2025', pagamento: null }) : null,
  processos: [processo(71)],
  totais: totais(100_000),
  pendencias,
  conferencia: {
    ok: pendencias.length === 0,
    parcelas: [
      { rotulo: 'Processamento 71', valor: 100_000 },
      { rotulo: 'Total', valor: 100_000 },
    ],
    divergencias: [],
  },
});
const contagem = (x: Partial<PainelPeriodicosEsocial['remuneracao']> = {}) => ({
  esperados: 2,
  porSituacao: {},
  semEvento: [11, 12],
  aceitos: 0,
  ...x,
});
const painel = (x: Record<string, unknown> = {}): PainelPeriodicosEsocial =>
  ({
    empresa: 1,
    apuracao: 'mensal',
    periodo: '2026-09',
    folha: fechamento(8),
    remuneracao: contagem(),
    pagamentos: contagem(),
    repasse: 0,
    situacao: 'aberto',
    eventoFechamento: null,
    pendencias: [{ codigo: 'remuneracao-pendente', mensagem: 'Faltam 2 remunerações aceitas.' }],
    acoes: {
      gerar: true,
      fecharEsocial: false,
      reabrirEsocial: false,
      fecharFolha: false,
      reabrirFolha: true,
    },
    ...x,
  }) as unknown as PainelPeriodicosEsocial;

// ── Comuns e textos ───────────────────────────────────────────────────────────────────────────────────────────
describe('comuns do fechamento e dos periódicos', () => {
  it('anos, período sugerido, entrada do fechamento e quando a prévia permite fechar', () => {
    expect(anosAte(HOJE, 3)).toEqual(['2026', '2025', '2024']);
    expect(periodoSugerido('mensal', HOJE)).toBe('2026-09');
    expect(periodoSugerido('mensal', '2026-01-10')).toBe('2025-12');
    expect(periodoSugerido('anual', HOJE)).toBe('2025');
    expect(periodoSugerido('anual', '2026-12-20')).toBe('2026');
    expect(entradaFechar(null, 'mensal', '2026-09', '2026-10-05', true)).toBeNull();
    expect(entradaFechar(1, 'mensal', '2026-9', '2026-10-05', true)).toBeNull();
    expect(entradaFechar(1, 'mensal', '2026-09', '2026-10-05', false)).toEqual({
      empresa: 1,
      apuracao: 'mensal',
      periodo: '2026-09',
      pagamento: '2026-10-05',
      simular: false,
    });
    // No anual a data de pagamento não vai (é a de cada parcela do 13º).
    expect(entradaFechar(1, 'anual', '2025', '2026-10-05', true)?.pagamento).toBeNull();
    expect(prontoParaFechar(null)).toBe(false);
    expect(prontoParaFechar(resultado([]) as never)).toBe(true);
    expect(
      prontoParaFechar(resultado([{ codigo: 'sem-decimo-final', mensagem: 'x', processo: null }]) as never),
    ).toBe(false);
    expect(prontoParaFechar(resultado([], true) as never)).toBe(false);
  });

  it('ações do painel na ordem da obrigação', () => {
    expect(pedidosDoPainel(painel(), true).map((x) => x.rotulo)).toEqual([
      'gerarRemuneracao',
      'gerarPagamentos',
    ]);
    expect(pedidosDoPainel(painel(), true)[0]!.vinculos).toEqual([11, 12]);
    // Com aceitos, o S-1200 de todos (retifica); sem permissão de gerar, só o que o painel liberou.
    const comAceitos = painel({ remuneracao: contagem({ semEvento: [], aceitos: 2 }), pagamentos: null });
    expect(pedidosDoPainel(comAceitos, true).map((x) => [x.rotulo, x.vinculos])).toEqual([
      ['retificarRemuneracao', []],
    ]);
    const semGerar = painel({ acoes: { ...painel().acoes, gerar: false } });
    expect(pedidosDoPainel(semGerar, false)).toEqual([]);
    const pronto = painel({
      remuneracao: contagem({ semEvento: [] }),
      pagamentos: contagem({ semEvento: [] }),
      acoes: { ...painel().acoes, gerar: true, fecharEsocial: true },
    });
    expect(pedidosDoPainel(pronto, true).map((x) => x.rotulo)).toEqual(['gerarFechamento']);
    const fechado = painel({
      situacao: 'fechado',
      acoes: { ...painel().acoes, gerar: false, reabrirEsocial: true },
    });
    expect(pedidosDoPainel(fechado, true).map((x) => x.rotulo)).toEqual(['gerarReabertura']);
  });

  it('toda pendência e recusa tem texto, sem nome de outro sistema', () => {
    for (const c of CODIGOS_PENDENCIA_FECHAMENTO) expect(mensagensFechamento.pendencia[c]).toBeTruthy();
    const erros = mensagensFolha.erro as Record<string, string>;
    for (const c of [...RECUSAS_FECHAMENTO_FOLHA, 'geracao-grande', 'sem-pagamentos'])
      expect(erros[c], c).toBeTruthy();
    const tudo = JSON.stringify([mensagensFechamento, mensagensEsocial.periodicos, erros]);
    expect(tudo).not.toMatch(/spdata|legado|sistema atual|sistema antigo/i);
  });
});

// ── Aba do fechamento ─────────────────────────────────────────────────────────────────────────────────────────
function montarFechamento(permissoes: readonly string[] = TODAS) {
  return mount(AbaFechamentoFolha, {
    attachTo: document.body,
    props: { hoje: HOJE, empresa: 1 },
    global: { plugins: plugins(permissoes) },
  });
}

describe('aba do fechamento', () => {
  it('lista o ano, confere com pendências, fecha o 13º com a prova da soma e reabre com motivo', async () => {
    let pendente = true;
    const pedidos = simular((p) => {
      if (p.url.startsWith('/api/pessoas/folha/fechamentos?'))
        return { corpo: { itens: [fechamento(8)], limitado: false } };
      if (p.url === '/api/pessoas/folha/fechamentos' && p.metodo === 'POST') {
        const c = p.corpo as { simular: boolean };
        if (c.simular && pendente) {
          pendente = false;
          return {
            corpo: resultado([{ codigo: 'sem-decimo-final', mensagem: 'x', processo: null }]),
          };
        }
        return { corpo: resultado([], !c.simular) };
      }
      if (p.url === '/api/pessoas/folha/fechamentos/8/reabertura')
        return { corpo: fechamento(8, { situacao: 'reaberta' }) };
      return null;
    });
    montarFechamento();
    await flushPromises();
    await flushPromises();
    expect(pedidos.some((p) => p.url === '/api/pessoas/folha/fechamentos?empresa=1&ano=2026')).toBe(true);
    expect(texto('[data-testid="folha-fechamento-linha-8"]')).toContain('09/2026');
    expect(texto('[data-testid="folha-fechamento-linha-8"]')).toContain('05/10/2026');
    expect(texto('[data-testid="folha-fechamento-situacao-8"]')).toContain('Fechado');

    await escolher('folha-fechamento-apuracao', 'anual');
    expect(existe('folha-fechamento-pagamento')).toBe(false);
    await clicar('[data-testid="folha-fechamento-previa"]');
    expect(texto('[data-testid="folha-fechamento-pendencias"]')).toContain('2ª parcela do 13º');
    expect(existe('folha-fechamento-fechar')).toBe(false);
    await clicar('[data-testid="folha-fechamento-resultado-fechar"]');

    await clicar('[data-testid="folha-fechamento-previa"]');
    expect(texto('[data-testid="folha-fechamento-parcelas"]')).toContain('Processamento 71');
    expect(texto('[data-testid="folha-fechamento-conferencia-ok"]')).toContain('confere');
    expect(texto('[data-testid="folha-fechamento-total-liquido"]')).toContain('1.000,00');
    await clicar('[data-testid="folha-fechamento-fechar"]');
    const fechamentos = pedidos.filter(
      (p) => p.url === '/api/pessoas/folha/fechamentos' && p.metodo === 'POST',
    );
    expect(fechamentos.map((p) => p.corpo)).toEqual([
      { empresa: 1, apuracao: 'anual', periodo: '2025', pagamento: null, simular: true },
      { empresa: 1, apuracao: 'anual', periodo: '2025', pagamento: null, simular: true },
      { empresa: 1, apuracao: 'anual', periodo: '2025', pagamento: null, simular: false },
    ]);
    expect(texto('[data-testid="folha-fechamento-aviso"]')).toContain('13º de 2025 fechado');

    await clicar('[data-testid="folha-fechamento-reabrir-8"]');
    await digitar('folha-fechamento-reabertura-motivo', 'Ajuste de rubrica');
    await clicar('[data-testid="folha-fechamento-reabertura-confirmar"]');
    const reab = pedidos.find((p) => p.url.endsWith('/8/reabertura'));
    expect(reab?.corpo).toEqual({ versao: 0, motivo: 'Ajuste de rubrica' });
    expect(texto('[data-testid="folha-fechamento-aviso"]')).toContain('09/2026 reaberto');
  });

  it('recusa traduzida e detalhe com o líquido restrito', async () => {
    simular((p) => {
      if (p.url.startsWith('/api/pessoas/folha/fechamentos?'))
        return {
          corpo: {
            itens: [
              fechamento(8, {
                processos: [{ ...processo(72, null), tipo: 'ferias', competencia: '2026-09' }],
              }),
            ],
            limitado: false,
          },
        };
      if (p.metodo === 'POST')
        return {
          status: 422,
          corpo: { title: 'Recusado', status: 422, codigo: 'periodo-ja-fechado', detail: 'x' },
        };
      return null;
    });
    montarFechamento();
    await flushPromises();
    await flushPromises();
    await clicar('[data-testid="folha-fechamento-detalhe-8"]');
    expect(texto('[data-testid="folha-fechamento-processo-72"]')).toContain('Restrito');
    expect(texto('[data-testid="folha-fechamento-detalhe"]')).toContain('consulta salário');
    await clicar('[data-testid="folha-fechamento-detalhe-fechar"]');
    await escolher('folha-fechamento-apuracao', 'anual');
    await clicar('[data-testid="folha-fechamento-previa"]');
    expect(texto('[data-testid="recusa-folha"]')).toContain('já está fechado');
  });

  it('perfil de consulta: só a lista, sem fechar nem reabrir', async () => {
    simular((p) =>
      p.url.startsWith('/api/pessoas/folha/fechamentos?')
        ? { corpo: { itens: [fechamento(8)], limitado: false } }
        : null,
    );
    montarFechamento(['pessoas.folha.abrir', 'pessoas.folha.ler']);
    await flushPromises();
    await flushPromises();
    expect(existe('folha-fechamento-so-consulta')).toBe(true);
    expect(existe('folha-fechamento-form')).toBe(false);
    expect(existe('folha-fechamento-linha-8')).toBe(true);
    expect(existe('folha-fechamento-reabrir-8')).toBe(false);
  });
});

// ── Aba dos periódicos ────────────────────────────────────────────────────────────────────────────────────────
const apoioEsocial = {
  hoje: HOJE,
  empresas: [{ codigo: 1, rotulo: 'Empresa Sintética', temCnpj: true }],
  eventos: [],
  leiautes: ['v_S_01_03_00'],
  leiauteCatalogo: [],
  motivosAfastamento: [],
  categorias: [],
  transmissao: { chaveLigada: false, ambiente: 'coletor', podeEnviar: false, motivo: null },
  acoes: { gerar: true, transmitir: false },
};
const gerado = (evento: string, id: number | null) => ({
  evento,
  operacao: null,
  origem: 'folha',
  referencia: 70,
  dataReferencia: '2026-09-01',
  pendencias: [],
  valido: true,
  errosXsd: [],
  xml: '<eSocial/>',
  id,
});

function montarEsocial() {
  return mount(EsocialTela as never, {
    attachTo: document.body,
    global: { plugins: plugins(TODAS), stubs: { RouterLink: { template: '<a><slot /></a>' } } },
  });
}

describe('aba dos periódicos', () => {
  it('mostra as contagens e gera o S-1200 dos sem evento pela prévia; grava', async () => {
    let atual = painel();
    const pedidos = simular((p) => {
      if (p.url.endsWith('/esocial/apoio')) return { corpo: apoioEsocial };
      if (p.url.startsWith('/api/pessoas/esocial/periodicos?')) return { corpo: atual };
      if (p.url.endsWith('/periodicos/remuneracao')) {
        const c = p.corpo as { gravar: boolean };
        if (c.gravar)
          atual = painel({ remuneracao: contagem({ semEvento: [], porSituacao: { gerado: 2 } }) });
        return {
          corpo: {
            gravado: c.gravar,
            eventos: [gerado('S-1200', c.gravar ? 501 : null), gerado('S-1200', c.gravar ? 502 : null)],
          },
        };
      }
      return null;
    });
    montarEsocial();
    await flushPromises();
    await flushPromises();
    await clicar('[data-testid="esocial-aba-periodicos"]');
    expect(
      pedidos.some(
        (p) => p.url === '/api/pessoas/esocial/periodicos?empresa=1&apuracao=mensal&periodo=2026-09',
      ),
    ).toBe(true);
    expect(texto('[data-testid="esocial-periodicos-folha"]')).toContain('fechamento 1');
    expect(existe('esocial-periodicos-ir-folha')).toBe(true);
    expect(texto('[data-testid="esocial-periodicos-remuneracao-esperados"]')).toBe('2');
    expect(texto('[data-testid="esocial-periodicos-remuneracao-sem-evento"]')).toBe('2');
    expect(texto('[data-testid="esocial-periodicos-pendencias"]')).toContain('Faltam 2');
    expect(existe('esocial-periodicos-gerarFechamento')).toBe(false);

    await clicar('[data-testid="esocial-periodicos-gerarRemuneracao"]');
    expect(existe('esocial-periodicos-valido-0')).toBe(true);
    await clicar('[data-testid="esocial-periodicos-gravar"]');
    const r = pedidos.filter((p) => p.url.endsWith('/periodicos/remuneracao')).map((p) => p.corpo);
    expect(r).toEqual([
      { empresa: 1, apuracao: 'mensal', periodo: '2026-09', gravar: false, vinculos: [11, 12] },
      { empresa: 1, apuracao: 'mensal', periodo: '2026-09', gravar: true, vinculos: [11, 12] },
    ]);
    expect(texto('[data-testid="esocial-periodicos-aviso"]')).toContain('2 evento(s) gravado(s)');
    await clicar('[data-testid="esocial-periodicos-resultado-fechar"]');
    expect(texto('[data-testid="esocial-periodicos-remuneracao"]')).toContain('Gerado: 2');
  });

  it('S-1299 liberado pelo painel; o 13º sem S-1210; recusa traduzida', async () => {
    const pedidos = simular((p) => {
      if (p.url.endsWith('/esocial/apoio')) return { corpo: apoioEsocial };
      if (p.url.includes('apuracao=anual'))
        return {
          corpo: painel({
            apuracao: 'anual',
            periodo: '2025',
            folha: null,
            pagamentos: null,
            remuneracao: contagem({ esperados: 0, semEvento: [] }),
            acoes: { ...painel().acoes, gerar: false, fecharFolha: true, reabrirFolha: false },
          }),
        };
      if (p.url.startsWith('/api/pessoas/esocial/periodicos?'))
        return {
          corpo: painel({
            remuneracao: contagem({ semEvento: [], aceitos: 2, porSituacao: { aceito: 2 } }),
            pagamentos: contagem({ semEvento: [], aceitos: 2, porSituacao: { aceito: 2 } }),
            pendencias: [],
            acoes: { ...painel().acoes, fecharEsocial: true },
          }),
        };
      if (p.url.endsWith('/periodicos/fechamento'))
        return {
          status: 422,
          corpo: { title: 'Recusado', status: 422, codigo: 'periodicos-pendentes', detail: 'x' },
        };
      return null;
    });
    montarEsocial();
    await flushPromises();
    await flushPromises();
    await clicar('[data-testid="esocial-aba-periodicos"]');
    expect(existe('esocial-periodicos-sem-pendencias')).toBe(true);
    await clicar('[data-testid="esocial-periodicos-gerarFechamento"]');
    expect(pedidos.find((p) => p.url.endsWith('/periodicos/fechamento'))?.corpo).toEqual({
      empresa: 1,
      apuracao: 'mensal',
      periodo: '2026-09',
      gravar: false,
    });
    expect(texto('[data-testid="recusa-folha"]')).toContain('ainda não aceitos');

    await escolher('esocial-periodicos-apuracao', 'anual');
    await flushPromises();
    expect(existe('esocial-periodicos-pagamentos')).toBe(false);
    expect(texto('[data-testid="esocial-periodicos-folha"]')).toContain('ainda não foi fechado');
    expect(existe('esocial-periodicos-acoes')).toBe(false);
  });
});
