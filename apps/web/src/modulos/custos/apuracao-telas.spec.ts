// @vitest-environment jsdom
// Telas da apuração do custo do mês e do resultado (M54, etapa 5): os comuns (reais, percentual, limite em reais,
// conservação com as parcelas, filtros, indicador como conta, produção com a unidade); a apuração (não apurada → apurar
// com o limite; apurada parcial com a conservação, os centros e as parcelas, as pendências, aprovar pela versão lida;
// aprovada → exportar e baixar, reapurar só com justificativa; recusa com o texto; bloqueios da estrutura; liberação
// desligada sem ações; relatório PDF/A); o resultado (grupos e total, indicadores, contas paginadas com o filtro do grupo,
// sem permissão, competência não apurada). Dados SINTÉTICOS; o fetch é simulado.
import {
  type ApoioApuracaoCustos,
  type ApuracaoCustos,
  type CustoConta,
  type IndicadorEconomico,
  type LinhaApuracaoCentro,
  type PainelApuracao,
  type ResultadoCustos,
} from '@sgh/contratos';
import { criarI18n, instalarUi, resolverMarca } from '@sgh/ui';
import { QueryClient, VueQueryPlugin } from '@tanstack/vue-query';
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { App } from 'vue';
import { mensagensWeb } from '../../i18n/pt-BR.js';
import ApuracaoCustosTela from './ApuracaoCustosTela.vue';
import {
  conservacao,
  contaIndicador,
  filtrarGrupos,
  filtrarLinhas,
  lerReais,
  percentual,
  reais,
  rotuloEstatistica,
  somaEmReais,
  textoProducao,
} from './comum-apuracao.js';
import ResultadoCustosTela from './ResultadoCustosTela.vue';

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
const montar = (tela: unknown) =>
  mount(tela as never, {
    attachTo: document.body,
    props: { hoje: '2026-03-20' } as never,
    global: {
      plugins: [
        criarI18n(mensagensWeb as unknown as Record<string, unknown>),
        ui,
        [VueQueryPlugin, { queryClient: new QueryClient({ defaultOptions: { queries: { retry: false } } }) }],
      ] as never,
      stubs: { RouterLink: { props: ['to'], template: '<a :href="to"><slot /></a>' } },
    },
  });

type Pedido = { url: string; metodo: string; corpo: unknown };
type Resposta = { status?: number; corpo: unknown; tipo?: string };
function simular(rota: (url: string, metodo: string, corpo: unknown) => Resposta): Pedido[] {
  const pedidos: Pedido[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      const metodo = init?.method ?? 'GET';
      const corpo = typeof init?.body === 'string' ? JSON.parse(init.body) : null;
      pedidos.push({ url: String(url), metodo, corpo });
      const r = rota(String(url), metodo, corpo);
      const tipo = r.tipo ?? (r.status && r.status >= 400 ? 'application/problem+json' : 'application/json');
      return new Response(typeof r.corpo === 'string' ? r.corpo : JSON.stringify(r.corpo), {
        status: r.status ?? 200,
        headers: { 'content-type': tipo },
      });
    }),
  );
  return pedidos;
}
const urlsCriadas: Blob[] = [];
beforeEach(() => {
  urlsCriadas.length = 0;
  URL.createObjectURL = vi.fn((b: Blob) => {
    urlsCriadas.push(b);
    return 'blob:sintetico';
  }) as never;
  URL.revokeObjectURL = vi.fn() as never;
});
afterEach(() => {
  vi.unstubAllGlobals();
  document.body.innerHTML = '';
});
async function selecionar(w: VueWrapper, testid: string, v: unknown): Promise<void> {
  const c = w.findAllComponents({ name: 'SanteSelecao' }).find((x) => x.attributes('data-testid') === testid);
  if (!c) throw new Error(`sem a seleção ${testid}`);
  c.vm.$emit('update:modelValue', v);
  await flushPromises();
}
const clicar = async (w: VueWrapper, testid: string) => {
  await w.find(`[data-testid="${testid}"]`).trigger('click');
  await flushPromises();
};

// ── Dados sintéticos ──────────────────────────────────────────────────────────────────────────────────────────────

