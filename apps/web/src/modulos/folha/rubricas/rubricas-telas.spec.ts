// @vitest-environment jsdom
// Tela "Rubricas, incidências e tabelas legais" (M53.2, etapa F1): os comuns (competências, centésimos de ponto,
// centavos, vigência, busca); a rota com a permissão; os textos sem nome de outro sistema e com todos os vocabulários; a
// lista com a conferência traduzida, a busca e o filtro das divergentes; o detalhe com as incidências e os códigos do
// eSocial; a gravação desligada com o motivo; a tabela legal com as faixas e a conferência, e sem vigência; a aba dos
// cadastros embutidos. Dados SINTÉTICOS; o fetch é simulado.
import {
  CODIGOS_CONFERENCIA_RUBRICA,
  CODIGOS_CONFERENCIA_TABELA_LEGAL,
  INCIDENCIAS_RUBRICA_FOLHA,
  REFERENCIAS_RUBRICA_FOLHA,
  TIPOS_RUBRICA_FOLHA,
  TRIBUTOS_INCIDENCIA_ESOCIAL,
  USOS_RUBRICA_FOLHA,
  type RubricaFolha,
} from '@sgh/contratos';
import { criarI18n, instalarUi, resolverMarca } from '@sgh/ui';
import { QueryClient, VueQueryPlugin } from '@tanstack/vue-query';
import { flushPromises, mount } from '@vue/test-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { App } from 'vue';
import { mensagensWeb } from '../../../i18n/pt-BR.js';
import {
  competenciasAte,
  dataBr,
  empresasDasRubricas,
  filtrarRubricas,
  percentual,
  reais,
  rotuloCompetencia,
  textoVigencia,
} from './comum-rubricas.js';
import { mensagensRubricasFolha } from './i18n.js';
import { rotasRubricasFolha } from './rotas.js';
import RubricasFolhaTela from './RubricasFolhaTela.vue';

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
const montar = () =>
  mount(RubricasFolhaTela as never, {
    attachTo: document.body,
    props: { hoje: '2026-10-26' } as never,
    global: {
      plugins: [
        criarI18n(mensagensWeb as unknown as Record<string, unknown>),
        ui,
        [VueQueryPlugin, { queryClient: new QueryClient({ defaultOptions: { queries: { retry: false } } }) }],
      ] as never,
      stubs: {
        RouterLink: { template: '<a><slot /></a>' },
        DominioTela: {
          props: ['modulo', 'recurso', 'abrir'],
          template:
            '<div data-testid="dominio-stub">{{ modulo }}.{{ recurso }}<span v-if="abrir" data-testid="dominio-abrir">{{ abrir.codigo }}|{{ abrir.busca }}</span></div>',
        },
      },
    },
  });

