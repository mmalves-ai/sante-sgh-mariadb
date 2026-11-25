// @vitest-environment jsdom
// Telas da contabilidade, etapa 1 (M54.1): os comuns (busca da árvore com as contas de nível acima, código sugerido pela
// máscara, rascunho da nova versão, conferência do rascunho); as rotas com a permissão; o plano (desligado com o motivo,
// árvore, busca, detalhe, inclusão com o corpo certo, problemas com as contagens); as regras (versões, nova versão a
// partir da publicada, simulação com os totais e as parcelas, publicação só com a justificativa e a senha); e os fatos
// (resumo por origem com o total e as parcelas, lista, detalhe "sem conta", conferência do reprocessamento). Dados
// SINTÉTICOS; o fetch é simulado.
import type {
  ApoioContabil,
  ContaDoPlano,
  FatoListado,
  PlanoContabil,
  ResumoFatosContabeis,
  SimulacaoRegra,
  VersaoRegra,
} from '@sgh/contratos';
import { criarI18n, instalarUi, resolverMarca } from '@sgh/ui';
import { QueryClient, VueQueryPlugin } from '@tanstack/vue-query';
import { flushPromises, mount } from '@vue/test-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { App } from 'vue';
import { mensagensWeb } from '../../i18n/pt-BR.js';
import {
  diaSeguinte,
  filtrarContas,
  novoRascunho,
  opcoesContasAnaliticas,
  problemasDoRascunho,
  proximoCodigoFilho,
  somaSituacoes,
  ultimaVersao,
} from './comum-contabil.js';
import FatosContabeisTela from './AbaFatos.vue';
import PlanoContasTela from './PlanoContasTela.vue';
import { rotasContabil } from './rotas.js';

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
// O jsdom não tem ResizeObserver, que o campo de texto de várias linhas usa.
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
    props: { hoje: '2026-10-28' } as never,
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
function simular(rota: (url: string, metodo: string) => { status?: number; corpo: unknown }): Pedido[] {
  const pedidos: Pedido[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      const metodo = init?.method ?? 'GET';
      pedidos.push({ url: String(url), metodo, corpo: init?.body ? JSON.parse(String(init.body)) : null });
      const r = rota(String(url), metodo);
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
  document.body.innerHTML = '';
});

