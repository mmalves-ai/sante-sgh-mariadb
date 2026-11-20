// @vitest-environment jsdom
// Telas do patrimônio (M54, etapa 6): os comuns (valor digitado, competência anterior, conferência das parcelas,
// rascunho do cadastro com as conferências e o corpo estrito de cada documento, alteração a partir do bem); a tela dos
// bens (desligada com o motivo, abas conforme o perfil, filtros, totais com a conta, ficha pelo QR, alteração pela
// versão, baixa com o termo e a senha); o cadastro da nota em passos (corpo certo); a depreciação (parcelas com a
// conferência, impedimentos, calcular com confirmação); os movimentos (aceitar, recusar com motivo, registrar a
// transferência com a versão); o inventário (abrir, ler pela plaqueta, resumo com a conta, encerrar); os parâmetros
// (cadastros do perfil); e os textos (sem o outro sistema; todo código com rótulo). Dados SINTÉTICOS; o fetch é simulado.
import {
  type AjusteBem,
  type LaudoBem,
  type ApoioPatrimonio,
  type BemPatrimonial,
  CODIGOS_GRUPO_BEM,
  type DepreciacaoCompetencia,
  type DetalheInventario,
  MOTIVOS_SEM_COTA,
  type MovimentoBem,
  RESULTADOS_LEITURA_INVENTARIO,
  SITUACOES_BEM,
  SITUACOES_MOVIMENTO_BEM,
  TIPOS_AJUSTE_BEM,
  TIPOS_MOVIMENTO_BEM,
} from '@sgh/contratos';
import { criarI18n, instalarUi, resolverMarca, SanteSelecao } from '@sgh/ui';
import { QueryClient, VueQueryPlugin } from '@tanstack/vue-query';
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { App } from 'vue';
import { mensagensWeb } from '../../i18n/pt-BR.js';
import BensTela from './BensTela.vue';
import {
  centavosOuZero,
  competenciaAnterior,
  conferenciaDasParcelas,
  corpoDaAlteracao,
  corpoDoCadastro,
  hojeLocal,
  problemasDaAlteracao,
  problemasDoCadastro,
  rascunhoDoBem,
  rascunhoDoItem,
  rascunhoVazio,
  rotuloCentro,
  textoDosCentavos,
} from './comum-patrimonio.js';
import DepreciacaoTela from './DepreciacaoTela.vue';
import { mensagensPatrimonio } from './i18n.js';
import AjustesBem from './AjustesBem.vue';
import InventarioTela from './InventarioTela.vue';
import MovimentosTela from './MovimentosTela.vue';
import ParametrosTela from './ParametrosTela.vue';

const rotaAtual = { query: {} as Record<string, string> };
vi.mock('vue-router', async (original) => ({
  ...(await original<typeof import('vue-router')>()),
  useRoute: () => rotaAtual,
}));

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
const montar = (componente: unknown) =>
  mount(componente as never, {
    attachTo: document.body,
    props: { hoje: '2026-10-28' } as never,
    global: {
      plugins: [
        criarI18n(mensagensWeb as unknown as Record<string, unknown>),
        ui,
        [VueQueryPlugin, { queryClient: new QueryClient({ defaultOptions: { queries: { retry: false } } }) }],
      ] as never,
      stubs: {
        RouterLink: { props: ['to'], template: '<a :href="to"><slot /></a>' },
        DominioTela: {
          props: ['modulo', 'recurso'],
          template: '<div data-testid="dominio">{{ modulo }}.{{ recurso }}</div>',
        },
      },
    },
  });

type Pedido = { url: string; metodo: string; corpo: unknown };
type Resposta = { status?: number; corpo: unknown };
function simular(rota: (url: string, metodo: string) => Resposta | null = () => null): Pedido[] {
  const pedidos: Pedido[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      const metodo = init?.method ?? 'GET';
      pedidos.push({ url: String(url), metodo, corpo: init?.body ? JSON.parse(String(init.body)) : null });
      const r = rota(String(url), metodo) ?? base(String(url));
      return new Response(JSON.stringify(r.corpo), {
        status: r.status ?? 200,
        headers: { 'content-type': 'application/json' },
      });
    }),
  );
  return pedidos;
}
afterEach(() => {
  vi.unstubAllGlobals();
  rotaAtual.query = {};
  document.body.innerHTML = '';
});

async function escolher(w: VueWrapper, testid: string, valor: unknown) {
  const c = w.findAllComponents(SanteSelecao).find((x) => x.attributes('data-testid') === testid);
  if (!c) throw new Error(`combo ${testid} não achado`);
  c.vm.$emit('update:modelValue', valor);
  await flushPromises();
}
/** As props do combo (SanteSelecao é genérico: o wrapper não tipa as props pelo nome). */
function propsDoCombo(w: VueWrapper, testid: string): Record<string, unknown> {
  const c = w.findAllComponents(SanteSelecao).find((x) => x.attributes('data-testid') === testid);
  if (!c) throw new Error(`combo ${testid} não achado`);
  return c.vm.$props as unknown as Record<string, unknown>;
}
async function digitar(w: VueWrapper, testid: string, texto: string) {
  const el = w.find(
    `[data-testid="${testid}"] input, [data-testid="${testid}"] textarea, input[data-testid="${testid}"]`,
  );
  if (!el.exists()) throw new Error(`campo ${testid} não achado`);
  await el.setValue(texto);
  await flushPromises();
}
async function clicar(w: VueWrapper, testid: string) {
  const el = w.find(`[data-testid="${testid}"]`);
  if (!el.exists()) throw new Error(`botão ${testid} não achado`);
  await el.trigger('click');
  await flushPromises();
  await flushPromises();
}
async function confirmarDestrutivo() {
  const bs = document.querySelectorAll<HTMLElement>('[data-testid="confirmacao"] button');
  expect(bs.length).toBeGreaterThan(0);
  bs[bs.length - 1]!.click();
  await flushPromises();
  await flushPromises();
}
const posts = (ps: Pedido[], trecho: string) =>
  ps.filter((p) => p.metodo === 'POST' && p.url.includes(trecho));

