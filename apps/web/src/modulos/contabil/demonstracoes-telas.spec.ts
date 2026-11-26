// @vitest-environment jsdom
// Telas da contabilidade, etapa 3 (M54.3): os comuns (saldo com D/C, intervalos, exercícios, CPF, rascunho e corpo do
// SPED, ISO-8859-1, tamanho, endereço da exportação); a tela das demonstrações (desligada com o motivo; o balancete
// com as parcelas, os avisos de período aberto e de desequilíbrio, o link ao razão; o diário paginado; a DRE; o
// balanço com o resultado não apurado; a exportação; a apuração com a senha e a recusa conhecida); e a tela do SPED
// (desligada com o motivo; sem cifra; a prévia com os impedimentos; a geração com os problemas antes do servidor e o
// corpo certo; a lista com salvar, recibo e cancelamento). Dados SINTÉTICOS (CPF de teste); o fetch é simulado.
import type {
  ApoioDemonstracoes,
  ApoioSped,
  ArquivoSpedListado,
  Balancete,
  Balanco,
  Diario,
  Dre,
  PreviaApuracao,
  PreviaSped,
} from '@sgh/contratos';
import { criarI18n, instalarUi, resolverMarca, SanteSelecao } from '@sgh/ui';
import { QueryClient, VueQueryPlugin } from '@tanstack/vue-query';
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { App, Component } from 'vue';
import { CHAVE_SESSAO } from '../../casca/sessao/sessao.js';
import { mensagensWeb } from '../../i18n/pt-BR.js';
import { urlExportacao } from './api-demonstracoes.js';
import {
  competenciasDoExercicio,
  corpoDoSped,
  cpfValido,
  exerciciosAte,
  intervaloDoAno,
  latin1,
  mesesEntre,
  novoRascunhoSped,
  problemaDoIntervalo,
  problemasDoSped,
  saldoDC,
  tamanhoBr,
} from './comum-demonstracoes.js';
import AbaRazao from './AbaRazao.vue';
import DemonstracoesTela from './DemonstracoesTela.vue';
import SpedTela from './SpedTela.vue';

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
const clienteCom = (permissoes?: readonly string[]) => {
  const c = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  if (permissoes)
    c.setQueryData(CHAVE_SESSAO, {
      usuario: { id: '1', nome: 'Sintético', login: 'SINT.CONTADOR' },
      rede: 'r',
      estabelecimentos: [{ codigo: 'pc', nome: 'PC' }],
      estabelecimentoAtivo: 'pc',
      permissoes,
      sintetica: true,
      bloqueioInatividadeSegundos: 0,
    });
  return c;
};
const montar = (
  tela: Component,
  props: Record<string, unknown> = { hoje: '2026-10-28' },
  permissoes?: readonly string[],
) =>
  mount(tela as never, {
    attachTo: document.body,
    props: props as never,
    global: {
      plugins: [
        criarI18n(mensagensWeb as unknown as Record<string, unknown>),
        ui,
        [VueQueryPlugin, { queryClient: clienteCom(permissoes) }],
      ] as never,
      stubs: { RouterLink: { props: ['to'], template: '<a :href="to"><slot /></a>' } },
    },
  });