// ── Dados sintéticos ─────────────────────────────────────────────────────────────────────────────────
const conta = (codigo: string, nome: string, extra: Partial<ContaDoPlano> = {}): ContaDoPlano => {
  const partes = codigo.split('.');
  return {
    empresa: 1,
    codigo,
    nome,
    grupo: 'ativo',
    tipo: 'sintetica',
    natureza: 'devedora',
    referencialTipo: null,
    referencialConta: null,
    contaExportacao: null,
    exigeCentroCusto: false,
    ativa: true,
    versao: 1,
    nivel: partes.length,
    pai: partes.length > 1 ? partes.slice(0, -1).join('.') : null,
    alteradoPor: 'SINT.CONTADOR',
    alteradoEm: '2026-10-20T10:00:00Z',
    ...extra,
  };
};
const CONTAS: ContaDoPlano[] = [
  conta('1', 'Ativo'),
  conta('1.1', 'Ativo circulante'),
  conta('1.1.1', 'Disponível'),
  conta('1.1.1.01', 'Bancos'),
  conta('1.1.1.01.0001', 'Banco sintético A', {
    tipo: 'analitica',
    referencialTipo: 7,
    referencialConta: '1.01.01',
  }),
  conta('1.1.1.01.0002', 'Caixa geral', { tipo: 'analitica' }),
  conta('3', 'Receitas', { grupo: 'receita', natureza: 'credora' }),
  conta('3.1', 'Receita de serviços', { grupo: 'receita', natureza: 'credora' }),
  conta('3.1.1', 'Convênios', { grupo: 'receita', natureza: 'credora' }),
  conta('3.1.1.01', 'Contas fechadas', { grupo: 'receita', natureza: 'credora' }),
  conta('3.1.1.01.0001', 'Receita de convênio', { grupo: 'receita', natureza: 'credora', tipo: 'analitica' }),
];
const PLANO: PlanoContabil = {
  empresa: 1,
  contas: CONTAS,
  problemas: [
    { codigo: '1.1.1.01.0002', regra: 'semReferencial', gravidade: 'aviso', detalhe: 'x' },
    { codigo: '3.1.1.01.0001', regra: 'semReferencial', gravidade: 'aviso', detalhe: 'x' },
  ],
};
const APOIO: ApoioContabil = {
  ligada: true,
  motivo: null,
  podeEditar: true,
  podePublicar: true,
  podeVerFatos: true,
  cadastros: [],
  empresas: [1],
  mascara: '9.9.9.99.9999',
  origens: [
    { id: 1, rotulo: 'Financeiro' },
    { id: 3, rotulo: 'Convênio' },
  ],
  tiposFato: [
    { codigo: 'receitaConta', origem: 3, rotulo: 'Receita da conta fechada' },
    { codigo: 'tituloPagar', origem: 1, rotulo: 'Título a pagar' },
  ],
  grupos: [
    { codigo: 'ativo', rotulo: 'Ativo', natureza: 'devedora' },
    { codigo: 'receita', rotulo: 'Receitas', natureza: 'credora' },
  ],
  tiposPlanoReferencial: [{ id: 7, codigo: '1', descricao: 'Plano referencial sintético', ecf: false }],
};
const VERSAO: VersaoRegra = {
  id: 41,
  regra: {
    empresa: 1,
    origem: 1,
    tipoFato: 'tituloPagar',
    versao: 2,
    nome: 'Títulos a pagar',
    vigenciaInicio: '2026-01-01',
    vigenciaFim: null,
    prioridade: 100,
    condicoes: [],
    partidas: [
      {
        lado: 'D',
        conta: { modo: 'fixa', conta: '1.1.1.01.0002' },
        valor: { base: 'valorFato' },
        historico: '{documento}',
        centroCusto: 'doFato',
      },
      {
        lado: 'C',
        conta: { modo: 'dePara', campoChave: 'tipoLancamento', contaPadrao: null },
        valor: { base: 'valorFato' },
        historico: '{documento}',
        centroCusto: 'nenhum',
      },
    ],
  },
  impressao: 'abc',
  justificativa: 'Versão sintética de teste.',
  publicadaPor: 'SINT.CONTADOR',
  publicadaEm: '2026-01-02T09:00:00Z',
  situacao: 'publicada',
};
const SIMULACAO: SimulacaoRegra = {
  competencia: '2026-10',
  fatos: 3,
  parcial: false,
  porSituacao: { pendente: 0, contabilizado: 2, semRegra: 0, semConta: 1, substituido: 0, ignorado: 0 },
  lancamentos: [],
  recusas: [
    { fato: 'titulo_pagar:9', situacao: 'semConta', motivo: 'A tabela de integração não tem a conta.' },
  ],
  totais: {
    debitos: 15000,
    creditos: 15000,
    equilibrado: true,
    parcelas: [
      { lado: 'D', conta: '1.1.1.01.0002', valorCentavos: 15000 },
      { lado: 'C', conta: '1.1.1.01.0001', valorCentavos: 15000 },
    ],
  },
  problemasDaPublicacao: [],
};

const rotaPlano = (
  extra: (u: string, m: string) => { status?: number; corpo: unknown } | null = () => null,
) =>
  simular((u, m) => {
    const x = extra(u, m);
    if (x) return x;
    if (u.startsWith('/api/contabil/apoio')) return { corpo: APOIO };
    if (u.startsWith('/api/contabil/plano?')) return { corpo: PLANO };
    if (u.startsWith('/api/contabil/regras?')) return { corpo: { empresa: 1, itens: [VERSAO] } };
    return { status: 404, corpo: { title: 'não simulado' } };
  });

