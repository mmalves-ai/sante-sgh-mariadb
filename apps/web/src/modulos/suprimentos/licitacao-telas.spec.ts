// @vitest-environment jsdom
// Tela da licitação e do pregão (M55, etapa 4): os textos cobrem todo vocabulário sem citar o sistema anterior; os
// apoios puros (abertura mínima do aviso em dias úteis, empates, atos por etapa, número digitado, permissão); o painel
// por etapa, a lista e o filtro; os pedidos marcados como licitação; o termo de referência conferido antes de enviar e
// gravado com a Idempotency-Key; o processo aberto (montado pela mesma regra pura da API) com a pesquisa e a conta, o
// preço, a proposta desclassificada com o motivo, o julgamento com o desempate, a publicação do aviso com o prazo, o
// pedido ligado, a homologação e a decisão do recurso pela autoridade; em consulta, o motivo e as ações desabilitadas.
// Dados SINTÉTICOS; o fetch é simulado.
import {
  CRITERIOS_JULGAMENTO,
  ETAPAS_LICITACAO,
  type EventoLicitacao,
  FONTES_PRECO,
  type ItemLicitacao,
  type LicitacaoGravada,
  MODALIDADES_LICITACAO,
  NATUREZAS_OBJETO_LICITACAO,
  PARAMETROS_LICITACAO_PADRAO,
  type PrecoPesquisado,
  type PropostaLicitacao,
  TIPOS_EVENTO_LICITACAO,
  VEICULOS_PUBLICACAO,
} from '@sgh/contratos';
import { montarLicitacao } from '@sgh/dominio-suprimentos';
import { criarI18n, instalarUi, resolverMarca } from '@sgh/ui';
import { QueryClient, VueQueryPlugin } from '@tanstack/vue-query';
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { App } from 'vue';
import { mensagensWeb } from '../../i18n/pt-BR.js';
import LicitacaoDetalhePainel from './componentes/LicitacaoDetalhePainel.vue';
import LicitacaoFormulario from './componentes/LicitacaoFormulario.vue';
import {
  aberturaMinima,
  ehDireta,
  empatesDoJulgamento,
  eventosNaEtapa,
  lerNumero,
  nomeFornecedor,
  podeLicitacao,
  rotuloCriterio,
  rotuloEtapa,
  rotuloEventoLicitacao,
  rotuloFonte,
  rotuloModalidade,
  rotuloNatureza,
  rotuloVeiculo,
} from './componentes/licitacao-tela.js';
import { mensagensLicitacao } from './i18n-licitacao.js';
import LicitacoesTela from './telas/LicitacoesTela.vue';

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
const montar = (c: unknown, props: Record<string, unknown> = {}) =>
  mount(c as never, {
    props: props as never,
    global: {
      plugins: [
        criarI18n(mensagensWeb as unknown as Record<string, unknown>),
        ui,
        [VueQueryPlugin, { queryClient: new QueryClient({ defaultOptions: { queries: { retry: false } } }) }],
      ] as never,
      stubs: { RouterLink: { template: '<a><slot /></a>' } },
    },
  });

interface Chamada {
  url: string;
  metodo: string;
  corpo: Record<string, unknown> | null;
  chave: string | null;
}
function simular(rota: (url: string, metodo: string) => unknown): Chamada[] {
  const chamadas: Chamada[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      const metodo = init?.method ?? 'GET';
      const h = (init?.headers ?? {}) as Record<string, string>;
      chamadas.push({
        url: String(url),
        metodo,
        corpo: init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : null,
        chave: h['idempotency-key'] ?? null,
      });
      return new Response(JSON.stringify(rota(String(url), metodo)), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }),
  );
  return chamadas;
}
afterEach(() => vi.unstubAllGlobals());

async function selecionar(w: VueWrapper, testid: string, v: unknown): Promise<void> {
  const c = w.findAllComponents({ name: 'SanteSelecao' }).find((x) => x.attributes('data-testid') === testid);
  if (!c) throw new Error(`sem a seleção ${testid}`);
  c.vm.$emit('update:modelValue', v);
  await flushPromises();
}

const HOJE = '2026-10-29';
const gravacao = (ligada: boolean, ops: Record<string, boolean> = { conduzir: true, homologar: true }) => ({
  ligada,
  motivo: ligada ? null : 'A licitação e o pregão ainda não foram liberados neste estabelecimento.',
  operacoes: Object.fromEntries(
    Object.entries(ops).map(([o, p]) => [o, { pode: ligada && p, motivo: null }]),
  ),
});

