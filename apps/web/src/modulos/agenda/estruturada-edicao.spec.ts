// @vitest-environment jsdom
// ADR 0009, telas (volta 2; dados SINTÉTICOS, fetch simulado):
// - nomes do contrato no lugar dos ids (convênio, plano, subplano, profissional, estabelecimento, credenciamento);
// - inclusão de cobertura (convênio e subplano, aceita ou exclui), restrição e preparo pela tela, com o texto original
//   ao lado e destacado quando a regra aponta o texto de origem;
// - criação do convênio com "credenciar todos os profissionais ativos" (decisão 26);
// - alerta e bloqueio de profissional não credenciado na marcação (decisão 25).
import type { AgendaEstruturada, Credenciamento } from '@sgh/contratos';
import { criarI18n, instalarUi, resolverMarca } from '@sgh/ui';
import { QueryClient, VueQueryPlugin } from '@tanstack/vue-query';
import { flushPromises, mount } from '@vue/test-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { App } from 'vue';
import { definirSessaoDaTela } from '../../casca/sessao/pode.js';
import { mensagensWeb } from '../../i18n/pt-BR.js';
import CredenciamentoConvenios from '../cadastro/componentes/CredenciamentoConvenios.vue';
import NovoConvenioForm from '../precos/componentes/NovoConvenioForm.vue';
import AgendaEstruturadaPainel from './componentes/AgendaEstruturadaPainel.vue';
import AlertaCredenciamentoMarcacao from './componentes/AlertaCredenciamentoMarcacao.vue';
import { montarCobertura, montarPreparo, montarRestricao, nomesDaAgenda } from './estruturada-edicao.js';

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
/** Escolhe na SanteSelecao (PrimeVue, sem <select> nativo) pelo data-testid. */
const escolher = async (
  w: { findAllComponents: (s: { name: string }) => unknown[] },
  testid: string,
  v: string,
) => {
  const c = (
    w.findAllComponents({ name: 'SanteSelecao' }) as {
      attributes: (n: string) => string | undefined;
      vm: { $emit: (e: string, v: string) => void };
    }[]
  ).find((x) => x.attributes('data-testid') === testid);
  if (!c) throw new Error(`SanteSelecao ${testid} não encontrada`);
  c.vm.$emit('update:modelValue', v);
  await flushPromises();
};
afterEach(() => {
  vi.unstubAllGlobals();
  definirSessaoDaTela(null);
  document.body.innerHTML = '';
});