// ── Comuns ───────────────────────────────────────────────────────────────────────────────────────
describe('comuns da contabilidade', () => {
  it('a busca traz a conta achada com as de nível acima, sem acento e sem caixa', () => {
    expect(filtrarContas(CONTAS, 'CONVÊNIO').map((c) => c.codigo)).toEqual([
      '3',
      '3.1',
      '3.1.1',
      '3.1.1.01',
      '3.1.1.01.0001',
    ]);
    expect(filtrarContas(CONTAS, '1.1.1.01').map((c) => c.codigo)).toEqual([
      '1',
      '1.1',
      '1.1.1',
      '1.1.1.01',
      '1.1.1.01.0001',
      '1.1.1.01.0002',
    ]);
    expect(filtrarContas(CONTAS, '  ')).toHaveLength(CONTAS.length);
  });

  it('o código sugerido é o seguinte livre no nível, com os zeros da máscara', () => {
    expect(proximoCodigoFilho(CONTAS, '1.1.1.01', '9.9.9.99.9999')).toBe('1.1.1.01.0003');
    expect(proximoCodigoFilho(CONTAS, '1.1', '9.9.9.99.9999')).toBe('1.1.2');
    expect(proximoCodigoFilho(CONTAS, null, '9.9.9.99.9999')).toBe('4');
  });

  it('só as analíticas ativas recebem lançamento', () => {
    const com = [...CONTAS, conta('1.1.1.01.0003', 'Inativa', { tipo: 'analitica', ativa: false })];
    expect(opcoesContasAnaliticas(com).map((o) => o.valor)).toEqual([
      '1.1.1.01.0001',
      '1.1.1.01.0002',
      '3.1.1.01.0001',
    ]);
  });

  it('a nova versão copia a última publicada com a versão seguinte e a vigência depois dela', () => {
    const v3 = { ...VERSAO, id: 42, regra: { ...VERSAO.regra, versao: 3, vigenciaInicio: '2026-11-15' } };
    const u = ultimaVersao([VERSAO, v3], { empresa: 1, origem: 1, tipoFato: 'tituloPagar' });
    expect(u?.id).toBe(42);
    const r = novoRascunho(u, { empresa: 1, origem: 1, tipoFato: 'tituloPagar', hoje: '2026-10-28' });
    expect(r.versao).toBe(4);
    expect(r.vigenciaInicio).toBe('2026-11-16');
    expect(r.partidas).toHaveLength(2);
    // A cópia é independente da versão publicada.
    r.partidas[0]!.historico = 'mudou';
    expect(VERSAO.regra.partidas[0]!.historico).toBe('{documento}');
    const vazio = novoRascunho(null, { empresa: 1, origem: 3, tipoFato: 'receitaConta', hoje: '2026-10-28' });
    expect(vazio).toMatchObject({ versao: 1, vigenciaInicio: '2026-10-28', nome: '' });
    expect(diaSeguinte('2026-12-31')).toBe('2027-01-01');
  });

  it('o rascunho é conferido antes de ir ao servidor', () => {
    const r = novoRascunho(null, { empresa: 1, origem: 3, tipoFato: 'receitaConta', hoje: '2026-10-28' });
    expect(problemasDoRascunho(r)).toEqual(['nome', 'conta']);
    r.nome = 'Receita';
    r.partidas[0]!.conta = { modo: 'fixa', conta: '1.1.1.01.0001' };
    r.partidas[1]!.conta = { modo: 'fixa', conta: '3.1.1.01.0001' };
    expect(problemasDoRascunho(r)).toEqual([]);
    r.partidas.push({ ...r.partidas[1]!, valor: { base: 'percentual', percentual: 60 } });
    r.partidas[1]!.valor = { base: 'percentual', percentual: 30 };
    expect(problemasDoRascunho(r)).toEqual(['percentual']);
    r.partidas[1]!.valor = { base: 'percentual', percentual: 40 };
    expect(problemasDoRascunho(r)).toEqual([]);
    r.partidas = r.partidas.filter((p) => p.lado === 'D');
    r.vigenciaFim = '2026-01-01';
    expect(problemasDoRascunho(r)).toEqual(['vigencia', 'lados']);
    expect(somaSituacoes({ contabilizado: 2, semConta: 1 })).toBe(3);
  });

  it('as rotas pedem a permissão de ler', () => {
    expect(rotasContabil.map((r) => [r.path, r.meta?.['permissao']])).toEqual([
      ['/contabil/plano', 'contabil.plano.ler'],
      ['/contabil/lancamentos', 'contabil.lancamento.ler'],
      ['/contabil/demonstracoes', 'contabil.demonstracao.ler'],
      ['/contabil/sped', 'contabil.sped.ler'],
    ]);
  });
});