const apoio = (ligada = true, tudo = true): ApoioApuracaoCustos => ({
  grupos: [],
  situacoes: [],
  agrupamentos: [
    { valor: 'convenio', rotulo: 'Convênio' },
    { valor: 'procedimento', rotulo: 'Procedimento principal da conta' },
    { valor: 'centro', rotulo: 'Unidade (centro produtivo)' },
    { valor: 'tipoConta', rotulo: 'Tipo de conta (internação ou externa)' },
  ],
  destinos: [
    { valor: 'proprio', rotulo: 'Próprio (planilha do hospital)', ativo: true },
    { valor: 'apurasus', rotulo: 'ApuraSUS', ativo: true },
    { valor: 'federassantas', rotulo: 'Federassantas', ativo: false },
  ],
  limiteLinhaSaidaPadrao: 10_000_000,
  acoes: { apurar: tudo, aprovar: tudo, exportar: tudo, resultado: tudo },
  liberacao: { ligada },
});

const linha = (x: Partial<LinhaApuracaoCentro> & Pick<LinhaApuracaoCentro, 'centro' | 'codigo' | 'nome'>) =>
  ({
    classe: 'produtivo',
    ordemRateio: null,
    criterio: null,
    direto: { pessoal: 0, materiais: 0, despesas: 0 },
    despesasGerais: 0,
    diretoTotal: 0,
    recebidos: [],
    recebidoTotal: 0,
    repassado: 0,
    naoRateado: 0,
    custoFinal: 0,
    baseCriterioCent: null,
    producao: null,
    custoUnitario: null,
    receita: 0,
    ...x,
  }) as LinhaApuracaoCentro;

const LINHAS: LinhaApuracaoCentro[] = [
  linha({
    centro: 1,
    codigo: 201,
    nome: 'Lavanderia sintética',
    classe: 'auxiliar',
    ordemRateio: 1,
    criterio: 'pacienteDia',
    direto: { pessoal: 0, materiais: 30_000, despesas: 0 },
    diretoTotal: 30_000,
    repassado: 26_000,
    naoRateado: 4_000,
    custoFinal: 4_000,
    baseCriterioCent: 1_250,
  }),
  linha({
    centro: 2,
    codigo: 101,
    nome: 'Internação sintética',
    direto: { pessoal: 0, materiais: 60_000, despesas: 10_000 },
    despesasGerais: 4_000,
    diretoTotal: 74_000,
    recebidos: [{ de: 1, centavos: 26_000 }],
    recebidoTotal: 26_000,
    custoFinal: 100_000,
    producao: { codigo: 'pacienteDia', quantidadeCent: 1_250 },
    custoUnitario: 8_000,
    receita: 200_000,
  }),
];

const apuracao = (situacao: ApuracaoCustos['situacao'] = 'apurada'): ApuracaoCustos => ({
  id: 7,
  competencia: '2026-02',
  situacao,
  versao: 3,
  completude: {
    fontes: [
      { fonte: 'estoque', presente: true, detalhe: '12 saídas' },
      { fonte: 'pessoal', presente: false, detalhe: 'sem folha da competência' },
    ],
    parcial: true,
    rotulo: 'parcial (sem pessoal)',
  },
  limiteLinhaSaida: 10_000_000,
  totais: {
    direto: { pessoal: 0, materiais: 90_000, despesas: 10_000 },
    despesasSemCentro: 5_000,
    diretoTotal: 105_000,
    custoFinalProdutivos: 100_000,
    naoRateado: 4_000,
    despesasNaoDistribuidas: 1_000,
    foraDoCusteio: 0,
    atipicas: { linhas: 1, centavos: 50_000_000 },
    custoNasContas: 100_000,
    custoSemConta: 0,
    receitaBruta: 210_000,
    receitaLiquida: 200_000,
    contas: 2,
  },
  linhas: LINHAS,
  pendencias: [
    {
      tipo: 'linhas-atipicas',
      bloqueia: false,
      centros: [2],
      centavos: 50_000_000,
      mensagem: '1 linha de saída atípica ficou fora do custo direto.',
    },
  ],
  impressao: 'ab'.repeat(32),
  justificativa: null,
  apuradaPor: 'SINT.CUSTOS',
  apuradaEm: '2026-03-02T13:00:00Z',
  aprovadaPor: situacao === 'aprovada' ? 'SINT.CUSTOS.CONTROLLER' : null,
  aprovadaEm: situacao === 'aprovada' ? '2026-03-03T13:00:00Z' : null,
  duracaoMs: 1_500,
});

const resumo = (x: ApuracaoCustos) => ({
  id: x.id,
  competencia: x.competencia,
  situacao: x.situacao,
  parcial: x.completude.parcial,
  rotuloParcial: x.completude.rotulo,
  custoFinalProdutivos: x.totais.custoFinalProdutivos,
  impressao: x.impressao,
  apuradaPor: x.apuradaPor,
  apuradaEm: x.apuradaEm,
  aprovadaPor: x.aprovadaPor,
  aprovadaEm: x.aprovadaEm,
});

