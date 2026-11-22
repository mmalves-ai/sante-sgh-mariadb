// @vitest-environment jsdom
// ADR 0009, telas (dados SINTÉTICOS, fetch simulado):
// - o texto original vem inteiro (sem corte de 2.000), ao lado das regras, com o trecho não interpretado destacado;
// - o teste de aceite (seção 6 da resposta da Hal-AI) responde pela regra estruturada e mostra o texto ao lado:
//   valor particular, convênio e subplano, preparo e restrição de idade;
// - a edição da regra de preço vai com a versão lida; a estimada pode ser confirmada;
// - credenciamento na ficha do profissional e no convênio (bloqueia e credencia todos);
// - no lançamento do atendimento, o alerta de não credenciado, o bloqueio e a origem do preço.
import { existsSync, readFileSync } from 'node:fs';
import type {
  AgendaEstruturada,
  RegraPrecoParticular,
  ResultadoCalculoPreco,
  TextoOrigemAgenda,
} from '@sgh/contratos';
import { criarI18n, instalarUi, resolverMarca } from '@sgh/ui';
import { QueryClient, VueQueryPlugin } from '@tanstack/vue-query';
import { flushPromises, mount } from '@vue/test-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { App } from 'vue';
import { definirSessaoDaTela } from '../../casca/sessao/pode.js';
import { mensagensWeb } from '../../i18n/pt-BR.js';
import OrigemPrecoAviso from '../atendimento/componentes/OrigemPrecoAviso.vue';
import CredenciamentoConvenios from '../cadastro/componentes/CredenciamentoConvenios.vue';
import OpcoesCredenciamentoConvenio from '../precos/componentes/OpcoesCredenciamentoConvenio.vue';
import AgendaEstruturadaPainel from './componentes/AgendaEstruturadaPainel.vue';
import * as api from './api-estruturada.js';
import { agruparCobertura, fatiarTexto, lerValorDigitado, regrasVigentes } from './estruturada-tela.js';

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
const ui = { install: (app: App) => instalarUi(app, resolverMarca(undefined).pacote) };
const plugins = () =>
  [
    criarI18n(mensagensWeb as unknown as Record<string, unknown>),
    ui,
    [VueQueryPlugin, { queryClient: new QueryClient({ defaultOptions: { queries: { retry: false } } }) }],
  ] as never;
const json = (corpo: unknown, status = 200) =>
  new Response(JSON.stringify(corpo), {
    status,
    headers: { 'content-type': status >= 400 ? 'application/problem+json' : 'application/json' },
  });
/** Texto com o espaço inseparável da moeda trocado por espaço comum. */
const sp = (s: string) => s.replace(/\u00a0/g, ' ');
const OK = { ok: true, resultado: {}, repetida: false, mensagem: 'Gravado.' };

afterEach(() => {
  vi.unstubAllGlobals();
  definirSessaoDaTela(null);
  document.body.innerHTML = '';
});

// ── Dados sintéticos ──
const LONGO = 'Orientação longa sintética. '.repeat(100); // 2.800 caracteres: passa do antigo corte de 2.000
const OBS =
  'Consulta particular R$ 250,00. Atende Convenio Sintetico plano Ouro, exceto plano Bronze. ' +
  'A partir de 12 anos. Trazer exames anteriores. Ligar antes na segunda.';