type Pedido = { url: string; metodo: string; corpo: unknown };
type Resposta = { status?: number; corpo: unknown; binario?: boolean };
function simular(rota: (url: string, metodo: string) => Resposta | null): Pedido[] {
  const pedidos: Pedido[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      const metodo = init?.method ?? 'GET';
      pedidos.push({ url: String(url), metodo, corpo: init?.body ? JSON.parse(String(init.body)) : null });
      const r = rota(String(url), metodo) ?? { status: 404, corpo: { codigo: 'nao-encontrado' } };
      if (r.binario)
        return new Response(new Uint8Array([0x50, 0x4b]), {
          status: 200,
          headers: { 'content-disposition': 'attachment; filename="dre-1-2026-01-a-2026-10.xlsx"' },
        });
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
const salvos: string[] = [];
URL.createObjectURL = vi.fn(() => 'blob:sintetico');
URL.revokeObjectURL = vi.fn();
HTMLAnchorElement.prototype.click = function (this: HTMLAnchorElement) {
  salvos.push(this.download);
};
afterEach(() => {
  vi.unstubAllGlobals();
  document.body.innerHTML = '';
  salvos.length = 0;
});

async function escolher(w: VueWrapper, testid: string, valor: unknown) {
  const c = w.findAllComponents(SanteSelecao).find((x) => x.attributes('data-testid') === testid);
  if (!c) throw new Error(`combo ${testid} não achado`);
  c.vm.$emit('update:modelValue', valor);
  await flushPromises();
}
async function digitar(w: VueWrapper, testid: string, texto: string) {
  const el = w.find(`[data-testid="${testid}"] input, [data-testid="${testid}"] textarea`);
  await el.setValue(texto);
  await flushPromises();
}
const clicar = async (w: VueWrapper, testid: string) => {
  await w.find(`[data-testid="${testid}"]`).trigger('click');
  await flushPromises();
};

// ── Dados sintéticos ─────────────────────────────────────────────────────────────────────────────
const APOIO: ApoioDemonstracoes = {
  ligada: true,
  motivo: null,
  empresas: [1],
  hoje: '2026-10-28',
  niveis: 5,
  centros: [
    { codigo: 3, nome: 'Administração', ativo: true },
    { codigo: 12, nome: 'Centro cirúrgico', ativo: true },
    { codigo: 40, nome: 'Unidade desativada', ativo: false },
  ],
  podeApurar: true,
  podeVerSped: true,
  tipos: [],
};
const BALANCETE: Balancete = {
  empresa: 1,
  de: '2026-01',
  ate: '2026-10',
  nivel: null,
  centroCusto: null,
  linhas: [
    {
      codigo: '1',
      nome: 'Ativo',
      nivel: 1,
      tipo: 'sintetica',
      grupo: 'ativo',
      natureza: 'devedora',
      saldoAnteriorCentavos: 0,
      debitosCentavos: 100_000,
      creditosCentavos: 30_000,
      saldoFinalCentavos: 70_000,
      foraDoPlano: false,
    },
    {
      codigo: '1.1.2.01.0001',
      nome: 'Clientes sintéticos',
      nivel: 5,
      tipo: 'analitica',
      grupo: 'ativo',
      natureza: 'devedora',
      saldoAnteriorCentavos: 0,
      debitosCentavos: 100_000,
      creditosCentavos: 30_000,
      saldoFinalCentavos: 70_000,
      foraDoPlano: false,
    },
    {
      codigo: '3.1.1.01.0001',
      nome: 'Receita sintética',
      nivel: 5,
      tipo: 'analitica',
      grupo: 'receita',
      natureza: 'credora',
      saldoAnteriorCentavos: 0,
      debitosCentavos: 0,
      creditosCentavos: 70_000,
      saldoFinalCentavos: -70_000,
      foraDoPlano: false,
    },
  ],
  totais: {
    saldoAnteriorDevedorCentavos: 0,
    saldoAnteriorCredorCentavos: 0,
    debitosCentavos: 100_000,
    creditosCentavos: 100_000,
    saldoFinalDevedorCentavos: 70_000,
    saldoFinalCredorCentavos: 70_000,
  },
  equilibrado: true,
  conferencia: ['Débitos R$ 1.000,00 = créditos R$ 1.000,00'],
  competenciasAbertas: ['2026-10'],
};
const DIARIO: Diario = {
  empresa: 1,
  de: '2026-10-01',
  ate: '2026-10-31',
  lancamentos: [
    {
      id: 7,
      data: '2026-10-10',
      tipo: 'estorno',
      tipoRotulo: 'Estorno',
      historico: 'Estorno sintético',
      debitosCentavos: 5_000,
      creditosCentavos: 5_000,
      estornaId: 3,
      partidas: [
        {
          lado: 'D',
          conta: '3.1.1.01.0001',
          contaNome: 'Receita sintética',
          valorCentavos: 5_000,
          centroCusto: 12,
          historico: '',
        },
        {
          lado: 'C',
          conta: '1.1.2.01.0001',
          contaNome: 'Clientes sintéticos',
          valorCentavos: 5_000,
          centroCusto: null,
          historico: '',
        },
      ],
    },
  ],
  totais: { lancamentos: 201, debitosCentavos: 9_000, creditosCentavos: 9_000 },
  parcelas: [{ tipo: 'estorno', lancamentos: 201, debitosCentavos: 9_000 }],
  conferencia: 'Débitos = créditos',
  pagina: 1,
  parcial: true,
};
const DRE: Dre = {
  empresa: 1,
  de: '2026-01',
  ate: '2026-10',
  linhas: [
    {
      chave: 'receitaBruta',
      rotulo: 'Receita bruta',
      valorCentavos: 100_000,
      total: false,
      parcelas: [{ codigo: '3.1', nome: 'Receita de serviços', valorCentavos: 100_000 }],
    },
    {
      chave: 'resultado',
      rotulo: 'Resultado do exercício',
      valorCentavos: -2_000,
      total: true,
      parcelas: [],
    },
  ],
  resultadoCentavos: -2_000,
  rotuloResultado: 'Déficit',
  conferencia: 'Receitas − custos − despesas = −20,00',
};
const BALANCO: Balanco = {
  empresa: 1,
  competencia: '2026-10',
  data: '2026-10-31',
  ativo: {
    rotulo: 'Ativo',
    totalCentavos: 70_000,
    parcelas: [{ codigo: '1.1', nome: 'Circulante', valorCentavos: 70_000 }],
  },
  passivo: { rotulo: 'Passivo', totalCentavos: 0, parcelas: [] },
  patrimonioLiquido: { rotulo: 'Patrimônio líquido', totalCentavos: 0, parcelas: [] },
  resultadoExercicioCentavos: 70_000,
  resultadoAnterioresCentavos: 0,
  totalAtivoCentavos: 70_000,
  totalPassivoPlCentavos: 70_000,
  compensacao: null,
  equilibrado: true,
  conferencia: 'Ativo = passivo + PL',
};
const PREVIA: PreviaApuracao = {
  empresa: 1,
  exercicio: '2025',
  data: '2025-12-31',
  receitasCentavos: 100_000,
  custosCentavos: 0,
  despesasCentavos: 30_000,
  resultadoCentavos: 70_000,
  conferencia: '1.000,00 − 0,00 − 300,00 = 700,00',
  partidas: 3,
  apuracaoAtiva: null,
  impedimentos: [],
  podeApurar: true,
  contasDestino: [{ codigo: '2.4.1.01.0001', nome: 'Superávits acumulados' }],
};

function rotasDemonstracoes(extra: (u: string, m: string) => Resposta | null = () => null) {
  return simular((u, m) => {
    const e = extra(u, m);
    if (e) return e;
    if (u.includes('/demonstracoes/apoio')) return { corpo: APOIO };
    if (u.includes('/demonstracoes/balancete')) return { corpo: BALANCETE };
    if (u.includes('/demonstracoes/diario')) return { corpo: DIARIO };
    if (u.includes('/demonstracoes/dre')) return { corpo: DRE };
    if (u.includes('/demonstracoes/balanco')) return { corpo: BALANCO };
    if (u.includes('/demonstracoes/exportar')) return { corpo: null, binario: true };
    if (u.includes('/demonstracoes/apuracao/apurar'))
      return {
        corpo: { ok: true, id: 9, resultadoCentavos: 70_000, mensagem: 'Resultado de 2025 apurado.' },
      };
    if (u.includes('/demonstracoes/apuracao')) return { corpo: PREVIA };
    return null;
  });
}

describe('comuns das demonstrações e do SPED', () => {
  it('saldo com D/C, intervalos, exercícios e meses', () => {
    expect(saldoDC(70_000)).toBe('R$ 700,00 D');
    expect(saldoDC(-70_000)).toBe('R$ 700,00 C');
    expect(saldoDC(0)).toBe('R$ 0,00');
    expect(intervaloDoAno('2026-10-28')).toEqual({ de: '2026-01', ate: '2026-10' });
    expect(competenciasDoExercicio(2025)).toHaveLength(12);
    expect(competenciasDoExercicio(2025)[11]).toBe('2025-12');
    expect(exerciciosAte('2026-10-28', 3)).toEqual([2026, 2025, 2024]);
    expect(mesesEntre('2025-01', '2025-12')).toBe(12);
    expect(mesesEntre('2025-11', '2026-02')).toBe(4);
    expect(problemaDoIntervalo(null, '2025-01')).toBe('intervaloIncompleto');
    expect(problemaDoIntervalo('2025-03', '2025-01')).toBe('inicioDepoisDoFim');
    expect(problemaDoIntervalo('2025-01', '2026-01')).toBe('maisDe12Meses');
    expect(problemaDoIntervalo('2025-12-01', '2026-01-31')).toBeNull();
    expect(problemaDoIntervalo('2025-12', '2026-01', true)).toBe('exerciciosDiferentes');
  });

  it('CPF, rascunho, problemas e corpo do SPED; ISO-8859-1; tamanho; endereço da exportação', () => {
    expect(cpfValido('123.456.789-09')).toBe(true);
    expect(cpfValido('12345678900')).toBe(false);
    expect(cpfValido('11111111111')).toBe(false);
    const r = novoRascunhoSped('ecf', 2025);
    expect(r.signatarios.map((s) => s.qualificacao)).toEqual(['900', '203']);
    const p = problemasDoSped(r).map((x) => `${x.chave}${x.n ?? ''}`);
    expect(p).toEqual(
      expect.arrayContaining(['formaTributacao', 'tipoEntidade', 'nome1', 'cpf1', 'crc1', 'nome2']),
    );
    r.formaTributacao = '9';
    r.tipoEntidadeEcf = '04';
    r.substituta = true;
    r.signatarios[0] = {
      nome: 'Contador Sintético',
      cpf: '123.456.789-09',
      qualificacao: '900',
      crc: 'SP000000',
      email: 'x',
      telefone: '11 9999',
    };
    r.signatarios[1] = {
      ...r.signatarios[0]!,
      qualificacao: '203',
      crc: '',
      email: '',
      telefone: '(11) 3333-4444',
    };
    expect(problemasDoSped(r).map((x) => `${x.chave}${x.n ?? ''}`)).toEqual([
      'hashAnterior',
      'email1',
      'telefone1',
    ]);
    r.hashAnterior = ' ABC123 ';
    r.signatarios[0]!.email = 'contador@exemplo.test';
    r.signatarios[0]!.telefone = '';
    expect(problemasDoSped(r)).toEqual([]);
    expect(corpoDoSped(1, r)).toMatchObject({
      tipo: 'ecf',
      numeroOrdem: 1,
      hashAnterior: 'ABC123',
      formaTributacao: '9',
      tipoEntidadeEcf: '04',
      signatarios: [
        { cpf: '12345678909', crc: 'SP000000', email: 'contador@exemplo.test', telefone: null },
        { cpf: '12345678909', crc: null, telefone: '1133334444' },
      ],
    });
    const ecd = novoRascunhoSped('ecd', 2025);
    ecd.numeroOrdem = '0';
    ecd.signatarios = [ecd.signatarios[0]!];
    expect(problemasDoSped(ecd).map((x) => x.chave)).toEqual(
      expect.arrayContaining(['numeroOrdem', 'doisSignatarios', 'semResponsavel']),
    );
    expect(corpoDoSped(1, { ...ecd, signatarios: [] })).toMatchObject({
      formaTributacao: null,
      tipoEntidadeEcf: null,
      hashAnterior: null,
    });
    expect([...latin1('Ação€')]).toEqual([0x41, 0xe7, 0xe3, 0x6f, 0x3f]);
    expect(tamanhoBr(500)).toBe('500 B');
    expect(tamanhoBr(2048)).toBe('2,0 KB');
    expect(tamanhoBr(3 * 1024 * 1024)).toBe('3,0 MB');
    const u = urlExportacao(
      {
        tipo: 'balancete',
        empresa: 1,
        de: '2026-01',
        ate: '2026-10',
        nivel: 2,
        incluirZeradas: false,
        centroCusto: null,
      },
      'pdf',
    );
    expect(u).toBe(
      '/api/contabil/demonstracoes/exportar?tipo=balancete&formato=pdf&empresa=1&de=2026-01&ate=2026-10&nivel=2',
    );
    expect(
      urlExportacao(
        {
          tipo: 'balancete',
          empresa: 1,
          de: '2026-01',
          ate: '2026-10',
          nivel: null,
          incluirZeradas: true,
          centroCusto: 5,
        },
        'xlsx',
      ),
    ).toContain('incluirZeradas=true&centroCusto=5');
  });
});

describe('tela das demonstrações', () => {
  it('desligada: o motivo e nada mais', async () => {
    rotasDemonstracoes((u) =>
      u.includes('/apoio')
        ? { corpo: { ...APOIO, ligada: false, motivo: 'Contabilidade desligada (sintético).' } }
        : null,
    );
    const w = montar(DemonstracoesTela);
    await flushPromises();
    expect(w.find('[data-testid="contabil-desligada"]').text()).toContain('desligada (sintético)');
    expect(w.find('[data-testid="aba-balancete"]').exists()).toBe(false);
  });

  it('balancete: consulta com o filtro, D/C, sintética, abertas, conferência, exportação e o razão', async () => {
    const pedidos = rotasDemonstracoes();
    const w = montar(DemonstracoesTela);
    await flushPromises();
    expect(w.find('[data-testid="balancete-escolha"]').exists()).toBe(true);
    await escolher(w, 'balancete-nivel', 5);
    await w.find('[data-testid="balancete-zeradas"]').setValue(true);
    // O centro de custo é uma seleção com busca (ADR 0027): "todos" e os centros do apoio, com o inativo marcado.
    const combo = w
      .findAllComponents(SanteSelecao)
      .find((x) => x.attributes('data-testid') === 'balancete-centro')!;
    const props = combo.props() as { busca?: boolean; opcoes: { valor: number | null; rotulo: string }[] };
    expect(props.busca).toBe(true);
    const opcoes = props.opcoes;
    expect(opcoes.map((o) => o.valor)).toEqual([null, 3, 12, 40]);
    expect(opcoes[0]!.rotulo).toBe('Todos os centros');
    expect(opcoes[2]!.rotulo).toBe('12 · Centro cirúrgico');
    expect(opcoes[3]!.rotulo).toContain('(inativo)');
    await escolher(w, 'balancete-centro', 12);
    await clicar(w, 'balancete-consultar');
    const ped = pedidos.find((p) => p.url.includes('/balancete'))!;
    expect(ped.url).toContain('de=2026-01&ate=2026-10&nivel=5&incluirZeradas=true&centroCusto=12');
    expect(w.find('[data-testid="balancete-linha-3.1.1.01.0001"]').text()).toContain('R$ 700,00 C');
    expect(w.find('[data-testid="balancete-linha-1"]').classes()).toContain('sintetica');
    expect(w.find('[data-testid="balancete-abertas"]').text()).toContain('10/2026');
    expect(w.find('[data-testid="balancete-conferencia"]').text()).toContain('Débitos R$ 1.000,00');
    expect(w.find('[data-testid="balancete-desequilibrado"]').exists()).toBe(false);
    await clicar(w, 'exportar-balancete-xlsx');
    expect(pedidos.some((p) => p.url.includes('/exportar?tipo=balancete&formato=xlsx'))).toBe(true);
    expect(salvos).toEqual(['dre-1-2026-01-a-2026-10.xlsx']);
    expect(w.find('[data-testid="balancete-razao-1"]').exists()).toBe(false);
    expect(w.find('[data-testid="balancete-razao-1.1.2.01.0001"]').exists()).toBe(true);
    await clicar(w, 'balancete-razao-1.1.2.01.0001');
  });

  it('do balancete ao razão: a conta e o intervalo já consultados', async () => {
    const pedidos = simular((u) =>
      u.includes('/contabil/razao') ? { corpo: { conta: '1.1.2.01.0001', movimentos: [] } } : null,
    );
    const apoio = {
      contas: [{ codigo: '1.1.2.01.0001', nome: 'Clientes', natureza: 'devedora', exigeCentroCusto: false }],
    };
    montar(AbaRazao, {
      apoio,
      empresa: 1,
      hoje: '2026-10-28',
      contaInicial: '1.1.2.01.0001',
      deInicial: '2026-01-01',
      ateInicial: '2026-10-31',
    });
    await flushPromises();
    const r = pedidos.find((p) => p.url.includes('/razao'))!;
    expect(r.url).toContain('conta=1.1.2.01.0001&de=2026-01-01&ate=2026-10-31');
  });

  it('balancete desequilibrado e com centro de custo: os avisos', async () => {
    rotasDemonstracoes((u) =>
      u.includes('/balancete')
        ? { corpo: { ...BALANCETE, equilibrado: false, competenciasAbertas: [] } }
        : null,
    );
    const w = montar(DemonstracoesTela);
    await flushPromises();
    await clicar(w, 'balancete-consultar');
    expect(w.find('[data-testid="balancete-desequilibrado"]').exists()).toBe(true);
    expect(w.find('[data-testid="balancete-abertas"]').exists()).toBe(false);
  });

  it('diário: as partidas, as parcelas, a próxima página e a exportação do intervalo inteiro', async () => {
    const pedidos = rotasDemonstracoes();
    const w = montar(DemonstracoesTela);
    await flushPromises();
    await clicar(w, 'demonstracoes-aba-diario');
    await clicar(w, 'diario-consultar');
    const l = w.find('[data-testid="diario-lancamento-7"]');
    expect(l.text()).toContain('estorna o lançamento 3');
    expect(l.text()).toContain('Receita sintética');
    expect(w.find('[data-testid="diario-parcelas"]').text()).toContain('Estorno: 201 lançamento(s)');
    await clicar(w, 'diario-proxima-pagina');
    expect(pedidos.some((p) => p.url.includes('/diario') && p.url.includes('pagina=2'))).toBe(true);
    await clicar(w, 'exportar-diario-pdf');
    const exp = pedidos.find((p) => p.url.includes('/exportar'))!;
    expect(exp.url).toContain('tipo=diario&formato=pdf');
    expect(exp.url).not.toContain('pagina');
  });

  it('DRE: o mesmo exercício, as parcelas e o déficit; balanço com o resultado não apurado', async () => {
    rotasDemonstracoes();
    const w = montar(DemonstracoesTela);
    await flushPromises();
    await clicar(w, 'demonstracoes-aba-dre');
    await escolher(w, 'dre-de', '2025-12');
    expect(w.find('[data-testid="dre-problema"]').text()).toContain('um só exercício');
    await escolher(w, 'dre-de', '2026-01');
    await clicar(w, 'dre-consultar');
    expect(w.find('[data-testid="dre-linha-receitaBruta"]').text()).toContain('Receita de serviços');
    expect(w.find('[data-testid="dre-resultado"]').text()).toBe('Déficit: R$ 20,00');
    await clicar(w, 'demonstracoes-aba-balanco');
    await clicar(w, 'balanco-consultar');
    expect(w.find('[data-testid="balanco-resultado-exercicio"]').text()).toContain('R$ 700,00');
    expect(w.find('[data-testid="balanco-resultado-anteriores"]').exists()).toBe(false);
    expect(w.find('[data-testid="balanco-desequilibrado"]').exists()).toBe(false);
    expect(w.find('[data-testid="balanco-conferencia"]').text()).toBe('Ativo = passivo + PL');
  });

  it('apuração: a prévia, apurar com a senha e o destino; a recusa conhecida; sem a permissão, só a prévia', async () => {
    let recusar = false;
    const pedidos = rotasDemonstracoes((u, m) =>
      recusar && m === 'POST' && u.includes('/apurar')
        ? {
            status: 409,
            corpo: { tipo: 'recusa-de-negocio', titulo: 'x', status: 409, codigo: 'ja-apurado' },
          }
        : null,
    );
    const w = montar(DemonstracoesTela);
    await flushPromises();
    await clicar(w, 'demonstracoes-aba-apuracao');
    expect(pedidos.some((p) => p.url.includes('/apuracao?empresa=1&exercicio=2025'))).toBe(true);
    expect(w.find('[data-testid="apuracao-resultado"]').text()).toBe('Superávit de R$ 700,00');
    expect(w.find('[data-testid="apuracao-confirmar"]').attributes('disabled')).toBeDefined();
    await w.find('[data-testid="apuracao-senha"]').setValue('senha-sintetica');
    await clicar(w, 'apuracao-confirmar');
    const p = pedidos.find((x) => x.metodo === 'POST')!;
    expect(p.corpo).toMatchObject({
      empresa: 1,
      exercicio: 2025,
      contaDestino: '2.4.1.01.0001',
      senha: 'senha-sintetica',
    });
    expect(w.find('[data-testid="apuracao-mensagem"]').text()).toContain('apurado');
    recusar = true;
    await w.find('[data-testid="apuracao-senha"]').setValue('senha-sintetica');
    await clicar(w, 'apuracao-confirmar');
    expect(w.find('[data-testid="recusa-contabil"]').text()).toContain('estorne a apuração');
  });

  it('apuração impedida e sem a permissão de encerrar', async () => {
    rotasDemonstracoes((u) =>
      u.includes('/demonstracoes/apoio')
        ? { corpo: { ...APOIO, podeApurar: false } }
        : u.includes('/apuracao')
          ? {
              corpo: {
                ...PREVIA,
                podeApurar: false,
                apuracaoAtiva: 4,
                impedimentos: [{ codigo: 'ja-apurado', mensagem: 'Já apurado (sintético).', quantidade: 1 }],
              },
            }
          : null,
    );
    const w = montar(DemonstracoesTela);
    await flushPromises();
    await clicar(w, 'demonstracoes-aba-apuracao');
    expect(w.find('[data-testid="apuracao-ativa"]').text()).toContain('lançamento 4');
    expect(w.find('[data-testid="apuracao-impedimento-ja-apurado"]').exists()).toBe(true);
    expect(w.find('[data-testid="apuracao-sem-permissao"]').exists()).toBe(true);
    expect(w.find('[data-testid="apuracao-apurar"]').exists()).toBe(false);
  });
});

// ── SPED ─────────────────────────────────────────────────────────────────────────────────────────
const APOIO_SPED: ApoioSped = {
  ligada: true,
  motivo: null,
  empresas: [1],
  hoje: '2026-10-28',
  podeGerar: true,
  cifraDisponivel: true,
  leiautes: { ecd: '9.00', ecf: '0011' },
  formasTributacao: [
    { codigo: '1', rotulo: 'Lucro real', gerada: true },
    { codigo: '5', rotulo: 'Lucro presumido', gerada: false },
    { codigo: '9', rotulo: 'Isenta do IRPJ', gerada: true },
  ],
  qualificacoes: [
    { codigo: '203', rotulo: 'Diretor' },
    { codigo: '900', rotulo: 'Contador' },
  ],
};
const PREVIA_SPED: PreviaSped = {
  empresa: 1,
  tipo: 'ecd',
  exercicio: 2025,
  leiaute: '9.00',
  impedimentos: [],
  avisos: ['Conta sem referencial e sem saldo (sintético).'],
  podeGerar: true,
  registros: [
    { registro: '0000', quantidade: 1 },
    { registro: 'I200', quantidade: 3 },
  ],
  linhas: 42,
};
const ARQ: ArquivoSpedListado = {
  id: 5,
  empresa: 1,
  tipo: 'ecd',
  exercicio: 2025,
  numero: 1,
  situacao: 'gerado',
  leiaute: '9.00',
  leiauteConferido: false,
  nomeArquivo: 'ECD_2025_1.txt',
  linhas: 42,
  tamanho: 2048,
  hash: 'a'.repeat(64),
  substituta: false,
  geradoPor: 'SINT.CONTADOR',
  geradoEm: '2026-10-28T10:00:00',
  recibo: null,
  transmitidoEm: null,
  motivo: null,
};
function rotasSped(extra: (u: string, m: string) => Resposta | null = () => null) {
  return simular((u, m) => {
    const e = extra(u, m);
    if (e) return e;
    if (u.includes('/sped/apoio')) return { corpo: APOIO_SPED };
    if (u.includes('/sped/previa')) return { corpo: PREVIA_SPED };
    if (u.includes('/sped/gerar'))
      return {
        corpo: {
          ok: true,
          id: 6,
          numero: 2,
          hash: 'b'.repeat(64),
          linhas: 42,
          mensagem: 'ECD de 2025 gerada (sintético).',
        },
      };
    if (u.includes('/sped/arquivo'))
      return {
        corpo: { id: 5, nomeArquivo: 'ECD_2025_1.txt', hash: ARQ.hash, conteudo: '|0000|LECD|Ação|\r\n' },
      };
    if (u.includes('/sped/situacao'))
      return {
        corpo: { ok: true, mensagem: 'Arquivo transmitido.', arquivo: { ...ARQ, situacao: 'transmitido' } },
      };
    if (u.includes('/contabil/sped?')) return { corpo: { empresa: 1, itens: [ARQ] } };
    return null;
  });
}

describe('tela do SPED', () => {
  it('desligado: o motivo; sem cifra: o aviso e sem gerar', async () => {
    rotasSped((u) =>
      u.includes('/sped/apoio')
        ? { corpo: { ...APOIO_SPED, ligada: false, motivo: 'SPED desligado (sintético).' } }
        : null,
    );
    const w = montar(SpedTela);
    await flushPromises();
    expect(w.find('[data-testid="sped-desligado"]').text()).toContain('desligado (sintético)');
    expect(w.find('[data-testid="sped-arquivos"]').exists()).toBe(false);
    w.unmount();
    rotasSped((u) =>
      u.includes('/sped/apoio')
        ? { corpo: { ...APOIO_SPED, podeGerar: false, cifraDisponivel: false } }
        : null,
    );
    const w2 = montar(SpedTela);
    await flushPromises();
    expect(w2.find('[data-testid="sped-sem-cifra"]').exists()).toBe(true);
    await clicar(w2, 'sped-ver-previa');
    expect(w2.find('[data-testid="sped-gerar"]').exists()).toBe(false);
    expect(w2.find('[data-testid="sped-sem-permissao"]').text()).toContain('cifrada');
    expect(w2.find('[data-testid="sped-baixar-5"]').exists()).toBe(false);
  });

  it('prévia com impedimentos não deixa gerar', async () => {
    rotasSped((u) =>
      u.includes('/sped/previa')
        ? {
            corpo: {
              ...PREVIA_SPED,
              podeGerar: false,
              impedimentos: [
                { codigo: 'meses-abertos', mensagem: 'Meses abertos (sintético).', quantidade: 3 },
              ],
            },
          }
        : null,
    );
    const w = montar(SpedTela);
    await flushPromises();
    await clicar(w, 'sped-ver-previa');
    expect(w.find('[data-testid="sped-impedimento-meses-abertos"]').text()).toContain('(3)');
    expect(w.find('[data-testid="sped-gerar"]').exists()).toBe(false);
  });

  it('o atalho às tabelas do SPED só para quem lê o catálogo (sem a permissão, a rota recusaria)', async () => {
    rotasSped();
    const sem = montar(SpedTela, { hoje: '2026-10-28' }, ['contabil.sped.ler']);
    await flushPromises();
    expect(sem.find('[data-testid="sped-ver-previa"]').exists()).toBe(true);
    expect(sem.find('[data-testid="sped-tabelas"]').exists()).toBe(false);
    sem.unmount();
    rotasSped();
    const com = montar(SpedTela, { hoje: '2026-10-28' }, ['contabil.sped.ler', 'catalogo.item.ler']);
    await flushPromises();
    expect(com.find('[data-testid="sped-tabelas"]').attributes('href')).toBe('/contabil/sped/tabelas');
  });

  it('gerar a ECD: os problemas antes do servidor; o corpo certo; a mensagem', async () => {
    const pedidos = rotasSped();
    const w = montar(SpedTela);
    await flushPromises();
    expect(w.find('[data-testid="sped-leiaute"]').text()).toContain('9.00');
    await clicar(w, 'sped-ver-previa');
    expect(pedidos.some((p) => p.url.includes('/sped/previa?empresa=1&tipo=ecd&exercicio=2025'))).toBe(true);
    expect(w.find('[data-testid="sped-previa-resumo"]').text()).toContain('42 linhas em 2');
    expect(w.find('[data-testid="sped-avisos"]').text()).toContain('sem referencial');
    await clicar(w, 'sped-gerar-confirmar');
    expect(w.find('[data-testid="sped-problemas"]').text()).toContain('Signatário 1');
    expect(pedidos.some((p) => p.metodo === 'POST')).toBe(false);
    await digitar(w, 'sped-sig-nome-1', 'Contador Sintético');
    await digitar(w, 'sped-sig-cpf-1', '123.456.789-09');
    await digitar(w, 'sped-sig-crc-1', 'SP000000');
    await digitar(w, 'sped-sig-nome-2', 'Diretor Sintético');
    await digitar(w, 'sped-sig-cpf-2', '12345678909');
    await clicar(w, 'sped-sig-incluir');
    expect(w.find('[data-testid="sped-signatario-3"]').exists()).toBe(true);
    await clicar(w, 'sped-sig-remover-3');
    expect(w.find('[data-testid="sped-signatario-3"]').exists()).toBe(false);
    await clicar(w, 'sped-gerar-confirmar');
    const g = pedidos.find((p) => p.metodo === 'POST' && p.url.includes('/sped/gerar'))!;
    expect(g.corpo).toMatchObject({
      empresa: 1,
      tipo: 'ecd',
      exercicio: 2025,
      numeroOrdem: 1,
      substituta: false,
      signatarios: [
        { nome: 'Contador Sintético', cpf: '12345678909', qualificacao: '900', crc: 'SP000000' },
        { nome: 'Diretor Sintético', qualificacao: '203', crc: null },
      ],
    });
    expect(w.find('[data-testid="sped-gerar-mensagem"]').text()).toContain('gerada');
  });

  it('ECF: a forma não gerada avisa e não envia', async () => {
    const pedidos = rotasSped();
    const w = montar(SpedTela);
    await flushPromises();
    await escolher(w, 'sped-tipo', 'ecf');
    await clicar(w, 'sped-ver-previa');
    await escolher(w, 'sped-forma', '5');
    expect(w.find('[data-testid="sped-forma-nao-gerada"]').text()).toContain('imunes e isentas');
    await clicar(w, 'sped-gerar-confirmar');
    expect(pedidos.some((p) => p.metodo === 'POST')).toBe(false);
  });

  it('arquivos: salvar em ISO-8859-1, registrar o recibo e cancelar com o motivo', async () => {
    const pedidos = rotasSped();
    const w = montar(SpedTela);
    await flushPromises();
    expect(w.find('[data-testid="sped-arquivo-5"]').text()).toContain('não conferido');
    await clicar(w, 'sped-baixar-5');
    expect(salvos).toEqual(['ECD_2025_1.txt']);
    await clicar(w, 'sped-recibo-5');
    expect(w.find('[data-testid="sped-acao-confirmar"]').attributes('disabled')).toBeDefined();
    await digitar(w, 'sped-recibo-numero', '12.34.56.78.90-12');
    await clicar(w, 'sped-acao-confirmar');
    const r = pedidos.find((p) => p.url.includes('/sped/situacao'))!;
    expect(r.corpo).toMatchObject({
      acao: 'recibo',
      empresa: 1,
      id: 5,
      recibo: '12.34.56.78.90-12',
      transmitidoEm: '2026-10-28',
    });
    expect(w.find('[data-testid="sped-arquivo-mensagem"]').text()).toBe('Arquivo transmitido.');
    await clicar(w, 'sped-cancelar-5');
    await digitar(w, 'sped-cancelar-motivo', 'gerado com o exercício errado (sintético)');
    await clicar(w, 'sped-acao-confirmar');
    const c = pedidos.filter((p) => p.url.includes('/sped/situacao'))[1]!;
    expect(c.corpo).toMatchObject({
      acao: 'cancelar',
      id: 5,
      motivo: 'gerado com o exercício errado (sintético)',
    });
  });
});