const painel = (x: ApuracaoCustos | null, bloqueios: PainelApuracao['bloqueios'] = []): PainelApuracao => ({
  competencia: '2026-02',
  apuracao: x,
  historico: x ? [resumo(x)] : [],
  bloqueios,
});

const INDICADOR: IndicadorEconomico = {
  codigo: 'custoPacienteDia',
  rotulo: 'Custo por paciente-dia',
  formula: 'Σ custo final ÷ Σ paciente-dia',
  numerador: 100_000,
  denominador: 1_250,
  valor: 8_000,
  parcelas: [{ centro: 2, numerador: 100_000, denominador: 1_250 }],
};

const resultado = (agrupamento: ResultadoCustos['agrupamento'], apurada = true): ResultadoCustos => ({
  competencia: '2026-02',
  apuracao: apurada ? resumo(apuracao('aprovada')) : null,
  agrupamento,
  grupos: !apurada
    ? []
    : agrupamento === 'centro'
      ? [
          {
            chave: '2',
            rotulo: '101 Internação sintética',
            contas: 0,
            receitaBruta: 200_000,
            glosa: 0,
            recurso: 0,
            receitaLiquida: 200_000,
            custo: 100_000,
            margem: 100_000,
            margemPercentualCent: 5_000,
          },
        ]
      : [
          {
            chave: '30',
            rotulo: 'Convênio sintético A',
            contas: 1,
            receitaBruta: 150_000,
            glosa: 10_000,
            recurso: 0,
            receitaLiquida: 140_000,
            custo: 160_000,
            margem: -20_000,
            margemPercentualCent: -1_429,
          },
          {
            chave: 'sem',
            rotulo: 'Sem convênio',
            contas: 1,
            receitaBruta: 60_000,
            glosa: 0,
            recurso: 0,
            receitaLiquida: 60_000,
            custo: 0,
            margem: 60_000,
            margemPercentualCent: 10_000,
          },
        ],
  total: {
    contas: 2,
    receitaBruta: 210_000,
    glosa: 10_000,
    recurso: 0,
    receitaLiquida: 200_000,
    custo: 160_000,
    margem: 40_000,
    margemPercentualCent: 2_000,
  },
  indicadores: apurada ? [INDICADOR] : [],
});

const conta = (numero: number, margem: number): CustoConta => ({
  conta: numero * 10,
  numero,
  tipoConta: 'I',
  convenio: 30,
  procedimento: '0303',
  receitaBruta: 150_000,
  glosa: 10_000,
  recurso: 0,
  receitaLiquida: 140_000,
  custo: 140_000 - margem,
  margem,
  margemPercentualCent: Math.round((margem * 10_000) / 140_000),
  parcelas: [{ centro: 2, receita: 150_000, custo: 140_000 - margem }],
  prontuario: 800000 + numero,
});

// ── Comuns ────────────────────────────────────────────────────────────────────────────────────────────────────────