// ── Dados sintéticos ─────────────────────────────────────────────────────────────────────────────────────────────────
const CENTROS = [
  { id: 10, codigo: 101, nome: 'UTI SINTÉTICA', ativo: true },
  { id: 11, codigo: 102, nome: 'ALA SINTÉTICA', ativo: true },
];
function apoio(
  m: Partial<ApoioPatrimonio['acoes']> = {},
  ligada = true,
  cadastros?: string[],
): ApoioPatrimonio {
  return {
    grupos: CODIGOS_GRUPO_BEM.map((g) => ({
      valor: g,
      rotulo: `Grupo ${g}`,
      vidaUtilMeses: 120,
      ativo: true,
    })),
    origens: [
      { id: 1, nome: 'Compra', depreciar: true },
      { id: 2, nome: 'Doação', depreciar: true },
    ],
    tiposResponsavel: [{ id: 3, nome: 'Chefe do setor' }],
    coeficientes: [{ id: 4, descricao: 'Dois turnos', percentual: 150 }],
    centros: CENTROS,
    empresas: [{ id: 1, nome: 'EMPRESA SINTÉTICA' }],
    parametros: [{ empresa: 1, depreciar: true, aplicarCoeficiente: true, considerarResidual: true }],
    acoes: {
      cadastrar: true,
      calcular: true,
      registrar: true,
      aceitar: true,
      baixar: true,
      contar: true,
      ...m,
    },
    liberacao: { ligada },
    cadastros: cadastros ?? [
      'patrimonio.origemBem',
      'patrimonio.tipoResponsavelBem',
      'patrimonio.coeficienteDepreciacao',
      'patrimonio.parametroPatrimonio',
      'patrimonio.parametroUsuarioPatrimonio',
    ],
  };
}
function bem(id: number, x: Partial<BemPatrimonial> = {}): BemPatrimonial {
  return {
    id,
    plaqueta: `PC${String(id).padStart(6, '0')}`,
    qr: `PAT1:pc:PC${String(id).padStart(6, '0')}:7`,
    descricao: `MONITOR SINTÉTICO ${id}`,
    grupo: 'equipamentoMedico',
    origem: { id: 1, nome: 'Compra' },
    documento: 'nota',
    nota: {
      id: 500,
      idItem: 900,
      numero: '1234',
      serie: '1',
      data: '2026-03-10',
      fornecedor: 'FORNECEDOR SINTÉTICO',
      item: 77,
      itemNome: 'MONITOR',
    },
    termo: null,
    empresa: 1,
    dataAquisicao: '2026-03-10',
    valorCent: 1_200_000,
    residualCent: 0,
    vidaUtilMeses: 120,
    coeficiente: null,
    inicioDepreciacao: '2026-04',
    depreciavel: true,
    centro: { id: 10, codigo: 101, nome: 'UTI SINTÉTICA' },
    localDetalhe: 'LEITO 3',
    tipoResponsavel: null,
    responsavel: null,
    marca: null,
    modelo: null,
    numeroSerie: null,
    situacao: 'ativo',
    baixadoEm: null,
    acumuladaCent: 60_000,
    contabilCent: 1_140_000,
    ultimaCompetencia: '2026-09',
    cotas: 6,
    movimentoPendente: null,
    versao: 3,
    criadoPor: 'SINT.PATRIMONIO',
    criadoEm: '2026-03-11T10:00:00Z',
    alteradoPor: 'SINT.PATRIMONIO',
    alteradoEm: '2026-03-11T10:00:00Z',
    ...x,
  };
}
function movimento(id: number, x: Partial<MovimentoBem> = {}): MovimentoBem {
  return {
    id,
    bem: { id: 1, plaqueta: 'PC000001', descricao: 'MONITOR SINTÉTICO 1' },
    tipo: 'transferencia',
    situacao: 'pendente',
    data: '2026-10-27',
    origem: { id: 10, codigo: 101, nome: 'UTI SINTÉTICA' },
    destino: { id: 11, codigo: 102, nome: 'ALA SINTÉTICA' },
    destinoResponsavel: null,
    terceiro: null,
    retornoPrevisto: null,
    termoNumero: null,
    motivo: 'Remanejamento sintético',
    valorVendaCent: null,
    referencia: null,
    solicitadoPor: 'SINT.PATRIMONIO',
    solicitadoEm: '2026-10-27T10:00:00Z',
    decididoPor: null,
    decididoEm: null,
    decisaoMotivo: null,
    versao: 0,
    ...x,
  };
}
const DEPREC: DepreciacaoCompetencia = {
  empresa: 1,
  competencia: '2026-09',
  calculo: null,
  cotas: [
    {
      bem: 1,
      plaqueta: 'PC000001',
      descricao: 'MONITOR SINTÉTICO 1',
      grupo: 'equipamentoMedico',
      centro: 10,
      baseCent: 1_200_000,
      residualCent: 0,
      vidaUtilMeses: 120,
      coeficiente: 1,
      acumuladaAntesCent: 50_000,
      mesesDecorridos: 6,
      valorCent: 10_000,
      acumuladaDepoisCent: 60_000,
      recuperaMeses: false,
      ultima: false,
    },
    {
      bem: 2,
      plaqueta: 'PC000002',
      descricao: 'NOTEBOOK SINTÉTICO',
      grupo: 'informatica',
      centro: 11,
      baseCent: 600_000,
      residualCent: 0,
      vidaUtilMeses: 60,
      coeficiente: 1,
      acumuladaAntesCent: 0,
      mesesDecorridos: 3,
      valorCent: 30_000,
      acumuladaDepoisCent: 30_000,
      recuperaMeses: true,
      ultima: false,
    },
  ],
  semCota: [{ bem: 3, plaqueta: 'PC000003', motivo: 'baixado' }],
  totalCent: 40_000,
  porGrupo: [
    { chave: 'equipamentoMedico', rotulo: 'Equipamentos', bens: 1, valorCent: 10_000 },
    { chave: 'informatica', rotulo: 'Informática', bens: 1, valorCent: 30_000 },
  ],
  porCentro: [
    { chave: '10', rotulo: 'UTI SINTÉTICA', bens: 1, valorCent: 10_000 },
    { chave: '11', rotulo: 'ALA SINTÉTICA', bens: 1, valorCent: 30_000 },
  ],
  impedimentos: [],
  parametros: { empresa: 1, depreciar: true, aplicarCoeficiente: true, considerarResidual: true },
  estornos: [],
  estornavel: false,
};
const RESUMO = {
  esperados: 3,
  leituras: 1,
  porResultado: {
    conforme: 1,
    'outro-local': 1,
    'nao-cadastrado': 0,
    baixado: 0,
    emprestado: 0,
    repetida: 0,
  },
  naoEncontrados: [{ bem: 2, plaqueta: 'PC000002', descricao: 'NOTEBOOK SINTÉTICO', centro: 11 }],
  naoEncontradosTotal: 1,
  listaCompleta: true,
};
const INVENTARIO: DetalheInventario = {
  id: 40,
  descricao: 'Inventário sintético de outubro',
  centro: null,
  situacao: 'aberto',
  abertoPor: 'SINT.PATRIMONIO',
  abertoEm: '2026-10-28T08:00:00Z',
  encerradoPor: null,
  encerradoEm: null,
  canceladoPor: null,
  canceladoEm: null,
  motivoCancelamento: null,
  resumo: RESUMO,
  leituras: [],
};

function base(u: string): Resposta {
  if (u.startsWith('/api/patrimonio/apoio')) return { corpo: apoio() };
  if (u.startsWith('/api/patrimonio/bens/codigo')) return { corpo: bem(1) };
  if (/\/api\/patrimonio\/bens\/\d+\/etiqueta/.test(u))
    return { corpo: { plaqueta: 'PC000001', zpl: '^XA^XZ' } };
  if (/\/api\/patrimonio\/bens\/\d+\/ajustes/.test(u)) return { corpo: [] };
  if (/\/api\/patrimonio\/bens\/\d+\/laudos/.test(u)) return { corpo: [] };
  if (/\/api\/patrimonio\/bens\/\d+$/.test(u)) return { corpo: bem(Number(u.split('/').pop())) };
  if (u.startsWith('/api/patrimonio/bens'))
    return {
      corpo: {
        bens: [bem(1), bem(2, { movimentoPendente: { id: 9, tipo: 'transferencia' } })],
        total: 120,
        pagina: 1,
        tamanho: 50,
        totaisPagina: { valorCent: 2_400_000, acumuladaCent: 120_000, contabilCent: 2_280_000 },
      },
    };
  if (u.startsWith('/api/patrimonio/notas/500/itens'))
    return {
      corpo: {
        nota: {
          id: 500,
          ano: 2026,
          mes: 10,
          doc: 1,
          numero: '1234',
          serie: '1',
          data: '2026-10-10',
          fornecedor: 'FORNECEDOR SINTÉTICO',
          empresa: 1,
          totalCent: 3_600_000,
          itens: 1,
        },
        itens: [
          {
            id: 900,
            seq: 1,
            item: 77,
            nome: 'MONITOR MULTIPARAMÉTRICO',
            quantidade: 3,
            valorTotalCent: 3_600_000,
            valorUnitarioCent: 1_200_000,
            jaCadastrados: 1,
            disponiveis: 2,
          },
        ],
      },
    };
  if (u.startsWith('/api/patrimonio/notas'))
    return {
      corpo: {
        notas: [
          {
            id: 500,
            ano: 2026,
            mes: 10,
            doc: 1,
            numero: '1234',
            serie: '1',
            data: '2026-10-10',
            fornecedor: 'FORNECEDOR SINTÉTICO',
            empresa: 1,
            totalCent: 3_600_000,
            itens: 1,
          },
        ],
        truncado: false,
      },
    };
  if (u.startsWith('/api/patrimonio/depreciacao')) return { corpo: DEPREC };
  if (u.startsWith('/api/patrimonio/movimentos?situacao=pendente')) return { corpo: [movimento(9)] };
  if (u.startsWith('/api/patrimonio/movimentos'))
    return {
      corpo: [
        movimento(9),
        movimento(8, {
          tipo: 'emprestimo',
          situacao: 'concluido',
          destino: null,
          terceiro: 'CLÍNICA SINTÉTICA',
        }),
      ],
    };
  if (u === '/api/patrimonio/inventarios') return { corpo: [INVENTARIO] };
  if (u.startsWith('/api/patrimonio/inventarios/40')) return { corpo: INVENTARIO };
  return { status: 404, corpo: { title: 'não simulado' } };
}

