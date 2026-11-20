// @vitest-environment jsdom
// Telas da agenda de sessões e da digitalização certificada (M50, etapa 6): a grade com as cadeiras e salas e as sessões
// do dia, a sessão escolhida com a situação enviada pela versão lida, a série nova com a prévia que mostra o conflito e
// só deixa agendar quando tudo está livre; a fila da digitalização com as contagens, a conferência por outra pessoa (o
// que a própria pessoa capturou não tem os botões) e a marcação para assinar só do que ela conferiu. Dados SINTÉTICOS;
// o fetch é simulado.
import { criarI18n, instalarUi, resolverMarca } from '@sgh/ui';
import { QueryClient, VueQueryPlugin } from '@tanstack/vue-query';
import { flushPromises, mount } from '@vue/test-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { App } from 'vue';
import { mensagensWeb } from '../../i18n/pt-BR.js';
import DigitalizacaoTela from '../same/telas/DigitalizacaoTela.vue';
import { diasDaGrade, combinaBusca, quando, somarDias } from './regras-sessoes.js';
import AgendaSessoesTela from './telas/AgendaSessoesTela.vue';

vi.mock('vue-router', async (original) => ({
  ...(await original<typeof import('vue-router')>()),
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
  useRoute: () => ({ query: {}, path: '/same/digitalizacao', params: {} }),
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
const montar = (c: unknown) =>
  mount(c as never, {
    global: {
      plugins: [
        criarI18n(mensagensWeb as unknown as Record<string, unknown>),
        ui,
        [VueQueryPlugin, { queryClient: new QueryClient({ defaultOptions: { queries: { retry: false } } }) }],
      ] as never,
      stubs: {
        RouterLink: { props: ['to'], template: `<a :href="to"><slot /></a>` },
        DominiosIndiceTela: { template: '<div data-testid="crud-embutido" />' },
      },
    },
  });

type Rota = (url: string, init?: RequestInit) => unknown;
function simular(rota: Rota) {
  const chamadas: { url: string; metodo: string; corpo: unknown }[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      chamadas.push({
        url: String(url),
        metodo: init?.method ?? 'GET',
        corpo: init?.body ? JSON.parse(String(init.body)) : null,
      });
      const r = rota(String(url), init);
      if (r === undefined) return new Response('{}', { status: 404 });
      return new Response(JSON.stringify(r), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }),
  );
  return chamadas;
}
afterEach(() => vi.unstubAllGlobals());

const GRAVACAO = { ligada: true, motivo: null, operacoes: { agendar: { pode: true, motivo: null } } };
const RECURSO = {
  recurso: 7001,
  identificacao: 'CADEIRA 01',
  agenda: 701,
  nomeAgenda: 'TERAPIA SINTETICA',
  unidade: 2,
  tipo: 1,
  prioridade: 1,
  complexidade: 0,
  duracao: 0,
  faixa: null,
  ativo: true,
};
const SESSAO = {
  id: 9001,
  serie: 901,
  ordem: 1,
  total: 4,
  recurso: 7001,
  agenda: 701,
  paciente: 1001,
  prontuario: 501,
  nome: 'PACIENTE SINTETICO',
  inicio: '2027-03-01T08:00',
  fim: '2027-03-01T09:30',
  situacao: 'agendada',
  planoTipo: 'quimioterapia',
  plano: 'PROTOCOLO SINTETICO',
  complexidade: 2,
  duracao: 2,
  observacao: null,
  motivo: null,
  por: 'SINT.SESSOES',
  em: '2026-10-25T10:00',
  alteradoPor: null,
  alteradoEm: null,
  versao: 3,
};
const GRADE = {
  de: '2027-03-01',
  ate: '2027-03-08',
  recursos: [
    RECURSO,
    { ...RECURSO, recurso: 7002, identificacao: 'CADEIRA PEDIATRICA', faixa: { de: 0, ate: 17 } },
  ],
  sessoes: [SESSAO],
  complexidades: [
    { codigo: 0, nome: 'Todas' },
    { codigo: 2, nome: 'Média complexidade' },
  ],
  duracoes: [
    { codigo: 0, nome: 'Todas' },
    { codigo: 2, nome: 'Média duração' },
  ],
  cortada: false,
  lidoEm: '2027-03-01T07:00',
};

describe('apoio da grade', () => {
  it('os dias, o texto curto, a busca e a soma de dias', () => {
    expect(diasDaGrade('2027-03-01', '2027-03-03')).toEqual([
      { dia: '2027-03-01', rotulo: 'seg 01/03' },
      { dia: '2027-03-02', rotulo: 'ter 02/03' },
    ]);
    expect(quando('2027-03-01T08:00')).toBe('01/03 08:00');
    expect(combinaBusca('jose', ['JOSÉ DA SILVA', 501])).toBe(true);
    expect(combinaBusca('maria', ['JOSÉ DA SILVA', null])).toBe(false);
    expect(combinaBusca('', ['X'])).toBe(true);
    expect(somarDias('2027-02-27', 3)).toBe('2027-03-02');
  });
});

describe('agenda de sessões', () => {
  it('a grade com as cadeiras, a faixa e a sessão; a sessão escolhida vai com a versão lida', async () => {
    const chamadas = simular((url) => {
      if (url.startsWith('/api/sessoes/gravacao')) return GRAVACAO;
      if (url.startsWith('/api/sessoes/grade')) return GRADE;
      if (url.startsWith('/api/sessoes/pacientes/1001'))
        return { paciente: 1001, nome: 'PACIENTE SINTETICO', sessoes: [SESSAO], cortada: false };
      if (url.includes('/situacao'))
        return { ok: true, serie: 901, sessoes: [9001], mensagem: 'Sessão registrada como realizada.' };
      return undefined;
    });
    const w = montar(AgendaSessoesTela);
    await flushPromises();
    const grade = w.get('[data-testid="grade-sessoes"]');
    expect(grade.text()).toContain('CADEIRA 01');
    expect(grade.text()).toContain('0 a 17 anos');
    expect(grade.text()).toContain('PACIENTE SINTETICO');
    expect(w.find('[data-testid="crud-embutido"]').exists()).toBe(true);
    await w.get('[data-testid="sessao-9001"]').trigger('click');
    await flushPromises();
    expect(w.get('[data-testid="sessao-escolhida"]').text()).toContain('PROTOCOLO SINTETICO');
    expect(w.get('[data-testid="sessao-falta"]').attributes('disabled')).toBeDefined();
    await w.get('[data-testid="sessao-realizar"]').trigger('click');
    await flushPromises();
    const envio = chamadas.find((c) => c.url === '/api/sessoes/9001/situacao');
    expect(envio?.corpo).toEqual({ sessao: 9001, acao: 'realizar', versao: 3 });
    expect(w.get('[data-testid="sessoes-mensagem"]').text()).toContain('realizada');
  });

  it('sem a liberação, o aviso e nada de ações', async () => {
    simular((url) => {
      if (url.startsWith('/api/sessoes/gravacao'))
        return {
          ligada: false,
          motivo: 'A agenda de sessões ainda não foi liberada.',
          operacoes: { agendar: { pode: false, motivo: 'A agenda de sessões ainda não foi liberada.' } },
        };
      if (url.startsWith('/api/sessoes/grade')) return GRADE;
      return undefined;
    });
    const w = montar(AgendaSessoesTela);
    await flushPromises();
    expect(w.find('[data-testid="sessoes-em-consulta"]').exists()).toBe(true);
    expect(w.find('[data-testid="sessoes-termo"]').exists()).toBe(false);
    await w.get('[data-testid="sessao-9001"]').trigger('click');
    expect(w.find('[data-testid="sessao-realizar"]').exists()).toBe(false);
  });
});

describe('digitalização certificada', () => {
  const DOC = {
    id: 10,
    lote: 3,
    ordem: 1,
    prontuario: 501,
    internacao: null,
    paciente: 1001,
    nome: 'PACIENTE SINTETICO',
    tipoDocumento: 'evolucao',
    descricao: 'EVOLUCAO SINTETICA',
    dataDocumento: '2019-04-02',
    paginas: 2,
    resolucaoDpi: 300,
    cor: 'cinza',
    hash: 'a'.repeat(64),
    tamanho: 100,
    situacao: 'capturado',
    capturadoPor: 'SINT.SAME.CAPTURA',
    capturadoEm: '2026-10-25T10:00',
    conferidoPor: null,
    conferidoEm: null,
    motivo: null,
    assinatura: null,
    assinadoPor: null,
    assinadoEm: null,
    carimboEm: null,
    destinacao: 'guardar',
    guardaAte: '2046-10-25',
    versao: 1,
  };
  const FILA = {
    itens: [
      DOC,
      { ...DOC, id: 11, ordem: 2, capturadoPor: 'SINT.SAME.CONFERE' },
      {
        ...DOC,
        id: 12,
        ordem: 3,
        situacao: 'conferido',
        conferidoPor: 'SINT.SAME.CONFERE',
        conferidoEm: '2026-10-25T11:00',
      },
    ],
    cortada: false,
    contagens: { capturado: 2, conferido: 1, recusado: 0, assinado: 0 },
    lidoEm: '2026-10-25T12:00',
  };
  const GRAV = {
    ligada: true,
    motivo: null,
    login: 'SINT.SAME.CONFERE',
    operacoes: {
      capturar: { pode: false, motivo: 'Seu perfil não permite esta ação.' },
      conferir: { pode: true, motivo: null },
      assinar: { pode: true, motivo: null },
    },
  };
  it('a fila com as contagens; conferir o de outra pessoa; o próprio sem botões; marcar o que conferiu', async () => {
    const chamadas = simular((url) => {
      if (url.startsWith('/api/digitalizacao/gravacao')) return GRAV;
      if (url.startsWith('/api/digitalizacao/fila')) return FILA;
      if (url.startsWith('/api/documento/certificados'))
        return {
          modo: 'simulador',
          certificados: [{ id: 5, midia: 'nuvem', provedor: 'simulador', serie: 'ABC' }],
          provedores: [],
          testes: [],
          agenteLocal: null,
        };
      if (url.endsWith('/conferencia'))
        return { ok: true, id: 10, lote: 3, situacao: 'conferido', mensagem: 'Fidelidade conferida.' };
      return undefined;
    });
    const w = montar(DigitalizacaoTela);
    await flushPromises();
    expect(w.get('[data-testid="digit-tabela"]').text()).toContain('EVOLUCAO SINTETICA');
    expect(w.text()).toContain('guardar até 25/10/2046');
    expect(w.find('[data-testid="digit-fiel-11"]').exists()).toBe(false);
    expect(w.text()).toContain('Capturado por você');
    expect(w.find('[data-testid="digit-marcar-12"]').exists()).toBe(true);
    expect(w.find('[data-testid="digit-marcar-10"]').exists()).toBe(false);
    await w.get('[data-testid="digit-fiel-10"]').trigger('click');
    await flushPromises();
    expect(chamadas.find((c) => c.url === '/api/digitalizacao/10/conferencia')?.corpo).toEqual({
      id: 10,
      resultado: 'fiel',
      versao: 1,
    });
    expect(w.get('[data-testid="digit-aviso"]').text()).toContain('Fidelidade conferida');
    expect(w.find('[data-testid="digit-prontuario"]').exists()).toBe(false);
  });
});