describe('comuns da apuração (M54.5)', () => {
  it('reais e percentual em inteiros, com o sinal', () => {
    expect(reais(123_456_789)).toBe('R$ 1.234.567,89');
    expect(reais(-5)).toBe('−R$ 0,05');
    expect(percentual(-1_429)).toBe('−14,29%');
    expect(percentual(5)).toBe('0,05%');
    expect(percentual(null)).toBe('—');
  });
  it('o limite em reais vira centavos', () => {
    expect(lerReais('100.000,00')).toBe(10_000_000);
    expect(lerReais('R$ 1.234,5')).toBe(123_450);
    expect(lerReais('1234.56')).toBe(123_456);
    expect(lerReais('100000')).toBe(10_000_000);
    expect(lerReais('')).toBeNull();
    expect(lerReais('1,234')).toBeNull();
    expect(lerReais('abc')).toBeNull();
  });
  it('a conservação com as parcelas: lido = destino', () => {
    const c = conservacao(apuracao().totais);
    expect(c.lidas).toEqual([0, 90_000, 10_000, 5_000]);
    expect(c.destinos).toEqual([100_000, 4_000, 1_000]);
    expect(c.fecha).toBe(true);
    expect(somaEmReais(c.destinos)).toBe('R$ 1.000,00 + R$ 40,00 + R$ 10,00 = R$ 1.050,00');
    expect(conservacao({ ...apuracao().totais, naoRateado: 0 }).fecha).toBe(false);
  });
  it('filtros dos centros e dos grupos; o indicador como conta; produção e critério pelo catálogo', () => {
    expect(filtrarLinhas(LINHAS, 'auxiliar', '').map((l) => l.codigo)).toEqual([201]);
    expect(filtrarLinhas(LINHAS, 'todas', 'internacao').map((l) => l.codigo)).toEqual([101]);
    expect(filtrarLinhas(LINHAS, 'todas', '201').map((l) => l.codigo)).toEqual([201]);
    const g = resultado('convenio').grupos;
    expect(filtrarGrupos(g, 'sintético').map((x) => x.chave)).toEqual(['30']);
    expect(filtrarGrupos(g, '30').map((x) => x.chave)).toEqual(['30']);
    expect(filtrarGrupos(g, '')).toHaveLength(2);
    expect(contaIndicador(INDICADOR)).toBe('R$ 1.000,00 ÷ 12,5 = R$ 80,00');
    expect(contaIndicador({ ...INDICADOR, valor: null })).toBe('R$ 1.000,00 ÷ 12,5 = —');
    expect(textoProducao({ codigo: 'pacienteDia', quantidadeCent: 125_000 })).toBe('1.250 paciente-dia');
    expect(textoProducao(null)).toBeNull();
    expect(rotuloEstatistica('pacienteDia')).toBe('Paciente-dia');
    expect(rotuloEstatistica(null)).toBe('—');
  });
});

// ── Apuração ──────────────────────────────────────────────────────────────────────────────────────────────────────

function rotaApuracao(
  estado: { atual: ApuracaoCustos | null; bloqueios?: PainelApuracao['bloqueios'] },
  ap = apoio(),
) {
  return (url: string, metodo: string, corpo: unknown): Resposta => {
    if (url === '/api/custos/apuracao/apoio') return { corpo: ap };
    if (url.startsWith('/api/custos/apuracao/relatorio'))
      return { corpo: '%PDF-1.7 sintético', tipo: 'application/pdf' };
    if (url.startsWith('/api/custos/apuracao?')) return { corpo: painel(estado.atual, estado.bloqueios) };
    if (url === '/api/custos/apuracao' && metodo === 'POST') {
      const c = corpo as { justificativa: string | null };
      if (estado.atual?.situacao === 'aprovada' && !c.justificativa)
        return { status: 422, corpo: { codigo: 'justificativa-obrigatoria', title: 'x', status: 422 } };
      estado.atual = { ...apuracao('apurada'), justificativa: c.justificativa };
      return { status: 201, corpo: estado.atual };
    }
    if (url === '/api/custos/apuracao/7/aprovacao') {
      estado.atual = apuracao('aprovada');
      return { corpo: estado.atual };
    }
    if (url === '/api/custos/apuracao/exportacao')
      return {
        corpo: {
          destino: 'apurasus',
          competencia: '2026-02',
          nomeArquivo: 'apurasus-2026-02.csv',
          conteudo: 'COMPETENCIA;COD\r\n2026-02;1\r\n',
          linhas: 1,
          sha256: 'cd'.repeat(32),
          semCodigo: [1],
          envio: 'somente-producao',
          avisos: [],
        },
      };
    return { status: 404, corpo: { title: 'não simulado', status: 404 } };
  };
}