const processo = (o: Partial<LicitacaoGravada> = {}): LicitacaoGravada => ({
  id: 7,
  numero: '12/2026',
  regime: 'lei-14133',
  modalidade: 'pregao-eletronico',
  criterio: 'menor-preco',
  natureza: 'bens',
  objeto: 'Luvas de procedimento sintéticas',
  justificativa: 'Reposição anual do estoque de luvas, consumo sintético.',
  fundamento: null,
  pesoTecnica: null,
  sigiloso: false,
  metodoEstimativa: 'mediana',
  valorEstimado: null,
  agente: 'SINT.AGENTE',
  centroCusto: null,
  etapa: 'pesquisa',
  dataPublicacao: null,
  dataAbertura: null,
  dataJulgamento: null,
  julgadoPor: null,
  homologadoPor: null,
  homologadoEm: null,
  versao: 4,
  usuario: 'SINT.AGENTE',
  criadoEm: '2026-10-20T10:00:00',
  ...o,
});
const item = (o: Partial<ItemLicitacao>): ItemLicitacao => ({
  id: 101,
  numero: 1,
  descricao: 'Luva de procedimento M',
  itemEstoque: null,
  unidade: 'CX',
  quantidade: 100,
  valorEstimado: null,
  resultado: null,
  vencedor: null,
  valorAdjudicado: null,
  ...o,
});
const preco = (id: number, it: number, valor: number): PrecoPesquisado => ({
  id,
  item: it,
  fonte: 'painel',
  referencia: `Painel sintético ${id}`,
  valor,
  data: '2026-10-21',
  fornecedor: null,
  usuario: 'SINT.AGENTE',
  descarte: null,
});
const proposta = (id: number, it: number, fornecedor: number, valor: number): PropostaLicitacao => ({
  id,
  item: it,
  fornecedor,
  fornecedorNome: `Fornecedor sintético ${fornecedor}`,
  valor,
  lance: null,
  notaTecnica: null,
  marca: null,
  situacao: 'valida',
  motivo: null,
});
const evento = (
  id: number,
  tipo: EventoLicitacao['tipo'],
  o: Partial<EventoLicitacao> = {},
): EventoLicitacao => ({
  id,
  tipo,
  de: null,
  para: null,
  data: '2026-10-22',
  veiculo: null,
  referencia: null,
  fornecedor: null,
  resultado: null,
  pedido: null,
  documento: null,
  descricao: 'Ato sintético',
  usuario: 'SINT.AGENTE',
  criadoEm: '2026-10-22T09:00:00',
  ...o,
});

/** O detalhe como a API o monta (a mesma regra pura), com a gravação. */
function detalhe(
  o: {
    processo?: Partial<LicitacaoGravada>;
    itens?: ItemLicitacao[];
    precos?: PrecoPesquisado[];
    propostas?: PropostaLicitacao[];
    eventos?: EventoLicitacao[];
    usuario?: string;
    ligada?: boolean;
    ops?: Record<string, boolean>;
  } = {},
) {
  const itens = o.itens ?? [
    item({}),
    item({ id: 102, numero: 2, descricao: 'Avental descartável', quantidade: 10 }),
  ];
  const precos = o.precos ?? [preco(1, 101, 10), preco(2, 101, 12), preco(3, 101, 11), preco(4, 102, 50)];
  const eventos = o.eventos ?? [];
  const d = montarLicitacao(
    {
      processo: processo(o.processo),
      itens,
      precos,
      propostas: o.propostas ?? [],
      eventos,
      hoje: HOJE,
      parametros: PARAMETROS_LICITACAO_PADRAO,
      precosDetalhe: precos,
      eventosDetalhe: eventos,
    },
    o.usuario ?? 'SINT.AGENTE',
    true,
  );
  return { ...d, gravacao: gravacao(o.ligada ?? true, o.ops) };
}

const ok = { ok: true, id: 7, registro: 1, etapa: 'pesquisa', repetido: false, mensagem: 'Gravado.' };
function rotaCom(det: unknown, listaLigada = true) {
  return (url: string, metodo: string) => {
    if (metodo !== 'GET') return ok;
    if (url.includes('/licitacoes/pedidos-marcados'))
      return {
        itens: [
          {
            pedido: 900,
            ano: 2021,
            documento: 55,
            sequencia: 1,
            descricao: 'Serviço sintético A',
            fornecedor: 500,
            data: '2021-03-02',
          },
          {
            pedido: 900,
            ano: 2021,
            documento: 55,
            sequencia: 2,
            descricao: 'Serviço sintético B',
            fornecedor: 500,
            data: '2021-03-02',
          },
          {
            pedido: 901,
            ano: 2023,
            documento: 8,
            sequencia: 1,
            descricao: 'Serviço sintético C',
            fornecedor: null,
            data: null,
          },
        ],
      };
    if (url.includes('/licitacoes/usuarios'))
      return { itens: [{ login: 'SINT.AGENTE', nome: 'Agente sintético' }] };
    if (url.includes('/licitacoes/fornecedores'))
      return { itens: [{ codigo: 500, nome: 'Fornecedor sintético 500' }], cortada: false };
    if (/\/licitacoes\/7$/.test(url)) return det;
    return {
      hoje: HOJE,
      itens: [
        {
          id: 7,
          numero: '12/2026',
          regime: 'lei-14133',
          modalidade: 'pregao-eletronico',
          criterio: 'menor-preco',
          objeto: 'Luvas de procedimento sintéticas',
          etapa: 'pesquisa',
          agente: 'SINT.AGENTE',
          valorEstimado: 1600,
          dataAbertura: null,
          itens: 2,
          versao: 4,
        },
      ],
      pagina: 1,
      cortada: false,
      painel: { porEtapa: { pesquisa: 1, homologado: 2 }, emAndamento: 1, sessoesProximas: 0 },
      gravacao: gravacao(listaLigada),
    };
  };
}