const iNI = OBS.indexOf('Ligar antes');
const TEXTO_OBS: TextoOrigemAgenda = {
  id: 70,
  agendaId: 5,
  fontePagadoraId: null,
  campo: 'observacao',
  texto: OBS,
  hash: '0123456789abcdef0123456789abcdef',
  situacao: 'extraida',
  versaoExtrator: '1',
  trechos: [
    { inicio: 0, fim: 30, interpretado: true, tipoRegra: 'preco', motivo: null },
    { inicio: 31, fim: 90, interpretado: true, tipoRegra: 'cobertura', motivo: null },
    { inicio: iNI, fim: OBS.length, interpretado: false, tipoRegra: null, motivo: 'Condição sem regra' },
  ],
};
const TEXTO_LONGO: TextoOrigemAgenda = {
  ...TEXTO_OBS,
  id: 71,
  campo: 'orientacao_marcacao',
  texto: LONGO,
  trechos: [],
};
const AGENDA: AgendaEstruturada = {
  agendaId: 5,
  nome: 'AGENDA SINTETICA',
  codigoOrigem: 'A-77',
  profissionalId: 9,
  vigenciaInicio: '2026-01-01',
  vigenciaFim: null,
  padrao: {
    sexoAtendido: 'todos',
    idadeMinimaAnos: 12,
    idadeMaximaAnos: null,
    aceitaRetorno: true,
    diasRetorno: 30,
    permiteEncaixe: false,
    preparo: null,
  },
  convenios: [1, 2],
  coberturas: [
    {
      id: 31,
      versao: 1,
      fontePagadoraId: 2,
      planoId: 21,
      planoSuperiorId: null,
      aceita: true,
      vigenciaInicio: '2026-01-01',
      vigenciaFim: null,
      situacaoRevisao: 'estimada',
      textoOrigemId: 70,
    },
    {
      id: 32,
      versao: 1,
      fontePagadoraId: 2,
      planoId: 22,
      planoSuperiorId: 21,
      aceita: false,
      vigenciaInicio: '2026-01-01',
      vigenciaFim: null,
      situacaoRevisao: 'estimada',
      textoOrigemId: 70,
    },
  ],
  restricoes: [],
  preparos: [
    {
      id: 41,
      versao: 1,
      itemAgendavelId: null,
      tipo: 'documento',
      descricao: 'Trazer exames anteriores',
      jejumHoras: null,
      vigenciaInicio: '2026-01-01',
      vigenciaFim: null,
      situacaoRevisao: 'estimada',
      textoOrigemId: 70,
    },
  ],
  precosParticulares: [
    {
      id: 51,
      estabelecimentoId: null,
      fontePagadoraId: 1,
      dono: { tipo: 'agenda', agendaId: 5 },
      alvo: { tipo: 'consulta' },
      valor: 250,
      prioridade: 100,
      vigenciaInicio: '2026-01-01',
      vigenciaFim: null,
      situacaoRevisao: 'estimada',
      textoOrigemId: 70,
      observacao: null,
      ativo: true,
      origem: 'migracao',
      versao: 3,
    },
    {
      id: 52,
      estabelecimentoId: null,
      fontePagadoraId: 1,
      dono: { tipo: 'profissional', profissionalId: 9 },
      alvo: { tipo: 'consulta' },
      valor: 180,
      prioridade: 100,
      vigenciaInicio: '2025-01-01',
      vigenciaFim: null,
      situacaoRevisao: 'recusada',
      textoOrigemId: null,
      observacao: null,
      ativo: true,
      origem: 'sistema',
      versao: 1,
    },
  ],
  textos: [TEXTO_OBS, TEXTO_LONGO],
};
const NOMES = { 1: 'PARTICULAR', 2: 'CONVENIO SINTETICO' };
const PLANOS = { 21: 'OURO', 22: 'BRONZE' };

describe('regras puras da agenda estruturada', () => {
  it('fatiar devolve o texto inteiro e marca o trecho não interpretado', () => {
    const p = fatiarTexto(OBS, TEXTO_OBS.trechos);
    expect(p.map((x) => x.texto).join('')).toBe(OBS);
    expect(p.filter((x) => x.interpretado === false).map((x) => x.texto)).toEqual([OBS.slice(iNI)]);
    expect(
      fatiarTexto(LONGO, [])
        .map((x) => x.texto)
        .join(''),
    ).toHaveLength(LONGO.length);
  });
  it('trecho fora do texto ou sobreposto não perde nem duplica caracteres', () => {
    const p = fatiarTexto('abcdef', [
      { inicio: 1, fim: 4, interpretado: true, tipoRegra: 'preco', motivo: null },
      { inicio: 2, fim: 99, interpretado: false, tipoRegra: null, motivo: null },
    ]);
    expect(p.map((x) => x.texto)).toEqual(['a', 'b', 'cdef']);
    expect(p.map((x) => x.interpretado)).toEqual([null, true, false]);
  });
  it('trecho não interpretado DENTRO de um interpretado continua marcado (decisão 27)', () => {
    const p = fatiarTexto('abcdefghij', [
      { inicio: 0, fim: 10, interpretado: true, tipoRegra: 'preco', motivo: null },
      { inicio: 3, fim: 5, interpretado: false, tipoRegra: null, motivo: 'forma de pagamento' },
    ]);
    expect(p.map((x) => x.texto)).toEqual(['abc', 'de', 'fghij']);
    expect(p.map((x) => x.interpretado)).toEqual([true, false, true]);
    expect(p[1]?.motivo).toBe('forma de pagamento');
  });
  it('regras vigentes: filtra pela data e ordena pela especificidade do domínio, não só pela prioridade', () => {
    const regra = (o: Partial<RegraPrecoParticular> & Pick<RegraPrecoParticular, 'id'>) =>
      ({
        dono: { tipo: 'profissional', profissionalId: 9, agendaId: null },
        alvo: { tipo: 'consulta', itemFaturavelId: null, grupoFaturamentoId: null },
        fontePagadoraId: 1,
        estabelecimentoId: null,
        valor: 100,
        prioridade: 100,
        vigenciaInicio: '2026-01-01',
        vigenciaFim: null,
        situacaoRevisao: 'confirmada',
        ativo: true,
        textoOrigemId: null,
        observacao: null,
        versao: 1,
        ...o,
      }) as RegraPrecoParticular;
    const doProfissional = regra({ id: 1, prioridade: 10 });
    const daAgendaNoItem = regra({
      id: 2,
      prioridade: 100,
      dono: { tipo: 'agenda', agendaId: 5, profissionalId: null },
      alvo: { tipo: 'item', itemFaturavelId: 7, grupoFaturamentoId: null },
    } as never);
    const vencida = regra({ id: 3, vigenciaFim: '2026-03-31' });
    const futura = regra({ id: 4, vigenciaInicio: '2027-01-01' });
    const recusada = regra({ id: 5, situacaoRevisao: 'recusada' });
    expect(
      regrasVigentes([doProfissional, vencida, futura, recusada, daAgendaNoItem], '2026-06-01').map(
        (r) => r.id,
      ),
    ).toEqual([2, 1]);
  });
});

