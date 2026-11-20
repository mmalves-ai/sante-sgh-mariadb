// @vitest-environment jsdom
// Integração da folha com o financeiro e o contábil (M53.9, etapa F8): os comuns (chave da classificação, linhas do
// de-para da vigência ou da sugestão, entrada da vigência e do lançamento, vencimentos ajustados); todo destino,
// pendência e recusa do contrato tem texto, sem nome de outro sistema; a tela (lançar pela prévia com a conta impressa,
// pendências e avisos, vencimento ajustado e o resumo conferido; perfil de consulta sem lançar; recusa traduzida; os
// lançamentos com a situação no contas a pagar; o custo por centro com a conta; o de-para com a busca do credor e a
// nova vigência). Dados SINTÉTICOS; o fetch é simulado.
import {
  type ApoioIntegracaoFolha,
  cenarioDoDestino,
  type DestinoTituloFolha,
  DESTINOS_TITULO_FOLHA,
  PENDENCIAS_TITULOS_FOLHA,
  type PreviaTitulosFolha,
  RECUSAS_TITULOS_FOLHA,
  type TituloFolhaPlanejado,
} from '@sgh/contratos';
import { criarI18n, instalarUi, resolverMarca } from '@sgh/ui';
import { QueryClient, VueQueryPlugin } from '@tanstack/vue-query';
import { flushPromises, mount } from '@vue/test-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { type App, nextTick } from 'vue';
import { CHAVE_SESSAO } from '../../../casca/sessao/sessao.js';
import { mensagensWeb } from '../../../i18n/pt-BR.js';
import {
  chaveClassificacao,
  entradaDePara,
  entradaLancar,
  lerChaveClassificacao,
  linhaCompleta,
  linhasDePara,
  vencimentosAjustados,
  vencimentosAntesDaEmissao,
} from './comum-integracao.js';
import { mensagensIntegracao } from './i18n.js';
import IntegracaoFolhaTela from './IntegracaoFolhaTela.vue';

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
const TODAS = [
  'pessoas.integracao.ler',
  'pessoas.integracao.lancar',
  'pessoas.integracao.configurar',
  'financeiro.tituloPagar.ler',
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
      const r = rota(p) ?? { corpo: p.url.includes('/de-para?') ? [] : { itens: [] } };
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
  const i = document.querySelector<HTMLInputElement>(`[data-testid="${testid}"] input`)!;
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
const rotina = (id: number, financeiro = true) => ({
  id,
  nome: `ROTINA SINTETICA ${id}`,
  complemento: '',
  agrupamento: 1,
  agrupamentoNome: 'AGRUPAMENTO SINTETICO',
  financeiro,
  contabilidade: true,
});
const classe = (grupo: number, subgrupo: number, item: number) => ({ grupo, subgrupo, item });
const SUGESTAO = {
  'liquido-mensal': classe(210, 1, 1),
  'liquido-ferias': classe(210, 1, 15),
  'liquido-rescisao': classe(210, 1, 15),
  'liquido-decimo': classe(210, 1, 15),
  inss: classe(210, 5, 8),
  'inss-patronal': classe(296, 4, 2),
  fgts: classe(296, 4, 2),
  irrf: classe(210, 4, 1),
  sindical: classe(210, 4, 1),
} as const;
const ROTINAS_DO_DESTINO = {
  'liquido-mensal': 4,
  'liquido-ferias': 11,
  'liquido-rescisao': 12,
  'liquido-decimo': 14,
  inss: 16,
  'inss-patronal': 17,
  fgts: 15,
  irrf: 18,
  sindical: 6,
} as const;
const vigente = {
  id: 3,
  empresa: 1,
  inicio: '2026-09-01',
  criadoPor: 'SINT.DP.FOLHA',
  criadoEm: '2026-09-01T09:00:00',
  destinos: [
    {
      destino: 'liquido-mensal' as const,
      rotina: 4,
      credor: 9001,
      classificacao: classe(210, 1, 1),
      diaVencimento: 20,
      mesesDepois: 1,
      contaContabil: '',
    },
    {
      destino: 'fgts' as const,
      rotina: 15,
      credor: 9003,
      classificacao: classe(296, 4, 2),
      diaVencimento: 7,
      mesesDepois: 1,
      contaContabil: '2.1.3',
    },
  ],
};
const apoio = (x: Partial<ApoioIntegracaoFolha> = {}): ApoioIntegracaoFolha => ({
  empresas: [{ codigo: 1, nome: 'EMPRESA SINTETICA' }],
  rotinas: [...Object.values(ROTINAS_DO_DESTINO).map((r) => rotina(r, r !== 6))],
  destinos: DESTINOS_TITULO_FOLHA.map((d) => ({ destino: d, rotina: ROTINAS_DO_DESTINO[d] })),
  sugestao: DESTINOS_TITULO_FOLHA.map((d) => ({ destino: d, classificacao: SUGESTAO[d] })),
  vigente: null,
  classificacoes: [
    { ...classe(210, 1, 1), nome: 'SALARIOS SINTETICOS' },
    { ...classe(210, 1, 15), nome: 'FERIAS SINTETICAS' },
    { ...classe(210, 5, 8), nome: 'INSS SINTETICO' },
    { ...classe(296, 4, 2), nome: 'ENCARGOS SINTETICOS' },
    { ...classe(210, 4, 1), nome: 'IMPOSTOS SINTETICOS' },
  ],
  credores: [],
  hoje: '2026-10-28',
  ...x,
});
const titulo = (
  destino: DestinoTituloFolha,
  valor: number,
  vencimento: string,
  credor: number | null = 9001,
): TituloFolhaPlanejado => ({
  chave: `${destino}:${vencimento}`,
  destino,
  rotina: 4,
  cenario: cenarioDoDestino(destino),
  credor,
  classificacao: credor === null ? null : classe(210, 1, 1),
  documento: 202_609_0405,
  valor,
  vencimento,
  referente: 'FOLHA 09/2026',
});
const previa = (x: Partial<PreviaTitulosFolha> = {}): PreviaTitulosFolha =>
  ({
    empresa: 1,
    origem: 'fechamento',
    id: 70,
    apuracao: 'mensal',
    periodo: '2026-09',
    titulos: [titulo('liquido-mensal', 420_000, '2026-10-05'), titulo('fgts', 40_000, '2026-10-07', 9003)],
    fatos: [
      { rotina: 4, centroCusto: 10, natureza: 'provento', contabiliza: true, valor: 300_000 },
      { rotina: 15, centroCusto: 10, natureza: 'encargo', contabiliza: true, valor: 24_000 },
    ],
    conta: 'líquido R$ 4.200,00 + FGTS R$ 400,00 = R$ 4.600,00',
    parcelas: [
      { rotulo: 'Líquido', valor: 420_000 },
      { rotulo: 'FGTS', valor: 40_000 },
    ],
    total: 460_000,
    esperado: 460_000,
    pendencias: [],
    avisos: [],
    resumo: 'c'.repeat(64),
    podeLancar: true,
    ...x,
  }) as PreviaTitulosFolha;
const origens = {
  itens: [
    {
      origem: 'fechamento',
      id: 70,
      apuracao: 'mensal',
      periodo: '2026-09',
      numero: 1,
      situacao: 'fechada',
      lancamento: null,
    },
    {
      origem: 'interface',
      id: 5,
      apuracao: 'mensal',
      periodo: '2026-08',
      numero: 5,
      situacao: 'lancado',
      lancamento: 8,
    },
  ],
};
const lancamento = {
  id: 9,
  empresa: 1,
  origem: 'fechamento',
  idOrigem: 70,
  apuracao: 'mensal',
  periodo: '2026-09',
  resumo: 'c'.repeat(64),
  total: 460_000,
  liquido: 420_000,
  encargos: 40_000,
  fatos: 2,
  lancadoPor: 'SINT.DP.FOLHA',
  lancadoEm: '2026-10-28T10:00:00',
  titulos: [
    { ...titulo('liquido-mensal', 420_000, '2026-10-05'), titulo: 77001, pago: true },
    { ...titulo('fgts', 40_000, '2026-10-07', 9003), titulo: 77002, pago: false },
  ],
};

// ── Comuns e textos ───────────────────────────────────────────────────────────────────────────────────────────
describe('comuns da integração da folha', () => {
  it('classificação, linhas do de-para da sugestão e da vigência, e a entrada da vigência', () => {
    expect(chaveClassificacao(classe(210, 1, 1))).toBe('210.1.1');
    expect(chaveClassificacao(null)).toBe('');
    expect(lerChaveClassificacao('296.4.2')).toEqual(classe(296, 4, 2));
    expect(lerChaveClassificacao('x')).toBeNull();
    // Sem vigência: a classificação vem da sugestão, sem credor; a rotina sem financeiro fica marcada.
    const s = linhasDePara(apoio());
    expect(s).toHaveLength(9);
    expect(s[0]).toMatchObject({
      destino: 'liquido-mensal',
      credor: null,
      classificacao: '210.1.1',
      sugerida: true,
    });
    expect(s.find((l) => l.destino === 'sindical')?.financeiro).toBe(false);
    expect(s.some(linhaCompleta)).toBe(false);
    expect(entradaDePara(1, '2026-10-01', s)).toBeNull();
    // Com vigência: os destinos dela com o nome do credor; os outros, da sugestão.
    const v = linhasDePara(apoio({ vigente, credores: [{ codigo: 9003, nome: 'FUNDO SINTETICO' }] }));
    expect(v.find((l) => l.destino === 'fgts')).toMatchObject({
      credor: 9003,
      credorNome: 'FUNDO SINTETICO',
      diaVencimento: 7,
      contaContabil: '2.1.3',
      sugerida: false,
    });
    const e = entradaDePara(1, '2026-10-01', v);
    expect(e?.destinos.map((d) => d.destino)).toEqual(['liquido-mensal', 'fgts']);
    expect(entradaDePara(null, '2026-10-01', v)).toBeNull();
    expect(entradaDePara(1, null, v)).toBeNull();
    // A linha da rotina sem financeiro nunca entra (o servidor recusaria a vigência).
    const comSindical = v.map((l) => (l.destino === 'sindical' ? { ...l, credor: 9005 } : l));
    expect(entradaDePara(1, '2026-10-01', comSindical)?.destinos.map((d) => d.destino)).not.toContain(
      'sindical',
    );
  });

  it('vencimentos ajustados, vencimento antes da emissão e a entrada do lançamento', () => {
    const p = previa();
    expect(vencimentosAjustados(p, {})).toEqual([]);
    expect(
      vencimentosAjustados(p, { 'fgts:2026-10-07': '2026-10-06', 'liquido-mensal:2026-10-05': '2026-10-05' }),
    ).toEqual([{ chave: 'fgts:2026-10-07', vencimento: '2026-10-06' }]);
    expect(vencimentosAntesDaEmissao(p, '2026-10-06', {})).toEqual(['liquido-mensal:2026-10-05']);
    expect(entradaLancar(p, '2026-10-06', {})).toBeNull();
    expect(entradaLancar(p, '2026-09-30', { 'fgts:2026-10-07': '2026-10-06' })).toEqual({
      empresa: 1,
      origem: 'fechamento',
      id: 70,
      resumo: 'c'.repeat(64),
      emissao: '2026-09-30',
      vencimentos: [{ chave: 'fgts:2026-10-07', vencimento: '2026-10-06' }],
    });
    expect(entradaLancar(previa({ podeLancar: false }), '2026-09-30', {})).toBeNull();
    expect(entradaLancar(null, '2026-09-30', {})).toBeNull();
    expect(entradaLancar(p, null, {})).toBeNull();
  });

  it('todo destino, pendência e recusa tem texto, sem nome de outro sistema', () => {
    for (const d of DESTINOS_TITULO_FOLHA) expect(mensagensIntegracao.destinos[d]).toBeTruthy();
    for (const p of PENDENCIAS_TITULOS_FOLHA) expect(mensagensIntegracao.pendencia[p]).toBeTruthy();
    for (const r of RECUSAS_TITULOS_FOLHA) expect(mensagensIntegracao.recusa[r]).toBeTruthy();
    expect(JSON.stringify(mensagensIntegracao)).not.toMatch(
      /spdata|legado|sistema atual|FPINT|MFCONPAG|TBFORNEC/i,
    );
  });
});

// ── Tela ──────────────────────────────────────────────────────────────────────────────────────────────────────
function montar(permissoes: readonly string[] = TODAS) {
  return mount(IntegracaoFolhaTela as never, {
    attachTo: document.body,
    global: { plugins: plugins(permissoes), stubs: { RouterLink: { template: '<a><slot /></a>' } } },
  });
}

describe('tela da integração da folha', { timeout: 30_000 }, () => {
  it('lança pela prévia: origem sugerida, conta impressa, vencimento ajustado e o resumo conferido', async () => {
    const pedidos = simular((p) => {
      if (p.url.includes('/apoio'))
        return { corpo: apoio({ vigente, credores: [{ codigo: 9001, nome: 'BANCO SINTETICO' }] }) };
      if (p.url.includes('/origens')) return { corpo: origens };
      if (p.url.endsWith('/previa'))
        return {
          corpo: previa({ avisos: [{ codigo: 'possivel-lancamento-manual', destino: 'fgts', titulos: 2 }] }),
        };
      if (p.url.endsWith('/lancamentos') && p.metodo === 'POST')
        return { corpo: { lancamento, conta: 'líquido R$ 4.200,00 + FGTS R$ 400,00 = R$ 4.600,00' } };
      return null;
    });
    montar();
    await flushPromises();
    await flushPromises();
    expect(existe('tela-integracao-folha')).toBe(true);
    expect(existe('integracao-so-consulta')).toBe(false);
    // A origem sugerida é a mais nova ainda não lançada.
    expect(pedidos.some((p) => p.url.includes('/origens?empresa=1&ano=2026'))).toBe(true);
    await clicar('[data-testid="integracao-previa"] button, button[data-testid="integracao-previa"]');
    const previaPedida = pedidos.find((p) => p.url.endsWith('/previa'));
    expect(previaPedida?.corpo).toEqual({ empresa: 1, origem: 'fechamento', id: 70 });
    expect(texto('[data-testid="integracao-conta"]')).toContain('= R$ 4.600,00');
    expect(texto('[data-testid="integracao-parcelas"]')).toContain('FGTS');
    expect(texto('[data-testid="integracao-soma"]')).toContain('fecha');
    expect(texto('[data-testid="integracao-aviso-fgts"]')).toContain('2 título(s)');
    expect(texto('[data-testid="integracao-titulo-liquido-mensal"]')).toContain('BANCO SINTETICO');
    expect(texto('[data-testid="integracao-fatos"]')).toContain('Encargo da empresa');
    await digitar('integracao-emissao', '30/09/2026');
    await digitar('integracao-vencimento-fgts', '06/10/2026');
    await clicar('[data-testid="integracao-confirmar"] button, button[data-testid="integracao-confirmar"]');
    const lancar = pedidos.find((p) => p.url.endsWith('/lancamentos') && p.metodo === 'POST');
    expect(lancar?.corpo).toEqual({
      empresa: 1,
      origem: 'fechamento',
      id: 70,
      resumo: 'c'.repeat(64),
      emissao: '2026-09-30',
      vencimentos: [{ chave: 'fgts:2026-10-07', vencimento: '2026-10-06' }],
    });
    expect(texto('[data-testid="integracao-lancado"]')).toContain('lançamento 9');
  });

  it('prévia com pendências não lança; perfil de consulta não vê o lançar nem o editar; recusa traduzida', async () => {
    simular((p) => {
      if (p.url.includes('/apoio')) return { corpo: apoio() };
      if (p.url.includes('/origens')) return { corpo: origens };
      if (p.url.endsWith('/previa'))
        return {
          corpo: previa({
            podeLancar: false,
            total: 420_000,
            pendencias: [
              { codigo: 'sem-de-para', destino: 'fgts' },
              { codigo: 'soma-divergente', destino: null },
            ],
            titulos: [
              titulo('liquido-mensal', 420_000, '2026-10-05'),
              titulo('fgts', 40_000, '2026-10-07', null),
            ],
          }),
        };
      return null;
    });
    montar(['pessoas.integracao.ler']);
    await flushPromises();
    await flushPromises();
    expect(existe('integracao-so-consulta')).toBe(true);
    await clicar('[data-testid="integracao-previa"] button, button[data-testid="integracao-previa"]');
    expect(texto('[data-testid="integracao-pendencia-sem-de-para"]')).toContain('FGTS');
    expect(existe('integracao-pendencia-soma-divergente')).toBe(true);
    expect(texto('[data-testid="integracao-soma"]')).toContain('não fecha');
    expect(texto('[data-testid="integracao-titulo-fgts"]')).toContain('sem de-para');
    expect(existe('integracao-confirmar')).toBe(false);
    await clicar('[data-testid="integracao-aba-dePara"] button, button[data-testid="integracao-aba-dePara"]');
    expect(existe('integracao-de-para-sem-vigente')).toBe(true);
    expect(existe('integracao-de-para-form')).toBe(false);
    expect(existe('integracao-de-para-editar-fgts')).toBe(false);
    expect(existe('integracao-sem-financeiro-sindical')).toBe(true);
  });

  it('recusa do lançamento vira o texto da tela (o plano mudou)', async () => {
    simular((p) => {
      if (p.url.includes('/apoio')) return { corpo: apoio({ vigente }) };
      if (p.url.includes('/origens')) return { corpo: origens };
      if (p.url.endsWith('/previa')) return { corpo: previa() };
      if (p.url.endsWith('/lancamentos') && p.metodo === 'POST')
        return { status: 409, corpo: { status: 409, title: 'x', codigo: 'plano-mudou' } };
      return null;
    });
    montar();
    await flushPromises();
    await flushPromises();
    await clicar('[data-testid="integracao-previa"] button, button[data-testid="integracao-previa"]');
    await digitar('integracao-emissao', '30/09/2026');
    await clicar('[data-testid="integracao-confirmar"] button, button[data-testid="integracao-confirmar"]');
    expect(texto('[data-testid="recusa-folha"]')).toContain('confira a prévia de novo');
  });

  it('lançamentos com a situação no contas a pagar e o custo por centro com a conta', async () => {
    simular((p) => {
      if (p.url.includes('/apoio')) return { corpo: apoio({ vigente }) };
      if (p.url.includes('/lancamentos/9')) return { corpo: lancamento };
      if (p.url.includes('/lancamentos?'))
        return { corpo: { itens: [{ ...lancamento, titulos: undefined }] } };
      if (p.url.includes('/custo'))
        return {
          corpo: {
            empresa: 1,
            periodo: '2026-09',
            centros: [
              { centroCusto: 10, proventos: 300_000, encargos: 24_000, total: 324_000 },
              { centroCusto: 20, proventos: 120_000, encargos: 16_000, total: 136_000 },
            ],
            total: 460_000,
            lancamentos: 1,
          },
        };
      return null;
    });
    montar();
    await flushPromises();
    await clicar(
      '[data-testid="integracao-aba-lancamentos"] button, button[data-testid="integracao-aba-lancamentos"]',
    );
    expect(texto('[data-testid="integracao-lancamento-9"]')).toContain('R$ 4.600,00');
    await clicar(
      '[data-testid="integracao-lancamento-detalhe-9"] button, button[data-testid="integracao-lancamento-detalhe-9"]',
    );
    expect(texto('[data-testid="integracao-lancado-situacao-liquido-mensal"]')).toContain('pago');
    expect(texto('[data-testid="integracao-lancado-situacao-fgts"]')).toContain('em aberto');
    expect(texto('[data-testid="integracao-lancamento-soma"]')).toContain('= R$ 4.600,00');
    await clicar(
      '[data-testid="integracao-lancamento-fechar"] button, button[data-testid="integracao-lancamento-fechar"]',
    );
    await clicar('[data-testid="integracao-aba-custo"] button, button[data-testid="integracao-aba-custo"]');
    expect(texto('[data-testid="integracao-custo-total"]')).toContain('R$ 4.600,00');
    expect(texto('[data-testid="integracao-custo-conta"]')).toContain(
      'R$ 3.240,00 + R$ 1.360,00 = R$ 4.600,00',
    );
  });

  it('de-para: busca o credor, escolhe a classificação e grava a vigência nova', async () => {
    const pedidos = simular((p) => {
      if (p.url.includes('/apoio'))
        return { corpo: apoio({ vigente, credores: [{ codigo: 9001, nome: 'BANCO SINTETICO' }] }) };
      if (p.url.includes('/credores'))
        return { corpo: { itens: [{ codigo: 9002, nome: 'PREVIDENCIA SINTETICA' }] } };
      if (p.url.endsWith('/de-para') && p.metodo === 'POST')
        return { corpo: { ...vigente, id: 4, inicio: '2026-11-01' } };
      if (p.url.includes('/de-para?'))
        return { corpo: [vigente, { ...vigente, id: 2, inicio: '2026-01-01' }] };
      return null;
    });
    montar();
    await flushPromises();
    await clicar('[data-testid="integracao-aba-dePara"] button, button[data-testid="integracao-aba-dePara"]');
    expect(texto('[data-testid="integracao-de-para-vigente"]')).toContain('01/09/2026');
    expect(texto('[data-testid="integracao-de-para-historico"]')).toContain('01/01/2026');
    expect(texto('[data-testid="integracao-de-para-liquido-mensal"]')).toContain('BANCO SINTETICO');
    expect(texto('[data-testid="integracao-de-para-inss"]')).toContain('sugerida');
    await clicar(
      '[data-testid="integracao-de-para-editar-inss"] button, button[data-testid="integracao-de-para-editar-inss"]',
    );
    await digitar('integracao-credor-termo', 'previd');
    await clicar(
      '[data-testid="integracao-credor-buscar"] button, button[data-testid="integracao-credor-buscar"]',
    );
    expect(pedidos.some((p) => p.url.includes('/credores?termo=previd'))).toBe(true);
    await escolher('integracao-credor', '9002');
    await escolher('integracao-dia', '20');
    await clicar(
      '[data-testid="integracao-de-para-aplicar"] button, button[data-testid="integracao-de-para-aplicar"]',
    );
    expect(texto('[data-testid="integracao-de-para-inss"]')).toContain('PREVIDENCIA SINTETICA');
    await digitar('integracao-de-para-inicio', '01/11/2026');
    await clicar(
      '[data-testid="integracao-de-para-gravar"] button, button[data-testid="integracao-de-para-gravar"]',
    );
    const g = pedidos.find((p) => p.url.endsWith('/de-para') && p.metodo === 'POST');
    expect(g?.corpo).toMatchObject({ empresa: 1, inicio: '2026-11-01' });
    expect(
      (g?.corpo as { destinos: { destino: string; credor: number }[] }).destinos.map((d) => [
        d.destino,
        d.credor,
      ]),
    ).toEqual([
      ['liquido-mensal', 9001],
      ['inss', 9002],
      ['fgts', 9003],
    ]);
    expect(texto('[data-testid="integracao-de-para-gravado"]')).toContain('01/11/2026');
  });
});