describe('textos da licitação e do pregão', () => {
  it('cobrem todo vocabulário e não citam o sistema anterior', () => {
    for (const e of ETAPAS_LICITACAO) expect(rotuloEtapa(e.codigo)).not.toBe('—');
    for (const m of MODALIDADES_LICITACAO) expect(rotuloModalidade(m.codigo)).not.toBe('—');
    for (const c of CRITERIOS_JULGAMENTO) expect(rotuloCriterio(c.codigo)).not.toBe('—');
    for (const n of NATUREZAS_OBJETO_LICITACAO) expect(rotuloNatureza(n.codigo)).not.toBe('—');
    for (const f of FONTES_PRECO) expect(rotuloFonte(f.codigo)).not.toBe('—');
    for (const v of VEICULOS_PUBLICACAO) expect(rotuloVeiculo(v.codigo)).not.toBe('—');
    for (const t of TIPOS_EVENTO_LICITACAO) expect(rotuloEventoLicitacao(t.codigo)).not.toBe('—');
    const valores = (o: object): string[] =>
      Object.values(o).flatMap((v) => (typeof v === 'string' ? [v] : valores(v as object)));
    const todos = valores(mensagensLicitacao).join('\n');
    expect(todos).not.toMatch(/spdata|legado|sistema anterior|GEDESPDS|GECADPED|SGH_/i);
    expect(todos).not.toMatch(/[|@]/);
  });
});

describe('apoios puros da tela', () => {
  it('a abertura mínima do aviso em dias úteis (art. 55) e nenhuma na contratação direta', () => {
    const pregao = {
      regime: 'lei-14133',
      modalidade: 'pregao-eletronico',
      criterio: 'menor-preco',
      natureza: 'bens',
    };
    expect(aberturaMinima(pregao, '2026-10-29', PARAMETROS_LICITACAO_PADRAO)).toEqual({
      dias: 8,
      data: '2026-11-10',
    });
    expect(
      aberturaMinima({ ...pregao, natureza: 'servico-especial' }, '2026-10-29', PARAMETROS_LICITACAO_PADRAO)
        ?.dias,
    ).toBe(25);
    expect(
      aberturaMinima({ ...pregao, regime: 'regulamento' }, '2026-10-29', PARAMETROS_LICITACAO_PADRAO)?.dias,
    ).toBe(5);
    expect(
      aberturaMinima({ ...pregao, modalidade: 'dispensa' }, '2026-10-29', PARAMETROS_LICITACAO_PADRAO),
    ).toBeNull();
    expect(aberturaMinima(pregao, '', PARAMETROS_LICITACAO_PADRAO)).toBeNull();
  });

  it('número digitado, contratação direta, permissão e nome do fornecedor', () => {
    expect(lerNumero('1.234,56')).toBe(1234.56);
    expect(lerNumero('9.80')).toBe(9.8);
    expect(lerNumero('')).toBeNull();
    expect(lerNumero('-3')).toBeNull();
    expect(lerNumero('abc')).toBeNull();
    expect(ehDireta('dispensa')).toBe(true);
    expect(ehDireta('inexigibilidade')).toBe(true);
    expect(ehDireta('pregao-eletronico')).toBe(false);
    expect(podeLicitacao(gravacao(true), 'conduzir')).toBe(true);
    expect(podeLicitacao(gravacao(false), 'conduzir')).toBe(false);
    expect(podeLicitacao(gravacao(true, { conduzir: true, homologar: false }), 'homologar')).toBe(false);
    expect(podeLicitacao(null, 'conduzir')).toBe(false);
    const ps = [proposta(1, 101, 500, 10)];
    expect(nomeFornecedor(ps, 500)).toBe('500 · Fornecedor sintético 500');
    expect(nomeFornecedor(ps, 777)).toBe('777');
    expect(nomeFornecedor(ps, null)).toBe('—');
  });

  it('os atos que cabem em cada etapa (recurso só no julgado e fora da contratação direta)', () => {
    expect(eventosNaEtapa('planejamento', 'pregao-eletronico')).toEqual(['parecer', 'documento']);
    expect(eventosNaEtapa('publicado', 'pregao-eletronico')).toEqual(['esclarecimento', 'documento']);
    expect(eventosNaEtapa('julgado', 'pregao-eletronico')).toEqual(['recurso', 'documento', 'ata']);
    expect(eventosNaEtapa('julgado', 'dispensa')).toEqual(['documento', 'ata']);
    expect(eventosNaEtapa('homologado', 'pregao-eletronico')).toEqual(['documento', 'ata', 'pedido']);
  });

  it('os empates do julgamento com os fornecedores em empate', () => {
    const d = detalhe({
      processo: { etapa: 'sessao' },
      itens: [item({ valorEstimado: 11 }), item({ id: 102, numero: 2, valorEstimado: 50 })],
      propostas: [proposta(1, 101, 500, 10.5), proposta(2, 101, 501, 10.5), proposta(3, 102, 500, 48)],
    });
    expect(empatesDoJulgamento(d.julgamento)).toEqual([{ item: 101, fornecedores: [500, 501] }]);
    expect(empatesDoJulgamento(null)).toEqual([]);
  });
});