// ── Comuns ───────────────────────────────────────────────────────────────────────────────────────────────────────────
describe('comuns do patrimônio', () => {
  it('valor digitado, competência anterior, setor e a conferência das parcelas', () => {
    expect(centavosOuZero('1.234,56')).toBe(123_456);
    expect(centavosOuZero('')).toBe(0);
    expect(centavosOuZero('abc')).toBeNull();
    expect(textoDosCentavos(123_456)).toBe('1234,56');
    expect(competenciaAnterior('2026-01')).toBe('2025-12');
    expect(competenciaAnterior('2026-10')).toBe('2026-09');
    expect(rotuloCentro({ id: 1, codigo: 101, nome: 'UTI' })).toBe('101 - UTI');
    expect(rotuloCentro(null)).toBe('');
    expect(hojeLocal(new Date(2026, 9, 29, 23, 30))).toBe('2026-10-29');
    const c = conferenciaDasParcelas(40_000, DEPREC.porGrupo);
    expect(c.fecha).toBe(true);
    expect(c.texto).toContain('=');
    expect(c.texto).toContain('+');
    expect(conferenciaDasParcelas(1, DEPREC.porGrupo).fecha).toBe(false);
  });

  it('rascunho do cadastro: conferências da tela e o corpo estrito de cada documento', () => {
    const r = rascunhoVazio();
    expect(problemasDoCadastro(r, null)).toEqual(expect.arrayContaining(['escolhaItem', 'origem', 'centro']));
    const item = {
      id: 900,
      seq: 1,
      item: 77,
      nome: 'MONITOR',
      quantidade: 3,
      valorTotalCent: 3_600_000,
      valorUnitarioCent: 1_200_000,
      jaCadastrados: 1,
      disponiveis: 2,
    };
    const n = { ...rascunhoDoItem(r, 500, item), origem: 1, centro: 10 };
    expect(n.quantidade).toBe(2);
    expect(n.descricao).toBe('MONITOR');
    expect(problemasDoCadastro(n, item)).toEqual([]);
    expect(problemasDoCadastro({ ...n, quantidade: 3 }, item)).toContain('quantidadeAcimaDoItem');
    expect(problemasDoCadastro({ ...n, numeroSerie: 'X1' }, item)).toContain('serieComVarias');
    expect(problemasDoCadastro({ ...n, plaqueta: 'A1' }, item)).toContain('plaquetaComVarias');
    expect(problemasDoCadastro({ ...n, responsavel: 'FULANO' }, item)).toContain('tipoResponsavel');
    expect(problemasDoCadastro({ ...n, inicioDepreciacao: '2026-13' }, item)).toContain('inicioDepreciacao');
    const corpo = corpoDoCadastro({ ...n, residual: '10,00', vidaUtilMeses: '60' });
    expect(corpo).toMatchObject({
      documento: 'nota',
      nota: 500,
      itemNota: 900,
      quantidade: 2,
      residualCent: 1000,
    });
    expect(corpo).toMatchObject({ vidaUtilMeses: 60, plaqueta: null, inicioDepreciacao: null });
    expect(Object.keys(corpo)).not.toContain('termoNumero');

    const t = {
      ...rascunhoVazio('termo'),
      termoNumero: 'T-1',
      termoData: '2026-10-01',
      doador: 'DOADOR SINTÉTICO',
      empresa: 1,
      dataAquisicao: '2026-10-01',
      valor: '500,00',
      descricao: 'CADEIRA',
      origem: 2,
      centro: 11,
      plaqueta: 'abc-1',
    };
    expect(problemasDoCadastro(t, null)).toEqual([]);
    expect(problemasDoCadastro({ ...t, valor: '0' }, null)).toContain('valor');
    const ct = corpoDoCadastro(t);
    expect(ct).toMatchObject({
      documento: 'termo',
      valorCent: 50_000,
      plaqueta: 'ABC-1',
      doador: 'DOADOR SINTÉTICO',
    });
    expect(Object.keys(ct)).not.toContain('nota');
  });

  it('alteração a partir do bem lido, com a versão', () => {
    const r = rascunhoDoBem(bem(1, { residualCent: 1050 }));
    expect(r.residual).toBe('10,50');
    expect(problemasDaAlteracao(r)).toEqual([]);
    expect(problemasDaAlteracao({ ...r, vidaUtilMeses: '0' })).toContain('vidaUtil');
    expect(problemasDaAlteracao({ ...r, descricao: ' ' })).toContain('descricao');
    expect(corpoDaAlteracao({ ...r, marca: ' MARCA ' }, 3)).toMatchObject({
      versao: 3,
      residualCent: 1050,
      marca: 'MARCA',
      vidaUtilMeses: 120,
      inicioDepreciacao: '2026-04',
    });
  });
});

// ── Bens ─────────────────────────────────────────────────────────────────────────────────────────────────────────────
describe('tela dos bens', () => {
  it('desligada: avisa e não oferece o cadastro; a consulta funciona', async () => {
    simular((u) =>
      u.startsWith('/api/patrimonio/apoio') ? { corpo: apoio({ cadastrar: false }, false, []) } : null,
    );
    const w = montar(BensTela);
    await flushPromises();
    await flushPromises();
    expect(w.find('[data-testid="patrimonio-desligado"]').exists()).toBe(true);
    expect(w.find('[data-testid="bens-aba-cadastrar"]').exists()).toBe(false);
    expect(w.find('[data-testid="bens-aba-cadastros"]').exists()).toBe(false);
    expect(w.find('[data-testid="tabela-bens"]').exists()).toBe(true);
  });

  it('lista com filtros, totais da página com a conta, paginação e o movimento pendente', async () => {
    const ps = simular();
    const w = montar(BensTela);
    await flushPromises();
    await flushPromises();
    expect(w.findAll('[data-testid^="bem-abrir-"]')).toHaveLength(2);
    expect(w.find('[data-testid="bens-totais"]').text()).toMatch(/24\.000,00.*1\.200,00.*22\.800,00/);
    expect(w.find('[data-testid="bem-2"]').text()).toContain('Transferência');
    expect(w.find('[data-testid="bens-pagina"]').text()).toContain('1 de 3');
    await escolher(w, 'bens-centro', 10);
    await escolher(w, 'bens-grupo', 'informatica');
    await digitar(w, 'bens-busca', 'MONITOR');
    await w.find('[data-testid="bens-filtros"]').trigger('submit');
    await flushPromises();
    const ultima = ps.filter((p) => p.url.startsWith('/api/patrimonio/bens?')).pop()!;
    expect(ultima.url).toContain('centro=10');
    expect(ultima.url).toContain('grupo=informatica');
    expect(ultima.url).toContain('busca=MONITOR');
    expect(ultima.url).toContain('situacao=ativo');
    await clicar(w, 'bens-proxima');
    expect(ps.filter((p) => p.url.startsWith('/api/patrimonio/bens?')).pop()!.url).toContain('pagina=2');
  });

  it('abre a ficha pelo QR e mostra a conferência; altera pela versão; baixa com o termo e a senha', async () => {
    let baixado = false;
    const ps = simular((u, m) => {
      if (m === 'POST' && u.endsWith('/baixa')) {
        baixado = true;
        return {
          status: 201,
          corpo: {
            movimento: movimento(20, { tipo: 'baixa', situacao: 'concluido' }),
            bem: bem(1, { situacao: 'baixado' }),
          },
        };
      }
      if (baixado && u === '/api/patrimonio/bens/1')
        return { corpo: bem(1, { situacao: 'baixado', versao: 5 }) };
      if (m === 'POST' && /\/bens\/1$/.test(u)) return { corpo: { bem: bem(1, { versao: 4 }), mudou: true } };
      return null;
    });
    const w = montar(BensTela);
    await flushPromises();
    await flushPromises();
    await digitar(w, 'bens-codigo-campo', 'PAT1:pc:PC000001:7');
    await w.find('[data-testid="bens-codigo"]').trigger('submit');
    await flushPromises();
    await flushPromises();
    expect(ps.some((p) => p.url === '/api/patrimonio/bens/codigo?codigo=PAT1%3Apc%3APC000001%3A7')).toBe(
      true,
    );
    const f = w.find('[data-testid="ficha-bem"]');
    expect(f.exists()).toBe(true);
    expect(w.find('[data-testid="ficha-conferencia"]').text()).toMatch(
      /11\.400,00.*12\.000,00.*600,00.*6 cotas/,
    );
    expect(w.find('[data-testid="ficha-documento"]').text()).toContain('FORNECEDOR SINTÉTICO');
    expect(w.find('[data-testid="ficha-termo-baixa"]').exists()).toBe(false);

    await clicar(w, 'ficha-alterar');
    await digitar(w, 'alterar-vida-util', '96');
    await w.find('[data-testid="ficha-form-alterar"]').trigger('submit');
    await flushPromises();
    const alt = posts(ps, '/api/patrimonio/bens/1').find((p) => !p.url.endsWith('/baixa'))!;
    expect(alt.corpo).toMatchObject({ versao: 3, vidaUtilMeses: 96, depreciavel: true });
    expect(w.find('[data-testid="ficha-mensagem"]').text()).toContain('gravados');

    await clicar(w, 'ficha-baixar');
    expect(w.find('[data-testid="baixa-confirmar"]').attributes('disabled')).toBeDefined();
    await digitar(w, 'baixa-termo', 'LAUDO-9');
    await digitar(w, 'baixa-motivo', 'Obsolescência sintética');
    await digitar(w, 'baixa-senha', 'segredo-sintetico');
    await clicar(w, 'baixa-confirmar');
    await confirmarDestrutivo();
    const bx = posts(ps, '/baixa')[0]!;
    expect(bx.url).toBe('/api/patrimonio/bens/1/baixa');
    expect(bx.corpo).toMatchObject({
      versao: 4,
      termoNumero: 'LAUDO-9',
      motivo: 'Obsolescência sintética',
      senha: 'segredo-sintetico',
      valorVendaCent: null,
      data: '2026-10-28',
    });
    expect(w.find('[data-testid="ficha-situacao"]').text()).toBe('Baixado');
    // o termo de baixa (PDF/A) só aparece para o bem baixado; a baixa e o movimentar somem
    expect(w.find('[data-testid="ficha-termo-baixa"]').attributes('href')).toBe(
      '/api/patrimonio/bens/1/termo-baixa',
    );
    expect(w.find('[data-testid="ficha-baixar"]').exists()).toBe(false);
  });

  it('a recusa conhecida aparece com o texto da tela', async () => {
    simular((u) =>
      u.startsWith('/api/patrimonio/bens/codigo')
        ? {
            status: 409,
            corpo: { type: 'about:blank', title: 'x', status: 409, codigo: 'plaqueta-repetida' },
          }
        : null,
    );
    const w = montar(BensTela);
    await flushPromises();
    await flushPromises();
    await digitar(w, 'bens-codigo-campo', 'PC1');
    await w.find('[data-testid="bens-codigo"]').trigger('submit');
    await flushPromises();
    await flushPromises();
    expect(w.text()).toContain(mensagensPatrimonio.recusas['plaqueta-repetida']);
  });

  it('cadastra da nota em passos: mês, nota, item, dados e o corpo certo', async () => {
    const ps = simular((u, m) =>
      m === 'POST' && u === '/api/patrimonio/bens'
        ? { status: 201, corpo: { bens: [bem(31), bem(32)] } }
        : null,
    );
    const w = montar(BensTela);
    await flushPromises();
    await flushPromises();
    await clicar(w, 'bens-aba-cadastrar');
    expect(ps.some((p) => p.url.startsWith('/api/patrimonio/notas?competencia=2026-10'))).toBe(true);
    await clicar(w, 'nota-escolher-500');
    await clicar(w, 'item-escolher-900');
    expect(w.find('[data-testid="cadastro-item-escolhido"]').text()).toContain('2 unidades');
    await clicar(w, 'cadastro-ir-dados');
    await escolher(w, 'cadastro-origem', 1);
    await escolher(w, 'cadastro-centro', 10);
    await digitar(w, 'cadastro-local', 'LEITO 4');
    await clicar(w, 'cadastro-ir-conferir');
    expect(w.find('[data-testid="cadastro-resumo"]').text()).toMatch(/2 bens de .*12\.000,00.*UTI SINTÉTICA/);
    expect(w.find('[data-testid="cadastro-problemas"]').exists()).toBe(false);
    await clicar(w, 'cadastro-gravar');
    const c = posts(ps, '/api/patrimonio/bens')[0]!;
    expect(c.corpo).toMatchObject({
      documento: 'nota',
      nota: 500,
      itemNota: 900,
      quantidade: 2,
      origem: 1,
      centro: 10,
      localDetalhe: 'LEITO 4',
      descricao: 'MONITOR MULTIPARAMÉTRICO',
    });
    expect(w.find('[data-testid="cadastro-gravado"]').text()).toContain('PC000031, PC000032');
  });

  it('cadastros auxiliares: só os da ficha do bem que o perfil consulta', async () => {
    simular((u) =>
      u.startsWith('/api/patrimonio/apoio')
        ? { corpo: apoio({}, true, ['patrimonio.origemBem', 'patrimonio.parametroPatrimonio']) }
        : null,
    );
    const w = montar(BensTela);
    await flushPromises();
    await flushPromises();
    await clicar(w, 'bens-aba-cadastros');
    expect(w.find('[data-testid="dominio"]').text()).toBe('patrimonio.origemBem');
  });
});

