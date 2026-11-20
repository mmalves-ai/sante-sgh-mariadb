// @vitest-environment jsdom
// Telas de férias e 13º (M53.4, etapa F3): os comuns (datas do gozo e do pagamento, opções de dias e abono, recusas da
// resposta, ações da fração, escala, saldo, datas do 13º); todo código do contrato tem texto; a aba Férias (escala →
// colaborador → saldo → programar com previsão, recusas da CLT todas de uma vez e avisos; prévia do recibo com a memória
// e a prova, cálculo depois da confirmação; cancelamento com motivo; perfil de consulta sem gravar); a aba 13º (prévia
// com avisos, cálculo com confirmação, lista do ano e memória do colaborador); as "Minhas férias" do autosserviço.
// Dados SINTÉTICOS; o fetch é simulado.
import {
  AVISOS_CALCULO_FERIAS,
  AVISOS_DECIMO,
  AVISOS_PERIODO_FERIAS,
  AVISOS_PROGRAMACAO_FERIAS,
  RECUSAS_PROGRAMACAO_FERIAS,
  SITUACOES_FERIAS,
  SITUACOES_PERIODO_AQUISITIVO,
} from '@sgh/contratos';
import { criarI18n, instalarUi, resolverMarca } from '@sgh/ui';
import { QueryClient, VueQueryPlugin } from '@tanstack/vue-query';
import { flushPromises, mount } from '@vue/test-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { type App, nextTick } from 'vue';
import { routeLocationKey } from 'vue-router';
import { ErroApi } from '../../../casca/erros/problem-details.js';
import { CHAVE_SESSAO } from '../../../casca/sessao/sessao.js';
import { mensagensWeb } from '../../../i18n/pt-BR.js';
import FolhaCompetenciaTela from '../telas/FolhaCompetenciaTela.vue';
import {
  acoesDaFracao,
  anosDecimo,
  escalaDaEmpresa,
  fimDoGozo,
  intervaloPadrao,
  opcoesAbono,
  opcoesDiasGozo,
  pagamentoPadraoDecimo,
  pagamentoPrevisto,
  periodoProgramavel,
  recusasDaProgramacao,
  saldoTotal,
  somarDias,
} from './comum-ferias.js';
import { mensagensDecimo, mensagensFerias } from './i18n.js';
import MinhasFeriasTela from './MinhasFeriasTela.vue';

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
  'pessoas.folha.abrir',
  'pessoas.folha.ler',
  'pessoas.ferias.ler',
  'pessoas.ferias.programar',
  'pessoas.ferias.calcular',
  'pessoas.decimo.calcular',
  'pessoas.salario.ler',
  'pessoas.colaborador.ler',
];
const plugins = (cliente: QueryClient) =>
  [
    criarI18n(mensagensWeb as unknown as Record<string, unknown>),
    ui,
    [VueQueryPlugin, { queryClient: cliente }],
  ] as never;