// ── Plano ────────────────────────────────────────────────────────────────────────────────────────
describe('tela do plano de contas', () => {
  it('desligada, mostra o motivo e não lê o plano', async () => {
    const pedidos = simular((u) =>
      u.startsWith('/api/contabil/apoio')
        ? { corpo: { ...APOIO, ligada: false, motivo: 'A contabilidade depende da aprovação.' } }
        : { status: 500, corpo: {} },
    );
    const w = montar(PlanoContasTela);
    await flushPromises();
    expect(w.find('[data-testid="contabil-desligada"]').text()).toContain('depende da aprovação');
    expect(pedidos.some((p) => p.url.startsWith('/api/contabil/plano'))).toBe(false);
    expect(w.find('[data-testid="aba-cadastros-contabil"]').exists()).toBe(false);
  });

  it('a aba Cadastros vale também desligada e oferece só os cadastros que o perfil consulta', async () => {
    simular((u) =>
      u.startsWith('/api/contabil/apoio')
        ? {
            corpo: {
              ...APOIO,
              ligada: false,
              motivo: 'A contabilidade depende da aprovação.',
              cadastros: ['contabil.origemLancamento', 'contabil.nire'],
            },
          }
        : { status: 500, corpo: {} },
    );
    const w = montar(PlanoContasTela);
    await flushPromises();
    expect(w.find('[data-testid="contabil-desligada"]').exists()).toBe(true);
    expect(w.find('[data-testid="plano-aba-plano"]').exists()).toBe(false);
    const aba = w.find('[data-testid="aba-cadastros-contabil"]');
    expect(aba.exists()).toBe(true);
    expect(aba.find('[data-testid="contabil-cadastro"]').text()).toContain('Origens de lançamento contábil');
  });

  it('mostra a árvore, busca, abre o detalhe e conta os problemas', async () => {
    rotaPlano();
    const w = montar(PlanoContasTela);
    await flushPromises();
    expect(w.find('[data-testid="plano-contagem"]').text()).toContain('11 contas, 3 analíticas');
    expect(w.findAll('[data-testid="conta-com-problema"]')).toHaveLength(2);
    await w.find('[data-testid="plano-busca"] input, [data-testid="plano-busca"] textarea').setValue('banco');
    await flushPromises();
    expect(w.findAll('[data-testid^="conta-1"]').length).toBeGreaterThan(0);
    expect(w.find('[data-testid="conta-3"]').exists()).toBe(false);
    await w.find('[data-testid="conta-detalhe-1.1.1.01.0001"]').trigger('click');
    expect(w.find('[data-testid="conta-referencial"]').text()).toContain('Plano referencial sintético');
    expect(w.find('[data-testid="conta-versao"]').text()).toContain('SINT.CONTADOR');
    expect(w.find('[data-testid="plano-aba-problemas"]').text()).toContain('(2)');
    await w.find('[data-testid="plano-aba-problemas"]').trigger('click');
    await flushPromises();
    expect(w.find('[data-testid="problemas-contagem"]').text()).toContain('2 problemas: 0 erros e 2 avisos');
    expect(w.find('[data-testid="problema-1.1.1.01.0002-semReferencial"]').text()).toContain(
      'Sem vínculo com o plano referencial',
    );
  });

  it('inclui a conta abaixo da sintética com o código sugerido e o grupo dela', async () => {
    const pedidos = rotaPlano((u, m) =>
      m === 'POST' && u === '/api/contabil/plano/contas'
        ? {
            corpo: {
              ok: true,
              codigo: '1.1.1.01.0003',
              versao: 1,
              mensagem: 'Conta incluída no plano.',
              problemas: 3,
            },
          }
        : null,
    );
    const w = montar(PlanoContasTela);
    await flushPromises();
    await w.find('[data-testid="conta-detalhe-1.1.1.01"]').trigger('click');
    await w.find('[data-testid="conta-nova-filha"]').trigger('click');
    const codigo = w.find('[data-testid="conta-codigo"] input');
    expect((codigo.element as HTMLInputElement).value).toBe('1.1.1.01.0003');
    expect(w.find('[data-testid="conta-gravar"]').attributes('disabled')).toBeDefined();
    await w.find('[data-testid="conta-nome"] input').setValue('Banco sintético B');
    await w.find('[data-testid="conta-exportacao"] input').setValue('12a');
    expect(w.find('[data-testid="conta-exportacao-invalida"]').exists()).toBe(true);
    await w.find('[data-testid="conta-exportacao"] input').setValue('1201');
    await w.find('[data-testid="conta-gravar"]').trigger('click');
    await flushPromises();
    const post = pedidos.find((p) => p.metodo === 'POST');
    expect(post?.corpo).toMatchObject({
      empresa: 1,
      codigo: '1.1.1.01.0003',
      nome: 'Banco sintético B',
      grupo: 'ativo',
      tipo: 'analitica',
      natureza: 'devedora',
      contaExportacao: 1201,
      ativa: true,
      exigeCentroCusto: false,
    });
    expect(w.find('[data-testid="plano-aviso"]').text()).toContain('3 problemas');
  });

  it('a alteração leva a versão lida e não deixa mudar código nem grupo', async () => {
    const pedidos = rotaPlano((u, m) =>
      m === 'POST' && u === '/api/contabil/plano/contas/alterar'
        ? {
            corpo: {
              ok: true,
              codigo: '1.1.1.01.0002',
              versao: 2,
              mensagem: 'Conta alterada.',
              problemas: 1,
            },
          }
        : null,
    );
    const w = montar(PlanoContasTela);
    await flushPromises();
    await w.find('[data-testid="conta-detalhe-1.1.1.01.0002"]').trigger('click');
    await w.find('[data-testid="conta-alterar"]').trigger('click');
    expect(w.find('[data-testid="conta-codigo-fixo"]').text()).toContain('1.1.1.01.0002');
    await w.find('[data-testid="conta-nome"] input').setValue('Caixa central');
    await w.find('[data-testid="conta-gravar"]').trigger('click');
    await flushPromises();
    const post = pedidos.find((p) => p.metodo === 'POST');
    expect(post?.corpo).toMatchObject({
      empresa: 1,
      codigo: '1.1.1.01.0002',
      versao: 1,
      nome: 'Caixa central',
    });
    expect(post?.corpo).not.toHaveProperty('grupo');
  });

  it('sem a permissão de editar, não oferece inclusão nem alteração', async () => {
    simular((u) => {
      if (u.startsWith('/api/contabil/apoio'))
        return { corpo: { ...APOIO, podeEditar: false, podePublicar: false } };
      if (u.startsWith('/api/contabil/plano?')) return { corpo: PLANO };
      return { status: 404, corpo: {} };
    });
    const w = montar(PlanoContasTela);
    await flushPromises();
    expect(w.find('[data-testid="plano-nova-conta"]').exists()).toBe(false);
    await w.find('[data-testid="conta-detalhe-1.1.1.01"]').trigger('click');
    expect(w.find('[data-testid="conta-alterar"]').exists()).toBe(false);
  });
});