// ── Depreciação ──────────────────────────────────────────────────────────────────────────────────────────────────────
describe('tela da depreciação', () => {
  it('prévia da competência anterior com as parcelas e a conferência; calcula com confirmação', async () => {
    const ps = simular((u, m) =>
      m === 'POST' && u.endsWith('/depreciacao/calculo')
        ? {
            status: 201,
            corpo: {
              ...DEPREC,
              calculo: {
                id: 1,
                empresa: 1,
                competencia: '2026-09',
                bens: 2,
                ignorados: 1,
                totalCent: 40_000,
                calculadoPor: 'SINT.PATRIMONIO',
                calculadoEm: '2026-10-28T12:00:00Z',
                rodada: 1,
              },
            },
          }
        : null,
    );
    const w = montar(DepreciacaoTela);
    await flushPromises();
    await flushPromises();
    expect(ps.some((p) => p.url === '/api/patrimonio/apoio/depreciacao')).toBe(true);
    expect(ps.some((p) => p.url === '/api/patrimonio/depreciacao?empresa=1&competencia=2026-09')).toBe(true);
    expect(w.find('[data-testid="deprec-situacao"]').text()).toContain('Prévia');
    expect(w.find('[data-testid="deprec-conferencia-porGrupo"]').text()).toMatch(
      /400,00 = .*100,00 \+ .*300,00/,
    );
    expect(w.find('[data-testid="deprec-conferencia-porCentro"]').text()).toMatch(/400,00 = /);
    expect(w.find('[data-testid="cota-2"]').text()).toContain('recupera meses');
    expect(w.find('[data-testid="deprec-sem-cota"]').text()).toContain('PC000003');
    await clicar(w, 'deprec-calcular');
    await confirmarDestrutivo();
    expect(posts(ps, '/depreciacao/calculo')[0]!.corpo).toEqual({ empresa: 1, competencia: '2026-09' });
    expect(w.find('[data-testid="deprec-mensagem"]').text()).toContain('09/2026');
    expect(w.find('[data-testid="deprec-situacao"]').text()).toContain('SINT.PATRIMONIO');
    expect(w.find('[data-testid="deprec-calcular"]').exists()).toBe(false);
  });

  it('W0-08: estorna o último cálculo com motivo e a senha (confirmação); a recusa do lote exportado vem com o caminho', async () => {
    const CALC = {
      id: 7,
      empresa: 1,
      competencia: '2026-09',
      bens: 2,
      ignorados: 1,
      totalCent: 40_000,
      calculadoPor: 'SINT.PATRIMONIO',
      calculadoEm: '2026-10-28T12:00:00Z',
      rodada: 1,
    };
    const ESTORNO = {
      id: 9,
      calculo: 7,
      competencia: '2026-09',
      bens: 2,
      totalCent: 40_000,
      motivo: 'Vida útil errada no cadastro',
      origem: 'patrimonio/estorno-depreciacao',
      estornadoPor: 'SINT.PATRIMONIO',
      estornadoEm: '2026-10-29T09:00:00Z',
    };
    let exportado = true;
    const ps = simular((u, m) => {
      if (m === 'POST' && u.endsWith('/depreciacao/estorno'))
        return exportado
          ? {
              status: 409,
              corpo: { type: 'about:blank', title: 'x', status: 409, codigo: 'lote-exportado' },
            }
          : { status: 201, corpo: { ...DEPREC, calculo: null, estornos: [ESTORNO], estornavel: false } };
      if (u.startsWith('/api/patrimonio/depreciacao'))
        return { corpo: { ...DEPREC, calculo: CALC, estornavel: true } };
      return null;
    });
    const w = montar(DepreciacaoTela);
    await flushPromises();
    await flushPromises();
    expect(w.find('[data-testid="deprec-estorno"]').exists()).toBe(false);
    await clicar(w, 'deprec-estornar');
    expect(w.find('[data-testid="deprec-estorno-confirmar"]').attributes('disabled')).toBeDefined();
    await digitar(w, 'deprec-estorno-motivo', 'Vida útil errada no cadastro');
    await digitar(w, 'deprec-estorno-senha', 'segredo-sintetico');
    await clicar(w, 'deprec-estorno-confirmar');
    await confirmarDestrutivo();
    expect(posts(ps, '/depreciacao/estorno')[0]!.corpo).toEqual({
      empresa: 1,
      competencia: '2026-09',
      motivo: 'Vida útil errada no cadastro',
      senha: 'segredo-sintetico',
    });
    expect(w.find('[data-testid="recusa-patrimonio"]').text()).toContain('cancele a exportação primeiro');
    exportado = false;
    await digitar(w, 'deprec-estorno-senha', 'segredo-sintetico');
    await clicar(w, 'deprec-estorno-confirmar');
    await confirmarDestrutivo();
    expect(w.find('[data-testid="deprec-mensagem"]').text()).toContain('estornado');
    expect(w.find('[data-testid="deprec-situacao"]').text()).toContain('Prévia');
    expect(w.find('[data-testid="deprec-estornos"]').text()).toContain('Vida útil errada no cadastro');
    expect(w.find('[data-testid="deprec-estornar"]').exists()).toBe(false);
  });

  it('impedida: mostra o que impede, o caminho para os parâmetros e não deixa calcular', async () => {
    simular((u) =>
      u.startsWith('/api/patrimonio/depreciacao')
        ? {
            corpo: {
              ...DEPREC,
              impedimentos: ['A empresa não deprecia os bens (parâmetros do patrimônio).'],
              parametros: { ...DEPREC.parametros, depreciar: false },
            },
          }
        : null,
    );
    const w = montar(DepreciacaoTela);
    await flushPromises();
    await flushPromises();
    expect(w.find('[data-testid="deprec-impedimentos"]').text()).toContain('não deprecia');
    expect(w.find('[data-testid="deprec-ir-parametros"]').attributes('href')).toBe('/patrimonio/parametros');
    expect(w.find('[data-testid="deprec-calcular"]').attributes('disabled')).toBeDefined();
  });
});

