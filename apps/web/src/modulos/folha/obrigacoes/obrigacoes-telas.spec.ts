// @vitest-environment jsdom
// FGTS Digital e obrigações legais (M53.8, etapa F7): os comuns (períodos por tipo, período sugerido pelo regime, regime
// no período, formulário dos parâmetros conferido no contrato, valores da guia em reais, ações pela situação); todo
// código do contrato tem texto, sem nome de outro sistema; a tela (empresa, abas, perfil de consulta); a aba do FGTS
// Digital (apuração por trabalhador, pendência com o atalho, gerar, registrar a entrega com a guia conciliada); a aba
// dos arquivos (prévia com pendências, prévia limpa e geração; aviso do leiaute não conferido); os parâmetros (nova
// vigência pela sugestão, campos inválidos nomeados, gravação); o histórico (filtros, detalhe, cancelamento com
// motivo). Dados SINTÉTICOS; o fetch é simulado.
import {
  CODIGOS_AVISO_OBRIGACAO,
  CODIGOS_PENDENCIA_OBRIGACAO,
  REGIMES_SUGERIDOS_OBRIGACOES,
  RECUSAS_OBRIGACAO,
  SITUACOES_OBRIGACAO,
  TIPOS_OBRIGACAO,
  type ObrigacaoLegal,
  type ParametrosObrigacoesLidos,
} from '@sgh/contratos';
import { criarI18n, instalarUi, resolverMarca } from '@sgh/ui';
import { QueryClient, VueQueryPlugin } from '@tanstack/vue-query';
import { flushPromises, mount } from '@vue/test-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { type App, nextTick } from 'vue';
import { CHAVE_SESSAO } from '../../../casca/sessao/sessao.js';
import { mensagensWeb } from '../../../i18n/pt-BR.js';
import {
  acoesDaObrigacao,
  centavosDe,
  conferirFormParametros,
  entradaEntrega,
  formDosParametros,
  periodosDoTipo,
  periodoSugeridoObrigacao,
  regimeNoPeriodo,
  rotuloPeriodoObrigacao,
} from './comum-obrigacoes.js';
import { mensagensObrigacoes } from './i18n.js';
import ObrigacoesTela from './ObrigacoesTela.vue';

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
const TODAS = ['pessoas.obrigacao.ler', 'pessoas.obrigacao.gerar', 'pessoas.salario.ler'];