// ── Dados sintéticos ──
const OBS = 'Atende Convênio Alfa exceto plano Bronze. Valor combinado na recepção.';
const AGENDA: AgendaEstruturada = {
  agendaId: 5,
  nome: 'Cardiologia Dra. Exemplo',
  codigoOrigem: 'A-77',
  estabelecimentoId: 1,
  estabelecimentoNome: 'Unidade Centro',
  profissionalId: 9,
  profissionalNome: 'Dra. Exemplo Sintética',
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
  convenios: [2, 3],
  conveniosAceitos: [
    { fontePagadoraId: 2, nome: 'Convênio Alfa' },
    { fontePagadoraId: 3, nome: 'Convênio Beta' },
  ],
  coberturas: [
    {
      id: 61,
      versao: 1,
      fontePagadoraId: 2,
      fontePagadoraNome: 'Convênio Alfa',
      planoId: 22,
      planoNome: 'Bronze Empresarial',
      planoSuperiorId: 21,
      planoSuperiorNome: 'Bronze',
      aceita: false,
      vigenciaInicio: '2026-01-01',
      vigenciaFim: null,
      situacaoRevisao: 'estimada',
      textoOrigemId: 81,
    },
  ],
  restricoes: [
    {
      id: 71,
      versao: 1,
      fontePagadoraId: 3,
      fontePagadoraNome: 'Convênio Beta',
      planoId: null,
      planoNome: null,
      itemAgendavelId: null,
      sexoAtendido: 'feminino',
      idadeMinimaAnos: null,
      idadeMaximaAnos: null,
      aceitaRetorno: null,
      diasRetorno: null,
      permiteEncaixe: null,
      vigenciaInicio: '2026-01-01',
      vigenciaFim: null,
      situacaoRevisao: 'confirmada',
      textoOrigemId: null,
    },
  ],
  preparos: [],
  precosParticulares: [],
  textos: [
    {
      id: 81,
      agendaId: 5,
      fontePagadoraId: null,
      campo: 'observacao',
      texto: OBS,
      hash: '0123456789abcdef0123456789abcdef',
      situacao: 'extraida',
      versaoExtrator: '1',
      trechos: [
        { inicio: 0, fim: 41, interpretado: true, tipoRegra: 'cobertura', motivo: null },
        { inicio: 42, fim: OBS.length, interpretado: false, tipoRegra: null, motivo: 'valor sem número' },
      ],
    },
  ],
};
const CONTRATO = {
  planos: [
    {
      id: 21,
      nome: 'Bronze',
      planoLegado: null,
      inicio: '2020-01-01',
      fim: null,
      ativo: true,
      criadoPor: 'x',
      versao: 1,
    },
    {
      id: 22,
      nome: 'Bronze Empresarial',
      planoLegado: null,
      inicio: '2020-01-01',
      fim: null,
      ativo: true,
      criadoPor: 'x',
      versao: 1,
    },
  ],
};

describe('montagem das regras da agenda (funções puras)', () => {
  const c = { vigenciaInicio: '2026-06-01', vigenciaFim: '', textoOrigemId: null };
  it('cobertura: convênio obrigatório; subplano e exclusão; vigência coerente', () => {
    expect(montarCobertura(5, { ...c, fontePagadoraId: null, planoId: null, aceita: true })).toEqual({
      ok: false,
      erro: 'estruturada.edicao.erros.convenio',
    });
    const m = montarCobertura(5, { ...c, fontePagadoraId: 2, planoId: 22, aceita: false });
    expect(m.ok && m.entrada).toMatchObject({
      agendaId: 5,
      fontePagadoraId: 2,
      planoId: 22,
      aceita: false,
      situacaoRevisao: 'confirmada',
      vigenciaFim: null,
    });
    expect(
      montarCobertura(5, { ...c, vigenciaFim: '2026-05-01', fontePagadoraId: 2, planoId: null, aceita: true })
        .ok,
    ).toBe(false);
  });
  it('restrição: ao menos um campo; idade coerente; nulo herda da agenda', () => {
    const base = {
      ...c,
      fontePagadoraId: null,
      planoId: null,
      sexoAtendido: '' as const,
      idadeMinimaAnos: '',
      idadeMaximaAnos: '',
      aceitaRetorno: '' as const,
      diasRetorno: '',
      permiteEncaixe: '' as const,
    };
    expect(montarRestricao(5, base)).toEqual({ ok: false, erro: 'estruturada.edicao.erros.restricaoVazia' });
    expect(montarRestricao(5, { ...base, idadeMinimaAnos: '18', idadeMaximaAnos: '5' }).ok).toBe(false);
    expect(montarRestricao(5, { ...base, planoId: 22 }).ok).toBe(false);
    const m = montarRestricao(5, { ...base, idadeMinimaAnos: '12', permiteEncaixe: 'nao' });
    expect(m.ok && m.entrada).toMatchObject({
      idadeMinimaAnos: 12,
      idadeMaximaAnos: null,
      permiteEncaixe: false,
      aceitaRetorno: null,
      sexoAtendido: null,
    });
  });
  it('preparo: descrição obrigatória e jejum de 1 a 72 horas', () => {
    const base = { ...c, tipo: 'preparo' as const, descricao: '  ', jejumHoras: '' };
    expect(montarPreparo(5, base).ok).toBe(false);
    expect(montarPreparo(5, { ...base, descricao: 'Jejum', jejumHoras: '80' }).ok).toBe(false);
    const m = montarPreparo(5, {
      ...base,
      descricao: ' Jejum absoluto ',
      jejumHoras: '8',
      textoOrigemId: 81,
    });
    expect(m.ok && m.entrada).toMatchObject({
      descricao: 'Jejum absoluto',
      jejumHoras: 8,
      textoOrigemId: 81,
    });
  });
  it('nomes por id a partir do contrato da agenda', () => {
    const n = nomesDaAgenda(AGENDA);
    expect(n.convenios).toEqual({ 2: 'Convênio Alfa', 3: 'Convênio Beta' });
    expect(n.planos).toEqual({ 21: 'Bronze', 22: 'Bronze Empresarial' });
  });
});