type Pedido = { url: string };
function simular(rota: (url: string) => { status?: number; corpo: unknown }): Pedido[] {
  const pedidos: Pedido[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      pedidos.push({ url: String(url) });
      const r = rota(String(url));
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

const semIncidencia = Object.fromEntries(
  INCIDENCIAS_RUBRICA_FOLHA.map((i) => [i, false]),
) as RubricaFolha['incidencias'];
const rubrica = (
  id: number,
  codigo: number,
  descricao: string,
  extra: Partial<RubricaFolha> = {},
): RubricaFolha => ({
  id,
  empresa: 1,
  codigo,
  descricao,
  tipo: 'provento',
  referencia: 'valor',
  percentual: 0,
  prioridade: null,
  ativa: true,
  vigencia: { inicio: '2026-01-01', fim: null },
  usos: ['mensal'],
  incidencias: { ...semIncidencia, inss: true, irrf: true },
  esocial: { inss: '11', irrf: '11', fgts: null, sindical: null },
  natureza: 1000,
  ...extra,
});
const RUBRICAS = [
  rubrica(1, 1, 'Salário sintético'),
  rubrica(2, 50, 'Hora extra sintética', { percentual: 5000, referencia: 'hora', empresa: 2 }),
  rubrica(3, 900, 'Desconto sintético', { tipo: 'desconto', incidencias: semIncidencia, natureza: null }),
];
const apoio = (
  ligada: boolean,
  extra: { lerRubricas?: boolean; tabelaLegal?: boolean; tabelaGrava?: boolean; cadastros?: string[] } = {},
) => ({
  incidenciasEsocial: {
    inss: [
      { codigo: '00', rotulo: 'Não é base de cálculo' },
      { codigo: '11', rotulo: 'Base de cálculo - mensal' },
    ],
    irrf: [{ codigo: '11', rotulo: 'Remuneração mensal' }],
    fgts: [{ codigo: '11', rotulo: 'Base de cálculo - mensal' }],
    sindical: [{ codigo: '11', rotulo: 'Base de cálculo' }],
  },
  naturezas: [{ id: 1000, codigo: '1000', rotulo: 'Salário, vencimento, soldo' }],
  gravacaoLigada: ligada,
  motivoDesligada: ligada ? null : 'A gravação das rubricas está desligada nas funcionalidades.',
  lerRubricas: extra.lerRubricas ?? true,
  tabelaLegal: {
    ler: extra.tabelaLegal ?? true,
    gravacaoLigada: extra.tabelaGrava ?? true,
    motivoDesligada: (extra.tabelaGrava ?? true) ? null : 'Seu perfil não permite alterar as tabelas legais.',
  },
  cadastros: extra.cadastros ?? ['pessoas.rubrica', 'pessoas.tabelaLegalFolha'],
});
const listaRubricas = {
  competencia: '2026-10',
  dataReferencia: '2026-10-01',
  rubricas: RUBRICAS,
  foraDeVigencia: 4,
  conferencia: [{ rubrica: 2, codigo: 'sem-codigo-esocial', tributo: 'fgts' }],
};
const faixa = (de: number, ate: number | null, aliquota: number, deducao = 0) => ({
  de,
  ate,
  aliquota,
  deducao,
});
const tabelas = (vigente: boolean) => ({
  competencia: '2026-10',
  dataReferencia: '2026-10-01',
  vigente: vigente
    ? {
        inicio: '2026-01-01',
        irrf: {
          faixas: [faixa(0, 242_880, 0), faixa(242_881, null, 2750, 90_000)],
          deducaoDependente: 18_959,
          descontoSimplificado: 60_720,
          reducao: {
            isencaoAte: 500_000,
            reducaoDe: 500_001,
            reducaoAte: 700_000,
            valor: 31_289,
            semReducaoAcimaDe: 700_000,
          },
        },
        inss: { faixas: [faixa(0, 151_800, 750), faixa(151_801, 815_741, 1400)], teto: 815_741 },
        salarioFamilia: [{ de: 0, ate: 190_604, cota: 6_504 }],
        salarioMinimo: 151_800,
        contribuinteIndividual: { aliquota: 2000, teto: 815_741 },
      }
    : null,
  conferencia: vigente ? [{ codigo: 'aliquota-regressiva', tabela: 'inss', faixa: 1 }] : [],
  vigencias: vigente ? ['2026-01-01', '2025-01-01'] : [],
  afastamento: vigente
    ? {
        vigente: { inicio: '2026-01-01', dias: 15 },
        vigencias: [
          { inicio: '2026-01-01', dias: 15 },
          { inicio: '2015-03-01', dias: 30 },
        ],
      }
    : { vigente: null, vigencias: [] },
});

function rotaPadrao(opc: { ligada?: boolean; vigente?: boolean; extra?: Parameters<typeof apoio>[1] } = {}) {
  return (url: string) => {
    if (url.startsWith('/api/pessoas/folha/rubricas/apoio'))
      return { corpo: apoio(opc.ligada ?? true, opc.extra ?? {}) };
    if (url.startsWith('/api/pessoas/folha/rubricas')) return { corpo: listaRubricas };
    if (url.startsWith('/api/pessoas/folha/tabelas-legais')) return { corpo: tabelas(opc.vigente ?? true) };
    return { status: 404, corpo: {} };
  };
}

function textos(o: unknown, caminho = ''): Array<[string, string]> {
  if (typeof o === 'string') return [[caminho, o]];
  if (o && typeof o === 'object')
    return Object.entries(o).flatMap(([k, v]) => textos(v, caminho ? `${caminho}.${k}` : k));
  return [];
}

describe('comuns das rubricas (M53.2)', () => {
  it('competências, datas, centésimos de ponto e centavos', () => {
    expect(competenciasAte('2026-02-15', 3)).toEqual(['2026-02', '2026-01', '2025-12']);
    expect(rotuloCompetencia('2026-09')).toBe('09/2026');
    expect(dataBr('2026-09-01')).toBe('01/09/2026');
    expect(dataBr(null)).toBe('');
    expect(percentual(750)).toBe('7,5%');
    expect(percentual(2750)).toBe('27,5%');
    expect(percentual(5000)).toBe('50%');
    expect(reais(151_800)).toBe('R$ 1.518,00');
  });

  it('vigência legível nos quatro casos', () => {
    expect(textoVigencia({ inicio: '2026-01-01', fim: null }).chave).toBe('desde');
    expect(textoVigencia({ inicio: null, fim: '2025-12-31' }).chave).toBe('ate');
    expect(textoVigencia({ inicio: '2025-01-01', fim: '2025-12-31' })).toEqual({
      chave: 'entre',
      inicio: '01/01/2025',
      fim: '31/12/2025',
    });
    expect(textoVigencia({ inicio: null, fim: null }).chave).toBe('sempre');
  });

  it('busca por código exato ou descrição sem acento; filtro das divergentes; empresas', () => {
    expect(filtrarRubricas(RUBRICAS, '50', null).map((r) => r.id)).toEqual([2]);
    expect(filtrarRubricas(RUBRICAS, 'SALARIO', null).map((r) => r.id)).toEqual([1]);
    expect(filtrarRubricas(RUBRICAS, '', new Set([3])).map((r) => r.id)).toEqual([3]);
    expect(filtrarRubricas(RUBRICAS, '', null)).toHaveLength(3);
    expect(empresasDasRubricas(RUBRICAS)).toEqual([1, 2]);
  });
});

describe('rota e textos (M53.2)', () => {
  it('a rota abre com a permissão da área (D-ABRIR-532); cada aba pede a sua', () => {
    expect(rotasRubricasFolha.map((r) => [r.path, r.meta?.['permissao']])).toEqual([
      ['/pessoas/folha/rubricas', 'pessoas.folha.abrir'],
    ]);
  });

  it('nenhum texto cita o outro sistema nem nome de tabela', () => {
    const achados = textos(mensagensRubricasFolha).filter(([, t]) =>
      /spdata|legado|sistema atual|sistema antigo|\bTB[A-Z]{3,}|\bFP[A-Z_]{3,}|SGH_/i.test(t),
    );
    expect(achados).toEqual([]);
  });

  it('todos os vocabulários do contrato têm texto', () => {
    const m = mensagensRubricasFolha;
    for (const x of TIPOS_RUBRICA_FOLHA) expect(m.tipos[x]).toBeTruthy();
    for (const x of REFERENCIAS_RUBRICA_FOLHA) expect(m.referencias[x]).toBeTruthy();
    for (const x of INCIDENCIAS_RUBRICA_FOLHA) expect(m.incidencias[x]).toBeTruthy();
    for (const x of TRIBUTOS_INCIDENCIA_ESOCIAL) expect(m.tributos[x]).toBeTruthy();
    for (const x of USOS_RUBRICA_FOLHA) expect(m.usos[x]).toBeTruthy();
    for (const x of CODIGOS_CONFERENCIA_RUBRICA) expect(m.conferenciaRubrica[x]).toBeTruthy();
    for (const x of CODIGOS_CONFERENCIA_TABELA_LEGAL) expect(m.conferenciaTabela[x]).toBeTruthy();
  });
});

describe('tela das rubricas (M53.2)', () => {
  it('lista as rubricas da competência com a conferência traduzida e a contagem', async () => {
    const pedidos = simular(rotaPadrao());
    const w = montar();
    await flushPromises();
    expect(pedidos.some((p) => p.url === '/api/pessoas/folha/rubricas?competencia=2026-10')).toBe(true);
    expect(w.find('[data-testid="rubricas-referencia"]').text()).toContain('01/10/2026');
    expect(w.find('[data-testid="rubricas-contagem"]').text()).toContain(
      '3 rubricas em vigor; 4 fora de vigência',
    );
    expect(
      w.findAll('[data-testid^="rubrica-"][data-testid$="1"], [data-testid="rubrica-2"]').length,
    ).toBeGreaterThan(0);
    const div = w.findAll('[data-testid="rubricas-divergencia"]');
    expect(div).toHaveLength(1);
    expect(div[0]!.text()).toBe(
      'Rubrica 50 (Hora extra sintética): incide em FGTS e não tem o código de incidência do eSocial.',
    );
    const linha = w.find('[data-testid="rubrica-2"]').text();
    expect(linha).toContain('Hora');
    expect(linha).toContain('50%');
    expect(linha).toContain('desde 01/01/2026');
    expect(linha).toContain('INSS, IRRF');
    expect(w.find('[data-testid="rubricas-gravacao-desligada"]').exists()).toBe(false);
    w.unmount();
  });

  it('a busca e o filtro das divergentes reduzem a lista', async () => {
    simular(rotaPadrao());
    const w = montar();
    await flushPromises();
    await w.find('[data-testid="rubricas-busca"] input').setValue('desconto');
    expect(w.findAll('tbody tr').map((t) => t.attributes('data-testid'))).toEqual(['rubrica-3']);
    await w.find('[data-testid="rubricas-busca"] input').setValue('');
    const marcadores = w.findAll('[data-testid="rubricas-mostrar"] input[type="checkbox"]');
    await marcadores[1]!.setValue(true);
    await flushPromises();
    expect(w.findAll('tbody tr').map((t) => t.attributes('data-testid'))).toEqual(['rubrica-2']);
    w.unmount();
  });

  it('incluir as fora de vigência pede a lista com todas=1', async () => {
    const pedidos = simular(rotaPadrao());
    const w = montar();
    await flushPromises();
    const marcadores = w.findAll('[data-testid="rubricas-mostrar"] input[type="checkbox"]');
    await marcadores[0]!.setValue(true);
    await flushPromises();
    expect(pedidos.some((p) => p.url === '/api/pessoas/folha/rubricas?competencia=2026-10&todas=1')).toBe(
      true,
    );
    expect(w.find('[data-testid="rubricas-contagem"]').text()).toContain('com as fora de vigência');
    w.unmount();
  });

  it('o detalhe mostra as 20 incidências, os códigos do eSocial com o rótulo oficial e a natureza; alterar abre o cadastro', async () => {
    simular(rotaPadrao());
    const w = montar();
    await flushPromises();
    await w.find('[data-testid="rubrica-detalhe-1"]').trigger('click');
    const d = w.find('[data-testid="rubrica-detalhe"]');
    expect(d.exists()).toBe(true);
    expect(d.findAll('[data-testid="rubrica-incidencias"] dt')).toHaveLength(
      INCIDENCIAS_RUBRICA_FOLHA.length,
    );
    expect(d.find('[data-testid="rubrica-esocial"]').text()).toContain('11 — Base de cálculo - mensal');
    expect(d.find('[data-testid="rubrica-esocial"]').text()).toContain('Sem código');
    expect(d.find('[data-testid="rubrica-natureza"]').text()).toBe('1000 — Salário, vencimento, soldo');
    expect(w.find('[data-testid="rubrica-alterar"]').text()).toBe('Alterar no cadastro');
    await w.find('[data-testid="rubrica-alterar"]').trigger('click');
    await flushPromises();
    // O cadastro abre na rubrica do detalhe (código = o identificador; a lista filtrada pela descrição).
    expect(w.find('[data-testid="dominio-stub"]').text()).toContain('pessoas.rubrica');
    expect(w.find('[data-testid="dominio-abrir"]').text()).toBe('1|Salário sintético');
    w.unmount();
  });
  it('gravação desligada: o detalhe leva a "Ver no cadastro"', async () => {
    simular(rotaPadrao({ ligada: false }));
    const w = montar();
    await flushPromises();
    await w.find('[data-testid="rubrica-detalhe-1"]').trigger('click');
    expect(w.find('[data-testid="rubrica-alterar"]').text()).toBe('Ver no cadastro');
    w.unmount();
  });
  it('referência das rubricas: algum dia da competência (D-VIG-532, exceção registrada)', async () => {
    simular(rotaPadrao());
    const w = montar();
    await flushPromises();
    expect(w.find('[data-testid="rubricas-referencia"]').text()).toContain('01/10/2026 a 31/10/2026');
    w.unmount();
  });
  it('o aviso de só consulta é por aba: a tabela legal grava com a chave da folha desligada', async () => {
    simular(rotaPadrao({ ligada: false }));
    const w = montar();
    await flushPromises();
    expect(w.find('[data-testid="rubricas-gravacao-desligada"]').exists()).toBe(true);
    await w.find('[data-testid="rubricas-aba-tabelas"]').trigger('click');
    await flushPromises();
    expect(w.find('[data-testid="rubricas-gravacao-desligada"]').exists()).toBe(false);
    await w.find('[data-testid="rubricas-aba-cadastros"]').trigger('click');
    await flushPromises();
    expect(w.find('[data-testid="rubricas-gravacao-desligada"]').text()).toContain(
      'As tabelas legais seguem editáveis',
    );
    w.unmount();
  });
  it('só a tabela legal (opção 370): sem a aba Rubricas, abre nas tabelas legais e sem o aviso', async () => {
    simular(
      rotaPadrao({
        ligada: false,
        extra: { lerRubricas: false, cadastros: ['pessoas.tabelaLegalFolha'] },
      }),
    );
    const w = montar();
    await flushPromises();
    expect(w.find('[data-testid="rubricas-aba-rubricas"]').exists()).toBe(false);
    expect(w.find('[data-testid="aba-tabelas-legais"]').exists()).toBe(true);
    expect(w.find('[data-testid="aba-rubricas"]').exists()).toBe(false);
    expect(w.find('[data-testid="rubricas-gravacao-desligada"]').exists()).toBe(false);
    w.unmount();
  });
  it('sem nenhuma parte: o aviso diz que o perfil não consulta', async () => {
    simular(rotaPadrao({ extra: { lerRubricas: false, tabelaLegal: false, cadastros: [] } }));
    const w = montar();
    await flushPromises();
    expect(w.find('[data-testid="rubricas-sem-abas"]').exists()).toBe(true);
    expect(w.find('[data-testid="aba-rubricas"]').exists()).toBe(false);
    w.unmount();
  });

  it('gravação desligada: o motivo aparece', async () => {
    simular(rotaPadrao({ ligada: false }));
    const w = montar();
    await flushPromises();
    expect(w.find('[data-testid="rubricas-gravacao-desligada"]').text()).toContain(
      'desligada nas funcionalidades',
    );
    w.unmount();
  });

  it('tabela legal em vigor: faixas, redução, teto, salário-família, mínimo e a conferência', async () => {
    simular(rotaPadrao());
    const w = montar();
    await flushPromises();
    await w.find('[data-testid="rubricas-aba-tabelas"]').trigger('click');
    await flushPromises();
    expect(w.find('[data-testid="tabelas-vigente"]').text()).toContain('01/01/2026');
    const irrf = w.find('[data-testid="tabela-irrf"]').text();
    expect(irrf).toContain('R$ 2.428,80');
    expect(irrf).toContain('sem limite');
    expect(irrf).toContain('27,5%');
    expect(w.find('[data-testid="tabela-inss"]').text()).toContain('7,5%');
    expect(w.find('[data-testid="tabelas-reducao"]').text()).toContain('R$ 5.000,00');
    expect(w.find('[data-testid="tabela-salario-familia"]').text()).toContain('R$ 65,04');
    expect(w.find('[data-testid="tabelas-gerais"]').text()).toContain('R$ 1.518,00');
    expect(w.find('[data-testid="tabelas-divergencia"]').text()).toBe(
      'INSS: a alíquota diminui de uma faixa para a seguinte (faixa 2).',
    );
    expect(w.findAll('[data-testid="tabelas-vigencias"] li').map((l) => l.text())).toEqual([
      '01/01/2026',
      '01/01/2025',
    ]);
    const af = w.find('[data-testid="tabelas-afastamento"]').text();
    expect(af).toContain('15 dias na competência (vigência desde 01/01/2026).');
    expect(af).toContain('30 dias desde 01/03/2015');
    await w.find('[data-testid="tabelas-abrir-cadastro"]').trigger('click');
    await flushPromises();
    expect(w.find('[data-testid="dominio-stub"]').text()).toBe('pessoas.tabelaLegalFolha');
    w.unmount();
  });

  it('sem tabela legal na competência: o aviso diz o que fazer', async () => {
    simular(rotaPadrao({ vigente: false }));
    const w = montar();
    await flushPromises();
    await w.find('[data-testid="rubricas-aba-tabelas"]').trigger('click');
    await flushPromises();
    expect(w.find('[data-testid="tabelas-sem-vigente"]').text()).toContain('inclua a vigência');
    w.unmount();
  });

  it('a aba dos cadastros abre o primeiro cadastro do apoio', async () => {
    simular(rotaPadrao());
    const w = montar();
    await flushPromises();
    await w.find('[data-testid="rubricas-aba-cadastros"]').trigger('click');
    await flushPromises();
    expect(w.find('[data-testid="dominio-stub"]').text()).toBe('pessoas.rubrica');
    w.unmount();
  });
});