describe('contrato das URLs do cliente com a API (agenda-preco.controller.ts)', () => {
  /** Rotas do controller pelos decoradores, no formato "MÉTODO /api/caminho/:id". */
  const rotasDoController = (): Set<string> => {
    // jsdom: import.meta.url não é file://; o caminho sai da raiz do repositório ou de apps/web (cwd do vitest)
    const rel = 'apps/api/src/modulos/precos/agenda-preco.controller.ts';
    const caminho = [rel, `../../${rel}`].find((c) => existsSync(c));
    if (!caminho) throw new Error(`controller não encontrado a partir de ${process.cwd()}`);
    const fonte = readFileSync(caminho, 'utf8');
    const rotas = new Set<string>();
    for (const m of fonte.matchAll(/@(Get|Post|Put|Delete|Patch)\('([^']*)'\)/g))
      rotas.add(`${m[1]!.toUpperCase()} /api/${m[2]!.replace(/:[A-Za-z]+/g, ':id')}`);
    return rotas;
  };
  const normalizar = (url: string, metodo: string) =>
    `${metodo} ${url.split('?')[0]!.replace(/\/\d+(?=\/|$)/g, '/:id')}`;

  it('toda URL chamada pelo cliente existe no controller ou está declarada como pendente da API', async () => {
    const chamadas: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init?: RequestInit) => {
        chamadas.push(normalizar(String(url), init?.method ?? 'GET'));
        return json({});
      }),
    );
    const tentar = async (f: () => Promise<unknown>) => {
      try {
        await f();
      } catch {
        // a resposta simulada não passa no esquema; só a URL interessa aqui
      }
    };
    await tentar(() => api.lerAgendaEstruturada(5, '2026-06-01'));
    await tentar(() => api.listarCredenciamentos({ profissionalId: 9, fontePagadoraId: 2 }));
    await tentar(() => api.lerOpcoesCredenciamento(2));
    await tentar(() => api.calcularPrecoAtendimento(12, 34));
    await tentar(() => api.incluirRegraPreco({} as never, 'k'));
    await tentar(() => api.revisarRegraPreco(51, { versao: 1, valores: {} }, 'k'));
    await tentar(() => api.incluirCredenciamento({} as never, 'k'));
    await tentar(() =>
      api.definirOpcoesCredenciamento(
        2,
        { bloqueiaSemCredenciamento: true, credenciaTodosAoCriar: false },
        'k',
      ),
    );
    // as entradas vazias são recusadas pelo esquema antes do fetch: confira as rotas de inclusão à parte
    chamadas.push('POST /api/precos-particulares', 'POST /api/credenciamentos');
    const controller = rotasDoController();
    const pendentes = new Set(api.ROTAS_PENDENTES_API);
    const fora = [...new Set(chamadas)].filter((c) => !controller.has(c) && !pendentes.has(c));
    expect(fora).toEqual([]);
    // uma pendente que a API já publica sai da lista
    expect([...pendentes].filter((c) => controller.has(c))).toEqual([]);
    expect(chamadas).toEqual(
      expect.arrayContaining([
        'GET /api/agendas/:id/estruturada',
        'GET /api/credenciamentos',
        'GET /api/convenios/:id/opcoes-credenciamento',
        'PUT /api/convenios/:id/opcoes-credenciamento',
      ]),
    );
  });
  it('as rotas de inclusão existem no controller', () => {
    const controller = rotasDoController();
    expect(controller.has('POST /api/precos-particulares')).toBe(true);
    expect(controller.has('POST /api/credenciamentos')).toBe(true);
  });
  it('cobertura agrupada por convênio e plano superior; valor digitado com vírgula', () => {
    const g = agruparCobertura(AGENDA.coberturas);
    expect(g).toHaveLength(1);
    expect(g[0]?.planos.map((p) => p.superiorId)).toEqual([null, 21]);
    expect(lerValorDigitado('1.250,50')).toBe(1250.5);
    expect(lerValorDigitado('250')).toBe(250);
    expect(lerValorDigitado('2,505')).toBeNull();
    expect(lerValorDigitado('')).toBeNull();
  });
});

