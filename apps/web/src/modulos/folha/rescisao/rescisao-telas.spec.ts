// @vitest-environment jsdom
// Aba de rescisão (M53.5, etapa F4): os comuns (intervalo da fila, pagamento padrão, avisos por modalidade, termo do
// contrato a prazo, recusas da resposta, conta da multa, ações da rescisão); todo código do contrato tem texto, sem nome
// de outro sistema; a fila dos desligados com a modalidade sugerida → formulário → prévia com a apuração, a multa com as
// parcelas, a memória e os avisos → gravação depois da confirmação; recusas traduzidas; rescisão gravada sem a permissão
// do salário (sem valores nem PDF); cancelamento com motivo; sem a permissão da rescisão, a aba não aparece.
// Dados SINTÉTICOS; o fetch é simulado.
import {
  AVISOS_PREVIOS,
  AVISOS_RESCISAO,
  MODALIDADES_RESCISAO,
  parcelasMultaFgts,
  RECUSAS_RESCISAO,
  SITUACOES_RESCISAO,
  TIPOS_VINCULO_TRABALHO,
} from '@sgh/contratos';
import { criarI18n, instalarUi, resolverMarca } from '@sgh/ui';
import { QueryClient, VueQueryPlugin } from '@tanstack/vue-query';
import { flushPromises, mount } from '@vue/test-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { type App, nextTick } from 'vue';
import { ErroApi } from '../../../casca/erros/problem-details.js';
import { CHAVE_SESSAO } from '../../../casca/sessao/sessao.js';
import { mensagensWeb } from '../../../i18n/pt-BR.js';
import FolhaCompetenciaTela from '../telas/FolhaCompetenciaTela.vue';
import {
  acoesDaRescisao,
  avisosDa,
  casaColaborador,
  contaMulta,
  filtrarDesligados,
  intervaloDesligados,
  pagamentoPadrao,
  pedeTermo,
  recusasDaRescisao,
  termoObrigatorio,
  vinculoDaBusca,
} from './comum-rescisao.js';
import { mensagensRescisao } from './i18n.js';

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
  'pessoas.rescisao.ler',
  'pessoas.rescisao.calcular',
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
const MODS = [
  { modalidade: 'sem-justa-causa', avisos: ['indenizado', 'trabalhado'] },
  { modalidade: 'justa-causa', avisos: ['nenhum'] },
  { modalidade: 'pedido-demissao', avisos: ['trabalhado', 'dispensado', 'nao-cumprido'] },
  { modalidade: 'antecipada-empregador', avisos: ['nenhum'] },
];
const apoioRescisao = (calcular = true, verSalario = true, ligada = true) => ({
  hoje: HOJE,
  gravacao: { ligada, motivo: ligada ? null : 'A folha deste estabelecimento ainda não está ligada.' },
  acoes: { calcular, verSalario, motivo: null },
  empresas: [{ codigo: 1, rotulo: 'Empresa Sintética' }],
  modalidades: MODS,
  tiposRescisao: [{ id: 1, nome: 'Dispensa sintética', modalidade: 'sem-justa-causa' }],
});
const desligado = (vinculo: number, extra: object = {}) => ({
  vinculo,
  matricula: `S-${vinculo}`,
  tipo: 'clt',
  admissao: '2023-03-01',
  desligamento: '2026-10-20',
  tipoRescisao: 1,
  modalidadeSugerida: 'sem-justa-causa',
  rescisao: null,
  ...extra,
});
const rescisao = (id: number, extra: object = {}) => ({
  id,
  vinculo: 21,
  empresa: 1,
  desligamento: '2026-10-20',
  tipoRescisao: 1,
  modalidade: 'sem-justa-causa',
  aviso: 'indenizado',
  diasAviso: 36,
  diasIndenizados: 36,
  projecao: '2026-11-25',
  termo: null,
  saldoFgts: 1_000_000,
  saldoFgtsInformado: true,
  multaFgts: 400_000,
  pagamento: '2026-10-30',
  situacao: 'calculada',
  processo: 50,
  motivo: null,
  registradoPor: 'SINT.DP.FOLHA',
  registradoEm: '2026-10-27T10:00:00',
  situacaoPor: null,
  situacaoEm: null,
  versao: 0,
  ...extra,
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
const linhas = [
  linha('salario', 'provento', 200_000, 'R$ 3.000,00 ÷ 30 × 20 dias'),
  linha('avisoIndenizado', 'provento', 360_000),
  linha('decimoProporcional', 'provento', 250_000),
  linha('inss', 'desconto', 60_000),
  linha('multaFgts', 'informativa', 400_000),
];
const apuracao = {
  desligamento: '2026-10-20',
  competencia: '2026-10',
  diasAviso: 36,
  diasIndenizados: 36,
  projecao: '2026-11-25',
  anosCompletos: 2,
  diasSaldo: 20,
  avosDecimo: 10,
  avosDecimoAviso: 1,
  saldoFgts: 1_000_000,
  saldoFgtsInformado: true,
  fgtsRescisao: 0,
  percentualMulta: 4000,
  multaFgts: 400_000,
  pagamento: '2026-10-30',
};
const processo = (id: number) => ({
  id,
  empresa: 1,
  competencia: '2026-10',
  tipo: 'rescisao',
  numero: id,
  situacao: 'calculada',
  pagamento: '2026-10-30',
  tabelaLegal: '2026-01-01',
  parametros: '2026-01-01',
  foraDaFolha: 0,
  calculadoPor: 'SINT.DP.FOLHA',
  calculadoEm: '2026-10-27T10:00:00',
  situacaoPor: null,
  situacaoEm: null,
  motivo: null,
  versao: 0,
});
const resultado = (gravado: boolean, extra: object = {}) => ({
  calculado: gravado,
  simulado: !gravado,
  rescisao: gravado ? rescisao(7) : null,
  processo: gravado ? processo(50) : null,
  substituida: gravado ? 3 : null,
  apuracao,
  pendencias: [],
  avisos: [{ codigo: 'competencias-sem-calculo', competencias: ['2026-02'] }],
  resumo: null,
  linhas,
  conferencia: null,
  ...extra,
});

let apoioAtual = apoioRescisao();
function padrao(p: Pedido): Resposta {
  if (p.url.endsWith('/calculo/apoio')) return { corpo: apoioCalculo };
  if (p.url.endsWith('/folha/apoio')) return { corpo: apoioF0 };
  if (p.url.endsWith('/rescisoes/apoio')) return { corpo: apoioAtual };
  if (p.url.includes('/rescisoes/desligados'))
    return {
      corpo: {
        itens: [desligado(21), desligado(22, { tipo: 'pj', modalidadeSugerida: null })],
        limitado: false,
      },
    };
  if (p.url.includes('/rescisoes?')) return { corpo: { itens: [], limitado: false } };
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
  i.value = valor;
  i.dispatchEvent(new Event('input'));
  i.dispatchEvent(new Event('blur'));
  i.dispatchEvent(new Event('change'));
  await flushPromises();
};
const texto = (seletor: string) => document.querySelector(seletor)?.textContent ?? '';
const desabilitado = (testid: string) =>
  document.querySelector(`[data-testid="${testid}"]`)?.hasAttribute('disabled');
async function abrirAba(w: ReturnType<typeof montar>) {
  await flushPromises();
  await flushPromises();
  await w.find('[data-testid="folha-aba-rescisao"]').trigger('click');
  await flushPromises();
  await flushPromises();
}

describe('comuns da rescisão', () => {
  it('intervalo da fila, pagamento, avisos por modalidade, termo, recusas, multa e ações', () => {
    expect(intervaloDesligados('2026-10-27')).toEqual({ de: '2026-09-01', ate: '2026-10-27' });
    expect(intervaloDesligados('2026-01-05')).toEqual({ de: '2025-12-01', ate: '2026-01-05' });
    expect(pagamentoPadrao('2026-10-25')).toBe('2026-11-04');
    expect(avisosDa(null, null)).toEqual([]);
    expect(avisosDa('acordo', null)).toEqual(['indenizado', 'trabalhado']);
    expect(avisosDa('pedido-demissao', apoioRescisao() as never)).toEqual([
      'trabalhado',
      'dispensado',
      'nao-cumprido',
    ]);
    expect(pedeTermo('antecipada-empregado')).toBe(true);
    expect(pedeTermo('sem-justa-causa')).toBe(false);
    expect(termoObrigatorio('antecipada-empregador')).toBe(true);
    expect(termoObrigatorio('antecipada-empregado')).toBe(false);
    const erro = (problema: object) => new ErroApi(problema as never, 409);
    expect(
      recusasDaRescisao(
        erro({ codigo: 'aviso-invalido', recusas: ['aviso-invalido', 'pagamento-antes', 'x'] }),
      ),
    ).toEqual(['aviso-invalido', 'pagamento-antes']);
    expect(recusasDaRescisao(erro({ codigo: 'termo-obrigatorio' }))).toEqual(['termo-obrigatorio']);
    expect(recusasDaRescisao(erro({ codigo: 'desatualizado' }))).toEqual([]);
    expect(recusasDaRescisao(new Error('x'))).toEqual([]);
    expect(contaMulta(1_000_000, 0, 4000, 400_000)).toBe('R$ 10.000,00 × 40% = R$ 4.000,00');
    // Com o FGTS desta rescisão, as duas parcelas da base (D-MULTA-535).
    expect(contaMulta(1_000_000, 197_733, 4000, 479_093)).toBe(
      '(R$ 10.000,00 + R$ 1.977,33) × 40% = R$ 4.790,93',
    );
    expect(contaMulta(1_000_000, 0, 0, 0)).toBeNull();
    // Na gravada, as parcelas saem das linhas: o FGTS (mês e 13º) e o percentual da linha da multa.
    expect(
      parcelasMultaFgts([
        { papel: 'fgts', valor: 150_000, quantidade: 800 },
        { papel: 'multaFgts', valor: 479_093, quantidade: 4000 },
        { papel: 'salario', valor: 300_000, quantidade: 0 },
      ]),
    ).toEqual({ fgtsRescisao: 150_000, percentual: 4000 });
    expect(parcelasMultaFgts([])).toEqual({ fgtsRescisao: 0, percentual: 0 });
    // A busca do colaborador: trecho da matrícula (sem caixa) ou o número exato do vínculo.
    const fila = [desligado(21), desligado(210), desligado(5, { matricula: null })] as never[];
    expect(casaColaborador('', 1, null)).toBe(true);
    expect(casaColaborador('s-21', 21, 'S-21')).toBe(true);
    expect(casaColaborador('21', 210, 'S-210')).toBe(true);
    expect(casaColaborador('21', 5, null)).toBe(false);
    expect(filtrarDesligados(fila, '').length).toBe(3);
    expect(filtrarDesligados(fila, '5').map((d: { vinculo: number }) => d.vinculo)).toEqual([5]);
    expect(vinculoDaBusca(fila, ' ')).toBeUndefined();
    expect(vinculoDaBusca(fila, 'S-210')).toBe(210);
    expect(vinculoDaBusca(fila, '21')).toBeUndefined(); // casa com 21 e 210: o histórico filtra na tela
    expect(vinculoDaBusca(fila, '777')).toBe(777); // fora da fila: o número do vínculo
    expect(vinculoDaBusca(fila, 'ninguém')).toBeUndefined();
    const a = apoioRescisao() as never;
    expect(acoesDaRescisao(rescisao(1) as never, a)).toEqual({ cancelar: true, termo: true });
    expect(acoesDaRescisao(rescisao(1, { situacao: 'cancelada' }) as never, a)).toEqual({
      cancelar: false,
      termo: false,
    });
    expect(acoesDaRescisao(rescisao(1) as never, apoioRescisao(true, false, false) as never)).toEqual({
      cancelar: false,
      termo: false,
    });
  });

  it('todo código do contrato tem texto, sem nome de outro sistema', () => {
    for (const c of MODALIDADES_RESCISAO) expect(mensagensRescisao.modalidades[c]).toBeTruthy();
    for (const c of AVISOS_PREVIOS) expect(mensagensRescisao.avisos[c]).toBeTruthy();
    for (const c of RECUSAS_RESCISAO) expect(mensagensRescisao.recusa[c]).toBeTruthy();
    for (const c of AVISOS_RESCISAO) expect(mensagensRescisao.avisoCalculo[c]).toBeTruthy();
    for (const c of SITUACOES_RESCISAO) expect(mensagensRescisao.situacoes[c]).toBeTruthy();
    for (const c of TIPOS_VINCULO_TRABALHO) expect(mensagensRescisao.tipos[c]).toBeTruthy();
    expect(JSON.stringify(mensagensRescisao)).not.toMatch(/spdata|legado|sistema atual/i);
  });
});

describe('aba Rescisão', () => {
  afterEach(() => {
    apoioAtual = apoioRescisao();
  });

  it('fila → formulário → prévia com a apuração e a multa → grava depois da confirmação', async () => {
    const pedidos = simular((p) => {
      if (p.url.endsWith('/folha/rescisoes') && p.metodo === 'POST')
        return { corpo: resultado(!(p.corpo as { simular: boolean }).simular) };
      return null;
    });
    const w = montar();
    await abrirAba(w);
    expect(pedidos.some((p) => p.url.endsWith('/rescisoes/apoio'))).toBe(true);
    const fila = pedidos.find((p) => p.url.includes('/rescisoes/desligados'));
    expect(fila?.url).toContain('de=2026-09-01');
    expect(fila?.url).toContain('ate=2026-10-27');
    const linha21 = w.find('[data-testid="folha-rescisao-desligado-21"]');
    expect(linha21.text()).toContain('Matrícula S-21');
    expect(linha21.text()).toContain('Dispensa sem justa causa');
    expect(linha21.text()).toContain('A calcular');
    // Vínculo que não é CLT: sem calcular; sem sugestão: "A escolher".
    expect(w.find('[data-testid="folha-rescisao-calcular-22"]').exists()).toBe(false);
    expect(w.find('[data-testid="folha-rescisao-desligado-22"]').text()).toContain('A escolher');
    expect(w.find('[data-testid="folha-rescisao-historico-vazio"]').exists()).toBe(true);

    await w.find('[data-testid="folha-rescisao-calcular-21"]').trigger('click');
    await flushPromises();
    expect(texto('[data-testid="folha-rescisao-sugerida"]')).toContain('Dispensa sem justa causa');
    // O aviso padrão é o primeiro da modalidade; o pagamento, 10 dias depois do desligamento.
    expect(
      document.querySelector<HTMLInputElement>(
        '[data-testid="folha-rescisao-aviso-previo"] input[value="indenizado"]',
      )?.checked,
    ).toBe(true);
    expect(texto('[data-testid="folha-rescisao-form"]')).toContain('até 30/10/2026');
    await digitar('folha-rescisao-saldo', 'abc');
    expect(document.querySelector('[data-testid="folha-rescisao-saldo-invalido"]')).not.toBeNull();
    expect(desabilitado('folha-rescisao-previa')).toBe(true);
    await digitar('folha-rescisao-saldo', '10.000,00');
    expect(desabilitado('folha-rescisao-previa')).toBe(false);
    await clicar('[data-testid="folha-rescisao-previa"]');
    const previa = pedidos.find((p) => p.url.endsWith('/folha/rescisoes') && p.metodo === 'POST');
    expect(previa?.corpo).toEqual({
      vinculo: 21,
      empresa: 1,
      modalidade: 'sem-justa-causa',
      aviso: 'indenizado',
      termo: null,
      saldoFgts: 1_000_000,
      pagamento: '2026-10-30',
      simular: true,
    });
    const ap = texto('[data-testid="folha-rescisao-apuracao"]');
    expect(ap).toContain('36 dia(s) devidos (2 ano(s) completo(s) de serviço), 36 indenizado(s)');
    expect(ap).toContain('20/10/2026 + 36 dia(s) = 25/11/2026');
    expect(ap).toContain('10/12 avos, 1 sobre o aviso');
    expect(ap).toContain('R$ 10.000,00 × 40% = R$ 4.000,00 (saldo do extrato)');
    expect(texto('[data-testid="folha-rescisao-avisos"]')).toContain('02/2026');
    expect(texto('[data-testid="folha-rescisao-linha-avisoIndenizado"]')).toContain('R$ 3.600,00');
    await clicar('[data-testid="folha-rescisao-gravar"]');
    expect(texto('[data-testid="folha-rescisao-confirmacao"]')).toContain('substituída');
    await clicar('[data-testid="folha-rescisao-confirmar"]');
    const gravacoes = pedidos.filter((p) => p.url.endsWith('/folha/rescisoes') && p.metodo === 'POST');
    expect(gravacoes).toHaveLength(2);
    expect((gravacoes[1]!.corpo as { simular: boolean }).simular).toBe(false);
    expect(w.find('[data-testid="folha-rescisao-aviso"]').text()).toContain('cálculo 50');
    expect(w.find('[data-testid="folha-rescisao-aviso"]').text()).toContain('substituída');
    expect(document.querySelector('[data-testid="folha-rescisao-pdf"]')?.getAttribute('href')).toBe(
      '/api/pessoas/folha/rescisoes/7/termo/pdf',
    );
    expect(document.querySelector('[data-testid="folha-rescisao-gravar"]')).toBeNull();
  });

  it('modalidade com termo: o término é pedido; recusas traduzidas todas de uma vez; o diálogo segue aberto', async () => {
    const pedidos = simular((p) => {
      if (p.url.endsWith('/folha/rescisoes') && p.metodo === 'POST')
        return {
          status: 409,
          corpo: {
            type: 'about:blank',
            title: 'Operação recusada',
            status: 409,
            detail: 'x',
            codigo: 'termo-invalido',
            recusas: ['termo-invalido', 'pagamento-antes'],
          },
        };
      return null;
    });
    const w = montar();
    await abrirAba(w);
    await w.find('[data-testid="folha-rescisao-calcular-21"]').trigger('click');
    await flushPromises();
    expect(document.querySelector('[data-testid="folha-rescisao-termo"]')).toBeNull();
    await escolher('folha-rescisao-modalidade', 'antecipada-empregador');
    expect(document.querySelector('[data-testid="folha-rescisao-termo"]')).not.toBeNull();
    expect(
      document.querySelector<HTMLInputElement>(
        '[data-testid="folha-rescisao-aviso-previo"] input[value="nenhum"]',
      )?.checked,
    ).toBe(true);
    // Na antecipação pelo empregador, sem o término não há prévia.
    expect(desabilitado('folha-rescisao-previa')).toBe(true);
    await digitar('folha-rescisao-termo', '01/10/2026');
    expect(desabilitado('folha-rescisao-previa')).toBe(false);
    await clicar('[data-testid="folha-rescisao-previa"]');
    expect(pedidos.find((p) => p.metodo === 'POST')?.corpo).toMatchObject({
      modalidade: 'antecipada-empregador',
      aviso: 'nenhum',
      termo: '2026-10-01',
      saldoFgts: null,
    });
    const rs = texto('[data-testid="folha-rescisao-recusas"]');
    expect(rs).toContain('O término do contrato a prazo tem de vir depois do desligamento.');
    expect(rs).toContain('O pagamento não pode vir antes do desligamento.');
    expect(document.querySelector('[data-testid="folha-rescisao-form"]')).not.toBeNull();
  });

  it('pendência barra a gravação; histórico com o PDF; rescisão sem o salário não mostra valores; cancela com motivo', async () => {
    apoioAtual = apoioRescisao(true, false);
    const pedidos = simular((p) => {
      if (p.url.includes('/rescisoes/desligados'))
        return { corpo: { itens: [desligado(21, { rescisao: 7 })], limitado: false } };
      if (p.url.includes('/rescisoes?')) return { corpo: { itens: [rescisao(7)], limitado: false } };
      if (p.url.endsWith('/rescisoes/7'))
        return { corpo: { rescisao: rescisao(7), processo: processo(50), linhas: [], linhasOcultas: true } };
      if (p.url.endsWith('/rescisoes/7/cancelamento'))
        return { corpo: { ok: true, mensagem: 'Rescisão cancelada.' } };
      if (p.url.endsWith('/folha/rescisoes') && p.metodo === 'POST')
        return {
          corpo: resultado(false, {
            pendencias: [{ codigo: 'na-folha-mensal', papel: null, vinculo: 21 }],
            linhas: [],
          }),
        };
      return null;
    });
    const w = montar([
      'pessoas.folha.abrir',
      'pessoas.folha.ler',
      'pessoas.rescisao.ler',
      'pessoas.rescisao.calcular',
    ]);
    await abrirAba(w);
    const item = w.find('[data-testid="folha-rescisao-item-7"]');
    expect(item.text()).toContain('Calculada');
    expect(item.text()).not.toContain('R$');
    expect(w.find('[data-testid="folha-rescisao-pdf-7"]').exists()).toBe(false);
    expect(w.find('[data-testid="folha-rescisao-desligado-21"]').text()).toContain('Calculada');
    await w.find('[data-testid="folha-rescisao-ver-21"]').trigger('click');
    await flushPromises();
    expect(texto('[data-testid="folha-rescisao-oculto"]')).toContain('não consulta salário');
    expect(texto('[data-testid="folha-rescisao-apuracao"]')).not.toContain('R$');
    expect(document.querySelector('[data-testid="folha-rescisao-pdf"]')).toBeNull();
    // Recalcular com pendência: a prévia mostra, a gravação não aparece.
    await clicar('[data-testid="folha-rescisao-calcular-21"]');
    await clicar('[data-testid="folha-rescisao-previa"]');
    expect(texto('[data-testid="folha-rescisao-pendencias"]')).toContain('folha mensal calculada');
    expect(document.querySelector('[data-testid="folha-rescisao-gravar"]')).toBeNull();
    // Cancelamento com motivo.
    await w.find('[data-testid="folha-rescisao-cancelar-7"]').trigger('click');
    await flushPromises();
    expect(desabilitado('folha-rescisao-confirmar-cancelamento')).toBe(true);
    await digitar('folha-rescisao-motivo', 'Desligamento revisto');
    expect(desabilitado('folha-rescisao-confirmar-cancelamento')).toBe(false);
    await clicar('[data-testid="folha-rescisao-confirmar-cancelamento"]');
    expect(pedidos.find((p) => p.url.endsWith('/rescisoes/7/cancelamento'))?.corpo).toEqual({
      versao: 0,
      motivo: 'Desligamento revisto',
    });
    expect(w.find('[data-testid="folha-rescisao-aviso"]').text()).toContain('Rescisão cancelada.');
  });

  it('consulta: sem calcular nem cancelar; com o salário, a multa e o PDF na linha; chave desligada avisa', async () => {
    apoioAtual = apoioRescisao(false, true, false);
    simular((p) => {
      if (p.url.includes('/rescisoes?')) return { corpo: { itens: [rescisao(7)], limitado: true } };
      return null;
    });
    const w = montar([
      'pessoas.folha.abrir',
      'pessoas.folha.ler',
      'pessoas.rescisao.ler',
      'pessoas.salario.ler',
    ]);
    await abrirAba(w);
    expect(w.find('[data-testid="folha-rescisao-gravacao-desligada"]').exists()).toBe(true);
    expect(w.find('[data-testid="folha-rescisao-calcular-21"]').exists()).toBe(false);
    expect(w.find('[data-testid="folha-rescisao-cancelar-7"]').exists()).toBe(false);
    expect(w.find('[data-testid="folha-rescisao-item-7"]').text()).toContain('R$ 4.000,00');
    expect(w.find('[data-testid="folha-rescisao-pdf-7"]').attributes('href')).toBe(
      '/api/pessoas/folha/rescisoes/7/termo/pdf',
    );
    expect(w.find('[data-testid="folha-rescisao-historico"]').text()).toContain('estreite as datas');
  });

  it('a busca do colaborador filtra a fila e leva o vínculo ao histórico; a situação vai ao servidor', async () => {
    const pedidos = simular((p) => {
      if (p.url.includes('/rescisoes?'))
        return { corpo: { itens: [rescisao(7), rescisao(8, { vinculo: 22 })], limitado: false } };
      return null;
    });
    const w = montar();
    await abrirAba(w);
    expect(w.find('[data-testid="folha-rescisao-desligado-22"]').exists()).toBe(true);
    await digitar('folha-rescisao-busca', 's-21');
    expect(w.find('[data-testid="folha-rescisao-desligado-21"]').exists()).toBe(true);
    expect(w.find('[data-testid="folha-rescisao-desligado-22"]').exists()).toBe(false);
    // Um desligado só casa com a busca: o histórico é pedido com o vínculo dele, e a tela mostra só as dele.
    expect(pedidos.some((p) => p.url.includes('/rescisoes?') && p.url.includes('vinculo=21'))).toBe(true);
    expect(w.find('[data-testid="folha-rescisao-item-7"]').exists()).toBe(true);
    expect(w.find('[data-testid="folha-rescisao-item-8"]').exists()).toBe(false);
    await escolher('folha-rescisao-filtro-situacao', 'cancelada');
    expect(
      pedidos.some(
        (p) =>
          p.url.includes('/rescisoes?') &&
          p.url.includes('situacao=cancelada') &&
          p.url.includes('vinculo=21'),
      ),
    ).toBe(true);
    await digitar('folha-rescisao-busca', 'X-404');
    expect(w.find('[data-testid="folha-rescisao-fila-nenhum-busca"]').exists()).toBe(true);
  });

  it('sem a permissão da rescisão, a aba não aparece e o apoio não é pedido', async () => {
    const pedidos = simular(() => null);
    const w = montar(['pessoas.folha.abrir', 'pessoas.folha.ler']);
    await flushPromises();
    await flushPromises();
    expect(w.find('[data-testid="folha-aba-rescisao"]').exists()).toBe(false);
    expect(pedidos.some((p) => p.url.includes('/rescisoes'))).toBe(false);
  });
});