// ── Movimentos ───────────────────────────────────────────────────────────────────────────────────────────────────────
describe('tela dos movimentos', () => {
  it('aceita e recusa (com motivo) a transferência pendente', async () => {
    const ps = simular((u, m) =>
      m === 'POST' && u.includes('/decisao')
        ? { corpo: { movimento: movimento(9, { situacao: 'aceito' }), bem: bem(1) } }
        : null,
    );
    const w = montar(MovimentosTela);
    await flushPromises();
    await flushPromises();
    expect(ps.some((p) => p.url === '/api/patrimonio/apoio/movimentos')).toBe(true);
    expect(w.find('[data-testid="pendente-9"]').text()).toContain('ALA SINTÉTICA');
    await clicar(w, 'pendente-aceitar-9');
    expect(posts(ps, '/movimentos/9/decisao')[0]!.corpo).toEqual({ aceitar: true, motivo: null, versao: 0 });
    expect(w.find('[data-testid="mov-mensagem"]').text()).toContain('aceita');
    await clicar(w, 'pendente-recusar-9');
    expect(w.find('[data-testid="pendente-confirmar-9"]').attributes('disabled')).toBeDefined();
    await digitar(w, 'pendente-motivo-9', 'Setor sem espaço');
    await clicar(w, 'pendente-confirmar-9');
    expect(posts(ps, '/movimentos/9/decisao')[1]!.corpo).toEqual({
      aceitar: false,
      motivo: 'Setor sem espaço',
      versao: 0,
    });
  });

  it('quem só aceita não vê o registro; o cancelamento pede o motivo', async () => {
    const ps = simular((u, m) => {
      if (u.startsWith('/api/patrimonio/apoio')) return { corpo: apoio({ registrar: false }) };
      if (m === 'POST' && u.includes('/cancelamento'))
        return { corpo: { movimento: movimento(9, { situacao: 'cancelado' }) } };
      return null;
    });
    const w = montar(MovimentosTela);
    await flushPromises();
    await flushPromises();
    expect(w.find('[data-testid="mov-aba-registrar"]').exists()).toBe(false);
    expect(w.find('[data-testid="pendente-cancelar-9"]').exists()).toBe(false);
    expect(ps.filter((p) => p.metodo === 'POST')).toHaveLength(0);
  });

  it('registra a transferência do bem lido pela plaqueta, com a versão', async () => {
    const ps = simular((u, m) =>
      m === 'POST' && u === '/api/patrimonio/movimentos'
        ? {
            status: 201,
            corpo: {
              movimento: movimento(21),
              bem: bem(1, { versao: 4, movimentoPendente: { id: 21, tipo: 'transferencia' } }),
            },
          }
        : null,
    );
    const w = montar(MovimentosTela);
    await flushPromises();
    await flushPromises();
    await clicar(w, 'mov-aba-registrar');
    await digitar(w, 'mov-codigo', 'PC000001');
    await clicar(w, 'mov-buscar');
    await w.find('[data-testid="mov-registrar"] form').trigger('submit');
    await flushPromises();
    await flushPromises();
    expect(w.find('[data-testid="mov-bem"]').text()).toContain('PC000001');
    expect(w.find('[data-testid="mov-gravar"]').attributes('disabled')).toBeDefined();
    await escolher(w, 'mov-destino', 11);
    await digitar(w, 'mov-motivo', 'Remanejamento sintético');
    await w.findAll('[data-testid="mov-registrar"] form')[1]!.trigger('submit');
    await flushPromises();
    await flushPromises();
    expect(posts(ps, '/api/patrimonio/movimentos')[0]!.corpo).toEqual({
      tipo: 'transferencia',
      bem: 1,
      versao: 3,
      data: '2026-10-28',
      motivo: 'Remanejamento sintético',
      destino: 11,
      destinoResponsavel: null,
    });
    expect(w.find('[data-testid="mov-mensagem"]').text()).toContain('Transferência');
    expect(w.find('[data-testid="mov-bem-pendente"]').exists()).toBe(true);
  });

  it('da ficha do bem (?bem=): abre o registro com o bem; o histórico filtra pela situação', async () => {
    rotaAtual.query = { bem: '1' };
    const ps = simular();
    const w = montar(MovimentosTela);
    await flushPromises();
    await flushPromises();
    expect(ps.some((p) => p.url === '/api/patrimonio/bens/1')).toBe(true);
    expect(w.find('[data-testid="mov-bem"]').exists()).toBe(true);
    await clicar(w, 'mov-aba-historico');
    expect(w.find('[data-testid="movimento-8"]').text()).toContain('CLÍNICA SINTÉTICA');
    await escolher(w, 'mov-hist-situacao', 'concluido');
    expect(ps.some((p) => p.url === '/api/patrimonio/movimentos?situacao=concluido')).toBe(true);
  });
});

// ── Inventário ───────────────────────────────────────────────────────────────────────────────────────────────────────
describe('tela do inventário', () => {
  it('abre, lê pela plaqueta (sem câmera), mostra o resumo com a conta e encerra', async () => {
    const ps = simular((u, m) => {
      if (m === 'POST' && u === '/api/patrimonio/inventarios') return { status: 201, corpo: INVENTARIO };
      if (m === 'POST' && u.endsWith('/leituras'))
        return {
          status: 201,
          corpo: {
            leitura: {
              id: 1,
              codigo: 'PC000001',
              bem: { id: 1, plaqueta: 'PC000001', descricao: 'MONITOR SINTÉTICO 1', centro: 10 },
              centroLido: 11,
              resultado: 'outro-local',
              observacao: null,
              lidoPor: 'SINT.PATRIMONIO',
              lidoEm: '2026-10-28T09:00:00Z',
            },
            resumo: { ...RESUMO, leituras: 2 },
          },
        };
      if (m === 'POST' && u.endsWith('/encerramento'))
        return {
          corpo: {
            ...INVENTARIO,
            situacao: 'encerrado',
            encerradoPor: 'SINT.PATRIMONIO',
            encerradoEm: '2026-10-28T10:00:00Z',
          },
        };
      return null;
    });
    const w = montar(InventarioTela);
    await flushPromises();
    await flushPromises();
    expect(ps.some((p) => p.url === '/api/patrimonio/apoio/inventario')).toBe(true);
    expect(w.find('[data-testid="inventario-40"]').exists()).toBe(true);
    await digitar(w, 'inv-nome', 'Inventário sintético de outubro');
    await w.find('[data-testid="inv-abrir"]').trigger('submit');
    await flushPromises();
    await flushPromises();
    expect(posts(ps, '/api/patrimonio/inventarios')[0]!.corpo).toEqual({
      descricao: 'Inventário sintético de outubro',
      centro: null,
    });
    expect(w.find('[data-testid="inv-sem-camera"]').exists()).toBe(true);
    expect(w.find('[data-testid="inv-conferencia"]').text()).toBe(
      'Esperados 3 = encontrados no lugar 1 + em outro setor 1 + não encontrados 1',
    );
    expect(w.find('[data-testid="inv-ler"]').attributes('disabled')).toBeDefined();
    await escolher(w, 'inv-onde', 11);
    await digitar(w, 'inv-codigo', 'PC000001');
    await w.find('[data-testid="inv-leitor"]').trigger('submit');
    await flushPromises();
    expect(posts(ps, '/leituras')[0]!.corpo).toEqual({ codigo: 'PC000001', centro: 11, observacao: null });
    expect(w.find('[data-testid="inv-ultima"]').text()).toContain('Encontrado em outro setor');
    expect(w.find('[data-testid="inv-resumo"]').text()).toContain('Leituras 2');
    await clicar(w, 'inv-encerrar');
    await confirmarDestrutivo();
    expect(posts(ps, '/encerramento')).toHaveLength(1);
    expect(w.find('[data-testid="inv-mensagem"]').text()).toContain('encerrado');
    expect(w.find('[data-testid="inv-leitor"]').exists()).toBe(false);
  });

  it('W0-08: cancela o aberto com motivo e confirmação; as leituras seguem visíveis e o leitor some', async () => {
    const LEITURA = {
      id: 1,
      codigo: 'PC000001',
      bem: { id: 1, plaqueta: 'PC000001', descricao: 'MONITOR SINTÉTICO 1', centro: 10 },
      centroLido: 10,
      resultado: 'conforme' as const,
      observacao: null,
      lidoPor: 'SINT.PATRIMONIO',
      lidoEm: '2026-10-28T09:00:00Z',
    };
    const ps = simular((u, m) => {
      if (m === 'POST' && u === '/api/patrimonio/inventarios')
        return { status: 201, corpo: { ...INVENTARIO, leituras: [LEITURA] } };
      if (m === 'POST' && u.endsWith('/cancelamento'))
        return {
          corpo: {
            ...INVENTARIO,
            leituras: [LEITURA],
            situacao: 'cancelado',
            canceladoPor: 'SINT.PATRIMONIO',
            canceladoEm: '2026-10-28T10:00:00Z',
            motivoCancelamento: 'Aberto no setor errado',
          },
        };
      return null;
    });
    const w = montar(InventarioTela);
    await flushPromises();
    await flushPromises();
    await digitar(w, 'inv-nome', 'Inventário sintético de outubro');
    await w.find('[data-testid="inv-abrir"]').trigger('submit');
    await flushPromises();
    await flushPromises();
    await clicar(w, 'inv-cancelar');
    expect(w.find('[data-testid="inv-cancelar-confirmar"]').attributes('disabled')).toBeDefined();
    await digitar(w, 'inv-cancelar-motivo', 'Aberto no setor errado');
    await clicar(w, 'inv-cancelar-confirmar');
    await confirmarDestrutivo();
    expect(posts(ps, '/cancelamento')[0]!.corpo).toEqual({ motivo: 'Aberto no setor errado' });
    expect(w.find('[data-testid="inv-mensagem"]').text()).toContain('cancelado');
    expect(w.find('[data-testid="inv-cancelado"]').text()).toContain('Aberto no setor errado');
    expect(w.find('[data-testid="inv-leituras"]').text()).toContain('PC000001');
    expect(w.find('[data-testid="inv-leitor"]').exists()).toBe(false);
    expect(w.find('[data-testid="inv-encerrar"]').exists()).toBe(false);
  });
});