describe('AgendaEstruturadaPainel (teste de aceite da seção 6)', () => {
  const montar = (buscar: ReturnType<typeof vi.fn>, podeEditar = false) => {
    vi.stubGlobal('fetch', buscar);
    return mount(AgendaEstruturadaPainel as never, {
      props: { agendaId: 5, nomesConvenio: NOMES, nomesPlano: PLANOS, particularId: 1, podeEditar } as never,
      global: { plugins: plugins() },
      attachTo: document.body,
    });
  };

  it('"quanto custa a consulta particular": a regra vigente responde e o texto original fica ao lado', async () => {
    const w = montar(vi.fn(async () => json(AGENDA)));
    await flushPromises();
    const preco = sp(w.get('[data-testid="estruturada-preco"]').text());
    expect(preco).toContain('R$ 250,00');
    expect(preco).toContain('Estimada');
    expect(w.find('[data-testid="regra-preco-52"]').exists()).toBe(false);
    expect(sp(w.get('[data-testid="precos-recusados"]').text())).toContain('R$ 180,00');
    const lado = w.get('[data-testid="estruturada-textos"]');
    expect(lado.get('[data-testid="texto-origem-70"]').text()).toContain('Consulta particular R$ 250,00');
    await w.get('[data-testid="ver-texto-preco-51"]').trigger('click');
    expect(w.get('[data-testid="texto-origem-70"]').classes()).toContain('texto-origem--destacado');
  });

  it('o texto original vem inteiro (passa de 2.000) e o trecho não interpretado fica destacado', async () => {
    const w = montar(vi.fn(async () => json(AGENDA)));
    await flushPromises();
    expect(w.get('[data-testid="texto-origem-71"] [data-testid="texto-corpo"]').text()).toBe(LONGO.trim());
    const marca = w.get('[data-testid="texto-origem-70"] [data-testid="trecho-nao-interpretado"]');
    expect(marca.element.tagName).toBe('MARK');
    expect(marca.text()).toBe(OBS.slice(iNI));
    expect(w.get('[data-testid="texto-nao-interpretados"]').text()).toContain('1 trecho');
  });

  it('"o médico atende o meu convênio, plano W": aceita o plano e exclui o subplano', async () => {
    const w = montar(vi.fn(async () => json(AGENDA)));
    await flushPromises();
    expect(w.get('[data-testid="convenios-da-agenda"]').text()).toContain('PARTICULAR, CONVENIO SINTETICO');
    expect(w.get('[data-testid="cobertura-31"]').text()).toContain('OURO — Aceita');
    expect(w.get('[data-testid="cobertura-32"]').text()).toContain('BRONZE — Exclui');
    expect(w.get('[data-testid="cobertura-convenio-2"]').text()).toContain('Subplanos de OURO');
  });

  it('"precisa de preparo" e "atende criança de 5 anos": preparo e idade mínima pela regra', async () => {
    const w = montar(vi.fn(async () => json(AGENDA)));
    await flushPromises();
    expect(w.get('[data-testid="preparo-41"]').text()).toContain('Documento: Trazer exames anteriores');
    const padrao = w.get('[data-testid="restricao-padrao"]').text();
    expect(padrao).toContain('a partir de 12 anos');
    expect(padrao).toContain('aceita retorno em até 30 dias');
    expect(padrao).toContain('não permite encaixe');
    expect(w.get('[data-testid="estruturada-cabecalho"]').text()).toContain('A-77');
  });

  it('sem permissão, não há edição; com ela, a edição vai com a versão lida e confirma a estimada', async () => {
    expect(
      await (async () => {
        const w = montar(vi.fn(async () => json(AGENDA)));
        await flushPromises();
        return w.find('[data-testid="editar-preco-51"]').exists();
      })(),
    ).toBe(false);
    document.body.innerHTML = '';
    const buscar = vi.fn(async (_url: string, init?: RequestInit) =>
      init?.method ? json(OK) : json(AGENDA),
    );
    const w = montar(buscar, true);
    await flushPromises();
    await w.get('[data-testid="editar-preco-51"]').trigger('click');
    await w.get('[data-testid="regra-valor"]').setValue('300,00');
    await w.get('[data-testid="regra-confirmar"]').trigger('click');
    await flushPromises();
    const put = buscar.mock.calls.find((c) => c[1]?.method === 'PUT');
    expect(put?.[0]).toBe('/api/precos-particulares/51');
    expect(JSON.parse(String(put?.[1]?.body))).toEqual({
      versao: 3,
      valores: {
        valor: 300,
        prioridade: 100,
        vigenciaInicio: '2026-01-01',
        vigenciaFim: null,
        situacaoRevisao: 'confirmada',
      },
    });
    expect(w.get('[data-testid="estruturada-mensagem"]').text()).toBe('Gravado.');
  });

  it('a regra nova é do particular da agenda e recusa valor inválido', async () => {
    const buscar = vi.fn(async (_url: string, init?: RequestInit) =>
      init?.method ? json(OK) : json(AGENDA),
    );
    const w = montar(buscar, true);
    await flushPromises();
    await w.get('[data-testid="nova-regra-preco"]').trigger('click');
    await w.get('[data-testid="regra-valor"]').setValue('12,345');
    expect(w.get('[data-testid="regra-problema"]').text()).toContain('2 casas');
    await w.get('[data-testid="regra-valor"]').setValue('199,90');
    await w.get('[data-testid="form-regra-preco"]').trigger('submit');
    await flushPromises();
    const post = buscar.mock.calls.find((c) => c[1]?.method === 'POST');
    expect(post?.[0]).toBe('/api/precos-particulares');
    const corpo = JSON.parse(String(post?.[1]?.body));
    expect(corpo).toMatchObject({
      fontePagadoraId: 1,
      dono: { tipo: 'agenda', agendaId: 5 },
      alvo: { tipo: 'consulta' },
      valor: 199.9,
      situacaoRevisao: 'confirmada',
    });
  });
});