describe('tela da apuração do custo do mês (M54.5)', () => {
  it('competência não apurada: apurar com o limite padrão, sem justificativa', async () => {
    const estado = { atual: null as ApuracaoCustos | null };
    const pedidos = simular(rotaApuracao(estado));
    const w = montar(ApuracaoCustosTela);
    await flushPromises();
    expect(pedidos.some((p) => p.url === '/api/custos/apuracao?competencia=2026-02')).toBe(true);
    expect(w.find('[data-testid="apuracao-nao-apurada"]').text()).toContain('fevereiro de 2026');
    expect((w.find('[data-testid="apuracao-limite"]').element as HTMLInputElement).value).toBe('100.000,00');
    expect(w.find('[data-testid="apuracao-justificativa"]').exists()).toBe(false);
    await w.find('[data-testid="apuracao-form-apurar"]').trigger('submit');
    await flushPromises();
    const post = pedidos.find((p) => p.metodo === 'POST');
    expect(post?.corpo).toEqual({
      competencia: '2026-02',
      limiteLinhaSaida: 10_000_000,
      justificativa: null,
    });
    expect(w.find('[data-testid="apuracao-feito"]').text()).toContain(
      'apurada em 1,5 s: 2 centro(s), 2 conta(s)',
    );
    expect(w.find('[data-testid="apuracao-situacao"]').text()).toBe('Apurada (aguarda aprovação)');
    w.unmount();
  });

  it('limite inválido bloqueia o apurar', async () => {
    simular(rotaApuracao({ atual: null }));
    const w = montar(ApuracaoCustosTela);
    await flushPromises();
    await w.find('[data-testid="apuracao-limite"]').setValue('mil');
    expect(w.find('[role="alert"]').text()).toContain('até duas casas');
    expect(w.find('[data-testid="apuracao-apurar"]').attributes('disabled')).toBeDefined();
    w.unmount();
  });

  it('apurada parcial: completude, conservação com as parcelas, centros com as parcelas, pendências; aprovar', async () => {
    const estado = { atual: apuracao('apurada') as ApuracaoCustos | null };
    const pedidos = simular(rotaApuracao(estado));
    const w = montar(ApuracaoCustosTela);
    await flushPromises();
    expect(w.find('[data-testid="apuracao-parcial"]').text()).toContain('Custeio parcial (sem pessoal)');
    expect(w.text()).toContain('pessoal: ausente (sem folha da competência)');
    const c = w.find('[data-testid="apuracao-conservacao"]').text();
    expect(c).toContain('R$ 0,00 + R$ 900,00 + R$ 100,00 + R$ 50,00 = R$ 1.050,00');
    expect(c).toContain('R$ 1.000,00 + R$ 40,00 + R$ 10,00 = R$ 1.050,00');
    expect(w.find('[data-testid="apuracao-fecha"]').text()).toContain('nada se perdeu');
    expect(c).toContain('1 linha(s), R$ 500.000,00');
    const l = w.find('[data-testid="apuracao-centro-101"]').text();
    expect(l).toContain('R$ 740,00');
    expect(l).toContain('R$ 260,00');
    expect(l).toContain('R$ 1.000,00');
    expect(l).toContain('12,5 paciente-dia');
    expect(l).toContain('R$ 80,00');
    await clicar(w, 'apuracao-ver-101');
    const parc = w.find('[data-testid="apuracao-parcelas-101"]').text();
    expect(parc).toContain('R$ 0,00 + R$ 600,00 + R$ 100,00 + R$ 40,00 = R$ 740,00');
    expect(parc).toContain('201 Lavanderia sintética: R$ 260,00');
    await clicar(w, 'apuracao-ver-201');
    const aux = w.find('[data-testid="apuracao-parcelas-201"]').text();
    expect(aux).toContain('Repassou R$ 260,00 aos centros seguintes pelo critério Paciente-dia (base 12,5)');
    expect(aux).toContain('R$ 40,00 ficaram parados');
    await w.find('[data-testid="apuracao-filtro-termo"]').setValue('lavanderia');
    expect(w.find('[data-testid="apuracao-contagem"]').text()).toBe('1 de 2 centro(s)');
    expect(w.find('[data-testid="apuracao-pendencia-linhas-atipicas"]').text()).toContain(
      '(R$ 500.000,00) · 101 Internação sintética',
    );
    expect(w.find('[data-testid="apuracao-exportacao"]').text()).toContain('Aprove a apuração');
    await clicar(w, 'apuracao-aprovar');
    expect(pedidos.find((p) => p.url === '/api/custos/apuracao/7/aprovacao')?.corpo).toEqual({ versao: 3 });
    expect(w.find('[data-testid="apuracao-feito"]').text()).toContain('aprovada');
    expect(w.find('[data-testid="apuracao-situacao"]').text()).toBe('Aprovada');
    expect(w.find('[data-testid="apuracao-aprovar"]').exists()).toBe(false);
    expect(w.find('[data-testid="apuracao-historico"]').text()).toContain('SINT.CUSTOS.CONTROLLER');
    w.unmount();
  });

  it('aprovada: exportar só os destinos ativos, baixar o arquivo; reapurar exige justificativa', async () => {
    const estado = { atual: apuracao('aprovada') as ApuracaoCustos | null };
    const pedidos = simular(rotaApuracao(estado));
    const w = montar(ApuracaoCustosTela);
    await flushPromises();
    const sel = w
      .findAllComponents({ name: 'SanteSelecao' })
      .find((x) => x.attributes('data-testid') === 'apuracao-destino');
    expect((sel?.props('opcoes') as { valor: string }[]).map((o) => o.valor)).toEqual([
      'proprio',
      'apurasus',
    ]);
    await selecionar(w, 'apuracao-destino', 'apurasus');
    await clicar(w, 'apuracao-exportar');
    expect(pedidos.find((p) => p.url === '/api/custos/apuracao/exportacao')?.corpo).toEqual({
      competencia: '2026-02',
      destino: 'apurasus',
    });
    expect(w.find('[data-testid="apuracao-arquivo"]').text()).toContain(
      'apurasus-2026-02.csv gerado: 1 linha(s)',
    );
    expect(w.find('[data-testid="apuracao-sem-codigo"]').text()).toContain('201 Lavanderia sintética');
    await clicar(w, 'apuracao-baixar');
    expect(urlsCriadas).toHaveLength(1);
    expect(await urlsCriadas[0]!.text()).toBe('COMPETENCIA;COD\r\n2026-02;1\r\n');
    // Reapurar a aprovada: o botão só libera com a justificativa de 10+ caracteres; o servidor guarda a justificativa.
    expect(w.find('[data-testid="apuracao-apurar"]').attributes('disabled')).toBeDefined();
    const j = w
      .findAllComponents({ name: 'SanteCampoTexto' })
      .find((x) => x.attributes('data-testid') === 'apuracao-justificativa');
    j!.vm.$emit('update:modelValue', 'Roupa conferida com a lavanderia.');
    await flushPromises();
    expect(w.find('[data-testid="apuracao-apurar"]').attributes('disabled')).toBeUndefined();
    await w.find('[data-testid="apuracao-form-apurar"]').trigger('submit');
    await flushPromises();
    expect(
      pedidos.filter((p) => p.url === '/api/custos/apuracao' && p.metodo === 'POST').at(-1)?.corpo,
    ).toMatchObject({
      justificativa: 'Roupa conferida com a lavanderia.',
    });
    expect(w.text()).toContain('Justificativa: Roupa conferida com a lavanderia.');
    w.unmount();
  });

  it('relatório de custos: baixa o PDF/A da competência', async () => {
    const pedidos = simular(rotaApuracao({ atual: apuracao('aprovada') }));
    const w = montar(ApuracaoCustosTela);
    await flushPromises();
    await clicar(w, 'apuracao-relatorio');
    expect(pedidos.some((p) => p.url === '/api/custos/apuracao/relatorio?competencia=2026-02')).toBe(true);
    expect(urlsCriadas).toHaveLength(1);
    expect(urlsCriadas[0]!.type).toContain('application/pdf');
    w.unmount();
  });

  it('a recusa do servidor vira o texto da tela', async () => {
    simular((url, metodo) => {
      if (url === '/api/custos/apuracao/apoio') return { corpo: apoio() };
      if (url.startsWith('/api/custos/apuracao?')) return { corpo: painel(null) };
      if (metodo === 'POST')
        return { status: 422, corpo: { codigo: 'fontes-truncadas', title: 'x', status: 422 } };
      return { status: 404, corpo: {} };
    });
    const w = montar(ApuracaoCustosTela);
    await flushPromises();
    await w.find('[data-testid="apuracao-form-apurar"]').trigger('submit');
    await flushPromises();
    expect(w.find('[data-testid="recusa-custos"]').text()).toContain('Avise o suporte');
    w.unmount();
  });

  it('a estrutura com pendência mostra os bloqueios e não deixa apurar', async () => {
    simular(
      rotaApuracao({
        atual: null,
        bloqueios: [
          {
            tipo: 'estrutura',
            bloqueia: true,
            centros: [3],
            centavos: 0,
            mensagem: '1 centro ativo sem classe.',
          },
        ],
      }),
    );
    const w = montar(ApuracaoCustosTela);
    await flushPromises();
    expect(w.find('[data-testid="apuracao-bloqueios"]').text()).toContain('1 centro ativo sem classe.');
    expect(w.find('[data-testid="apuracao-apurar"]').attributes('disabled')).toBeDefined();
    expect(w.find('a[href="/custos/centros"]').exists()).toBe(true);
    w.unmount();
  });

  it('liberação desligada ou só consulta: sem apurar, aprovar nem exportar', async () => {
    simular(rotaApuracao({ atual: apuracao('apurada') }, apoio(false)));
    const w = montar(ApuracaoCustosTela);
    await flushPromises();
    expect(w.find('[data-testid="apuracao-aviso"]').text()).toContain('ainda não foi liberada');
    expect(w.find('[data-testid="apuracao-form-apurar"]').exists()).toBe(false);
    expect(w.find('[data-testid="apuracao-aprovar"]').exists()).toBe(false);
    expect(w.find('[data-testid="apuracao-relatorio"]').exists()).toBe(true);
    w.unmount();
    simular(rotaApuracao({ atual: apuracao('aprovada') }, apoio(true, false)));
    const v = montar(ApuracaoCustosTela);
    await flushPromises();
    expect(v.find('[data-testid="apuracao-aviso"]').text()).toContain('consulta a apuração');
    expect(v.find('[data-testid="apuracao-exportar"]').exists()).toBe(false);
    expect(v.find('a[href="/custos/resultado"]').exists()).toBe(false);
    v.unmount();
  });
});