// ── Grupos do bem (W0-08) ────────────────────────────────────────────────────────────────────────────────────────────
describe('tela dos grupos do bem (W0-08)', () => {
  const G = (codigo: string, x: Record<string, unknown> = {}) => ({
    codigo,
    nome: `GRUPO SINTÉTICO ${codigo}`,
    vidaUtilMeses: 120,
    conta: null,
    ativo: true,
    semente: true,
    inativadoEm: null,
    motivoInativacao: null,
    versao: 0,
    bens: 0,
    ...x,
  });
  const GRUPOS = [G('equipamentoMedico', { bens: 3 }), G('moveis'), G('veiculos', { conta: '9.9.9' })];
  function rotas(extra: (u: string, m: string) => Resposta | null = () => null) {
    return simular((u, m) => {
      const e = extra(u, m);
      if (e) return e;
      if (m === 'GET' && u === '/api/patrimonio/grupos')
        return {
          corpo: { grupos: GRUPOS, contas: [{ codigo: '1.2.3.01', nome: 'EQUIPAMENTOS SINTÉTICOS' }] },
        };
      if (m === 'GET' && u.startsWith('/api/patrimonio/grupos/')) {
        const c = decodeURIComponent(u.split('/').pop() ?? '');
        const versoes =
          c === 'moveis'
            ? [
                {
                  versao: 0,
                  operacao: 'alteracao',
                  nome: 'MÓVEIS ANTIGO',
                  vidaUtilMeses: 100,
                  conta: null,
                  ativo: true,
                  motivo: 'Nome conforme a IN',
                  por: 'SINT.PATRIMONIO',
                  em: '2026-10-20T10:00:00Z',
                },
              ]
            : [];
        return { corpo: { ...GRUPOS.find((g) => g.codigo === c), versoes } };
      }
      return null;
    });
  }
  async function abrirAba() {
    const w = montar(BensTela);
    await flushPromises();
    await flushPromises();
    await clicar(w, 'bens-aba-grupos');
    return w;
  }

  it('lista com vida útil, situação e bens; inclui com o corpo estrito e confere o código', async () => {
    const ps = rotas((u, m) =>
      m === 'POST' && u === '/api/patrimonio/grupos' ? { status: 201, corpo: G('telefonia') } : null,
    );
    const w = await abrirAba();
    expect(w.find('[data-testid="grupo-equipamentoMedico"]').text()).toContain('120 meses');
    expect(w.find('[data-testid="grupo-equipamentoMedico"]').text()).toContain('3');
    await clicar(w, 'grupo-incluir');
    await digitar(w, 'grupo-codigo', '1x');
    await digitar(w, 'grupo-nome', 'Telefonia');
    await digitar(w, 'grupo-vida', '60');
    await w.find('[data-testid="grupo-form"]').trigger('submit');
    await flushPromises();
    expect(w.find('[data-testid="grupo-problemas"]').exists()).toBe(true);
    expect(posts(ps, '/api/patrimonio/grupos')).toHaveLength(0);
    await digitar(w, 'grupo-codigo', 'telefonia');
    await w.find('[data-testid="grupo-form"]').trigger('submit');
    await flushPromises();
    await flushPromises();
    expect(posts(ps, '/api/patrimonio/grupos')[0]!.corpo).toEqual({
      codigo: 'telefonia',
      nome: 'Telefonia',
      vidaUtilMeses: 60,
      conta: null,
    });
    expect(w.find('[data-testid="grupos-bem-aviso"]').text()).toContain('incluído');
  });

  it('altera pela versão lida com motivo (PUT) e mostra as versões anteriores; 409 desatualizado com o texto', async () => {
    const ps = rotas((_u, m) =>
      m === 'PUT'
        ? { status: 409, corpo: { type: 'about:blank', title: 'x', status: 409, codigo: 'desatualizado' } }
        : null,
    );
    const w = await abrirAba();
    await clicar(w, 'grupo-alterar-moveis');
    await flushPromises();
    expect(w.find('[data-testid="grupo-versao-0"]').text()).toContain('Nome conforme a IN');
    await digitar(w, 'grupo-vida', '150');
    await digitar(w, 'grupo-motivo', 'Laudo da engenharia');
    await w.find('[data-testid="grupo-form"]').trigger('submit');
    await flushPromises();
    await flushPromises();
    const put = ps.find((p) => p.metodo === 'PUT')!;
    expect(put.url).toBe('/api/patrimonio/grupos/moveis');
    expect(put.corpo).toEqual({
      versao: 0,
      nome: 'GRUPO SINTÉTICO moveis',
      vidaUtilMeses: 150,
      conta: null,
      motivo: 'Laudo da engenharia',
    });
    expect(w.text()).toContain(mensagensPatrimonio.recusas.desatualizado);
  });

  it('revisão: a conta é combo com busca das contas analíticas do plano; a fora do plano aparece marcada; 409 conta', async () => {
    const ps = rotas((_u, m) =>
      m === 'PUT'
        ? {
            status: 409,
            corpo: { type: 'about:blank', title: 'x', status: 409, codigo: 'conta', campos: ['conta'] },
          }
        : null,
    );
    const w = await abrirAba();
    await clicar(w, 'grupo-alterar-veiculos');
    await flushPromises();
    const combo = propsDoCombo(w, 'grupo-conta');
    expect(combo['busca']).toBe(true);
    expect(combo['opcoes']).toEqual([
      { valor: null, rotulo: '—' },
      { valor: '1.2.3.01', rotulo: '1.2.3.01 EQUIPAMENTOS SINTÉTICOS' },
      { valor: '9.9.9', rotulo: `9.9.9 (${mensagensPatrimonio.gruposBem.contaForaDoPlano})` },
    ]);
    await escolher(w, 'grupo-conta', '1.2.3.01');
    await digitar(w, 'grupo-motivo', 'Conta do plano novo');
    await w.find('[data-testid="grupo-form"]').trigger('submit');
    await flushPromises();
    await flushPromises();
    expect(ps.find((p) => p.metodo === 'PUT')!.corpo).toMatchObject({ conta: '1.2.3.01' });
    expect(w.text()).toContain(mensagensPatrimonio.recusas.conta);
  });

  it('revisão: bem de grupo inativo mostra o nome cadastrado na lista e na ficha; a alteração traz o grupo marcado', async () => {
    const ap = apoio();
    const comInativos: ApoioPatrimonio = {
      ...ap,
      grupos: ap.grupos.map((g) =>
        g.valor === 'moveis'
          ? { ...g, rotulo: 'MÓVEIS HOSPITALARES SINTÉTICOS', ativo: false }
          : g.valor === 'informatica'
            ? { ...g, ativo: false }
            : g,
      ),
    };
    simular((u) => {
      if (u.startsWith('/api/patrimonio/apoio')) return { corpo: comInativos };
      if (u.startsWith('/api/patrimonio/bens/codigo') || /\/bens\/1$/.test(u))
        return { corpo: bem(1, { grupo: 'moveis' }) };
      if (u.startsWith('/api/patrimonio/bens?'))
        return {
          corpo: {
            bens: [bem(1, { grupo: 'moveis' })],
            total: 1,
            pagina: 1,
            tamanho: 50,
            totaisPagina: { valorCent: 1_200_000, acumuladaCent: 60_000, contabilCent: 1_140_000 },
          },
        };
      return null;
    });
    const w = montar(BensTela);
    await flushPromises();
    await flushPromises();
    expect(w.find('[data-testid="bem-1"]').text()).toContain('MÓVEIS HOSPITALARES SINTÉTICOS');
    const marca = mensagensPatrimonio.gruposBem.marcaInativo;
    expect(propsDoCombo(w, 'bens-grupo')['opcoes']).toContainEqual({
      valor: 'informatica',
      rotulo: `Grupo informatica (${marca})`,
    });
    await digitar(w, 'bens-codigo-campo', 'PAT1:pc:PC000001:7');
    await w.find('[data-testid="bens-codigo"]').trigger('submit');
    await flushPromises();
    await flushPromises();
    expect(w.find('[data-testid="ficha-grupo"]').text()).toBe('MÓVEIS HOSPITALARES SINTÉTICOS');
    await clicar(w, 'ficha-alterar');
    const combo = propsDoCombo(w, 'alterar-grupo');
    const opcoes = combo['opcoes'] as { valor: string; rotulo: string }[];
    expect(combo['modelValue']).toBe('moveis');
    expect(opcoes).toContainEqual({ valor: 'moveis', rotulo: `MÓVEIS HOSPITALARES SINTÉTICOS (${marca})` });
    expect(opcoes.some((o) => o.valor === 'informatica')).toBe(false);
  });

  it('excluir com bens: 409 com a contagem e a oferta de inativar, que grava a inativação com o motivo', async () => {
    const ps = rotas((u, m) => {
      if (m === 'POST' && u.endsWith('/exclusao'))
        return {
          status: 409,
          corpo: {
            type: 'https://sgh.invalid/problemas/com-dependentes',
            title: 'Operação recusada',
            status: 409,
            codigo: 'com-dependentes',
            detail: 'O grupo do bem tem 3 registros dependentes.',
            dependentes: [
              { rotulo: 'Bens patrimoniais', quantidade: 3, amostra: ['PC000001'], origem: 'logica' },
            ],
            podeInativar: true,
          },
        };
      if (m === 'POST' && u.endsWith('/inativacao'))
        return { corpo: G('equipamentoMedico', { ativo: false, versao: 1 }) };
      return null;
    });
    const w = await abrirAba();
    await clicar(w, 'grupo-excluir-equipamentoMedico');
    await flushPromises();
    await digitar(w, 'grupo-motivo', 'Cadastrado por engano');
    await clicar(w, 'grupo-gravar');
    await confirmarDestrutivo();
    expect(w.find('[data-testid="grupo-dependentes"]').text()).toContain('Bens patrimoniais: 3');
    await clicar(w, 'grupo-inativar-em-vez');
    await w.find('[data-testid="grupo-form"]').trigger('submit');
    await flushPromises();
    await flushPromises();
    expect(posts(ps, '/inativacao')[0]!.corpo).toEqual({ versao: 0, motivo: 'Cadastrado por engano' });
    expect(w.find('[data-testid="grupos-bem-aviso"]').text()).toContain('inativado');
  });

  it('sem cadastrar ou com a liberação desligada: só a consulta', async () => {
    rotas((u) => (u.startsWith('/api/patrimonio/apoio') ? { corpo: apoio({ cadastrar: false }) } : null));
    const w = await abrirAba();
    expect(w.find('[data-testid="grupos-bem-tabela"]').exists()).toBe(true);
    expect(w.find('[data-testid="grupo-incluir"]').exists()).toBe(false);
    expect(w.find('[data-testid="grupo-alterar-moveis"]').exists()).toBe(false);
  });
});