describe('credenciamento', () => {
  const CRED = [
    {
      id: 81,
      profissionalId: 9,
      fontePagadoraId: 2,
      estabelecimentoId: null,
      planoId: null,
      credenciado: true,
      vigenciaInicio: '2026-01-01',
      vigenciaFim: null,
      versao: 1,
    },
  ];
  it('na ficha do profissional: lista por convênio e inclui com o profissional fixo', async () => {
    const buscar = vi.fn(async (_url: string, init?: RequestInit) => (init?.method ? json(OK) : json(CRED)));
    vi.stubGlobal('fetch', buscar);
    const w = mount(CredenciamentoConvenios as never, {
      props: { profissionalId: 9, nomesConvenio: NOMES, podeEditar: true } as never,
      global: { plugins: plugins() },
    });
    await flushPromises();
    expect(String(buscar.mock.calls[0]?.[0])).toMatch(
      /^\/api\/credenciamentos\?profissional=9&data=\d{4}-\d{2}-\d{2}$/,
    );
    expect(w.get('[data-testid="credenciamento-81"]').text()).toContain('CONVENIO SINTETICO');
    await w.get('[data-testid="cred-outro"]').setValue('2');
    await w.get('[data-testid="cred-plano"]').setValue('21');
    await w.get('[data-testid="form-credenciamento"]').trigger('submit');
    await flushPromises();
    const post = buscar.mock.calls.find((c) => c[1]?.method === 'POST');
    expect(JSON.parse(String(post?.[1]?.body))).toMatchObject({
      profissionalId: 9,
      fontePagadoraId: 2,
      planoId: 21,
      credenciado: true,
    });
  });

  it('no convênio: bloqueia e credencia todos gravam só com a permissão de editar o contrato', async () => {
    definirSessaoDaTela({ permissoes: ['convenio.contrato.editar', 'convenio.credenciamento.ler'] } as never);
    const opcoes = { fontePagadoraId: 2, bloqueiaSemCredenciamento: false, credenciaTodosAoCriar: true };
    const buscar = vi.fn(async (url: string, init?: RequestInit) =>
      init?.method ? json(OK) : String(url).includes('/opcoes-credenciamento') ? json(opcoes) : json(CRED),
    );
    vi.stubGlobal('fetch', buscar);
    const w = mount(OpcoesCredenciamentoConvenio as never, {
      props: { codigo: 2 } as never,
      global: { plugins: plugins() },
    });
    await flushPromises();
    expect((w.get('[data-testid="opcao-credencia-todos"]').element as HTMLInputElement).checked).toBe(true);
    expect(w.get('[data-testid="opcoes-gravar"]').attributes('disabled')).toBeDefined();
    await w.get('[data-testid="opcao-bloqueia"]').setValue(true);
    await w.get('form').trigger('submit');
    await flushPromises();
    const put = buscar.mock.calls.find((c) => c[1]?.method === 'PUT');
    expect(put?.[0]).toBe('/api/convenios/2/opcoes-credenciamento');
    expect(JSON.parse(String(put?.[1]?.body))).toEqual({
      bloqueiaSemCredenciamento: true,
      credenciaTodosAoCriar: true,
    });
    expect(w.find('[data-testid="credenciamento-81"]').exists()).toBe(true);
  });

  it('sem a permissão de editar: só leitura das opções', async () => {
    definirSessaoDaTela({ permissoes: [] } as never);
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        json({ fontePagadoraId: 2, bloqueiaSemCredenciamento: true, credenciaTodosAoCriar: false }),
      ),
    );
    const w = mount(OpcoesCredenciamentoConvenio as never, {
      props: { codigo: 2 } as never,
      global: { plugins: plugins() },
    });
    await flushPromises();
    expect(w.get('[data-testid="opcao-bloqueia"]').attributes('disabled')).toBeDefined();
    expect(w.find('[data-testid="opcoes-gravar"]').exists()).toBe(false);
    expect(w.find('[data-testid="credenciamento-convenios"]').exists()).toBe(false);
  });
});