describe('AgendaEstruturadaPainel: nomes e edição (volta 2)', () => {
  const montar = (buscar: ReturnType<typeof vi.fn>) => {
    vi.stubGlobal('fetch', buscar);
    return mount(AgendaEstruturadaPainel as never, {
      props: { agendaId: 5 } as never,
      global: { plugins: plugins() },
      attachTo: document.body,
    });
  };

  it('"o médico atende o meu convênio, plano X": nomes do contrato, sem mapa de nomes nas props', async () => {
    const w = montar(vi.fn(async () => json(AGENDA)));
    await flushPromises();
    const cab = w.get('[data-testid="estruturada-cabecalho"]').text();
    expect(cab).toContain('Dra. Exemplo Sintética');
    expect(cab).toContain('Unidade Centro');
    expect(w.get('[data-testid="convenios-da-agenda"]').text()).toContain('Convênio Alfa, Convênio Beta');
    const cob = w.get('[data-testid="cobertura-convenio-2"]').text();
    expect(cob).toContain('Convênio Alfa');
    expect(cob).toContain('Subplanos de Bronze');
    expect(w.get('[data-testid="cobertura-61"]').text()).toContain('Bronze Empresarial — Exclui');
    expect(w.get('[data-testid="restricao-71"]').text()).toContain('convênio Convênio Beta');
    expect(w.text()).not.toMatch(/#\d/);
    // texto original ao lado, com o trecho não interpretado destacado
    expect(w.get('[data-testid="estruturada-textos"]').find('mark').text()).toContain('Valor combinado');
    // sem a permissão, nada de incluir
    expect(w.find('[data-testid="nova-cobertura"]').exists()).toBe(false);
  });

  it('inclui a exclusão de um subplano, ligada ao texto de origem (destacado ao lado)', async () => {
    definirSessaoDaTela({ permissoes: ['agenda.estruturada.editar'] } as never);
    const buscar = vi.fn(async (url: string, init?: RequestInit) => {
      if (url.startsWith('/api/agendas/5/estruturada')) return json(AGENDA);
      if (url === '/api/agendas/5/coberturas' && init?.method === 'POST') return json({ id: 62 }, 201);
      return json({ ...CONTRATO, codigo: 2, nome: 'Convênio Alfa' });
    });
    const w = montar(buscar);
    await flushPromises();
    await w.get('[data-testid="nova-cobertura"]').trigger('click');
    await flushPromises();
    const form = w.get('[data-testid="form-cobertura"]');
    await escolher(w, 'cobertura-convenio', '2');
    await escolher(w, 'cobertura-plano', '22');
    await escolher(w, 'cobertura-aceita', 'nao');
    await escolher(w, 'cobertura-texto', '81');
    expect(w.text()).toContain('O texto de origem está destacado ao lado');
    await form.trigger('submit');
    await flushPromises();
    const post = buscar.mock.calls.find((c) => c[0] === '/api/agendas/5/coberturas');
    expect(post).toBeTruthy();
    const corpo = JSON.parse(String((post?.[1] as RequestInit).body));
    expect(corpo).toMatchObject({
      fontePagadoraId: 2,
      planoId: 22,
      aceita: false,
      textoOrigemId: 81,
      situacaoRevisao: 'confirmada',
    });
    expect(corpo.agendaId).toBeUndefined();
    expect(w.get('[data-testid="estruturada-mensagem"]').text()).toBe('Gravado.');
  });

  it('restrição "atende criança de 5 anos?" e preparo incluídos pela tela', async () => {
    definirSessaoDaTela({ permissoes: ['agenda.estruturada.editar'] } as never);
    const buscar = vi.fn(async (url: string, init?: RequestInit) => {
      if (url.startsWith('/api/agendas/5/estruturada')) return json(AGENDA);
      if (init?.method === 'POST') return json({ id: 99 }, 201);
      return json({ ...CONTRATO, codigo: 3, nome: 'Convênio Beta' });
    });
    const w = montar(buscar);
    await flushPromises();
    await w.get('[data-testid="nova-restricao"]').trigger('click');
    const fr = w.get('[data-testid="form-restricao"]');
    await fr.trigger('submit');
    await flushPromises();
    expect(w.get('[data-testid="restricao-problema"]').text()).toContain('ao menos uma restrição');
    await fr.get('[data-testid="restricao-idade-min"]').setValue('12');
    await fr.trigger('submit');
    await flushPromises();
    const r = buscar.mock.calls.find((c) => c[0] === '/api/agendas/5/restricoes');
    expect(JSON.parse(String((r?.[1] as RequestInit).body))).toMatchObject({ idadeMinimaAnos: 12 });

    await w.get('[data-testid="nova-preparo"]').trigger('click');
    const fp = w.get('[data-testid="form-preparo"]');
    await fp.get('[data-testid="preparo-descricao"]').setValue('Jejum de 8 horas e trazer exames anteriores');
    await fp.get('[data-testid="preparo-jejum"]').setValue('8');
    await fp.trigger('submit');
    await flushPromises();
    const p = buscar.mock.calls.find((c) => c[0] === '/api/agendas/5/preparos');
    expect(JSON.parse(String((p?.[1] as RequestInit).body))).toMatchObject({
      tipo: 'preparo',
      jejumHoras: 8,
    });
  });
});

describe('credenciamento com nomes e criação do convênio', () => {
  const CRED: Credenciamento = {
    id: 1,
    profissionalId: 9,
    profissionalNome: 'Dra. Exemplo Sintética',
    fontePagadoraId: 2,
    fontePagadoraNome: 'Convênio Alfa',
    estabelecimentoId: 1,
    estabelecimentoNome: 'Unidade Centro',
    planoId: 22,
    planoNome: 'Bronze Empresarial',
    credenciado: true,
    vigenciaInicio: '2026-01-01',
    vigenciaFim: null,
    versao: 1,
  };
  it('lista do convênio mostra profissional, plano e estabelecimento pelo nome', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => json([CRED])),
    );
    const w = mount(CredenciamentoConvenios as never, {
      props: { fontePagadoraId: 2 } as never,
      global: { plugins: plugins() },
    });
    await flushPromises();
    const linha = w.get('[data-testid="credenciamento-1"]').text();
    expect(linha).toContain('Dra. Exemplo Sintética');
    expect(linha).toContain('Bronze Empresarial');
    expect(linha).toContain('Unidade Centro');
    expect(linha).not.toContain('#');
  });
  it('na ficha do profissional, o convênio da lista mostra o nome', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => json([CRED])),
    );
    const w = mount(CredenciamentoConvenios as never, {
      props: { profissionalId: 9 } as never,
      global: { plugins: plugins() },
    });
    await flushPromises();
    expect(w.get('[data-testid="credenciamento-1"]').text()).toContain('Convênio Alfa');
  });

  it('criar convênio com "credenciar todos os profissionais ativos" (decisão 26)', async () => {
    const buscar = vi.fn(async () => json({ id: 40, credenciados: 7 }, 201));
    vi.stubGlobal('fetch', buscar);
    const w = mount(NovoConvenioForm as never, { global: { plugins: plugins() } });
    expect(w.get('[data-testid="novo-convenio-criar"]').attributes('disabled')).toBeDefined();
    await w.get('[data-testid="novo-convenio-codigo"]').setValue('GAMA');
    await w.get('[data-testid="novo-convenio-nome"]').setValue('Convênio Gama');
    await w.get('[data-testid="novo-convenio-credencia-todos"]').setValue(true);
    await w.get('[data-testid="novo-convenio-inicio"]').setValue('2026-07-01');
    await w.get('form').trigger('submit');
    await flushPromises();
    const [url, init] = buscar.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('/api/convenios');
    expect(init.method).toBe('POST');
    expect(JSON.parse(String(init.body))).toEqual({
      codigo: 'GAMA',
      nome: 'Convênio Gama',
      tipo: 'operadora',
      registroAns: null,
      bloqueiaSemCredenciamento: false,
      credenciaTodosAoCriar: true,
      dataInicioRelacao: '2026-07-01',
    });
    expect(w.emitted('criado')?.[0]).toEqual(['Convênio criado; 7 profissional(is) credenciado(s).']);
  });
});

