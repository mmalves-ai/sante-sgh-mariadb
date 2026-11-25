// @vitest-environment jsdom
// Telas dos complementos do patrimônio (F8, 07-FIN linha 149; CPC 27 / NBC TG 27): a agregação de valor na ficha do
// bem (validação na hora, componente buscado pela plaqueta, soma ao custo, retirada com data e motivo), o imobilizado
// em andamento (alerta do orçamento a 90% e o estouro, ativação com a vida útil do grupo, gravação escondida sem
// patrimonio.bem.cadastrar), o seguro dos bens (selo de subseguro, segurar com validação) e a busca do bem com a espera
// de 300 ms. Dados SINTÉTICOS; o fetch é simulado.
import { criarI18n, instalarUi, resolverMarca, SanteData, SanteSelecao } from '@sgh/ui';
import { QueryClient, VueQueryPlugin } from '@tanstack/vue-query';
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { App } from 'vue';
import { mensagensWeb } from '../../i18n/pt-BR.js';
import AgregacoesBem from './AgregacoesBem.vue';
import type { AgregacaoLida, ApoliceLida, BemSeguradoLido, ObraLida } from './api-complementos.js';
import BuscaBem from './BuscaBem.vue';
import ObrasTela from './ObrasTela.vue';
import SegurosTela from './SegurosTela.vue';