// ── Ajustes de valor do bem (W0-08, M1) ──────────────────────────────────────────────────────────────────────────────
function ajuste(id: number, x: Partial<AjusteBem> = {}): AjusteBem {
  return {
    id,
    bem: 1,
    tipo: 'impairment',
    competenciaMarco: '2026-09',
    data: '2026-10-20',
    valorContabilAntesCent: 1_140_000,
    valorContabilDepoisCent: 900_000,
    acumuladaMarcoCent: 60_000,
    perdaCent: 240_000,
    residualCent: 0,
    vidaRestanteMeses: 114,
    valorJustoCent: null,
    laudo: 77,
    motivo: 'Laudo sintético de recuperabilidade',
    origem: 'patrimonio/ajuste-bem',
    registradoPor: 'USUARIO.SINTETICO',
    registradoEm: '2026-10-20T10:00:00.000Z',
    estorno: null,
    ...x,
  };
}
function laudo(id: number, x: Partial<LaudoBem> = {}): LaudoBem {
  return {
    id,
    bem: 1,
    nome: 'laudo-sintetico.pdf',
    descricao: 'Teste de recuperabilidade sintético',
    sha256: 'c'.repeat(64),
    tamanho: 2048,
    enviadoPor: 'USUARIO.SINTETICO',
    enviadoEm: '2026-10-19T10:00:00.000Z',
    ...x,
  };
}
const montarAjustes = (podeAjustar = true, b = bem(1)) =>
  mount(AjustesBem as never, {
    attachTo: document.body,
    props: { bem: b, podeAjustar } as never,
    global: {
      plugins: [
        criarI18n(mensagensWeb as unknown as Record<string, unknown>),
        ui,
        [VueQueryPlugin, { queryClient: new QueryClient({ defaultOptions: { queries: { retry: false } } }) }],
      ] as never,
    },
  });