// ── Regras ───────────────────────────────────────────────────────────────────────────────────────
describe('aba das regras de contabilização', () => {
  async function abrirRegras(extra?: Parameters<typeof rotaPlano>[0]) {
    const pedidos = rotaPlano(extra);
    const w = montar(PlanoContasTela);
    await flushPromises();
    await w.find('[data-testid="plano-aba-regras"]').trigger('click');
    await flushPromises();
    return { w, pedidos };
  }

  it('lista as versões e abre a nova versão a partir da publicada', async () => {
    const { w, pedidos } = await abrirRegras();
    // A primeira origem do apoio é o financeiro, com o título a pagar.
    expect(
      pedidos.some((p) => p.url.includes('/api/contabil/regras?empresa=1&origem=1&tipoFato=tituloPagar')),
    ).toBe(true);
    expect(w.find('[data-testid="regra-41"]').text()).toContain('desde 01/01/2026');
    await w.find('[data-testid="regra-nova-versao-41"]').trigger('click');
    expect(w.find('[data-testid="regra-editor"] h3').text()).toContain('Nova versão 3');
    expect(w.find('[data-testid="regra-problemas"]').exists()).toBe(false);
  });

  it('simula sem gravar e mostra as contagens, os totais e as parcelas', async () => {
    const { w, pedidos } = await abrirRegras((u, m) =>
      m === 'POST' && u === '/api/contabil/regras/simular' ? { corpo: SIMULACAO } : null,
    );
    await w.find('[data-testid="regra-nova-versao-41"]').trigger('click');
    await w.find('[data-testid="regra-simular"]').trigger('click');
    await flushPromises();
    const post = pedidos.find((p) => p.url === '/api/contabil/regras/simular');
    expect(post?.corpo).toMatchObject({ competencia: '2026-10', regra: { versao: 3, prioridade: 100 } });
    const s = w.find('[data-testid="regra-simulacao"]');
    expect(s.text()).toContain('2 lançamentos, 0 sem regra, 1 sem conta');
    expect(w.find('[data-testid="simulacao-fatos"]').text()).toContain('3 fatos');
    expect(w.find('[data-testid="simulacao-totais"]').text()).toMatch(
      /Débitos R\$ 150,00 e créditos R\$ 150,00/,
    );
    expect(w.findAll('[data-testid="simulacao-parcelas"] tbody tr')).toHaveLength(2);
    expect(w.find('[data-testid="simulacao-recusas"]').text()).toContain('não tem a conta');
    expect(w.find('[data-testid="simulacao-pode-publicar"]').exists()).toBe(true);
  });

  it('publica só com a justificativa e a senha, e a senha não fica no campo', async () => {
    const { w, pedidos } = await abrirRegras((u, m) =>
      m === 'POST' && u === '/api/contabil/regras/publicar'
        ? { corpo: { ok: true, id: 42, versao: 3, impressao: 'x', mensagem: 'Versão 3 publicada.' } }
        : null,
    );
    await w.find('[data-testid="regra-nova-versao-41"]').trigger('click');
    const publicar = () => w.find('[data-testid="regra-publicar"]');
    expect(publicar().attributes('disabled')).toBeDefined();
    await w.find('[data-testid="regra-justificativa"] textarea').setValue('Correção da conta de débito.');
    expect(publicar().attributes('disabled')).toBeDefined();
    await w.find('[data-testid="regra-senha"]').setValue('senha-sintetica');
    expect(publicar().attributes('disabled')).toBeUndefined();
    await publicar().trigger('click');
    await flushPromises();
    const post = pedidos.find((p) => p.url === '/api/contabil/regras/publicar');
    expect(post?.corpo).toMatchObject({
      justificativa: 'Correção da conta de débito.',
      senha: 'senha-sintetica',
      regra: { versao: 3, tipoFato: 'tituloPagar' },
    });
    expect(w.find('[data-testid="regras-aviso"]').text()).toContain('Versão 3 publicada');
    expect(w.find('[data-testid="regra-editor"]').exists()).toBe(false);
  });

  it('sem a permissão de publicar, simula mas não mostra a publicação', async () => {
    simular((u) => {
      if (u.startsWith('/api/contabil/apoio')) return { corpo: { ...APOIO, podePublicar: false } };
      if (u.startsWith('/api/contabil/plano?')) return { corpo: PLANO };
      if (u.startsWith('/api/contabil/regras?')) return { corpo: { empresa: 1, itens: [] } };
      return { status: 404, corpo: {} };
    });
    const w = montar(PlanoContasTela);
    await flushPromises();
    await w.find('[data-testid="plano-aba-regras"]').trigger('click');
    await flushPromises();
    expect(w.find('[data-testid="regras-nenhuma"]').exists()).toBe(true);
    await w.find('[data-testid="regras-nova"]').trigger('click');
    expect(w.find('[data-testid="regra-sem-publicar"]').exists()).toBe(true);
    expect(w.find('[data-testid="regra-publicar"]').exists()).toBe(false);
    // O rascunho vazio pede nome e contas antes de simular.
    expect(w.find('[data-testid="regra-problemas"]').text()).toContain('Dê um nome');
    expect(w.find('[data-testid="regra-simular"]').attributes('disabled')).toBeDefined();
  });

  it('sem a permissão de acompanhar os fatos, não oferece a simulação (ela mostra os fatos um a um)', async () => {
    simular((u) => {
      if (u.startsWith('/api/contabil/apoio')) return { corpo: { ...APOIO, podeVerFatos: false } };
      if (u.startsWith('/api/contabil/plano?')) return { corpo: PLANO };
      if (u.startsWith('/api/contabil/regras?')) return { corpo: { empresa: 1, itens: [] } };
      return { status: 404, corpo: {} };
    });
    const w = montar(PlanoContasTela);
    await flushPromises();
    await w.find('[data-testid="plano-aba-regras"]').trigger('click');
    await flushPromises();
    await w.find('[data-testid="regras-nova"]').trigger('click');
    expect(w.find('[data-testid="regra-editor"]').exists()).toBe(true);
    expect(w.find('[data-testid="regra-simular"]').exists()).toBe(false);
  });
});