function plugins(permissoes: readonly string[]) {
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
  return [
    criarI18n(mensagensWeb as unknown as Record<string, unknown>),
    ui,
    [VueQueryPlugin, { queryClient: cliente }],
  ] as never;
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
      const r = rota(p) ?? { corpo: { itens: [], limitado: false } };
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

const clicar = async (seletor: string) => {
  const b = document.querySelector<HTMLElement>(seletor);
  expect(b, seletor).not.toBeNull();
  b!.click();
  await flushPromises();
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
  const i = document.querySelector<HTMLInputElement | HTMLTextAreaElement>(
    `[data-testid="${testid}"] input, [data-testid="${testid}"] textarea`,
  )!;
  expect(i, testid).not.toBeNull();
  i.value = valor;
  i.dispatchEvent(new Event('input'));
  i.dispatchEvent(new Event('blur'));
  i.dispatchEvent(new Event('change'));
  await flushPromises();
};
const texto = (seletor: string) => document.querySelector(seletor)?.textContent ?? '';
const existe = (testid: string) => document.querySelector(`[data-testid="${testid}"]`) !== null;

// ── Dados sintéticos ──────────────────────────────────────────────────────────────────────────────────────────
const APOIO = {
  tipos: TIPOS_OBRIGACAO,
  regimesSugeridos: REGIMES_SUGERIDOS_OBRIGACOES,
  fontes: { 'fgts-digital': 'Fonte A.', sefip: 'Fonte B.', caged: 'Fonte C.', rais: 'Fonte D.' },
  empresas: [{ codigo: 1, rotulo: 'Empresa sintética' }],
  competenciaSugerida: '2026-09',
  anoSugerido: '2025',
  hoje: HOJE,
};
const TOTAIS = {
  trabalhadores: 2,
  remuneracao: 500_000,
  remuneracaoDecimo: 0,
  baseFgts: 500_000,
  fgts: 40_000,
  rescisorio: 8_000,
  admissoes: 1,
  desligamentos: 1,
};
const obrigacao = (id: number, x: Partial<ObrigacaoLegal> = {}): ObrigacaoLegal => ({
  id,
  empresa: 1,
  tipo: 'fgts-digital',
  periodo: '2026-09',
  numero: 1,
  situacao: 'gerada',
  leiaute: 'FGTS Digital 1.0',
  leiauteConferido: true,
  nomeArquivo: 'FGTSDIGITAL202609.csv',
  tamanho: 120,
  resumo: 'b'.repeat(64),
  totais: TOTAIS,
  trabalhadores: 2,
  fechamentos: [9],
  geradoPor: 'SINT.DP.FOLHA',
  geradoEm: '2026-10-06T10:00:00',
  entrega: null,
  motivo: null,
  situacaoPor: null,
  situacaoEm: null,
  versao: 0,
  ...x,
});
const vigencia = (inicio: string, x: Partial<ParametrosObrigacoesLidos> = {}): ParametrosObrigacoesLidos => ({
  id: 1,
  empresa: 1,
  inicio,
  razaoSocial: 'EMPRESA SINTETICA LTDA',
  endereco: {
    logradouro: 'RUA SINTETICA 1',
    bairro: 'CENTRO',
    cep: '01000000',
    cidade: 'CIDADE',
    uf: 'SP',
    municipio: '3550308',
  },
  contato: { nome: 'RESPONSAVEL', telefone: '1130000000', email: 'dp@exemplo.invalid' },
  naturezaJuridica: '2062',
  codigoRecolhimentoSefip: '115',
  codigoPagamentoGps: '2100',
  regimes: {
    'fgts-digital': {
      exigidaDe: '2024-03',
      exigidaAte: null,
      leiaute: 'FGTS Digital 1.0',
      leiauteConferido: true,
    },
    sefip: { exigidaDe: null, exigidaAte: '2024-02', leiaute: 'SEFIP 8.4', leiauteConferido: false },
    caged: { exigidaDe: null, exigidaAte: '2019-12', leiaute: 'CAGED 2010', leiauteConferido: false },
    rais: { exigidaDe: null, exigidaAte: '2018', leiaute: 'RAIS 2018', leiauteConferido: false },
  },
  criadoPor: 'SINT.DP.FOLHA',
  criadoEm: '2026-10-01T09:00:00',
  ...x,
});
const trabalhador = (vinculo: number, esocial = 'aceito') => ({
  vinculo,
  matricula: `M${vinculo}`,
  categoria: '101',
  baseFgts: 250_000,
  fgts: 20_000,
  baseDecimo: 0,
  fgtsDecimo: 0,
  rescisorio: vinculo === 12 ? 8_000 : 0,
  processos: [70],
  esocial,
});
const apuracao = (x: Record<string, unknown> = {}) => ({
  empresa: 1,
  competencia: '2026-09',
  exigida: true,
  fechamento: { id: 9, numero: 1 },
  trabalhadores: [trabalhador(11), trabalhador(12)],
  totais: TOTAIS,
  conferencia: {
    ok: true,
    parcelas: [
      { rotulo: 'Vínculo 11', valor: 20_000 },
      { rotulo: 'Vínculo 12', valor: 28_000 },
      { rotulo: 'Total', valor: 48_000 },
    ],
    divergencias: [],
  },
  pendencias: [],
  avisos: [],
  vigente: null,
  ...x,
});

// ── Comuns ────────────────────────────────────────────────────────────────────────────────────────────────────
describe('comuns das obrigações', () => {
  it('períodos por tipo, rótulo e período sugerido pelo regime', () => {
    const m = periodosDoTipo('sefip', HOJE);
    expect(m[0]).toBe('2026-10');
    expect(m).toContain('2019-12');
    expect(m).toHaveLength(144);
    expect(periodosDoTipo('rais', HOJE).slice(0, 2)).toEqual(['2026', '2025']);
    expect(rotuloPeriodoObrigacao('caged', '2019-12')).toBe('12/2019');
    expect(rotuloPeriodoObrigacao('rais', '2018')).toBe('2018');
    const s = { competencia: '2026-09', ano: '2025' };
    const r = REGIMES_SUGERIDOS_OBRIGACOES;
    expect(periodoSugeridoObrigacao('sefip', s, r.sefip)).toBe('2024-02');
    expect(periodoSugeridoObrigacao('caged', s, r.caged)).toBe('2019-12');
    expect(periodoSugeridoObrigacao('rais', s, r.rais)).toBe('2018');
    expect(periodoSugeridoObrigacao('fgts-digital', s, r['fgts-digital'])).toBe('2026-09');
    expect(periodoSugeridoObrigacao('sefip', s, null)).toBe('2026-09');
  });

  it('regime no período: a vigência que já começou e se exige a obrigação', () => {
    const vs = [vigencia('2015-01'), vigencia('2025-01', { id: 2 })];
    expect(regimeNoPeriodo(vs, 1, 'sefip', '2024-02')?.exigida).toBe(true);
    expect(regimeNoPeriodo(vs, 1, 'sefip', '2024-03')?.exigida).toBe(false);
    expect(regimeNoPeriodo(vs, 1, 'rais', '2018')?.exigida).toBe(true);
    expect(regimeNoPeriodo(vs, 1, 'rais', '2019')?.exigida).toBe(false);
    expect(regimeNoPeriodo(vs, 1, 'caged', '2010-01')).toBeNull();
    expect(regimeNoPeriodo(vs, 2, 'caged', '2019-01')).toBeNull();
  });

  it('formulário dos parâmetros: parte da vigência em vigor ou da sugestão; limpa máscara; nomeia o inválido', () => {
    const novo = formDosParametros(null, REGIMES_SUGERIDOS_OBRIGACOES, '2026-10');
    expect(novo.regimes.sefip).toEqual({
      exigidaDe: '',
      exigidaAte: '2024-02',
      leiaute: 'SEFIP 8.4',
      leiauteConferido: false,
    });
    expect(novo.codigoRecolhimentoSefip).toBe('115');
    const ruim = conferirFormParametros(1, novo);
    expect(ruim.ok).toBe(false);
    if (!ruim.ok)
      expect(ruim.campos).toEqual(expect.arrayContaining(['razaoSocial', 'cep', 'nome', 'naturezaJuridica']));
    const f = formDosParametros(vigencia('2024-01'), REGIMES_SUGERIDOS_OBRIGACOES, '2026-10');
    f.cep = '01000-000';
    f.telefone = '(11) 3000-0000';
    f.regimes.sefip.leiauteConferido = true;
    const ok = conferirFormParametros(1, f);
    expect(ok.ok).toBe(true);
    if (ok.ok) {
      expect(ok.dados.endereco.cep).toBe('01000000');
      expect(ok.dados.contato.telefone).toBe('1130000000');
      expect(ok.dados.regimes.sefip.exigidaDe).toBeNull();
      expect(ok.dados.regimes.sefip.leiauteConferido).toBe(true);
      expect(ok.dados.inicio).toBe('2026-10');
    }
    f.regimes.caged.exigidaDe = '2020-01';
    const fim = conferirFormParametros(1, f);
    expect(fim.ok).toBe(false);
    if (!fim.ok) expect(fim.campos).toContain('regimes.caged');
  });

  it('valores da guia em reais; entrega do FGTS com a guia e dos arquivos sem; ações pela situação', () => {
    expect(centavosDe('1.234,56')).toBe(123_456);
    expect(centavosDe('R$ 480,00')).toBe(48_000);
    expect(centavosDe('480.5')).toBe(48_050);
    expect(centavosDe('')).toBeNull();
    expect(centavosDe('abc')).toBeNaN();
    const f = { protocolo: 'G123', data: '2026-10-07', valorGuia: '480,00', acrescimos: '' };
    const e = entradaEntrega({ tipo: 'fgts-digital', versao: 3 }, f);
    expect(e).toEqual({
      ok: true,
      dados: { versao: 3, protocolo: 'G123', data: '2026-10-07', valorGuia: 48_000, acrescimos: 0 },
    });
    const s = entradaEntrega({ tipo: 'sefip', versao: 0 }, { ...f, valorGuia: 'x' });
    expect(s.ok && s.dados.valorGuia).toBeNull();
    const sem = entradaEntrega({ tipo: 'caged', versao: 0 }, { ...f, protocolo: '', data: null });
    expect(sem.ok ? [] : sem.campos).toEqual(['protocolo', 'data']);
    expect(acoesDaObrigacao({ situacao: 'gerada', leiauteConferido: false }, true)).toEqual({
      baixar: true,
      entregar: false,
      cancelar: true,
    });
    expect(acoesDaObrigacao({ situacao: 'entregue', leiauteConferido: true }, true)).toEqual({
      baixar: true,
      entregar: false,
      cancelar: false,
    });
    expect(acoesDaObrigacao({ situacao: 'gerada', leiauteConferido: true }, false)).toEqual({
      baixar: false,
      entregar: false,
      cancelar: false,
    });
  });

  it('todo código do contrato tem texto, sem nome de outro sistema', () => {
    for (const c of CODIGOS_PENDENCIA_OBRIGACAO) expect(mensagensObrigacoes.pendencia[c], c).toBeTruthy();
    for (const c of CODIGOS_AVISO_OBRIGACAO) expect(mensagensObrigacoes.aviso[c], c).toBeTruthy();
    for (const c of RECUSAS_OBRIGACAO) expect(mensagensObrigacoes.recusa[c], c).toBeTruthy();
    for (const c of SITUACOES_OBRIGACAO) expect(mensagensObrigacoes.situacoes[c], c).toBeTruthy();
    for (const c of TIPOS_OBRIGACAO) expect(mensagensObrigacoes.tipos[c], c).toBeTruthy();
    for (const c of ['aceito', 'em-andamento', 'sem-evento', 'nao-se-aplica'] as const)
      expect(mensagensObrigacoes.esocial[c]).toBeTruthy();
    expect(JSON.stringify(mensagensObrigacoes)).not.toMatch(/spdata|legado|sistema atual|sistema antigo/i);
  });
});

// ── Tela ──────────────────────────────────────────────────────────────────────────────────────────────────────
function montar(permissoes: readonly string[] = TODAS) {
  return mount(ObrigacoesTela as never, {
    attachTo: document.body,
    global: { plugins: plugins(permissoes), stubs: { RouterLink: { template: '<a><slot /></a>' } } },
  });
}

describe('tela das obrigações: FGTS Digital', () => {
  it('apuração por trabalhador, gerar e registrar a entrega com a guia conciliada', async () => {
    let gerada: ObrigacaoLegal | null = null;
    const pedidos = simular((p) => {
      if (p.url === '/api/pessoas/obrigacoes/apoio') return { corpo: APOIO };
      if (p.url.startsWith('/api/pessoas/obrigacoes/fgts-digital?'))
        return { corpo: apuracao({ vigente: gerada }) };
      if (p.url === '/api/pessoas/obrigacoes' && p.metodo === 'POST') {
        gerada = obrigacao(30);
        return {
          corpo: {
            gerado: true,
            simulado: false,
            obrigacao: gerada,
            nomeArquivo: gerada.nomeArquivo,
            tamanho: 120,
            totais: TOTAIS,
            trabalhadores: 2,
            pendencias: [],
            avisos: [],
            conferencia: null,
          },
        };
      }
      if (p.url === '/api/pessoas/obrigacoes/30/entrega') {
        const c = p.corpo as { valorGuia: number };
        if (c.valorGuia !== 48_000)
          return {
            status: 409,
            corpo: {
              type: 'recusa-de-negocio',
              title: 'Operação recusada',
              status: 409,
              codigo: 'guia-divergente',
            },
          };
        gerada = obrigacao(30, {
          situacao: 'entregue',
          versao: 1,
          entrega: {
            protocolo: 'G123',
            data: '2026-10-07',
            valorGuia: 48_000,
            acrescimos: 0,
            por: 'SINT.DP.FOLHA',
            em: '2026-10-07T10:00:00',
          },
        });
        return { corpo: gerada };
      }
      return null;
    });
    montar();
    await flushPromises();
    await flushPromises();
    expect(existe('obrigacoes-so-consulta')).toBe(false);
    expect(existe('obrigacoes-nao-transmite')).toBe(true);
    expect(texto('[data-testid="obrigacoes-fgts-tabela"]')).toContain('M12');
    expect(texto('[data-testid="obrigacoes-fgts-esocial-11"]')).toBe('Aceito');
    expect(texto('[data-testid="obrigacoes-fgts-total-fgts"]')).toContain('400,00');
    expect(texto('[data-testid="obrigacoes-fgts-parcelas"]')).toContain('Total');
    await clicar('[data-testid="obrigacoes-fgts-gerar"]');
    const post = pedidos.find((p) => p.url === '/api/pessoas/obrigacoes' && p.metodo === 'POST')!;
    expect(post.corpo).toMatchObject({
      empresa: 1,
      tipo: 'fgts-digital',
      periodo: '2026-09',
      simular: false,
    });
    expect(texto('[data-testid="obrigacoes-fgts-aviso"]')).toContain('geração 1');
    expect(texto('[data-testid="obrigacao-30-sha"]')).toBe('b'.repeat(64));
    await clicar('[data-testid="obrigacao-30-entregar"]');
    expect(texto('[data-testid="obrigacao-entrega-esperado"]')).toContain('480,00');
    await digitar('obrigacao-entrega-protocolo', 'G123');
    await digitar('obrigacao-entrega-guia', '470,00');
    await clicar('[data-testid="obrigacao-entrega-gravar"]');
    expect(texto('[data-testid="recusa-folha"]')).toContain('não confere');
    await digitar('obrigacao-entrega-guia', '480,00');
    await clicar('[data-testid="obrigacao-entrega-gravar"]');
    const entrega = pedidos.filter((p) => p.url.endsWith('/30/entrega')).at(-1)!;
    expect(entrega.corpo).toMatchObject({
      protocolo: 'G123',
      data: HOJE,
      valorGuia: 48_000,
      acrescimos: 0,
      versao: 0,
    });
    expect(texto('[data-testid="obrigacoes-fgts-aviso"]')).toContain('Entrega');
    expect(existe('obrigacoes-fgts-gerar')).toBe(false);
  });

  it('pendência do eSocial barra a geração e leva aos periódicos; consulta sem ações nem valores', async () => {
    simular((p) => {
      if (p.url === '/api/pessoas/obrigacoes/apoio') return { corpo: APOIO };
      if (p.url.startsWith('/api/pessoas/obrigacoes/fgts-digital?'))
        return {
          corpo: apuracao({
            trabalhadores: null,
            totais: null,
            conferencia: null,
            vigente: obrigacao(31, { totais: null }),
            pendencias: [{ codigo: 'evento-esocial-pendente', mensagem: 'x', vinculos: [12] }],
          }),
        };
      return null;
    });
    montar(['pessoas.obrigacao.ler']);
    await flushPromises();
    await flushPromises();
    expect(existe('obrigacoes-so-consulta')).toBe(true);
    expect(existe('obrigacoes-sem-valores')).toBe(true);
    expect(texto('[data-testid="obrigacoes-fgts-pendencia-evento-esocial-pendente"]')).toContain(
      'Vínculos: 12',
    );
    expect(existe('obrigacoes-fgts-ir-esocial')).toBe(true);
    expect(existe('obrigacoes-fgts-gerar')).toBe(false);
    expect(existe('obrigacoes-fgts-tabela')).toBe(false);
    expect(existe('obrigacao-31')).toBe(true);
    expect(existe('obrigacao-31-baixar')).toBe(false);
    expect(existe('obrigacao-31-entregar')).toBe(false);
    expect(existe('obrigacao-31-total-fgts')).toBe(false);
  });
});

describe('tela das obrigações: arquivos, parâmetros e histórico', () => {
  it('SEFIP: período sugerido pelo regime, prévia com pendência, prévia limpa e geração com o aviso do leiaute', async () => {
    let pendente = true;
    const pedidos = simular((p) => {
      if (p.url === '/api/pessoas/obrigacoes/apoio') return { corpo: APOIO };
      if (p.url.startsWith('/api/pessoas/obrigacoes/parametros?'))
        return { corpo: { empresa: 1, itens: [vigencia('2015-01')] } };
      if (p.url.startsWith('/api/pessoas/obrigacoes/fgts-digital?')) return { corpo: apuracao() };
      if (p.url === '/api/pessoas/obrigacoes' && p.metodo === 'POST') {
        const c = p.corpo as { simular: boolean };
        const ob = obrigacao(40, {
          tipo: 'sefip',
          periodo: '2024-02',
          leiauteConferido: false,
          nomeArquivo: 'SEFIP.RE',
        });
        const base = {
          simulado: c.simular,
          nomeArquivo: 'SEFIP.RE',
          tamanho: 1_080,
          totais: TOTAIS,
          trabalhadores: 2,
          avisos: ['leiaute-nao-conferido'],
          conferencia: { ok: true, parcelas: [{ rotulo: 'Total', valor: 40_000 }], divergencias: [] },
        };
        if (c.simular && pendente) {
          pendente = false;
          return {
            corpo: {
              ...base,
              gerado: false,
              obrigacao: null,
              pendencias: [{ codigo: 'sem-nis', mensagem: 'x', vinculos: [11] }],
            },
          };
        }
        return { corpo: { ...base, gerado: !c.simular, obrigacao: c.simular ? null : ob, pendencias: [] } };
      }
      return null;
    });
    montar();
    await flushPromises();
    await clicar('[data-testid="obrigacoes-aba-arquivos"]');
    await flushPromises();
    expect(texto('[data-testid="obrigacoes-arquivos-regime"]')).toContain('2024-02');
    expect(texto('[data-testid="obrigacoes-arquivos-regime"]')).toContain('Não conferido');
    await clicar('[data-testid="obrigacoes-arquivos-previa"]');
    expect(texto('[data-testid="obrigacoes-arquivos-previa-pendencia-sem-nis"]')).toContain('NIS');
    expect(existe('obrigacoes-arquivos-gerar')).toBe(false);
    await clicar('[data-testid="obrigacoes-arquivos-resultado-fechar"]');
    await clicar('[data-testid="obrigacoes-arquivos-previa"]');
    expect(existe('obrigacoes-arquivos-previa-aviso-leiaute-nao-conferido')).toBe(true);
    await clicar('[data-testid="obrigacoes-arquivos-gerar"]');
    const posts = pedidos.filter((p) => p.url === '/api/pessoas/obrigacoes' && p.metodo === 'POST');
    expect(posts.map((p) => (p.corpo as { simular: boolean }).simular)).toEqual([true, true, false]);
    expect(posts[2]!.corpo).toMatchObject({ tipo: 'sefip', periodo: '2024-02', empresa: 1 });
    expect(texto('[data-testid="obrigacoes-arquivos-aviso"]')).toContain('SEFIP');
  });

  it('parâmetros: nova vigência a partir da em vigor, inválido nomeado e gravação', async () => {
    const pedidos = simular((p) => {
      if (p.url === '/api/pessoas/obrigacoes/apoio') return { corpo: APOIO };
      if (p.url.startsWith('/api/pessoas/obrigacoes/parametros?'))
        return { corpo: { empresa: 1, itens: [vigencia('2015-01')] } };
      if (p.url === '/api/pessoas/obrigacoes/parametros' && p.metodo === 'POST')
        return { corpo: { empresa: 1, itens: [vigencia('2015-01'), vigencia('2026-10', { id: 2 })] } };
      if (p.url.startsWith('/api/pessoas/obrigacoes/fgts-digital?')) return { corpo: apuracao() };
      return null;
    });
    montar();
    await flushPromises();
    await clicar('[data-testid="obrigacoes-aba-parametros"]');
    await flushPromises();
    expect(texto('[data-testid="obrigacoes-vigencia-2015-01-sefip"]')).toContain('SEFIP 8.4');
    expect(texto('[data-testid="obrigacoes-fontes"]')).toContain('Fonte B.');
    await clicar('[data-testid="obrigacoes-parametros-nova"]');
    await digitar('obrigacoes-param-cep', '123');
    await clicar('[data-testid="obrigacoes-param-gravar"]');
    expect(texto('[data-testid="obrigacoes-param-invalido"]')).toContain('CEP');
    await digitar('obrigacoes-param-cep', '01000-000');
    await escolher('obrigacoes-param-sefip-conferido', 'sim');
    await clicar('[data-testid="obrigacoes-param-gravar"]');
    const post = pedidos.find((p) => p.url === '/api/pessoas/obrigacoes/parametros' && p.metodo === 'POST')!;
    expect(post.corpo).toMatchObject({
      empresa: 1,
      inicio: '2026-10',
      endereco: { cep: '01000000' },
      regimes: { sefip: { exigidaAte: '2024-02', leiauteConferido: true } },
    });
    expect(texto('[data-testid="obrigacoes-parametros-aviso"]')).toContain('10/2026');
  });

  it('histórico: filtro, detalhe e cancelamento com motivo', async () => {
    const pedidos = simular((p) => {
      if (p.url === '/api/pessoas/obrigacoes/apoio') return { corpo: APOIO };
      if (p.url.startsWith('/api/pessoas/obrigacoes/fgts-digital?')) return { corpo: apuracao() };
      if (p.url.startsWith('/api/pessoas/obrigacoes?'))
        return {
          corpo: {
            itens: [
              obrigacao(50, { tipo: 'rais', periodo: '2018', leiaute: 'RAIS 2018', leiauteConferido: false }),
            ],
            limitado: false,
          },
        };
      if (p.url === '/api/pessoas/obrigacoes/50/cancelamento')
        return { corpo: obrigacao(50, { tipo: 'rais', periodo: '2018', situacao: 'cancelada', versao: 1 }) };
      return null;
    });
    montar();
    await flushPromises();
    await clicar('[data-testid="obrigacoes-aba-historico"]');
    await flushPromises();
    await escolher('obrigacoes-historico-tipo', 'rais');
    await flushPromises();
    expect(pedidos.some((p) => p.url.includes('tipo=rais'))).toBe(true);
    expect(texto('[data-testid="obrigacoes-historico-50"]')).toContain('RAIS');
    await clicar('[data-testid="obrigacoes-historico-abrir-50"]');
    expect(existe('obrigacao-50-entregar')).toBe(false);
    expect(existe('obrigacao-50-aviso-leiaute-nao-conferido')).toBe(true);
    await clicar('[data-testid="obrigacao-50-cancelar"]');
    await digitar('obrigacao-cancelamento-motivo', 'Gerada por engano');
    await clicar('[data-testid="obrigacao-cancelamento-confirmar"]');
    const c = pedidos.find((p) => p.url.endsWith('/50/cancelamento'))!;
    expect(c.corpo).toEqual({ versao: 0, motivo: 'Gerada por engano' });
    expect(texto('[data-testid="obrigacoes-historico-aviso"]')).toContain('cancelada');
  });
});