// ── Resultado ─────────────────────────────────────────────────────────────────────────────────────────────────────

function rotaResultado(ap = apoio(), apurada = true) {
  return (url: string): Resposta => {
    if (url === '/api/custos/apuracao/apoio') return { corpo: ap };
    if (url.startsWith('/api/custos/resultado/contas')) {
      const q = new URL(url, 'http://x').searchParams;
      const pagina = Number(q.get('pagina') ?? '1');
      const contas = apurada
        ? q.get('negativas') === 'sim'
          ? [conta(9001, -20_000)]
          : [conta(9001 + pagina, 10_000)]
        : [];
      return {
        corpo: { competencia: '2026-02', pagina, tamanho: 50, total: apurada ? 120 : 0, contas },
      };
    }
    if (url.startsWith('/api/custos/resultado')) {
      const q = new URL(url, 'http://x').searchParams;
      return { corpo: resultado(q.get('agrupamento') as ResultadoCustos['agrupamento'], apurada) };
    }
    return { status: 404, corpo: {} };
  };
}

describe('tela do resultado e da margem (M54.5)', () => {
  it('grupos com o total, indicadores com a conta e as parcelas, contas paginadas pelo filtro do grupo', async () => {
    const pedidos = simular(rotaResultado());
    const w = montar(ResultadoCustosTela);
    await flushPromises();
    expect(w.find('[data-testid="resultado-apuracao"]').text()).toContain(
      'Apuração aprovada, apurada por SINT.CUSTOS',
    );
    expect(w.find('[data-testid="resultado-parcial"]').text()).toContain('parcial (sem pessoal)');
    const g = w.find('[data-testid="resultado-grupo-30"]').text();
    expect(g).toContain('Convênio sintético A');
    expect(g).toContain('−R$ 200,00');
    expect(g).toContain('−14,29%');
    const total = w.find('[data-testid="resultado-total"]').text();
    expect(total).toContain('Total da competência (2 grupo(s))');
    expect(total).toContain('R$ 2.000,00');
    expect(total).toContain('20,00%');
    const ind = w.find('[data-testid="resultado-indicador-custoPacienteDia"]').text();
    expect(ind).toContain('R$ 1.000,00 ÷ 12,5 = R$ 80,00');
    expect(ind).toContain('101 Internação sintética: R$ 1.000,00 ÷ 12,5');
    expect(w.find('[data-testid="resultado-conta-9002"]').text()).toContain(
      '101 Internação sintética: faturou R$ 1.500,00, custo R$ 1.300,00',
    );
    expect(w.find('[data-testid="resultado-conta-9002"]').text()).toContain('809002');
    expect(w.find('[data-testid="resultado-pagina"]').text()).toContain('Página 1 de 3 (120 conta(s))');
    await clicar(w, 'resultado-pagina-proxima');
    expect(pedidos.some((p) => p.url === '/api/custos/resultado/contas?competencia=2026-02&pagina=2')).toBe(
      true,
    );
    expect(w.find('[data-testid="resultado-conta-9003"]').exists()).toBe(true);
    await clicar(w, 'resultado-ver-contas-30');
    expect(pedidos.at(-1)?.url).toBe('/api/custos/resultado/contas?competencia=2026-02&convenio=30');
    await w.find('[data-testid="resultado-busca"]').setValue('sem conv');
    expect(w.find('[data-testid="resultado-grupo-30"]').exists()).toBe(false);
    w.unmount();
  });

  it('convênio e procedimento em combos com busca, das opções da apuração; número e prontuário inválidos travam o filtro', async () => {
    const pedidos = simular(rotaResultado());
    const w = montar(ResultadoCustosTela);
    await flushPromises();
    const combo = (id: string) =>
      w.findAllComponents({ name: 'SanteSelecao' }).find((x) => x.attributes('data-testid') === id)!;
    expect(combo('resultado-filtro-convenio').props('busca')).toBe(true);
    expect(combo('resultado-filtro-procedimento').props('busca')).toBe(true);
    const opcoes = combo('resultado-filtro-convenio').props('opcoes') as { valor: unknown; rotulo: string }[];
    expect(opcoes[0]).toEqual({ valor: null, rotulo: 'Todos os convênios' });
    expect(opcoes.map((o) => o.valor)).toContain(30);
    expect(opcoes.find((o) => o.valor === 30)?.rotulo).toBe('30 · Convênio sintético A');
    expect(opcoes.some((o) => o.rotulo.includes('sem'))).toBe(false);
    expect(w.findAll('input').some((i) => i.attributes('maxlength') === '6')).toBe(false);
    await selecionar(w, 'resultado-filtro-convenio', 30);
    await w.find('[data-testid="resultado-filtro-numero"]').setValue('12a');
    expect(w.find('[data-testid="resultado-filtrar"]').attributes('disabled')).toBeDefined();
    await w.find('[data-testid="resultado-filtro-numero"]').setValue('501');
    await w.find('[data-testid="resultado-filtro-prontuario"]').setValue('x');
    expect(w.find('[data-testid="resultado-filtrar"]').attributes('disabled')).toBeDefined();
    await w.find('[data-testid="resultado-filtro-prontuario"]').setValue('800001');
    await w.find('[data-testid="resultado-filtrar"]').trigger('submit');
    await flushPromises();
    expect(pedidos.at(-1)?.url).toBe(
      '/api/custos/resultado/contas?competencia=2026-02&convenio=30&numero=501&prontuario=800001',
    );
    w.unmount();
  });

  it('custo por paciente: agrupamento pelo prontuário; "Ver as contas" filtra as contas do paciente', async () => {
    const pedidos = simular(rotaResultado());
    const w = montar(ResultadoCustosTela);
    await flushPromises();
    await selecionar(w, 'resultado-agrupamento', 'paciente');
    expect(
      pedidos.some((p) => p.url === '/api/custos/resultado?competencia=2026-02&agrupamento=paciente'),
    ).toBe(true);
    await clicar(w, 'resultado-ver-contas-30');
    expect(pedidos.at(-1)?.url).toBe('/api/custos/resultado/contas?competencia=2026-02&prontuario=30');
    expect((w.find('[data-testid="resultado-filtro-prontuario"]').element as HTMLInputElement).value).toBe(
      '30',
    );
    expect(w.find('[data-testid="resultado-contas"]').text()).toContain('Prontuário');
    w.unmount();
  });

  it('filtro de margem negativa e procedimento; trocar o agrupamento consulta de novo', async () => {
    const pedidos = simular(rotaResultado());
    const w = montar(ResultadoCustosTela);
    await flushPromises();
    await selecionar(w, 'resultado-filtro-procedimento', '0303');
    await w.find('input[type="radio"][value="negativas"]').setValue(true);
    await w.find('[data-testid="resultado-filtrar"]').trigger('submit');
    await flushPromises();
    expect(pedidos.at(-1)?.url).toBe(
      '/api/custos/resultado/contas?competencia=2026-02&procedimento=0303&negativas=sim',
    );
    expect(w.find('[data-testid="resultado-conta-9001"]').text()).toContain('−R$ 200,00');
    await selecionar(w, 'resultado-agrupamento', 'tipoConta');
    expect(
      pedidos.some((p) => p.url === '/api/custos/resultado?competencia=2026-02&agrupamento=tipoConta'),
    ).toBe(true);
    expect(w.find('[data-testid="resultado-ver-contas-30"]').exists()).toBe(false);
    w.unmount();
  });

  it('competência não apurada e perfil sem a permissão do resultado', async () => {
    simular(rotaResultado(apoio(), false));
    const w = montar(ResultadoCustosTela);
    await flushPromises();
    expect(w.find('[data-testid="resultado-nao-apurada"]').text()).toContain('ainda não foi apurada');
    expect(w.find('[data-testid="resultado-sem-contas"]').exists()).toBe(true);
    w.unmount();
    const pedidos = simular(rotaResultado(apoio(true, false)));
    const v = montar(ResultadoCustosTela);
    await flushPromises();
    expect(v.find('[data-testid="resultado-sem-permissao"]').exists()).toBe(true);
    expect(pedidos.filter((p) => p.url.startsWith('/api/custos/resultado'))).toEqual([]);
    v.unmount();
  });
});