function montar(permissoes: readonly string[] = TODAS) {
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
  return mount(FolhaCompetenciaTela as never, {
    attachTo: document.body,
    global: { plugins: plugins(cliente), stubs: { RouterLink: { template: '<a><slot /></a>' } } },
  });
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
      const r = rota(p) ?? padrao(p);
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

const HOJE = '2026-10-27';
const apoioF0 = {
  hoje: HOJE,
  competenciaSugerida: '2026-09',
  gravacao: { ligada: true, motivo: null },
  acoes: { exportar: false, importar: false, afastamento: false, motivo: null, buscarColaborador: true },
  empresas: [{ codigo: 1, rotulo: 'Empresa Sintética' }],
  eventosPonto: [],
  motivosAfastamento: [],
  remessas: [],
};
const apoioCalculo = {
  hoje: HOJE,
  competenciaSugerida: '2026-09',
  gravacao: { ligada: true, motivo: null },
  acoes: { calcular: true, salario: true, verSalario: true, parametros: true, motivo: null },
  empresas: [{ codigo: 1, rotulo: 'Empresa Sintética' }],
  papeis: [],
};
const apoioFerias = (grava = true, verSalario = true) => ({
  hoje: HOJE,
  gravacao: { ligada: true, motivo: null },
  acoes: {
    programar: grava,
    calcularFerias: grava,
    calcularDecimo: grava,
    verSalario,
    motivo: null,
  },
  empresas: [{ codigo: 1, rotulo: 'Empresa Sintética' }],
});
const periodo = (inicio: string, fim: string, situacao: string, saldo: number, extra: object = {}) => ({
  inicio,
  fim,
  concessivoFim: somarDias(fim, 365),
  situacao,
  faltas: 0,
  direito: 30,
  gozados: 30 - saldo,
  abono: 0,
  programados: 0,
  saldo,
  avisos: [],
  competenciasSemCalculo: [],
  ...extra,
});
const fracao = (id: number, situacao: string, extra: object = {}) => ({
  id,
  vinculo: 11,
  empresa: 1,
  aquisitivoInicio: '2025-01-10',
  aquisitivoFim: '2026-01-09',
  inicio: '2026-12-01',
  fim: '2026-12-20',
  dias: 20,
  abono: 10,
  dobra: 0,
  adiantarDecimo: false,
  pagamento: '2026-11-29',
  situacao,
  processo: situacao === 'calculada' ? 40 : null,
  motivo: null,
  registradoPor: 'SINT.DP.FOLHA',
  registradoEm: '2026-10-20T09:00:00',
  situacaoPor: null,
  situacaoEm: null,
  versao: 2,
  ...extra,
});
const saldo = (ferias: object[] = []) => ({
  hoje: HOJE,
  vinculo: 11,
  matricula: 'S-011',
  temDireito: true,
  periodos: [
    periodo('2025-01-10', '2026-01-09', 'aberto', 30, {
      avisos: ['competencias-sem-calculo'],
      competenciasSemCalculo: ['2025-02'],
    }),
    periodo('2026-01-10', '2027-01-09', 'em-aquisicao', 0),
  ],
  ferias,
});
const totais = {
  colaboradores: 1,
  proventos: 400000,
  descontos: 40000,
  liquido: 360000,
  inss: 40000,
  irrf: 0,
  fgts: 32000,
  inssPatronal: 80000,
  rat: 8000,
  terceiros: 23200,
};
const conferencia = {
  ok: true,
  parcelas: [
    { rotulo: 'proventos', valor: 400000 },
    { rotulo: 'descontos', valor: 40000 },
    { rotulo: 'liquido', valor: 360000 },
  ],
  divergencias: [],
};
const processo = (id: number, tipo: string, situacao = 'calculada') => ({
  id,
  empresa: 1,
  competencia: tipo === 'decimo2' ? '2026-12' : '2026-11',
  tipo,
  numero: id,
  situacao,
  pagamento: tipo === 'decimo1' ? '2026-11-30' : tipo === 'decimo2' ? '2026-12-20' : '2026-11-29',
  totais,
  tabelaLegal: '2026-01-01',
  parametros: '2026-01-01',
  foraDaFolha: 0,
  resumo: 'c'.repeat(64),
  calculadoPor: 'SINT.DP.FOLHA',
  calculadoEm: '2026-10-27T10:00:00',
  situacaoPor: null,
  situacaoEm: null,
  motivo: null,
  versao: 0,
});
const linha = (papel: string, tipo: string, valor: number, memoria = 'conta sintética') => ({
  papel,
  tipo,
  rubrica: tipo === 'provento' || tipo === 'desconto' ? 101 : null,
  codigoRubrica: tipo === 'provento' || tipo === 'desconto' ? 7 : null,
  quantidade: 0,
  unidade: 'valor',
  valor,
  memoria,
});
const linhasRecibo = [
  linha('feriasGozo', 'provento', 200000, 'R$ 3.000,00 ÷ 30 × 20 dias'),
  linha('feriasTerco', 'provento', 66667),
  linha('abonoPecuniario', 'provento', 100000),
  linha('abonoTerco', 'provento', 33333),
  linha('inssFerias', 'desconto', 40000),
];
const colaborador = {
  vinculo: 11,
  matricula: 'S-011',
  centroCusto: 5,
  diasPagos: 0,
  proventos: 400000,
  descontos: 40000,
  liquido: 360000,
  baseInss: 266667,
  baseIrrf: 226667,
  baseFgts: 266667,
  inss: 40000,
  irrf: 0,
  fgts: 21333,
  encargos: 50000,
};

function padrao(p: Pedido): Resposta {
  if (p.url.endsWith('/calculo/apoio')) return { corpo: apoioCalculo };
  if (p.url.endsWith('/folha/apoio')) return { corpo: apoioF0 };
  if (p.url.endsWith('/ferias/apoio')) return { corpo: apoioFerias() };
  if (p.url.includes('/folha/ferias?'))
    return { corpo: { itens: [fracao(3, 'programada')], limitado: false } };
  if (p.url.includes('/ferias/saldo')) return { corpo: saldo([fracao(3, 'programada')]) };
  if (p.url.includes('/folha/decimo')) return { corpo: { itens: [], limitado: false } };
  if (p.url.includes('/calculos')) return { corpo: { itens: [], limitado: false } };
  if (p.url.includes('/parametros')) return { corpo: { empresa: 1, itens: [] } };
  return { corpo: { itens: [] } };
}
const clicar = async (seletor: string) => {
  const b = document.querySelector<HTMLElement>(seletor);
  expect(b, seletor).not.toBeNull();
  b!.click();
  await flushPromises();
};
/** Escolhe a opção do combo pelo valor (o OpenVue anexa a lista ao body e escolhe no mousedown). */
const escolher = async (testid: string, valor: string) => {
  document.querySelector<HTMLElement>(`[data-testid="${testid}"] [role="combobox"]`)!.click();
  await flushPromises();
  await nextTick();
  const opcao = document.body.querySelector<HTMLElement>(`[role="option"]:has([data-valor="${valor}"])`);
  expect(opcao, `opção ${valor} em ${testid}`).not.toBeNull();
  opcao!.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
  await flushPromises();
};
const texto = (seletor: string) => document.querySelector(seletor)?.textContent ?? '';
async function abrirAba(w: ReturnType<typeof montar>, aba: 'ferias' | 'decimo') {
  await flushPromises();
  await flushPromises();
  await w.find(`[data-testid="folha-aba-${aba}"]`).trigger('click');
  await flushPromises();
  await flushPromises();
}

describe('comuns de férias e 13º', () => {
  it('datas do gozo e do pagamento, intervalo e opções de dias e abono', () => {
    expect(somarDias('2026-12-31', 1)).toBe('2027-01-01');
    expect(somarDias('2026-03-01', -1)).toBe('2026-02-28');
    expect(fimDoGozo('2026-12-01', 20)).toBe('2026-12-20');
    expect(pagamentoPrevisto('2026-12-01')).toBe('2026-11-29');
    expect(intervaloPadrao('2026-10-27')).toEqual({ de: '2026-10-27', ate: '2027-02-24' });
    expect(opcoesDiasGozo(30)[0]).toBe(30);
    expect(opcoesDiasGozo(30).at(-1)).toBe(5);
    expect(opcoesDiasGozo(3)).toEqual([3]);
    expect(opcoesDiasGozo(0)).toEqual([]);
    expect(opcoesAbono({ direito: 30, saldo: 30, abono: 0 })).toHaveLength(11);
    expect(opcoesAbono({ direito: 24, saldo: 24, abono: 0 }).at(-1)).toBe(8);
    expect(opcoesAbono({ direito: 30, saldo: 20, abono: 10 })).toEqual([0]);
    expect(opcoesAbono({ direito: 30, saldo: 1, abono: 0 })).toEqual([0]);
  });

  it('recusas da resposta, ações da fração, escala, saldo e datas do 13º', () => {
    const e = new ErroApi(
      {
        title: 'Operação recusada',
        status: 409,
        codigo: 'fracao-minima',
        recusas: ['fracao-minima', 'sobreposicao', 'outra'],
      } as never,
      409,
    );
    expect(recusasDaProgramacao(e)).toEqual(['fracao-minima', 'sobreposicao']);
    expect(
      recusasDaProgramacao(new ErroApi({ title: 'x', status: 409, codigo: 'tres-fracoes' } as never, 409)),
    ).toEqual(['tres-fracoes']);
    expect(
      recusasDaProgramacao(new ErroApi({ title: 'x', status: 409, codigo: 'desatualizado' } as never, 409)),
    ).toEqual([]);
    expect(recusasDaProgramacao(new Error('x'))).toEqual([]);
    const a = apoioFerias() as never;
    expect(acoesDaFracao(fracao(1, 'programada') as never, a)).toEqual({
      calcular: true,
      cancelar: true,
      recibo: false,
    });
    expect(acoesDaFracao(fracao(1, 'calculada') as never, a)).toEqual({
      calcular: false,
      cancelar: true,
      recibo: true,
    });
    expect(acoesDaFracao(fracao(1, 'cancelada') as never, a)).toEqual({
      calcular: false,
      cancelar: false,
      recibo: false,
    });
    const soProgramar = {
      ...apoioFerias(),
      acoes: { ...apoioFerias().acoes, calcularFerias: false },
    } as never;
    expect(acoesDaFracao(fracao(1, 'calculada') as never, soProgramar).cancelar).toBe(false);
    expect(acoesDaFracao(fracao(1, 'programada') as never, soProgramar).cancelar).toBe(true);
    const desligada = { ...apoioFerias(), gravacao: { ligada: false, motivo: 'x' } } as never;
    expect(acoesDaFracao(fracao(1, 'programada') as never, desligada)).toEqual({
      calcular: false,
      cancelar: false,
      recibo: false,
    });
    const xs = [
      fracao(2, 'programada', { inicio: '2026-12-10' }),
      fracao(1, 'programada', { empresa: 2 }),
      fracao(3, 'programada', { inicio: '2026-11-10' }),
    ] as never[];
    expect(escalaDaEmpresa(xs, 1).map((f) => (f as { id: number }).id)).toEqual([3, 2]);
    expect(escalaDaEmpresa(xs, null)).toHaveLength(3);
    const ps = saldo().periodos as never[];
    expect(saldoTotal([...ps, periodo('2024-01-10', '2025-01-09', 'vencido', 5)] as never[])).toBe(35);
    expect(periodoProgramavel(ps[0]!)).toBe(true);
    expect(periodoProgramavel(ps[1]!)).toBe(false);
    expect(pagamentoPadraoDecimo(2026, 1)).toBe('2026-11-30');
    expect(pagamentoPadraoDecimo(2026, 2)).toBe('2026-12-20');
    expect(anosDecimo('2026-10-27')).toEqual([2026, 2025, 2024]);
  });

  it('todo código e situação do contrato tem texto, sem nome de outro sistema', () => {
    for (const c of RECUSAS_PROGRAMACAO_FERIAS) expect(mensagensFerias.recusa[c]).toBeTruthy();
    for (const c of AVISOS_PROGRAMACAO_FERIAS) expect(mensagensFerias.avisoProgramacao[c]).toBeTruthy();
    for (const c of AVISOS_CALCULO_FERIAS) expect(mensagensFerias.avisoCalculo[c]).toBeTruthy();
    for (const c of AVISOS_PERIODO_FERIAS) expect(mensagensFerias.aviso[c]).toBeTruthy();
    for (const c of SITUACOES_FERIAS) expect(mensagensFerias.situacoes[c]).toBeTruthy();
    for (const c of SITUACOES_PERIODO_AQUISITIVO) expect(mensagensFerias.situacaoPeriodo[c]).toBeTruthy();
    for (const c of AVISOS_DECIMO) expect(mensagensDecimo.aviso[c]).toBeTruthy();
    const tudo = JSON.stringify([mensagensFerias, mensagensDecimo]);
    expect(tudo).not.toMatch(/spdata|legado|sistema atual/i);
  });
});

describe('aba Férias', { timeout: 30_000 }, () => {
  it('escala → colaborador → saldo com avisos; programar com previsão e avisos da CLT', async () => {
    const pedidos = simular((p) => {
      if (p.url.endsWith('/folha/ferias') && p.metodo === 'POST')
        return {
          corpo: {
            ok: true,
            id: 4,
            mensagem: 'Férias programadas.',
            avisos: ['aviso-curto'],
            ferias: fracao(4, 'programada'),
          },
        };
      return null;
    });
    const w = montar();
    await abrirAba(w, 'ferias');
    expect(pedidos.some((p) => p.url.endsWith('/ferias/apoio'))).toBe(true);
    const escala = pedidos.find((p) => p.url.includes('/folha/ferias?'));
    expect(escala?.url).toContain('de=2026-10-27');
    expect(escala?.url).toContain('ate=2027-02-24');
    // A empresa escolhida vai ao servidor (o filtro não fica no navegador depois do teto).
    expect(escala?.url).toMatch(/empresa=\d+/);
    expect(w.find('[data-testid="folha-ferias-escala-3"]').text()).toContain('01/12/2026 – 20/12/2026');
    await w.find('[data-testid="folha-ferias-ver-3"]').trigger('click');
    await flushPromises();
    await flushPromises();
    expect(pedidos.some((p) => p.url.endsWith('/ferias/saldo?vinculo=11'))).toBe(true);
    expect(w.find('[data-testid="folha-ferias-escolhido"]').text()).toContain('Matrícula S-011');
    const per = w.find('[data-testid="folha-ferias-periodo-2025-01-10"]');
    expect(per.text()).toContain('Aberto');
    expect(per.text()).toContain('30 d');
    expect(per.find('[data-testid="folha-ferias-periodo-aviso-competencias-sem-calculo"]').text()).toContain(
      '02/2025',
    );
    // Período em aquisição: sem programar.
    expect(w.find('[data-testid="folha-ferias-programar-2026-01-10"]').exists()).toBe(false);
    expect(w.find('[data-testid="folha-ferias-fracao-3"]').text()).toContain('Programadas');
    await w.find('[data-testid="folha-ferias-programar-2025-01-10"]').trigger('click');
    await flushPromises();
    const gravar = () =>
      document.querySelector('[data-testid="folha-ferias-gravar"]')?.hasAttribute('disabled');
    expect(gravar()).toBe(true);
    const data = document.querySelector<HTMLInputElement>('[data-testid="folha-ferias-inicio"] input')!;
    data.value = '01/12/2026';
    data.dispatchEvent(new Event('input'));
    data.dispatchEvent(new Event('blur'));
    data.dispatchEvent(new Event('change'));
    await flushPromises();
    await escolher('folha-ferias-dias', '20');
    await escolher('folha-ferias-abono', '10');
    expect(texto('[data-testid="folha-ferias-previsao"]')).toContain(
      'Gozo de 01/12/2026 a 20/12/2026; pagamento até 29/11/2026.',
    );
    expect(gravar()).toBe(false);
    await clicar('[data-testid="folha-ferias-gravar"]');
    expect(pedidos.find((p) => p.metodo === 'POST')?.corpo).toEqual({
      vinculo: 11,
      empresa: 1,
      aquisitivoInicio: '2025-01-10',
      inicio: '2026-12-01',
      dias: 20,
      abono: 10,
      adiantarDecimo: false,
    });
    expect(w.find('[data-testid="folha-ferias-aviso"]').text()).toContain('Férias programadas.');
    expect(w.find('[data-testid="folha-ferias-avisos-programacao"]').text()).toContain(
      'aviso de férias é de 30 dias',
    );
  });

  it('recusas da CLT aparecem todas, traduzidas, e o diálogo segue aberto', async () => {
    simular((p) =>
      p.url.endsWith('/folha/ferias') && p.metodo === 'POST'
        ? {
            status: 409,
            corpo: {
              type: 'recusa-de-negocio',
              title: 'Operação recusada',
              status: 409,
              detail: 'Cada fração de férias tem no mínimo 5 dias.',
              codigo: 'vespera-de-descanso',
              campos: ['inicio'],
              recusas: ['vespera-de-descanso', 'fracao-quatorze'],
            },
          }
        : null,
    );
    const w = montar();
    await abrirAba(w, 'ferias');
    await w.find('[data-testid="folha-ferias-ver-3"]').trigger('click');
    await flushPromises();
    await flushPromises();
    await w.find('[data-testid="folha-ferias-programar-2025-01-10"]').trigger('click');
    await flushPromises();
    const data = document.querySelector<HTMLInputElement>('[data-testid="folha-ferias-inicio"] input')!;
    data.value = '04/12/2026';
    data.dispatchEvent(new Event('input'));
    data.dispatchEvent(new Event('blur'));
    data.dispatchEvent(new Event('change'));
    await flushPromises();
    await clicar('[data-testid="folha-ferias-gravar"]');
    expect(texto('[data-testid="folha-ferias-recusa-vespera-de-descanso"]')).toContain(
      'sexta-feira ou sábado',
    );
    expect(texto('[data-testid="folha-ferias-recusa-fracao-quatorze"]')).toContain('14 dias ou mais');
    expect(document.querySelector('[data-testid="folha-ferias-form"]')).not.toBeNull();
  });

  it('prévia do recibo com a memória e a prova; calcula depois da confirmação; cancela com motivo', async () => {
    let calculado = false;
    const pedidos = simular((p) => {
      if (p.url.includes('/ferias/saldo'))
        return { corpo: saldo([fracao(3, calculado ? 'calculada' : 'programada')]) };
      if (p.url.endsWith('/ferias/3/calculo')) {
        const sim = (p.corpo as { simular: boolean }).simular;
        if (!sim) calculado = true;
        return {
          corpo: {
            calculado: !sim,
            simulado: sim,
            ferias: fracao(3, sim ? 'programada' : 'calculada'),
            processo: sim ? null : processo(40, 'ferias'),
            pendencias: [],
            avisos: [{ codigo: 'folha-mensal-calculada', competencias: ['2026-12'] }],
            resumo: colaborador,
            linhas: linhasRecibo,
            conferencia,
          },
        };
      }
      if (p.url.endsWith('/ferias/3/cancelamento'))
        return { corpo: { ok: true, id: 3, mensagem: 'Férias canceladas.' } };
      return null;
    });
    const w = montar();
    await abrirAba(w, 'ferias');
    await w.find('[data-testid="folha-ferias-ver-3"]').trigger('click');
    await flushPromises();
    await flushPromises();
    await w.find('[data-testid="folha-ferias-previa-3"]').trigger('click');
    await flushPromises();
    expect(pedidos.find((p) => p.url.endsWith('/ferias/3/calculo'))?.corpo).toEqual({
      versao: 2,
      simular: true,
    });
    expect(texto('[data-testid="folha-ferias-recibo-linha-feriasTerco"]')).toContain('R$ 666,67');
    expect(texto('[data-testid="folha-ferias-recibo-linha-feriasGozo"]')).toContain('÷ 30 × 20 dias');
    expect(texto('[data-testid="folha-ferias-recibo-prova"]')).toContain(
      'R$ 4.000,00 − R$ 400,00 = R$ 3.600,00',
    );
    expect(texto('[data-testid="folha-ferias-recibo-avisos"]')).toContain('12/2026');
    await clicar('[data-testid="folha-ferias-calcular"]');
    expect(pedidos.filter((p) => p.url.endsWith('/ferias/3/calculo'))).toHaveLength(1);
    await clicar('[data-testid="folha-ferias-confirmar"]');
    expect(pedidos.filter((p) => p.url.endsWith('/ferias/3/calculo'))[1]?.corpo).toEqual({
      versao: 2,
      simular: false,
    });
    expect(w.find('[data-testid="folha-ferias-aviso"]').text()).toContain('cálculo 40');
    expect(texto('[data-testid="folha-ferias-recibo-pdf"]')).toContain('Aviso e recibo (PDF)');
    await flushPromises();
    // Recibo calculado: o PDF na linha e o cancelamento (quem calcula), com motivo.
    expect(w.find('[data-testid="folha-ferias-pdf-3"]').attributes('href')).toBe(
      '/api/pessoas/folha/ferias/3/recibo/pdf',
    );
    expect(w.find('[data-testid="folha-ferias-previa-3"]').exists()).toBe(false);
    await w.find('[data-testid="folha-ferias-cancelar-3"]').trigger('click');
    await flushPromises();
    const confirmar = () =>
      document.querySelector('[data-testid="folha-ferias-confirmar-cancelamento"]')?.hasAttribute('disabled');
    expect(confirmar()).toBe(true);
    const motivo = document.querySelector<HTMLInputElement>('[data-testid="folha-ferias-motivo"] input')!;
    motivo.value = 'Remarcação sintética';
    motivo.dispatchEvent(new Event('input'));
    await flushPromises();
    expect(confirmar()).toBe(false);
    await clicar('[data-testid="folha-ferias-confirmar-cancelamento"]');
    expect(pedidos.find((p) => p.url.endsWith('/ferias/3/cancelamento'))?.corpo).toEqual({
      versao: 2,
      motivo: 'Remarcação sintética',
    });
    expect(w.find('[data-testid="folha-ferias-aviso"]').text()).toContain('Férias canceladas.');
  });

  it('recibo gravado sem a permissão do salário: sem valores nem PDF; consulta sem programar, calcular nem cancelar', async () => {
    simular((p) => {
      if (p.url.endsWith('/ferias/apoio')) return { corpo: apoioFerias(false, false) };
      if (p.url.includes('/ferias/saldo')) return { corpo: saldo([fracao(3, 'calculada')]) };
      if (p.url.endsWith('/ferias/3'))
        return {
          corpo: {
            ferias: fracao(3, 'calculada'),
            processo: processo(40, 'ferias'),
            linhas: [],
            linhasOcultas: true,
          },
        };
      return null;
    });
    const w = montar(['pessoas.folha.abrir', 'pessoas.folha.ler', 'pessoas.ferias.ler']);
    await abrirAba(w, 'ferias');
    // Sem a busca de colaborador: só pela escala.
    expect(w.find('[data-testid="folha-ferias-termo"]').exists()).toBe(false);
    await w.find('[data-testid="folha-ferias-ver-3"]').trigger('click');
    await flushPromises();
    await flushPromises();
    expect(w.find('[data-testid="folha-ferias-programar-2025-01-10"]').exists()).toBe(false);
    expect(w.find('[data-testid="folha-ferias-cancelar-3"]').exists()).toBe(false);
    expect(w.find('[data-testid="folha-ferias-pdf-3"]').exists()).toBe(false);
    await w.find('[data-testid="folha-ferias-recibo-3"]').trigger('click');
    await flushPromises();
    expect(texto('[data-testid="folha-ferias-recibo-oculto"]')).toContain('não consulta salário');
    expect(document.querySelector('[data-testid="folha-ferias-recibo-pdf"]')).toBeNull();
    expect(document.querySelector('[data-testid="folha-ferias-calcular"]')).toBeNull();
  });

  it('sem a permissão de férias, a aba não aparece; a do 13º, sim', async () => {
    simular(() => null);
    const w = montar(['pessoas.folha.abrir', 'pessoas.folha.ler']);
    await flushPromises();
    await flushPromises();
    expect(w.find('[data-testid="folha-aba-ferias"]').exists()).toBe(false);
    expect(w.find('[data-testid="folha-aba-decimo"]').exists()).toBe(true);
  });
});

describe('aba 13º salário', { timeout: 30_000 }, () => {
  it('prévia com avisos e a prova; calcula depois da confirmação; lista do ano e memória do colaborador', async () => {
    let gravado = false;
    const pedidos = simular((p) => {
      if (p.url.endsWith('/folha/decimo') && p.metodo === 'POST') {
        const sim = (p.corpo as { simular: boolean }).simular;
        if (!sim) gravado = true;
        return {
          corpo: {
            calculado: !sim,
            simulado: sim,
            processo: sim ? null : processo(50, 'decimo1'),
            pendencias: [],
            totais,
            colaboradores: [colaborador],
            conferencia,
            substituido: null,
            avisos: [{ codigo: 'competencias-sem-calculo', competencias: ['2026-03'] }],
          },
        };
      }
      if (p.url.includes('/folha/decimo?'))
        return { corpo: { itens: gravado ? [processo(50, 'decimo1')] : [], limitado: false } };
      if (p.url.endsWith('/calculos/50'))
        return {
          corpo: {
            processo: processo(50, 'decimo1'),
            colaboradores: [colaborador],
            colaboradoresOcultos: false,
            conferencia,
          },
        };
      if (p.url.endsWith('/calculos/50/vinculos/11'))
        return {
          corpo: {
            processo: 50,
            vinculo: 11,
            matricula: 'S-011',
            linhas: [linha('decimoPrimeira', 'provento', 150000, '10/12 avos × 50%')],
          },
        };
      return null;
    });
    const w = montar();
    await abrirAba(w, 'decimo');
    expect(pedidos.some((p) => p.url.includes('/folha/decimo?empresa=1&ano=2026'))).toBe(true);
    expect(w.find('[data-testid="folha-decimo-nenhum"]').exists()).toBe(true);
    await w.find('[data-testid="folha-decimo-previa"]').trigger('click');
    await flushPromises();
    expect(pedidos.find((p) => p.metodo === 'POST')?.corpo).toEqual({
      empresa: 1,
      ano: 2026,
      parcela: 1,
      pagamento: '2026-11-30',
      simular: true,
    });
    expect(w.find('[data-testid="folha-decimo-visto-previa"]').exists()).toBe(true);
    expect(w.find('[data-testid="folha-decimo-conta"]').text()).toContain(
      'R$ 4.000,00 − R$ 400,00 = R$ 3.600,00',
    );
    expect(w.find('[data-testid="folha-decimo-aviso-competencias-sem-calculo"]').text()).toContain('03/2026');
    expect(w.find('[data-testid="folha-decimo-memoria-11"]').exists()).toBe(false);
    await w.find('[data-testid="folha-decimo-calcular"]').trigger('click');
    await flushPromises();
    expect(pedidos.filter((p) => p.metodo === 'POST')).toHaveLength(1);
    await clicar('[data-testid="folha-decimo-confirmar"]');
    await flushPromises();
    expect(pedidos.filter((p) => p.metodo === 'POST')[1]?.corpo).toMatchObject({
      simular: false,
      parcela: 1,
    });
    expect(w.find('[data-testid="folha-decimo-aviso"]').text()).toContain('cálculo 50');
    expect(w.find('[data-testid="folha-decimo-processo-50"]').text()).toContain('1ª parcela');
    expect(w.find('[data-testid="folha-decimo-visto-gravado"]').text()).toContain('1ª parcela em vigor');
    expect(w.find('[data-testid="folha-decimo-pdf"]').attributes('href')).toBe(
      '/api/pessoas/folha/calculos/50/conferencia/pdf',
    );
    await w.find('[data-testid="folha-decimo-memoria-11"]').trigger('click');
    await flushPromises();
    expect(texto('[data-testid="folha-decimo-linha-decimoPrimeira"]')).toContain('10/12 avos');
    expect(texto('[data-testid="folha-decimo-prova"]')).toContain('R$ 1.500,00 − R$ 0,00 = R$ 1.500,00');
    // O descarte da parcela vai pela rota do 13º (a permissão do 13º), não pela do cálculo mensal.
    await w.find('[data-testid="folha-decimo-descartar"]').trigger('click');
    await flushPromises();
    const motivo = document.querySelector<HTMLInputElement>('[data-testid="folha-decimo-motivo"] input')!;
    motivo.value = 'Descarte sintético';
    motivo.dispatchEvent(new Event('input'));
    await flushPromises();
    await clicar('[data-testid="folha-decimo-confirmar-descarte"]');
    expect(pedidos.find((p) => p.url.endsWith('/folha/decimo/50/descarte'))?.corpo).toEqual({
      versao: 0,
      motivo: 'Descarte sintético',
    });
    expect(pedidos.some((p) => p.url.includes('/calculos/50/descarte'))).toBe(false);
  });

  it('parcela final: a data padrão de 20 de dezembro; data de outro ano barra; consulta só vê a lista', async () => {
    simular((p) => {
      if (p.url.endsWith('/ferias/apoio')) return { corpo: apoioFerias(false, false) };
      if (p.url.includes('/folha/decimo?'))
        return { corpo: { itens: [processo(51, 'decimo2', 'descartada')], limitado: false } };
      return null;
    });
    const w = montar(['pessoas.folha.abrir', 'pessoas.folha.ler']);
    await abrirAba(w, 'decimo');
    expect(w.find('[data-testid="folha-decimo-previa"]').exists()).toBe(false);
    expect(w.find('[data-testid="folha-decimo-calcular"]').exists()).toBe(false);
    expect(w.find('[data-testid="folha-decimo-processo-51"]').text()).toContain('Parcela final');
    expect(w.find('[data-testid="folha-decimo-processo-51"]').text()).toContain('Descartado');
  });

  it('quem calcula: a parcela final muda a data padrão para 20/12', async () => {
    const pedidos = simular((p) =>
      p.url.endsWith('/folha/decimo') && p.metodo === 'POST'
        ? {
            corpo: {
              calculado: false,
              simulado: true,
              processo: null,
              pendencias: [{ codigo: 'sem-salario', papel: null, vinculos: [11] }],
              totais: null,
              colaboradores: [],
              conferencia: null,
              substituido: null,
              avisos: [],
            },
          }
        : null,
    );
    const w = montar();
    await abrirAba(w, 'decimo');
    const radio = w.findAll('[data-testid="folha-decimo-parcela"] input[type="radio"]')[1]!;
    await radio.setValue(true);
    await flushPromises();
    await w.find('[data-testid="folha-decimo-previa"]').trigger('click');
    await flushPromises();
    expect(pedidos.find((p) => p.metodo === 'POST')?.corpo).toMatchObject({
      parcela: 2,
      pagamento: '2026-12-20',
    });
    // Pendência barra: nada aparece como calculado.
    expect(w.find('[data-testid="folha-decimo-pendencia-sem-salario"]').text()).toContain('11');
    expect(w.find('[data-testid="folha-decimo-visto-previa"]').exists()).toBe(false);
  });
});

describe('minhas férias (autosserviço)', { timeout: 30_000 }, () => {
  const montarMinhas = (vinculo: string | null) =>
    mount(MinhasFeriasTela as never, {
      attachTo: document.body,
      global: {
        plugins: plugins(new QueryClient({ defaultOptions: { queries: { retry: false } } })),
        provide: { [routeLocationKey as symbol]: { query: vinculo ? { vinculo } : {} } },
        stubs: { RouterLink: { template: '<a><slot /></a>' } },
      },
    });

  it('saldo, períodos e frações do próprio vínculo, sem valores', async () => {
    const pedidos = simular((p) =>
      p.url.startsWith('/api/pessoas/meu/ferias')
        ? {
            corpo: {
              hoje: HOJE,
              disponivel: true,
              mensagem: null,
              saldo: saldo([fracao(3, 'calculada')]),
            },
          }
        : null,
    );
    const w = montarMinhas('11');
    await flushPromises();
    await flushPromises();
    expect(pedidos[0]?.url).toBe('/api/pessoas/meu/ferias?vinculo=11');
    expect(w.find('[data-testid="minhas-ferias-saldo"]').text()).toContain('30 dia(s)');
    expect(w.find('[data-testid="minhas-ferias-periodo-2025-01-10"]').text()).toContain('Aberto');
    expect(w.find('[data-testid="minhas-ferias-fracao-3"]').text()).toContain('29/11/2026');
    expect(w.text()).not.toContain('R$');
  });

  it('folha desligada: só a frase', async () => {
    simular((p) =>
      p.url.startsWith('/api/pessoas/meu/ferias')
        ? {
            corpo: {
              hoje: HOJE,
              disponivel: false,
              mensagem: 'As suas férias aparecem aqui quando a folha de pagamento estiver liberada.',
              saldo: null,
            },
          }
        : null,
    );
    const w = montarMinhas(null);
    await flushPromises();
    await flushPromises();
    expect(w.find('[data-testid="minhas-ferias-indisponivel"]').text()).toContain('folha de pagamento');
    expect(w.find('[data-testid="minhas-ferias-periodos"]').exists()).toBe(false);
  });
});