// ── Fatos ────────────────────────────────────────────────────────────────────────────────────────
describe('tela dos lançamentos automáticos (aba Fatos)', () => {
  const RESUMO: ResumoFatosContabeis = {
    fontes: [
      {
        fonte: 'titulo_pagar',
        tipos: ['Título a pagar', 'Pagamento de título'],
        marca: 1200,
        ultimaLeitura: '2026-10-28T03:00:00Z',
        lidosNovos: 10,
        lidosAlterados: 2,
        porSituacao: { contabilizado: 8, semConta: 4 },
      },
      {
        fonte: 'lancamento_titulos_folha',
        tipos: ['Folha e encargos'],
        marca: 0,
        ultimaLeitura: null,
        lidosNovos: 0,
        lidosAlterados: 0,
        porSituacao: {},
      },
    ],
    totais: { contabilizado: 8, semConta: 4 },
  };
  const fato = (id: number, extra: Partial<FatoListado> = {}): FatoListado => ({
    id,
    fonte: 'titulo_pagar',
    tipo: 'tituloPagar',
    tipoRotulo: 'Título a pagar',
    origem: 1,
    empresa: 1,
    data: '2026-10-05',
    competencia: '2026-10',
    valorCentavos: 12345,
    centroCusto: null,
    documento: `título a pagar ${id}`,
    estorno: false,
    situacao: 'contabilizado',
    situacaoRotulo: 'Contabilizado',
    motivo: null,
    lidoEm: '2026-10-28T03:00:00Z',
    ...extra,
  });
  const rotaFatos = (extra: (u: string, m: string) => { corpo: unknown } | null = () => null) =>
    simular((u, m) => {
      const x = extra(u, m);
      if (x) return x;
      if (u.startsWith('/api/contabil/fatos/apoio')) return { corpo: APOIO };
      if (u.startsWith('/api/contabil/fatos/resumo')) return { corpo: RESUMO };
      if (u.startsWith('/api/contabil/fatos'))
        return {
          corpo: {
            itens: [
              fato(1),
              fato(2, {
                situacao: 'semConta',
                situacaoRotulo: 'Regra sem conta (de-para incompleto)',
                motivo: 'Tipo de lançamento 7 sem conta.',
              }),
            ],
            total: 120,
            pagina: 1,
            tamanho: 50,
          },
        };
      return { status: 404, corpo: {} } as never;
    });

  it('mostra o resumo por origem com o rótulo de produto e o total com as parcelas', async () => {
    rotaFatos();
    const w = montar(FatosContabeisTela);
    await flushPromises();
    const linha = w.find('[data-testid="resumo-fonte-titulo_pagar"]').text();
    expect(linha).toContain('Contas a pagar');
    expect(linha).not.toContain('titulo_pagar');
    expect(w.find('[data-testid="resumo-fonte-lancamento_titulos_folha"]').text()).toContain(
      'Ainda não lida',
    );
    expect(w.find('[data-testid="resumo-total"]').text()).toContain(
      'Total: 12 fatos (Contabilizado 8 + Regra sem conta',
    );
  });

  it('lista, pagina e explica o fato sem conta com o caminho da integração', async () => {
    const pedidos = rotaFatos();
    const w = montar(FatosContabeisTela);
    await flushPromises();
    expect(w.findAll('[data-testid^="fato-detalhe-"]')).toHaveLength(2);
    expect(w.find('[data-testid="fatos-paginacao"]').text()).toContain('Página 1 de 3 (120 fatos)');
    await w.find('[data-testid="fatos-proxima"]').trigger('click');
    await flushPromises();
    expect(pedidos.some((p) => p.url.includes('pagina=2'))).toBe(true);
    await w.find('[data-testid="fato-detalhe-2"]').trigger('click');
    expect(w.find('[data-testid="fato-motivo"]').text()).toContain('sem conta');
    expect(w.find('[data-testid="fato-sem-conta"] a').attributes('href')).toBe(
      '/financeiro/contabil/exportacao',
    );
  });

  it('confere o reprocessamento sem senha e só grava com a senha', async () => {
    const resultado = {
      empresa: 1,
      competencia: '2026-10',
      somenteConferir: true,
      fatos: 12,
      parcial: false,
      identico: true,
      iguais: 12,
      diferentes: 0,
      situacoesAlteradas: 3,
      porSituacao: { pendente: 0, contabilizado: 8, semRegra: 0, semConta: 4, substituido: 0, ignorado: 0 },
      totais: { debitos: 100, creditos: 100 },
      mensagem: 'As duas aplicações deram o mesmo resultado.',
    };
    const pedidos = rotaFatos((u, m) =>
      m === 'POST' && u === '/api/contabil/periodos/reprocessar' ? { corpo: resultado } : null,
    );
    const w = montar(FatosContabeisTela);
    await flushPromises();
    await w.find('[data-testid="reprocessar-conferir"]').trigger('click');
    await flushPromises();
    expect(pedidos.find((p) => p.metodo === 'POST')?.corpo).toEqual({
      empresa: 1,
      competencia: '2026-10',
      somenteConferir: true,
    });
    expect(w.find('[data-testid="reprocessar-resultado"]').text()).toContain('12 iguais, 0 diferentes');
    expect(w.find('[data-testid="reprocessar-identico"]').exists()).toBe(true);
    expect(w.find('[data-testid="reprocessar-gravar"]').attributes('disabled')).toBeDefined();
    await w.find('[data-testid="reprocessar-senha"]').setValue('senha-sintetica');
    await w.find('[data-testid="reprocessar-gravar"]').trigger('click');
    await flushPromises();
    expect(pedidos.filter((p) => p.metodo === 'POST')[1]?.corpo).toEqual({
      empresa: 1,
      competencia: '2026-10',
      somenteConferir: false,
      senha: 'senha-sintetica',
    });
  });

  it('sem a permissão de publicar, não oferece o reprocessamento', async () => {
    simular((u) => {
      if (u.startsWith('/api/contabil/fatos/apoio')) return { corpo: { ...APOIO, podePublicar: false } };
      if (u.startsWith('/api/contabil/fatos/resumo')) return { corpo: { fontes: [], totais: {} } };
      if (u.startsWith('/api/contabil/fatos'))
        return { corpo: { itens: [], total: 0, pagina: 1, tamanho: 50 } };
      return { status: 404, corpo: {} };
    });
    const w = montar(FatosContabeisTela);
    await flushPromises();
    expect(w.find('[data-testid="fatos-vazio"]').exists()).toBe(true);
    expect(w.find('[data-testid="fatos-reprocessar"]').exists()).toBe(false);
  });

  it('quem só acompanha os fatos (sem a permissão do plano) abre a tela e vê a lista', async () => {
    const pedidos = rotaFatos((u) =>
      u.startsWith('/api/contabil/apoio') ? ({ status: 403, corpo: {} } as never) : null,
    );
    const w = montar(FatosContabeisTela);
    await flushPromises();
    expect(w.findAll('[data-testid^="fato-detalhe-"]')).toHaveLength(2);
    expect(pedidos.some((p) => p.url.startsWith('/api/contabil/apoio'))).toBe(false);
    expect(pedidos.some((p) => p.url.startsWith('/api/contabil/fatos/apoio'))).toBe(true);
  });
});