const sessao = vi.hoisted(() => ({ permissoes: new Set<string>() }));
vi.mock('../../casca/sessao/sessao.js', () => ({
  usarSessao: () => ({ permissoes: { value: sessao.permissoes } }),
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
const HOJE = '2026-10-28';
const montar = (componente: unknown, props: Record<string, unknown>) =>
  mount(componente as never, {
    attachTo: document.body,
    props: props as never,
    global: {
      plugins: [
        criarI18n(mensagensWeb as unknown as Record<string, unknown>),
        ui,
        [VueQueryPlugin, { queryClient: new QueryClient({ defaultOptions: { queries: { retry: false } } }) }],
      ] as never,
    },
  });

type Pedido = { url: string; metodo: string; corpo: unknown };
type Resposta = { status?: number; corpo: unknown };
function simular(rota: (url: string, metodo: string) => Resposta | null): Pedido[] {
  const pedidos: Pedido[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      const metodo = init?.method ?? 'GET';
      pedidos.push({ url: String(url), metodo, corpo: init?.body ? JSON.parse(String(init.body)) : null });
      const r = rota(String(url), metodo) ?? { status: 404, corpo: { title: 'não simulado' } };
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
  sessao.permissoes = new Set();
  document.body.innerHTML = '';
});

async function escolher(w: VueWrapper, testid: string, valor: unknown) {
  const c = w.findAllComponents(SanteSelecao).find((x) => x.attributes('data-testid') === testid);
  if (!c) throw new Error(`combo ${testid} não achado`);
  c.vm.$emit('update:modelValue', valor);
  await flushPromises();
}
async function data(w: VueWrapper, testid: string, valor: string) {
  const c = w.findAllComponents(SanteData).find((x) => x.attributes('data-testid') === testid);
  if (!c) throw new Error(`data ${testid} não achada`);
  c.vm.$emit('update:modelValue', valor);
  await flushPromises();
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
const existe = (w: VueWrapper, testid: string) => w.find(`[data-testid="${testid}"]`).exists();
const gravarDesligado = (w: VueWrapper, testid: string) =>
  w.find(`[data-testid="${testid}"]`).attributes('disabled') !== undefined;
const esperar = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ── Dados sintéticos ─────────────────────────────────────────────────────────────────────────────────────────────────
const BENS_BUSCA = {
  bens: [
    { id: 1, plaqueta: 'PC000001', descricao: 'MONITOR SINTÉTICO', situacao: 'ativo' },
    { id: 7, plaqueta: 'PC000007', descricao: 'PLACA SINTÉTICA', situacao: 'ativo' },
    { id: 8, plaqueta: 'PC000008', descricao: 'BEM BAIXADO SINTÉTICO', situacao: 'baixado' },
  ],
  total: 3,
  pagina: 1,
  tamanho: 30,
  totaisPagina: { valorCent: 0, acumuladaCent: 0, contabilCent: 0 },
};
const agregacao = (id: number, x: Partial<AgregacaoLida> = {}): AgregacaoLida => ({
  id,
  sequencia: id,
  tipo: 'melhoria',
  bemAgregado: null,
  numeroDocumento: null,
  descricao: 'MELHORIA SINTÉTICA',
  data: '2026-09-10',
  valorCent: 50_000,
  agregaValor: true,
  dataDesagregacao: null,
  observacao: null,
  versao: 1,
  ...x,
});
const APOIO = {
  grupos: [{ id: 3, codigo: 'EDF', descricao: 'EDIFICAÇÕES SINTÉTICAS', vidaUtilMeses: 300 }],
  contas: [{ id: 50, codigo: '1.2.3', descricao: 'IMOBILIZADO EM ANDAMENTO' }],
  seguradoras: [{ id: 9, nome: 'SEGURADORA SINTÉTICA' }],
  origens: [{ id: 2, descricao: 'COMPRA' }],
  centros: [{ id: 10, codigo: '101', nome: 'UTI SINTÉTICA' }],
};
const obra = (id: number, x: Partial<ObraLida> = {}): ObraLida => ({
  id,
  numero: id,
  descricao: `OBRA SINTÉTICA ${id}`,
  grupo: { id: 3, codigo: 'EDF', descricao: 'EDIFICAÇÕES SINTÉTICAS' },
  conta: 50,
  centro: 10,
  dataInicio: '2026-01-10',
  dataPrevista: null,
  dataAtivacao: null,
  orcadoCent: 100_000,
  acumuladoCent: 50_000,
  orcamento: { percentual: 50, estado: 'dentro' },
  bem: null,
  situacao: 'em_andamento',
  observacao: null,
  versao: 2,
  apropriacoes: [],
  ...x,
});
const OBRAS = [
  obra(1),
  obra(2, { acumuladoCent: 92_000, orcamento: { percentual: 92, estado: 'alerta' } }),
  obra(3, { acumuladoCent: 130_000, orcamento: { percentual: 130, estado: 'estourado' } }),
];
const segurado = (id: number, x: Partial<BemSeguradoLido> = {}): BemSeguradoLido => ({
  id,
  bem: id,
  plaqueta: `PC00000${id}`,
  descricao: 'BEM SINTÉTICO',
  valorSeguradoCent: 100_000,
  valorIndenizadoCent: 0,
  inicio: '2026-01-01',
  fim: null,
  ativo: true,
  valorContabilCent: 100_000,
  cobertura: { percentual: 100, subseguro: false, detalhe: '' },
  ...x,
});
const APOLICE: ApoliceLida = {
  id: 20,
  numero: 'AP-SINT-1',
  tipo: 'patrimonial',
  seguradora: { id: 9, nome: 'SEGURADORA SINTÉTICA' },
  corretorNome: null,
  corretorTelefone: null,
  corretorEmail: null,
  cobertura: null,
  inicio: '2026-01-01',
  fim: '2026-12-31',
  premioCent: 120_000,
  franquiaCent: null,
  totalSeguradoCent: 150_000,
  anterior: null,
  situacao: 'vigente',
  situacaoVista: 'vigente',
  bensCobertos: 2,
  versao: 1,
  bens: [
    segurado(1),
    segurado(2, {
      valorSeguradoCent: 50_000,
      cobertura: { percentual: 50, subseguro: true, detalhe: '50% do valor contábil' },
    }),
  ],
};

// ── Busca do bem ─────────────────────────────────────────────────────────────────────────────────────────────────────
describe('busca do bem pela plaqueta', () => {
  it('espera 300 ms depois da última tecla, manda um pedido só e tira o baixado e o próprio bem', async () => {
    const ps = simular((u) => (u.startsWith('/api/patrimonio/bens?') ? { corpo: BENS_BUSCA } : null));
    const w = montar(BuscaBem, {
      rotuloBusca: 'Buscar',
      rotulo: 'Bem',
      excluir: 1,
      testid: 'busca',
      modelValue: null,
    });
    await digitar(w, 'busca-busca', 'P');
    await digitar(w, 'busca-busca', 'PC');
    await digitar(w, 'busca-busca', 'PC0');
    await esperar(150);
    expect(ps.filter((p) => p.url.startsWith('/api/patrimonio/bens?'))).toHaveLength(0);
    await esperar(250);
    await flushPromises();
    await flushPromises();
    const buscas = ps.filter((p) => p.url.startsWith('/api/patrimonio/bens?'));
    expect(buscas).toHaveLength(1);
    expect(buscas[0]!.url).toContain('busca=PC0');
    const combo = w.findAllComponents(SanteSelecao).find((x) => x.attributes('data-testid') === 'busca')!;
    const opcoes = (combo.vm.$props as unknown as { opcoes: { valor: string }[] }).opcoes.map((o) => o.valor);
    expect(opcoes).toEqual(['', '7']);
  });

  it('termo com menos de 2 letras não vai ao servidor', async () => {
    const ps = simular(() => ({ corpo: BENS_BUSCA }));
    const w = montar(BuscaBem, { rotuloBusca: 'Buscar', rotulo: 'Bem', testid: 'busca', modelValue: null });
    await digitar(w, 'busca-busca', 'P');
    await esperar(350);
    await flushPromises();
    expect(ps).toHaveLength(0);
  });
});

// ── Agregação ────────────────────────────────────────────────────────────────────────────────────────────────────────
describe('agregação de valor na ficha do bem', () => {
  const rotas = (u: string, m: string): Resposta | null => {
    if (m === 'POST' && u === '/api/patrimonio/bens/1/agregacoes') return { status: 201, corpo: { id: 31 } };
    if (m === 'POST' && u === '/api/patrimonio/agregacoes/30/retirada') return { corpo: { versao: 2 } };
    if (u === '/api/patrimonio/bens/1/agregacoes')
      return {
        corpo: {
          bem: 1,
          versaoBem: 4,
          custoCent: 1_200_000,
          agregadoVigenteCent: 50_000,
          agregacoes: [
            agregacao(30),
            agregacao(29, { dataDesagregacao: '2026-10-01', descricao: 'SERVIÇO SINTÉTICO' }),
          ],
        },
      };
    if (u.startsWith('/api/patrimonio/bens?')) return { corpo: BENS_BUSCA };
    return null;
  };

  it('valida na hora (componente, descrição, data futura, valor) e grava o componente buscado com a soma ao custo', async () => {
    const ps = simular(rotas);
    const w = montar(AgregacoesBem, { bem: { id: 1, situacao: 'ativo' }, podeAgregar: true, hoje: HOJE });
    await flushPromises();
    await flushPromises();
    expect(w.find('[data-testid="agregacoes-custo"]').text()).toMatch(/12\.000,00.*500,00/);
    expect(existe(w, 'agregacao-retirada-29')).toBe(true);
    expect(existe(w, 'agregacao-retirar-29')).toBe(false);
    await clicar(w, 'agregacoes-registrar');
    await escolher(w, 'agregacoes-tipo', 'componente');
    expect(existe(w, 'agregacoes-componente-busca')).toBe(true);
    const problemas = () => w.find('[data-testid="agregacoes-problemas"]').text();
    expect(problemas()).toContain('Escolha o bem incorporado');
    expect(problemas()).toContain('ao menos 5 letras');
    expect(problemas()).toContain('maior que zero');
    expect(gravarDesligado(w, 'agregacoes-gravar')).toBe(true);

    await digitar(w, 'agregacoes-componente-busca', 'PC000007');
    await esperar(350);
    await flushPromises();
    await flushPromises();
    await escolher(w, 'agregacoes-componente', '7');
    await digitar(w, 'agregacoes-descricao', 'PLACA DE VÍDEO SINTÉTICA');
    await digitar(w, 'agregacoes-valor', '1.500,00');
    await data(w, 'agregacoes-data', '2026-11-30');
    expect(problemas()).toContain('não futura');
    expect(gravarDesligado(w, 'agregacoes-gravar')).toBe(true);
    await data(w, 'agregacoes-data', '2026-10-20');
    expect(existe(w, 'agregacoes-problemas')).toBe(false);
    await escolher(w, 'agregacoes-soma', 'sim');
    await w.find('[data-testid="agregacoes-form"]').trigger('submit');
    await flushPromises();
    await flushPromises();
    const post = ps.find((p) => p.metodo === 'POST' && p.url.endsWith('/bens/1/agregacoes'))!;
    expect(post.corpo).toMatchObject({
      versao: 4,
      tipo: 'componente',
      bemAgregado: 7,
      descricao: 'PLACA DE VÍDEO SINTÉTICA',
      data: '2026-10-20',
      valorCent: 150_000,
      agregaValor: true,
    });
    expect(w.find('[data-testid="agregacoes-mensagem"]').text()).toContain('Agregação registrada');
  });

  it('sem somar ao custo aceita valor zero; a retirada pede data não futura e motivo', async () => {
    const ps = simular(rotas);
    const w = montar(AgregacoesBem, { bem: { id: 1, situacao: 'ativo' }, podeAgregar: true, hoje: HOJE });
    await flushPromises();
    await flushPromises();
    await clicar(w, 'agregacoes-registrar');
    await digitar(w, 'agregacoes-descricao', 'REVISÃO SINTÉTICA');
    await escolher(w, 'agregacoes-soma', 'nao');
    expect(existe(w, 'agregacoes-problemas')).toBe(false);

    await clicar(w, 'agregacao-retirar-30');
    expect(existe(w, 'agregacoes-retirada')).toBe(true);
    expect(gravarDesligado(w, 'agregacoes-retirada-confirmar')).toBe(true);
    await digitar(w, 'agregacoes-retirada-motivo', 'PEÇA DEVOLVIDA');
    await data(w, 'agregacoes-retirada-data', '2026-12-01');
    expect(gravarDesligado(w, 'agregacoes-retirada-confirmar')).toBe(true);
    await data(w, 'agregacoes-retirada-data', '2026-10-25');
    expect(gravarDesligado(w, 'agregacoes-retirada-confirmar')).toBe(false);
    await clicar(w, 'agregacoes-retirada-confirmar');
    expect(ps.some((p) => p.url.endsWith('/retirada'))).toBe(false);
    await confirmarDestrutivo();
    const post = ps.find((p) => p.url === '/api/patrimonio/agregacoes/30/retirada')!;
    expect(post.corpo).toEqual({ versao: 1, data: '2026-10-25', motivo: 'PEÇA DEVOLVIDA' });
    expect(w.find('[data-testid="agregacoes-mensagem"]').text()).toContain('Retirada registrada');
  });

  it('sem a permissão ou com o bem baixado: só consulta', async () => {
    simular(rotas);
    const w = montar(AgregacoesBem, { bem: { id: 1, situacao: 'ativo' }, podeAgregar: false, hoje: HOJE });
    await flushPromises();
    await flushPromises();
    expect(existe(w, 'agregacoes-registrar')).toBe(false);
    expect(existe(w, 'agregacao-retirar-30')).toBe(false);
    expect(w.text()).toContain('permissão de cadastrar bens');
    const b = montar(AgregacoesBem, { bem: { id: 1, situacao: 'baixado' }, podeAgregar: true, hoje: HOJE });
    await flushPromises();
    await flushPromises();
    expect(existe(b, 'agregacoes-registrar')).toBe(false);
    expect(existe(b, 'agregacao-retirar-30')).toBe(false);
  });
});

// ── Obras ────────────────────────────────────────────────────────────────────────────────────────────────────────────
describe('imobilizado em andamento (obras)', () => {
  const rotas = (u: string, m: string): Resposta | null => {
    if (u === '/api/patrimonio/complementos/apoio') return { corpo: APOIO };
    if (m === 'POST' && u === '/api/patrimonio/obras') return { status: 201, corpo: { id: 4, numero: 4 } };
    if (m === 'POST' && u === '/api/patrimonio/obras/2/ativacao') return { status: 201, corpo: { bem: 99 } };
    if (/\/api\/patrimonio\/obras\/\d+$/.test(u))
      return { corpo: OBRAS.find((o) => o.id === Number(u.split('/').pop())) ?? OBRAS[0] };
    if (u.startsWith('/api/patrimonio/obras')) return { corpo: OBRAS };
    return null;
  };

  it('mostra o consumo, o alerta a 90% e o estouro na lista e no detalhe', async () => {
    sessao.permissoes = new Set(['patrimonio.bem.ler', 'patrimonio.bem.cadastrar']);
    simular(rotas);
    const w = montar(ObrasTela, { hoje: HOJE });
    await flushPromises();
    await flushPromises();
    expect(w.find('[data-testid="obra-orcamento-1"]').text()).toContain('50% do orçamento');
    expect(w.find('[data-testid="obra-orcamento-2"]').text()).toContain('90% ou mais');
    expect(w.find('[data-testid="obra-orcamento-3"]').text()).toContain('Orçamento estourado');
    await clicar(w, 'obra-abrir-1');
    expect(existe(w, 'obra-alerta-orcamento')).toBe(false);
    await clicar(w, 'obra-abrir-2');
    expect(w.find('[data-testid="obra-alerta-orcamento"]').text()).toContain('90% ou mais');
    await clicar(w, 'obra-abrir-3');
    expect(w.find('[data-testid="obra-alerta-orcamento"]').text()).toContain('Orçamento estourado');
  });

  it('abrir obra valida na hora; a ativação vem com a vida útil do grupo e confere o residual', async () => {
    sessao.permissoes = new Set(['patrimonio.bem.ler', 'patrimonio.bem.cadastrar']);
    const ps = simular(rotas);
    const w = montar(ObrasTela, { hoje: HOJE });
    await flushPromises();
    await flushPromises();
    await clicar(w, 'obras-nova');
    expect(gravarDesligado(w, 'obras-gravar')).toBe(true);
    await digitar(w, 'obras-descricao', 'REFORMA SINTÉTICA DA ALA');
    await escolher(w, 'obras-grupo', '3');
    await data(w, 'obras-inicio', '2026-11-30');
    expect(w.find('[data-testid="obras-problemas"]').exists()).toBe(true);
    await data(w, 'obras-inicio', '2026-10-01');
    await digitar(w, 'obras-orcado', 'abc');
    expect(gravarDesligado(w, 'obras-gravar')).toBe(true);
    await digitar(w, 'obras-orcado', '10.000,00');
    expect(existe(w, 'obras-problemas')).toBe(false);
    await w.find('[data-testid="obras-form"]').trigger('submit');
    await flushPromises();
    await flushPromises();
    expect(ps.find((p) => p.metodo === 'POST' && p.url === '/api/patrimonio/obras')!.corpo).toMatchObject({
      descricao: 'REFORMA SINTÉTICA DA ALA',
      grupo: 3,
      dataInicio: '2026-10-01',
      orcadoCent: 1_000_000,
    });

    await clicar(w, 'obra-abrir-2');
    await clicar(w, 'obra-ativar');
    const vida = w.find('[data-testid="ativacao-vida"] input');
    expect((vida.element as HTMLInputElement).value).toBe('300');
    await digitar(w, 'ativacao-plaqueta', 'OB000002');
    await escolher(w, 'ativacao-origem', '2');
    await digitar(w, 'ativacao-residual', '2.000,00');
    expect(gravarDesligado(w, 'ativacao-gravar')).toBe(true);
    await digitar(w, 'ativacao-residual', '100,00');
    expect(existe(w, 'ativacao-problemas')).toBe(false);
  });

  it('sem patrimonio.bem.cadastrar: só consulta (sem abrir, apropriar, ativar nem cancelar)', async () => {
    sessao.permissoes = new Set(['patrimonio.bem.ler']);
    simular(rotas);
    const w = montar(ObrasTela, { hoje: HOJE });
    await flushPromises();
    await flushPromises();
    expect(existe(w, 'obras-nova')).toBe(false);
    await clicar(w, 'obra-abrir-1');
    expect(existe(w, 'obra-detalhe')).toBe(true);
    expect(existe(w, 'obra-apropriar')).toBe(false);
    expect(existe(w, 'obra-ativar')).toBe(false);
    expect(existe(w, 'obra-cancelar')).toBe(false);
    expect(w.text()).toContain('permissão de cadastrar bens');
  });
});

// ── Seguros ──────────────────────────────────────────────────────────────────────────────────────────────────────────
describe('seguro dos bens', () => {
  const rotas = (u: string, m: string): Resposta | null => {
    if (u === '/api/patrimonio/complementos/apoio') return { corpo: APOIO };
    if (m === 'POST' && u === '/api/patrimonio/apolices/20/bens') return { status: 201, corpo: { id: 3 } };
    if (u === '/api/patrimonio/apolices/20') return { corpo: APOLICE };
    if (u === '/api/patrimonio/apolices') return { corpo: [APOLICE] };
    if (u.startsWith('/api/patrimonio/bens?')) return { corpo: BENS_BUSCA };
    return null;
  };

  it('mostra o selo de subseguro só no bem abaixo do limite; segurar valida na hora', async () => {
    sessao.permissoes = new Set(['patrimonio.bem.ler', 'patrimonio.bem.cadastrar']);
    const ps = simular(rotas);
    const w = montar(SegurosTela, { hoje: HOJE });
    await flushPromises();
    await flushPromises();
    expect(w.find('[data-testid="apolice-situacao-20"]').text()).toBeTruthy();
    await clicar(w, 'apolice-abrir-20');
    expect(existe(w, 'segurado-subseguro-1')).toBe(false);
    expect(w.find('[data-testid="segurado-subseguro-2"]').text()).toMatch(/Subseguro.*50%/);
    await clicar(w, 'apolice-segurar');
    expect(gravarDesligado(w, 'segurar-gravar')).toBe(true);
    expect(existe(w, 'segurar-problemas')).toBe(true);
    await digitar(w, 'segurar-bem-busca', 'PC000007');
    await esperar(350);
    await flushPromises();
    await flushPromises();
    await escolher(w, 'segurar-bem', '7');
    await digitar(w, 'segurar-valor', '0');
    expect(gravarDesligado(w, 'segurar-gravar')).toBe(true);
    await digitar(w, 'segurar-valor', '800,00');
    expect(existe(w, 'segurar-problemas')).toBe(false);
    await w.find('[data-testid="segurar-form"]').trigger('submit');
    await flushPromises();
    await flushPromises();
    expect(ps.find((p) => p.metodo === 'POST' && p.url.endsWith('/apolices/20/bens'))!.corpo).toMatchObject({
      versao: 1,
      bem: 7,
      valorSeguradoCent: 80_000,
      inicio: HOJE,
    });
  });

  it('sem patrimonio.bem.cadastrar: só consulta (sem nova apólice, segurar, retirar nem cancelar)', async () => {
    sessao.permissoes = new Set(['patrimonio.bem.ler']);
    simular(rotas);
    const w = montar(SegurosTela, { hoje: HOJE });
    await flushPromises();
    await flushPromises();
    expect(existe(w, 'seguros-nova')).toBe(false);
    await clicar(w, 'apolice-abrir-20');
    expect(existe(w, 'segurado-subseguro-2')).toBe(true);
    expect(existe(w, 'segurado-retirar-1')).toBe(false);
    expect(existe(w, 'apolice-segurar')).toBe(false);
    expect(existe(w, 'apolice-cancelar')).toBe(false);
  });
});