describe('OrigemPrecoAviso (lançamento do atendimento)', () => {
  const base: ResultadoCalculoPreco = {
    valor: 250,
    origem: 'regra_particular_profissional',
    regraPrecoParticularId: 51,
    tabelaPrecoId: null,
    textoOrigemId: 70,
    estimada: true,
    credenciamento: { credenciado: false, efeito: 'alerta', credenciamentoId: null, motivo: null },
    explicacao: 'Regra do profissional, vigente desde 01/01/2026.',
    recusa: null,
  };
  const montar = (resultado: ResultadoCalculoPreco) =>
    mount(OrigemPrecoAviso as never, { props: { resultado } as never, global: { plugins: plugins() } });

  it('alerta de não credenciado, origem do preço e aviso de regra estimada', () => {
    const w = montar(base);
    expect(w.get('[data-testid="credenciamento-alerta"]').text()).toContain('não é credenciado');
    expect(w.get('[data-testid="preco-origem"]').text()).toContain(
      'Regra de preço particular do profissional',
    );
    expect(sp(w.text())).toContain('R$ 250,00');
    expect(w.find('[data-testid="preco-estimada"]').exists()).toBe(true);
  });
  it('bloqueio quando o convênio bloqueia; sem preço pede preço manual', () => {
    const w = montar({
      ...base,
      valor: null,
      origem: null,
      estimada: false,
      credenciamento: { credenciado: false, efeito: 'bloqueio', credenciamentoId: null, motivo: null },
      recusa: 'profissional-nao-credenciado',
    });
    expect(w.find('[data-testid="credenciamento-bloqueio"]').exists()).toBe(true);
    expect(w.find('[data-testid="credenciamento-alerta"]').exists()).toBe(false);
    expect(w.find('[data-testid="preco-ausente"]').exists()).toBe(true);
  });
  it('credenciado e tabela do convênio: sem alerta', () => {
    const w = montar({
      ...base,
      origem: 'tabela_convenio',
      estimada: false,
      credenciamento: { credenciado: true, efeito: 'nenhum', credenciamentoId: 81, motivo: null },
    });
    expect(w.find('[role="alert"]').exists()).toBe(false);
    expect(w.get('[data-testid="preco-origem"]').text()).toContain('Tabela do convênio');
  });
});