describe('ajustes de valor do bem na ficha (W0-08, M1)', () => {
  it('registra o impairment com o laudo e a versão lida; o laudo é obrigatório', async () => {
    const ps = simular((u, m) =>
      m === 'POST' && u === '/api/patrimonio/bens/1/ajustes'
        ? { status: 201, corpo: ajuste(5) }
        : u === '/api/patrimonio/bens/1/laudos'
          ? { corpo: [laudo(77)] }
          : null,
    );
    const w = montarAjustes();
    await flushPromises();
    expect(w.find('[data-testid="ajustes-nenhum"]').exists()).toBe(true);
    await clicar(w, 'ajustes-registrar');
    await digitar(w, 'ajustes-recuperavel', '9.000,00');
    await digitar(w, 'ajustes-motivo', 'Laudo sintético de recuperabilidade');
    expect(w.find('[data-testid="ajustes-problemas"]').text()).toContain('laudo');
    expect(w.find('[data-testid="ajustes-gravar"]').attributes('disabled')).toBeDefined();
    // O laudo é um dos PDFs anexados ao bem (combo), não um número digitado.
    expect((propsDoCombo(w, 'ajustes-laudo')['opcoes'] as { valor: string }[]).map((o) => o.valor)).toEqual([
      '',
      '77',
    ]);
    await escolher(w, 'ajustes-laudo', '77');
    await w.find('[data-testid="ajustes-form"]').trigger('submit');
    await flushPromises();
    const p = posts(ps, '/ajustes')[0]!;
    expect(p.corpo).toEqual({
      versao: 3,
      motivo: 'Laudo sintético de recuperabilidade',
      tipo: 'impairment',
      recuperavelCent: 900_000,
      laudo: 77,
    });
    expect(w.find('[data-testid="ajustes-mensagem"]').text()).toContain('10/2026');
  });

  it('revisão de estimativa sem laudo; recusa sem conta mostra o aviso do ajuste', async () => {
    const ps = simular((u, m) =>
      m === 'POST' && u.endsWith('/ajustes')
        ? {
            status: 409,
            corpo: { type: 'about:blank', title: 'Conflito', status: 409, codigo: 'sem-conta' },
          }
        : null,
    );
    const w = montarAjustes();
    await flushPromises();
    await clicar(w, 'ajustes-registrar');
    await escolher(w, 'ajustes-tipo', 'revisao-estimativa');
    await digitar(w, 'ajustes-vida', '48');
    await digitar(w, 'ajustes-residual', '100,00');
    await digitar(w, 'ajustes-motivo', 'Revisão anual sintética');
    expect(w.find('[data-testid="ajustes-problemas"]').exists()).toBe(false);
    await w.find('[data-testid="ajustes-form"]').trigger('submit');
    await flushPromises();
    expect(posts(ps, '/ajustes')[0]!.corpo).toMatchObject({
      tipo: 'revisao-estimativa',
      vidaRestanteMeses: 48,
      residualCent: 10_000,
      laudo: null,
    });
    expect(w.find('[data-testid="recusa-patrimonio"]').text()).toContain('regra contábil');
  });

  it('lista com o estornado visível e estorna o vigente com motivo e senha', async () => {
    const ps = simular((u, m) => {
      if (u === '/api/patrimonio/bens/1/ajustes' && m === 'GET')
        return {
          corpo: [
            ajuste(4, {
              estorno: {
                motivo: 'Laudo trocado',
                origem: 'patrimonio/estorno-ajuste-bem',
                estornadoPor: 'OUTRO.SINTETICO',
                estornadoEm: '2026-10-19T09:00:00.000Z',
              },
            }),
            ajuste(5),
          ],
        };
      if (u === '/api/patrimonio/ajustes/5/estorno') return { status: 201, corpo: ajuste(5) };
      return null;
    });
    const w = montarAjustes();
    await flushPromises();
    expect(w.find('[data-testid="ajuste-estorno-4"]').text()).toContain('Laudo trocado');
    expect(w.find('[data-testid="ajuste-estornar-4"]').exists()).toBe(false);
    expect(w.find('[data-testid="ajuste-5"]').text()).toMatch(/2\.400,00/);
    await clicar(w, 'ajuste-estornar-5');
    await digitar(w, 'ajustes-estorno-motivo', 'Laudo sintético refeito');
    await digitar(w, 'ajustes-estorno-senha', 'segredo-sintetico');
    await clicar(w, 'ajustes-estorno-confirmar');
    await confirmarDestrutivo();
    expect(posts(ps, '/ajustes/5/estorno')[0]!.corpo).toEqual({
      motivo: 'Laudo sintético refeito',
      senha: 'segredo-sintetico',
    });
    expect(w.find('[data-testid="ajustes-mensagem"]').text()).toContain('estornado');
  });

  it('anexa o PDF do laudo (base64), escolhe-o no ajuste aberto e lista o laudo com o link do arquivo', async () => {
    let anexados: LaudoBem[] = [];
    const ps = simular((u, m) => {
      if (u === '/api/patrimonio/bens/1/laudos' && m === 'POST') {
        anexados = [laudo(81, { descricao: 'Laudo do perito sintético', nome: 'perito.pdf' })];
        return { status: 201, corpo: anexados[0] };
      }
      if (u === '/api/patrimonio/bens/1/laudos') return { corpo: anexados };
      if (u === '/api/patrimonio/bens/1/ajustes') return { corpo: [ajuste(5, { laudo: 81 })] };
      return null;
    });
    const w = montarAjustes();
    await flushPromises();
    expect(w.find('[data-testid="laudos-nenhum"]').exists()).toBe(true);
    expect(w.find('[data-testid="ajuste-laudo-5"]').attributes('href')).toBe(
      '/api/patrimonio/laudos/81/arquivo',
    );
    await clicar(w, 'ajustes-registrar');
    await clicar(w, 'laudos-anexar');
    expect(w.find('[data-testid="laudos-enviar"]').attributes('disabled')).toBeDefined();
    const pdf = new File(['%PDF-1.7 sintético'], 'perito.pdf', { type: 'application/pdf' });
    const input = w.find('[data-testid="laudos-arquivo"]');
    Object.defineProperty(input.element, 'files', { value: [pdf] });
    await input.trigger('change');
    await digitar(w, 'laudos-descricao', 'Laudo do perito sintético');
    expect(w.find('[data-testid="laudos-problemas"]').exists()).toBe(false);
    await w.find('[data-testid="laudos-form"]').trigger('submit');
    await flushPromises();
    await flushPromises();
    const p = posts(ps, '/laudos')[0]!;
    expect(p.corpo).toEqual({
      nome: 'perito.pdf',
      descricao: 'Laudo do perito sintético',
      conteudo: Buffer.from('%PDF-1.7 sintético').toString('base64'),
    });
    expect(w.find('[data-testid="ajustes-mensagem"]').text()).toContain('Laudo do perito sintético');
    expect(w.find('[data-testid="laudo-81"]').text()).toContain('perito.pdf');
    expect(w.find('[data-testid="laudo-abrir-81"]').attributes('href')).toBe(
      '/api/patrimonio/laudos/81/arquivo',
    );
    // O ajuste aberto já fica com o laudo recém-anexado escolhido.
    expect(propsDoCombo(w, 'ajustes-laudo')['modelValue']).toBe('81');
  });

  it('a recusa laudo-inexistente mostra o aviso do laudo', async () => {
    simular((u, m) =>
      m === 'POST' && u.endsWith('/ajustes')
        ? {
            status: 409,
            corpo: { type: 'about:blank', title: 'Conflito', status: 409, codigo: 'laudo-inexistente' },
          }
        : u.endsWith('/laudos')
          ? { corpo: [laudo(77)] }
          : null,
    );
    const w = montarAjustes();
    await flushPromises();
    await clicar(w, 'ajustes-registrar');
    await digitar(w, 'ajustes-recuperavel', '9.000,00');
    await digitar(w, 'ajustes-motivo', 'Laudo sintético de recuperabilidade');
    await escolher(w, 'ajustes-laudo', '77');
    await w.find('[data-testid="ajustes-form"]').trigger('submit');
    await flushPromises();
    expect(w.find('[data-testid="recusa-patrimonio"]').text()).toContain('não está anexado a este bem');
  });

  it('sem a permissão do cálculo só consulta; bem baixado não recebe ajuste', async () => {
    simular((u) => (u.endsWith('/ajustes') ? { corpo: [ajuste(5)] } : null));
    const w = montarAjustes(false);
    await flushPromises();
    expect(w.find('[data-testid="laudos-anexar"]').exists()).toBe(false);
    expect(w.find('[data-testid="ajustes-registrar"]').exists()).toBe(false);
    expect(w.find('[data-testid="ajuste-estornar-5"]').exists()).toBe(false);
    const w2 = montarAjustes(true, bem(1, { situacao: 'baixado' }));
    await flushPromises();
    expect(w2.find('[data-testid="ajustes-registrar"]').exists()).toBe(false);
  });
});

// ── Parâmetros ───────────────────────────────────────────────────────────────────────────────────────────────────────
describe('tela dos parâmetros', () => {
  it('embute os parâmetros que o perfil consulta', async () => {
    simular((u) =>
      u.startsWith('/api/patrimonio/apoio')
        ? { corpo: apoio({}, true, ['patrimonio.parametroPatrimonio']) }
        : null,
    );
    const w = montar(ParametrosTela);
    await flushPromises();
    await flushPromises();
    expect(w.find('[data-testid="dominio"]').text()).toBe('patrimonio.parametroPatrimonio');
  });
  it('sem nenhum dos cadastros no perfil: diz que não consulta', async () => {
    simular((u) => (u.startsWith('/api/patrimonio/apoio') ? { corpo: apoio({}, true, []) } : null));
    const w = montar(ParametrosTela);
    await flushPromises();
    await flushPromises();
    expect(w.find('[data-testid="parametros-nenhum"]').exists()).toBe(true);
  });
});

// ── Textos ───────────────────────────────────────────────────────────────────────────────────────────────────────────
function textos(o: unknown, caminho = ''): Array<[string, string]> {
  if (typeof o === 'string') return [[caminho, o]];
  if (o && typeof o === 'object')
    return Object.entries(o).flatMap(([k, v]) => textos(v, caminho ? `${caminho}.${k}` : k));
  return [];
}
describe('textos do patrimônio', () => {
  it('não citam o outro sistema, tabela do banco nem chave técnica', () => {
    const ruins = textos(mensagensPatrimonio).filter(
      ([, t]) =>
        /spdata|legado|sistema atual|sistema anterior/i.test(t) ||
        /\b(GPBENS|GPPARAMG|GPPARAMU|GPORIGEM|GECADNFS|GELANNFS|TBCENCUS|SGH_PAT_[A-Z_]+)\b/.test(t) ||
        /\bpatrimonio\.[a-z]+\b/.test(t),
    );
    expect(ruins).toEqual([]);
  });
  it('todo código mostrado tem rótulo', () => {
    for (const g of CODIGOS_GRUPO_BEM) expect(mensagensPatrimonio.grupos[g]).toBeTruthy();
    for (const s of SITUACOES_BEM) expect(mensagensPatrimonio.situacoesBem[s]).toBeTruthy();
    for (const x of TIPOS_MOVIMENTO_BEM) expect(mensagensPatrimonio.tiposMovimento[x]).toBeTruthy();
    for (const x of SITUACOES_MOVIMENTO_BEM) expect(mensagensPatrimonio.situacoesMovimento[x]).toBeTruthy();
    for (const x of RESULTADOS_LEITURA_INVENTARIO)
      expect(mensagensPatrimonio.resultadosLeitura[x]).toBeTruthy();
    for (const x of MOTIVOS_SEM_COTA) expect(mensagensPatrimonio.motivosSemCota[x]).toBeTruthy();
    for (const x of TIPOS_AJUSTE_BEM) {
      expect(mensagensPatrimonio.ajustes.tipos[x]).toBeTruthy();
      expect(mensagensPatrimonio.ajustes.ajudaTipo[x]).toBeTruthy();
    }
  });
});