describe('a tela da licitação', () => {
  it('o painel por etapa, a lista e o filtro pela etapa', async () => {
    const chamadas = simular(rotaCom(detalhe()));
    const w = montar(LicitacoesTela);
    await flushPromises();
    expect(w.get('[data-testid="lic-painel-andamento"]').text()).toBe('1');
    expect(w.get('[data-testid="lic-painel-homologado"]').text()).toContain('Homologado: 2');
    expect(w.find('[data-testid="lic-painel-sessao"]').exists()).toBe(false);
    expect(w.get('[data-testid="lic-linha-7"]').text()).toContain('Pregão eletrônico');
    expect(w.get('[data-testid="lic-estimado-7"]').text()).toContain('1.600,00');
    await w.get('[data-testid="lic-painel-homologado"]').trigger('click');
    await flushPromises();
    expect(chamadas.at(-1)!.url).toBe('/api/suprimentos/licitacoes?etapa=homologado&pagina=1');
  });

  it('os pedidos de compra marcados como licitação, com a contagem', async () => {
    simular(rotaCom(detalhe()));
    const w = montar(LicitacoesTela);
    await flushPromises();
    await w.get('[data-testid="lic-aba-marcados"]').trigger('click');
    await flushPromises();
    expect(w.get('[data-testid="lic-marcados-total"]').text()).toBe('3 linha(s) de 2 pedido(s).');
    expect(w.get('[data-testid="lic-marcados"]').text()).toContain('Serviço sintético C');
  });

  it('em consulta: o motivo e o novo processo desabilitado', async () => {
    simular(rotaCom(detalhe(), false));
    const w = montar(LicitacoesTela);
    await flushPromises();
    expect(w.get('[data-testid="lic-desligado"]').text()).toContain('ainda não foram liberados');
    expect(w.get('[data-testid="lic-novo"]').attributes('disabled')).toBeDefined();
  });
});

describe('o termo de referência', () => {
  it('confere antes de enviar e grava com a Idempotency-Key', async () => {
    const chamadas = simular(rotaCom(detalhe()));
    const w = montar(LicitacaoFormulario, { pode: true });
    await w.get('form').trigger('submit');
    await flushPromises();
    expect(w.get('[data-testid="lic-faltam"]').text()).toContain('Informe o número do processo.');
    expect(chamadas.filter((c) => c.metodo === 'POST')).toHaveLength(0);

    await w.get('[data-testid="lic-numero"]').setValue('12/2026');
    await w.get('[data-testid="lic-objeto"]').setValue('Luvas de procedimento sintéticas');
    await w
      .get('[data-testid="lic-justificativa"]')
      .setValue('Reposição anual do estoque de luvas, consumo sintético.');
    await w.get('[data-testid="lic-agente-termo"]').setValue('SINT');
    await w.get('[data-testid="lic-agente-buscar"]').trigger('click');
    await flushPromises();
    await selecionar(w, 'lic-agente', 'SINT.AGENTE');
    await w.get('[data-testid="lic-item-desc-1"]').setValue('Luva de procedimento M');
    await w.get('[data-testid="lic-item-qtd-1"]').setValue('1000');
    await w.get('[data-testid="lic-item-incluir"]').trigger('click');
    await w.get('[data-testid="lic-item-desc-2"]').setValue('Avental descartável');
    await w.get('[data-testid="lic-item-qtd-2"]').setValue('10,5');
    await w.get('form').trigger('submit');
    await flushPromises();
    const post = chamadas.find((c) => c.metodo === 'POST')!;
    expect(post.url).toBe('/api/suprimentos/licitacoes');
    expect(post.corpo).toMatchObject({
      numero: '12/2026',
      modalidade: 'pregao-eletronico',
      criterio: 'menor-preco',
      agente: 'SINT.AGENTE',
      fundamento: null,
      pesoTecnica: null,
      itens: [
        { descricao: 'Luva de procedimento M', unidade: 'UN', quantidade: 1000, itemEstoque: null },
        { descricao: 'Avental descartável', unidade: 'UN', quantidade: 10.5, itemEstoque: null },
      ],
    });
    expect(post.chave).toBeTruthy();
    expect(post.corpo!['chave']).toBe(post.chave);
    expect(w.emitted('gravado')?.[0]).toEqual([7, 'Gravado.']);
  });

  it('a contratação direta pede o fundamento legal; o pregão recusa técnica e preço', async () => {
    simular(rotaCom(detalhe()));
    const w = montar(LicitacaoFormulario, { pode: true });
    expect(w.find('[data-testid="lic-fundamento"]').exists()).toBe(false);
    await selecionar(w, 'lic-criterio', 'tecnica-preco');
    await w.get('form').trigger('submit');
    await flushPromises();
    expect(w.get('[data-testid="lic-faltam"]').text()).toContain('O pregão é julgado pelo menor preço');
    await selecionar(w, 'lic-modalidade', 'dispensa');
    await selecionar(w, 'lic-criterio', 'menor-preco');
    expect(w.find('[data-testid="lic-fundamento"]').exists()).toBe(true);
    expect(w.get('[data-testid="lic-faltam"]').text()).toContain('Informe o fundamento legal');
  });
});