describe('criação do convênio: particular sem credenciamento', () => {
  it('a tela não deixa criar o particular com "credenciar todos"', async () => {
    vi.stubGlobal('fetch', vi.fn());
    const w = mount(NovoConvenioForm as never, { global: { plugins: plugins() } });
    await w.get('[data-testid="novo-convenio-codigo"]').setValue('PART');
    await w.get('[data-testid="novo-convenio-nome"]').setValue('Particular');
    await escolher(w as never, 'novo-convenio-tipo', 'particular');
    await w.get('[data-testid="novo-convenio-credencia-todos"]').setValue(true);
    expect(w.get('[data-testid="novo-convenio-criar"]').attributes('disabled')).toBeDefined();
  });
});

describe('marcação: profissional não credenciado (decisão 25)', () => {
  const montar = (efeito: 'nenhum' | 'alerta' | 'bloqueio', convenio: number | null = 2) => {
    const buscar = vi.fn(async (url: string) =>
      url.startsWith('/api/agendas/5/estruturada')
        ? json(AGENDA)
        : json({ credenciado: efeito === 'nenhum', efeito, credenciamentoId: null, motivo: null }),
    );
    vi.stubGlobal('fetch', buscar);
    const w = mount(AlertaCredenciamentoMarcacao as never, {
      props: { agendaId: 5, convenio, data: '2026-06-10' } as never,
      global: { plugins: plugins() },
    });
    return { w, buscar };
  };
  it('alerta: avisa e deixa marcar', async () => {
    const { w, buscar } = montar('alerta');
    await flushPromises();
    expect(w.get('[data-testid="marcacao-credenciamento-alerta"]').text()).toContain('não é credenciado');
    expect(buscar.mock.calls.map((c) => c[0])).toContain(
      '/api/credenciamentos/verificacao?profissional=9&convenio=2&data=2026-06-10',
    );
    expect(w.emitted('efeito')?.at(-1)).toEqual(['alerta']);
  });
  it('bloqueio: avisa e emite o bloqueio (a tela desabilita o botão)', async () => {
    const { w } = montar('bloqueio');
    await flushPromises();
    expect(w.find('[data-testid="marcacao-credenciamento-bloqueio"]').exists()).toBe(true);
    expect(w.emitted('efeito')?.at(-1)).toEqual(['bloqueio']);
  });
  it('credenciado ou sem convênio: nada aparece', async () => {
    const { w } = montar('nenhum');
    await flushPromises();
    expect(w.text()).toBe('');
    const sem = montar('alerta', null);
    await flushPromises();
    expect(sem.w.text()).toBe('');
  });
});