describe('o processo aberto', () => {
  it('a pesquisa com a conta impressa e o preço registrado com a versão', async () => {
    const chamadas = simular(rotaCom(detalhe()));
    const w = montar(LicitacaoDetalhePainel, { id: 7 });
    await flushPromises();
    expect(w.get('[data-testid="lic-det-aviso-pesquisa-insuficiente"]').text()).toContain('1 item(ns)');
    await w.get('[data-testid="lic-det-aba-pesquisa"]').trigger('click');
    await flushPromises();
    expect(w.get('[data-testid="lic-est-item-1"]').text()).toContain('1.100,00');
    expect(w.get('[data-testid="lic-est-item-2"]').text()).toContain('Abaixo do mínimo de 3 preços');
    expect(w.get('[data-testid="lic-conta-total"]').text()).toMatch(/1\.100|1100/);

    await selecionar(w, 'lic-preco-fonte', 'fornecedor');
    await w.get('[data-testid="lic-preco-valor"]').setValue('9,80');
    await w.get('[data-testid="lic-preco-ref"]').setValue('Cotação sintética por e-mail');
    await w.get('[data-testid="lic-preco-form"]').trigger('submit');
    await flushPromises();
    expect(w.get('[data-testid="lic-preco-faltam"]').text()).toContain('Escolha o fornecedor consultado.');
    expect(chamadas.filter((c) => c.metodo === 'POST')).toHaveLength(0);

    await selecionar(w, 'lic-preco-fonte', 'painel');
    await w.get('[data-testid="lic-preco-form"]').trigger('submit');
    await flushPromises();
    const post = chamadas.find((c) => c.metodo === 'POST')!;
    expect(post.url).toBe('/api/suprimentos/licitacoes/7/precos');
    expect(post.corpo).toMatchObject({
      versao: 4,
      item: 101,
      fonte: 'painel',
      valor: 9.8,
      data: HOJE,
      fornecedor: null,
    });
    expect(post.corpo!['chave']).toBe(post.chave);
    expect(w.get('[data-testid="lic-det-mensagem"]').text()).toBe('Gravado.');
  });

  const sessao = () =>
    detalhe({
      processo: {
        etapa: 'sessao',
        dataPublicacao: '2026-10-01',
        dataAbertura: '2026-10-15',
        valorEstimado: 1600,
      },
      itens: [
        item({ valorEstimado: 11 }),
        item({ id: 102, numero: 2, descricao: 'Avental descartável', quantidade: 10, valorEstimado: 50 }),
      ],
      propostas: [proposta(1, 101, 500, 10.5), proposta(2, 101, 501, 10.5), proposta(3, 102, 500, 48)],
    });

  it('a proposta desclassificada pede o motivo e vai pelo PUT com a versão', async () => {
    const chamadas = simular(rotaCom(sessao()));
    const w = montar(LicitacaoDetalhePainel, { id: 7 });
    await flushPromises();
    await w.get('[data-testid="lic-det-aba-sessao"]').trigger('click');
    await flushPromises();
    await w.get('[data-testid="lic-desclassificar-3"]').trigger('click');
    await flushPromises();
    expect(w.get('[data-testid="lic-situacao-confirmar"]').attributes('disabled')).toBeDefined();
    await w.get('[data-testid="lic-situacao-motivo"]').setValue('Documentação técnica sintética ausente');
    await w.get('[data-testid="lic-situacao-form"]').trigger('submit');
    await flushPromises();
    const put = chamadas.find((c) => c.metodo === 'PUT')!;
    expect(put.url).toBe('/api/suprimentos/licitacoes/7/propostas/3');
    expect(put.corpo).toEqual({
      versao: 4,
      situacao: 'desclassificada',
      motivo: 'Documentação técnica sintética ausente',
    });
    expect(put.chave).toBeNull();
  });

  it('o julgamento com empate pede o desempate justificado e o grava', async () => {
    const chamadas = simular(rotaCom(sessao()));
    const w = montar(LicitacaoDetalhePainel, { id: 7 });
    await flushPromises();
    expect(w.get('[data-testid="lic-det-aviso-empate"]').text()).toContain('1 item(ns) empatado(s)');
    await w.get('[data-testid="lic-det-aba-sessao"]').trigger('click');
    await flushPromises();
    expect(w.get('[data-testid="lic-julg-item-2"]').text()).toContain('Fornecedor sintético 500');
    expect(w.get('[data-testid="lic-julgar"]').attributes('disabled')).toBeDefined();
    await selecionar(w, 'lic-desempate-1', 501);
    await w
      .get('[data-testid="lic-desempate-just"]')
      .setValue('Sorteio sintético em sessão pública registrada');
    await w.get('[data-testid="lic-julgar-form"]').trigger('submit');
    await flushPromises();
    const post = chamadas.find((c) => c.metodo === 'POST')!;
    expect(post.url).toBe('/api/suprimentos/licitacoes/7/etapas');
    expect(post.corpo).toMatchObject({
      versao: 4,
      para: 'julgado',
      desempates: [{ item: 101, fornecedor: 501 }],
      justificativaDesempate: 'Sorteio sintético em sessão pública registrada',
    });
  });

  it('o aviso pede o parecer antes; com ele, a publicação vai com o prazo mínimo do art. 55', async () => {
    const semParecer = detalhe({ processo: { etapa: 'edital', valorEstimado: 1600 } });
    simular(rotaCom(semParecer));
    const w1 = montar(LicitacaoDetalhePainel, { id: 7 });
    await flushPromises();
    await w1.get('[data-testid="lic-det-aba-atos"]').trigger('click');
    await flushPromises();
    const acaoPublicar = semParecer.acoes.find((a) => a.acao === 'publicado')!;
    expect(acaoPublicar.pode).toBe(false);
    expect(w1.get('[data-testid="lic-etapa-motivo"]').text()).toBe(acaoPublicar.motivo);
    expect(w1.get('[data-testid="lic-etapa-avancar"]').attributes('disabled')).toBeDefined();
    vi.unstubAllGlobals();

    const comParecer = detalhe({
      processo: { etapa: 'edital', valorEstimado: 1600 },
      eventos: [evento(1, 'parecer', { resultado: 'favoravel' })],
    });
    expect(comParecer.acoes.find((a) => a.acao === 'publicado')?.pode).toBe(true);
    const chamadas = simular(rotaCom(comParecer));
    const w = montar(LicitacaoDetalhePainel, { id: 7 });
    await flushPromises();
    await w.get('[data-testid="lic-det-aba-atos"]').trigger('click');
    await flushPromises();
    expect(w.get('[data-testid="lic-prazo-minimo"]').text()).toContain('8 dias úteis');
    expect(w.get('[data-testid="lic-prazo-minimo"]').text()).toContain('10/11/2026');
    await w.get('[data-testid="lic-ref-pub"]').setValue('Controle sintético 0001');
    await w.get('[data-testid="lic-etapa-form"]').trigger('submit');
    await flushPromises();
    const post = chamadas.find((c) => c.metodo === 'POST')!;
    expect(post.url).toBe('/api/suprimentos/licitacoes/7/etapas');
    expect(post.corpo).toMatchObject({
      versao: 4,
      para: 'publicado',
      dataPublicacao: HOJE,
      dataAbertura: '2026-11-10',
      veiculo: 'pncp',
      referencia: 'Controle sintético 0001',
    });
  });

  const julgado = (o: Parameters<typeof detalhe>[0] = {}) =>
    detalhe({
      processo: {
        etapa: 'julgado',
        dataPublicacao: '2026-10-01',
        dataAbertura: '2026-10-15',
        dataJulgamento: '2026-10-20',
        julgadoPor: 'SINT.AGENTE',
        valorEstimado: 1600,
      },
      itens: [
        item({ valorEstimado: 11, resultado: 'adjudicavel', vencedor: 500, valorAdjudicado: 10.5 }),
        item({
          id: 102,
          numero: 2,
          descricao: 'Avental descartável',
          quantidade: 10,
          valorEstimado: 50,
          resultado: 'adjudicavel',
          vencedor: 500,
          valorAdjudicado: 48,
        }),
      ],
      propostas: [proposta(1, 101, 500, 10.5), proposta(3, 102, 500, 48)],
      usuario: 'SINT.AUTORIDADE',
      ...o,
    });

  it('a autoridade homologa depois do prazo de recurso; sem a permissão, os botões desabilitados', async () => {
    const d = julgado();
    expect(d.acoes.find((a) => a.acao === 'homologar')?.pode).toBe(true);
    const chamadas = simular(rotaCom(d));
    const w = montar(LicitacaoDetalhePainel, { id: 7 });
    await flushPromises();
    await w.get('[data-testid="lic-det-aba-autoridade"]').trigger('click');
    await flushPromises();
    await w.get('[data-testid="lic-hom-obs"]').setValue('Homologação sintética');
    await w.get('[data-testid="lic-homologar-form"]').trigger('submit');
    await flushPromises();
    const post = chamadas.find((c) => c.metodo === 'POST')!;
    expect(post.url).toBe('/api/suprimentos/licitacoes/7/homologacao');
    expect(post.corpo).toMatchObject({ versao: 4, observacao: 'Homologação sintética' });
    expect(post.corpo!['chave']).toBe(post.chave);
    vi.unstubAllGlobals();

    simular(rotaCom(julgado({ ops: { conduzir: true, homologar: false } })));
    const w2 = montar(LicitacaoDetalhePainel, { id: 7 });
    await flushPromises();
    await w2.get('[data-testid="lic-det-aba-autoridade"]').trigger('click');
    await flushPromises();
    expect(w2.find('[data-testid="lic-aut-sem-permissao"]').exists()).toBe(true);
    expect(w2.get('[data-testid="lic-homologar"]').attributes('disabled')).toBeDefined();
  });

  it('a decisão do recurso vai à rota da autoridade; o pedido do vencedor é ligado pelo número', async () => {
    const recurso = julgado({
      eventos: [evento(5, 'recurso', { fornecedor: 500, criadoEm: '2026-10-21T10:00:00' })],
    });
    const emRecurso = {
      ...recurso,
      etapa: 'recurso' as const,
      processo: { ...recurso.processo, etapa: 'recurso' as const },
    };
    const chamadas = simular(rotaCom(emRecurso));
    const w = montar(LicitacaoDetalhePainel, { id: 7 });
    await flushPromises();
    await w.get('[data-testid="lic-det-aba-autoridade"]').trigger('click');
    await flushPromises();
    await w.get('[data-testid="lic-decisao-desc"]').setValue('Razões sintéticas não acolhidas');
    await w.get('[data-testid="lic-decisao-form"]').trigger('submit');
    await flushPromises();
    const post = chamadas.find((c) => c.metodo === 'POST')!;
    expect(post.url).toBe('/api/suprimentos/licitacoes/7/decisoes');
    expect(post.corpo).toMatchObject({ tipo: 'decisao-recurso', resultado: 'nao-provido', versao: 4 });
    vi.unstubAllGlobals();

    const homologado = julgado({
      processo: {
        etapa: 'homologado',
        homologadoPor: 'SINT.AUTORIDADE',
        homologadoEm: '2026-10-28T10:00:00',
      },
    });
    const chamadas2 = simular(rotaCom(homologado));
    const w2 = montar(LicitacaoDetalhePainel, { id: 7 });
    await flushPromises();
    await w2.get('[data-testid="lic-det-aba-atos"]').trigger('click');
    await flushPromises();
    await selecionar(w2, 'lic-ato-tipo', 'pedido');
    await w2.get('[data-testid="lic-ato-pedido"]').setValue('9001');
    await w2.get('[data-testid="lic-ato-form"]').trigger('submit');
    await flushPromises();
    const p2 = chamadas2.find((c) => c.metodo === 'POST')!;
    expect(p2.url).toBe('/api/suprimentos/licitacoes/7/eventos');
    expect(p2.corpo).toMatchObject({ tipo: 'pedido', pedido: 9001, versao: 4 });
  });

  it('o histórico mostra os atos com o detalhe', async () => {
    simular(
      rotaCom(
        detalhe({
          eventos: [
            evento(1, 'etapa', { de: 'planejamento', para: 'pesquisa', descricao: '' }),
            evento(2, 'parecer', { resultado: 'favoravel', documento: 33 }),
          ],
        }),
      ),
    );
    const w = montar(LicitacaoDetalhePainel, { id: 7 });
    await flushPromises();
    await w.get('[data-testid="lic-det-aba-historico"]').trigger('click');
    await flushPromises();
    expect(w.get('[data-testid="lic-det-evento-etapa"]').text()).toContain(
      'Termo de referência para Pesquisa de preços',
    );
    expect(w.get('[data-testid="lic-det-evento-parecer"]').text()).toContain('Documento 33');
  });

  it('os documentos em PDF/A: a ata só depois do julgamento; o termo emitido abre pelo link com o código', async () => {
    const pdf = btoa('%PDF-1.7 sintetico');
    const base = rotaCom(detalhe());
    const chamadas = simular((url, metodo) =>
      url.endsWith('/documentos')
        ? {
            tipo: 'termo',
            formato: 'pdf',
            conteudo: pdf,
            nomeArquivo: 'licitacao-termo-12-2026.pdf',
            emissao: 'e1',
            sha256: 'ab'.repeat(32),
            identificadorQr: 'QR-SINT-1',
            ligadoAoProcesso: true,
          }
        : base(url, metodo),
    );
    const criar = vi.fn(() => 'blob:sintetico');
    vi.stubGlobal('URL', Object.assign(URL, { createObjectURL: criar, revokeObjectURL: vi.fn() }));
    const w = montar(LicitacaoDetalhePainel, { id: 7 });
    await flushPromises();
    expect(w.get('[data-testid="lic-doc-ata"]').attributes('disabled')).toBeDefined();
    expect(w.get('[data-testid="lic-doc-ata-motivo"]').text()).toContain('depois do julgamento');
    await w.get('[data-testid="lic-doc-termo"]').trigger('click');
    await flushPromises();
    const c = chamadas.find((x) => x.url.endsWith('/licitacoes/7/documentos'))!;
    expect(c).toMatchObject({ metodo: 'POST', corpo: { tipo: 'termo' } });
    expect(c.chave).toBe(c.corpo!['chave']);
    expect(criar).toHaveBeenCalledTimes(1);
    expect(w.get('[data-testid="lic-doc-emitido"]').text()).toContain('Código de validação: QR-SINT-1');
    expect(w.get('[data-testid="lic-doc-abrir"]').attributes()).toMatchObject({
      href: 'blob:sintetico',
      download: 'licitacao-termo-12-2026.pdf',
    });
  });

  it('o preço digitado errado se descarta com a justificativa pelo PUT; o descartado fica marcado e fora da conta', async () => {
    const descartado = {
      ...preco(5, 101, 10_000),
      descarte: {
        justificativa: 'Digitado errado: 10.000 no lugar de 10.',
        usuario: 'SINT.AGENTE',
        em: HOJE,
      },
    };
    const chamadas = simular(
      rotaCom(detalhe({ precos: [preco(1, 101, 10), preco(2, 101, 12), preco(3, 101, 11), descartado] })),
    );
    const w = montar(LicitacaoDetalhePainel, { id: 7 });
    await flushPromises();
    await w.get('[data-testid="lic-det-aba-pesquisa"]').trigger('click');
    await flushPromises();
    expect(w.get('[data-testid="lic-est-item-1"]').text()).toContain('1.100,00');
    expect(w.get('[data-testid="lic-preco-descartado-5"]').text()).toContain('Digitado errado');
    expect(w.find('[data-testid="lic-preco-descartar-5"]').exists()).toBe(false);
    await w.get('[data-testid="lic-preco-descartar-2"]').trigger('click');
    await flushPromises();
    await w.get('[data-testid="lic-descarte-justificativa"]').setValue('curta');
    await flushPromises();
    expect(w.get('[data-testid="lic-descarte-faltam"]').text()).toContain('20 letras');
    expect(w.get('[data-testid="lic-descarte-confirmar"]').attributes('disabled')).toBeDefined();
    await w
      .get('[data-testid="lic-descarte-justificativa"]')
      .setValue('Preço excessivo, fora do mercado (sintético).');
    await w.get('[data-testid="lic-descarte-form"]').trigger('submit');
    await flushPromises();
    const put = chamadas.find((c) => c.metodo === 'PUT')!;
    expect(put.url).toBe('/api/suprimentos/licitacoes/7/precos/2/descarte');
    expect(put.corpo).toMatchObject({
      versao: 4,
      justificativa: 'Preço excessivo, fora do mercado (sintético).',
    });
    expect(put.corpo!['chave']).toBe(put.chave);
  });

  it('os documentos emitidos ligados ao processo ficam listados depois de recarregar', async () => {
    simular(
      rotaCom(
        detalhe({
          eventos: [
            evento(9, 'documento', {
              referencia: '00000000-0000-4000-8000-000000000009',
              descricao:
                'Termo de referência em PDF/A (etapa Pesquisa de preços); SHA-256 ab; código de validação QR-9',
              criadoEm: '2026-10-28T14:30:00',
            }),
          ],
        }),
      ),
    );
    const w = montar(LicitacaoDetalhePainel, { id: 7 });
    await flushPromises();
    const linha = w.get('[data-testid="lic-doc-emitido-9"]').text();
    expect(linha).toContain('28/10/2026 14:30');
    expect(linha).toContain('código de validação QR-9');
    expect(linha).toContain('00000000-0000-4000-8000-000000000009');
  });
});
