// @vitest-environment jsdom
// Telas da gestão da qualidade e dos envios regulatórios (M48, etapa 5): documentos (lista, ciência, publicação; quem
// não publica vê só os vigentes), indicadores (competência fechada, análise fora da meta), auditorias (checklist com a
// prévia da conformidade), comissões (reunião com o quórum), riscos (prévia GUT; não conformidade aberta pela origem no
// endereço), ouvidoria (anônima sem identificação; resposta com procedência; pesquisa como manifestação), envios
// (gerar, baixar conferido, transmissão com o resumo) e a funcionalidade desligada. Dados SINTÉTICOS; o fetch é
// simulado.
import { criarI18n, instalarUi, resolverMarca } from '@sgh/ui';
import { QueryClient, VueQueryPlugin } from '@tanstack/vue-query';
import { flushPromises, mount } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { type App, nextTick } from 'vue';
import { definirSessaoDaTela } from '../../../casca/sessao/pode.js';
import { mensagensWeb } from '../../../i18n/pt-BR.js';
import AuditoriasTela from './telas/AuditoriasTela.vue';
import ComissoesTela from './telas/ComissoesTela.vue';
import DocumentosTela from './telas/DocumentosTela.vue';
import EnviosRegulatoriosTela from './telas/EnviosRegulatoriosTela.vue';
import IndicadoresTela from './telas/IndicadoresTela.vue';
import OuvidoriaTela from './telas/OuvidoriaTela.vue';
import MinhasPendenciasProntuarioTela from './telas/MinhasPendenciasProntuarioTela.vue';
import RevisaoProntuariosTela from './telas/RevisaoProntuariosTela.vue';
import RiscosTela from './telas/RiscosTela.vue';

const rotaAtual = { path: '/qualidade/documentos', params: {}, query: {} as Record<string, string> };
vi.mock('vue-router', async (original) => ({
  ...(await original<typeof import('vue-router')>()),
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
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
const montados: { unmount: () => void }[] = [];
const montar = (c: unknown) => {
  const w = mount(c as never, {
    attachTo: document.body,
    global: {
      plugins: [
        criarI18n(mensagensWeb as unknown as Record<string, unknown>),
        ui,
        [VueQueryPlugin, { queryClient: new QueryClient({ defaultOptions: { queries: { retry: false } } }) }],
      ] as never,
      stubs: { RouterLink: { props: ['to'], template: '<a :href="to"><slot /></a>' } },
    },
  });
  montados.push(w);
  return w;
};

type Resposta = { status?: number; corpo: unknown };
type Rota = (url: string, init?: RequestInit) => Resposta | unknown;
function simular(rota: Rota) {
  const chamadas: { url: string; metodo: string; corpo: unknown; chave: string | null }[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      const h = new Headers(init?.headers);
      chamadas.push({
        url: String(url),
        metodo: init?.method ?? 'GET',
        corpo: init?.body ? JSON.parse(String(init.body)) : null,
        chave: h.get('idempotency-key'),
      });
      const r = rota(String(url), init);
      const comStatus = r && typeof r === 'object' && 'corpo' in r ? (r as Resposta) : { corpo: r };
      return new Response(JSON.stringify(comStatus.corpo), {
        status: comStatus.status ?? 200,
        headers: { 'content-type': 'application/json' },
      });
    }),
  );
  return chamadas;
}
const baixados: string[] = [];
beforeEach(() => {
  URL.createObjectURL = vi.fn(() => 'blob:sintetico');
  URL.revokeObjectURL = vi.fn();
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
    baixados.push(this.download);
  });
});
afterEach(() => {
  for (const w of montados.splice(0)) w.unmount();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  definirSessaoDaTela(null);
  rotaAtual.query = {};
  baixados.length = 0;
  document.body.innerHTML = '';
});

const escolher = async (w: ReturnType<typeof mount>, testid: string, valor: string) => {
  await w.find(`[data-testid="${testid}"] [role="combobox"]`).trigger('click');
  await flushPromises();
  await nextTick();
  const opcao = document.body.querySelector<HTMLElement>(`[role="option"]:has([data-valor="${valor}"])`);
  expect(opcao, `opção ${valor} em ${testid}`).not.toBeNull();
  opcao!.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
  await flushPromises();
};
const digitar = async (w: ReturnType<typeof mount>, testid: string, texto: string) => {
  const i = w.find(
    `[data-testid="${testid}"] textarea, [data-testid="${testid}"] input, textarea[data-testid="${testid}"], input[data-testid="${testid}"]`,
  );
  await i.setValue(texto);
  await i.trigger('blur');
};
const clicar = async (w: ReturnType<typeof mount>, testid: string) => {
  await w.find(`[data-testid="${testid}"]`).trigger('click');
  await flushPromises();
};
const enviarForm = async (w: ReturnType<typeof mount>, testid: string) => {
  await w.find(`[data-testid="${testid}"]`).trigger('submit');
  await flushPromises();
};
const posts = (c: ReturnType<typeof simular>) => c.filter((x) => x.metodo === 'POST');
const sessao = (...permissoes: string[]) => definirSessaoDaTela({ permissoes } as never);

const AGORA = '2026-10-27T09:00:00';
const HASH = 'c'.repeat(64);
const RESUMO = (ligada = true, podeRegistrar = ligada) => ({
  documentosVigentes: 3,
  documentosRevisaoVencida: 1,
  cienciasPendentesSessao: 2,
  riscosCriticos: 1,
  naoConformidadesAbertas: 2,
  naoConformidadesVencidas: 0,
  manifestacoesAbertas: 4,
  manifestacoesVencidas: 1,
  comissoesAtrasadas: 1,
  ligada,
  motivo: null,
  podeRegistrar,
  agora: AGORA,
});
const PAGINA = (itens: unknown[]) => ({ itens, total: itens.length, pagina: 1, porPagina: 50 });
const DOC = (x: Record<string, unknown> = {}) => ({
  id: 5,
  versao: 1,
  codigo: 'POP-ENF-001',
  revisao: 2,
  tipo: 'pop',
  titulo: 'Higiene das mãos na assistência',
  area: 'Enfermagem',
  resumoAlteracao: 'Quinto momento incluído.',
  elaboradoPor: 'SINT.ELABORA',
  revisadoPor: null,
  aprovadoPor: 'SINT.QUALIDADE',
  publicadoEm: '2026-10-01T10:00:00',
  vigenciaAte: '2028-10-01',
  exigeCiencia: true,
  situacao: 'vigente',
  motivoRetirada: null,
  hash: HASH,
  revisaoVencida: false,
  ciencias: 4,
  cienteSessao: false,
  ...x,
});
const DOC_COMPLETO = (x: Record<string, unknown> = {}) => ({
  ...DOC(x),
  conteudo: 'Conteúdo sintético do POP.',
  revisoes: [
    { id: 5, revisao: 2, situacao: 'vigente', publicadoEm: '2026-10-01T10:00:00' },
    { id: 4, revisao: 1, situacao: 'obsoleto', publicadoEm: '2025-10-01T10:00:00' },
  ],
});

function base(extra: Rota = () => undefined, ligada = true): Rota {
  return (url, init) => {
    const e = extra(url, init);
    if (e !== undefined) return e;
    if (url.startsWith('/api/qualidade/gestao/resumo')) return RESUMO(ligada);
    return { status: 404, corpo: { title: 'não simulado' } };
  };
}

describe('gestão documental', () => {
  it('lista, abre o documento e registra a ciência com a chave; o resumo mostra os números', async () => {
    sessao('qualidade.documento.ler');
    const c = simular(
      base((url, init) => {
        if (url === '/api/qualidade/documentos/5/ciencia' && init?.method === 'POST') return { id: 77 };
        if (url.startsWith('/api/qualidade/documentos/5')) return DOC_COMPLETO();
        if (url.startsWith('/api/qualidade/documentos')) return PAGINA([DOC()]);
        return undefined;
      }),
    );
    const w = montar(DocumentosTela);
    await flushPromises();
    expect(w.find('[data-testid="resumo-cienciasPendentes"]').text()).toBe('2');
    expect(w.find('[data-testid="resumo-riscosCriticos"]').exists()).toBe(false);
    // Quem não publica: sem filtro de situação, a lista pede só os vigentes, sem botão de novo documento.
    expect(c.some((x) => x.url.includes('/api/qualidade/documentos?situacao=vigente'))).toBe(true);
    expect(w.find('[data-testid="doc-filtro-situacao"]').exists()).toBe(false);
    expect(w.find('[data-testid="doc-novo"]').exists()).toBe(false);
    expect(w.find('[data-testid="documento-5"]').text()).toContain('Ciência pendente');
    await clicar(w, 'abrir-documento-5');
    expect(w.find('[data-testid="doc-conteudo-lido"]').text()).toBe('Conteúdo sintético do POP.');
    expect(w.find('[data-testid="doc-revisar"]').exists()).toBe(false);
    expect(w.find('[data-testid="doc-revisoes"]').exists()).toBe(false);
    await clicar(w, 'doc-dar-ciencia');
    const p = posts(c)[0]!;
    expect(p.url).toBe('/api/qualidade/documentos/5/ciencia');
    expect(p.chave).toMatch(/^m48g\.ciencia\./);
    expect(w.find('[data-testid="gestao-aviso"]').text()).toContain('Ciência registrada');
  });

  it('o gestor do documento vê quem deu ciência e quem a distribuição obriga a ler e ainda não leu', async () => {
    sessao('qualidade.documento.ler', 'qualidade.documento.publicar');
    const c = simular(
      base((url) => {
        if (url === '/api/qualidade/documentos/5/ciencias')
          return { itens: [{ usuario: 'SINT.QUALIDADE', cienteEm: '2026-10-02T09:00:00' }] };
        if (url === '/api/qualidade/documentos/5/pendentes-ciencia')
          return { itens: [{ usuario: 'SINT.ENFERMEIRA', nome: 'Enfermeira sintética' }] };
        if (url.startsWith('/api/qualidade/documentos/5')) return DOC_COMPLETO();
        if (url.startsWith('/api/qualidade/documentos')) return PAGINA([DOC()]);
        return undefined;
      }),
    );
    const w = montar(DocumentosTela);
    await flushPromises();
    await clicar(w, 'abrir-documento-5');
    expect(c.some((x) => x.url.includes('pendentes-ciencia'))).toBe(false);
    await clicar(w, 'doc-ver-cientes');
    await flushPromises();
    expect(w.find('[data-testid="doc-cientes"]').text()).toContain('SINT.QUALIDADE');
    expect(w.find('[data-testid="doc-pendentes-ciencia"]').text()).toContain(
      'Enfermeira sintética (SINT.ENFERMEIRA)',
    );
  });

  it('quem publica: o novo documento vai com o código em maiúsculas e a vigência de 24 meses', async () => {
    sessao('qualidade.documento.ler', 'qualidade.documento.publicar');
    const c = simular(
      base((url, init) => {
        if (url === '/api/qualidade/documentos' && init?.method === 'POST')
          return { id: 9, revisao: 1, hash: HASH };
        if (url.startsWith('/api/qualidade/documentos/9')) return DOC_COMPLETO({ id: 9, revisao: 1 });
        if (url.startsWith('/api/qualidade/documentos')) return PAGINA([]);
        return undefined;
      }),
    );
    const w = montar(DocumentosTela);
    await flushPromises();
    expect(w.find('[data-testid="doc-filtro-situacao"]').exists()).toBe(true);
    await clicar(w, 'doc-novo');
    await digitar(w, 'doc-codigo', 'pop-far-002');
    await escolher(w, 'doc-tipo', 'protocolo');
    await digitar(w, 'doc-area', 'Farmácia');
    await digitar(w, 'doc-titulo', 'Dispensação de antimicrobianos');
    await digitar(w, 'doc-conteudo', 'Conteúdo sintético do protocolo de dispensação.');
    await digitar(w, 'doc-elaborado', 'sint.farmacia');
    await enviarForm(w, 'form-documento');
    const p = posts(c)[0]!;
    expect(p.url).toBe('/api/qualidade/documentos');
    expect(p.corpo).toMatchObject({
      codigo: 'POP-FAR-002',
      tipo: 'protocolo',
      elaboradoPor: 'SINT.FARMACIA',
      revisadoPor: null,
      vigenciaAte: '2028-10-27',
      exigeCiencia: true,
      substitui: null,
    });
    expect(w.find('[data-testid="gestao-aviso"]').text()).toContain('revisão 1');
  });

  it('a recusa do servidor aparece com o texto da aplicação; desligada não oferece gravação', async () => {
    sessao('qualidade.documento.ler', 'qualidade.documento.publicar');
    simular(
      base((url) => {
        if (url.startsWith('/api/qualidade/documentos/5')) return DOC_COMPLETO();
        if (url.startsWith('/api/qualidade/documentos')) return PAGINA([DOC()]);
        return undefined;
      }, false),
    );
    const w = montar(DocumentosTela);
    await flushPromises();
    expect(w.find('[data-testid="gestao-desligada"]').text()).toContain('em consulta');
    expect(w.find('[data-testid="doc-novo"]').exists()).toBe(false);
    await clicar(w, 'abrir-documento-5');
    expect(w.find('[data-testid="doc-dar-ciencia"]').exists()).toBe(false);
    expect(w.find('[data-testid="doc-revisar"]').exists()).toBe(false);
  });
});

const FICHA = {
  codigo: 'densidadeIpcsCvc',
  nome: 'Densidade de IPCS associada a cateter venoso central',
  formula: 'IPCS ÷ cateter-dia × 1.000',
  numerador: 'IPCS associadas a CVC',
  denominador: 'Cateter venoso central-dia',
  fator: 1000,
  unidade: 'densidade',
  fonte: 'Ficha de IRAS e denominadores',
  periodicidade: 'mensal',
  polaridade: 'menor-melhor',
  responsavel: 'CCIH',
  referencia: 'Anvisa',
  programas: ['ona', 'pmQualiss'],
  origem: 'qualidade',
};
describe('indicadores', () => {
  it('abre na competência fechada; fora da meta a análise exige o plano e grava sem ID', async () => {
    sessao('qualidade.indicador.ler', 'qualidade.indicador.analisar');
    const c = simular(
      base((url, init) => {
        if (url.includes('/analise') && init?.method === 'POST') return { id: 1 };
        if (url.includes('/analises')) return { itens: [] };
        if (url.startsWith('/api/qualidade/indicadores'))
          return {
            competencia: '2026-09',
            itens: [
              {
                ficha: FICHA,
                competencia: '2026-09',
                numerador: 3,
                denominador: 1250,
                valor: 2.4,
                conta: '3 / 1.250 × 1.000 = 2,4',
                meta: 2,
                situacaoMeta: 'fora-da-meta',
                parcial: false,
                analise: null,
                pendente: true,
              },
            ],
            ligada: true,
            motivo: null,
            podeAnalisar: true,
          };
        return undefined;
      }),
    );
    const w = montar(IndicadoresTela);
    await flushPromises();
    expect(c.some((x) => x.url === '/api/qualidade/indicadores?competencia=2026-09')).toBe(true);
    const linha = w.find('[data-testid="indicador-densidadeIpcsCvc"]');
    expect(linha.text()).toContain('2,4 por mil');
    expect(linha.text()).toContain('3 / 1.250 × 1.000 = 2,4');
    expect(linha.text()).toContain('Fora da meta');
    expect(w.find('[data-testid="pendente-densidadeIpcsCvc"]').exists()).toBe(true);
    await clicar(w, 'abrir-indicador-densidadeIpcsCvc');
    expect(w.find('[data-testid="ficha-indicador"]').text()).toContain('Cateter venoso central-dia');
    await digitar(w, 'analise-texto', 'Análise sintética do mês fora da meta.');
    await enviarForm(w, 'form-analise');
    expect(posts(c)).toHaveLength(0);
    expect(w.find('[data-testid="erros-gestao"]').text()).toContain('plano de ação');
    await digitar(w, 'analise-causas', 'Causa sintética.');
    await digitar(w, 'analise-plano', 'Plano sintético.');
    await digitar(w, 'analise-responsavel', 'CCIH');
    await digitar(w, 'analise-prazo', '30/11/2026');
    await enviarForm(w, 'form-analise');
    const p = posts(c)[0]!;
    expect(p.url).toBe('/api/qualidade/indicadores/densidadeIpcsCvc/analise');
    expect(p.corpo).toMatchObject({
      analise: null,
      versao: null,
      competencia: '2026-09',
      prazo: '2026-11-30',
    });
  });
});

describe('W0-04 (M2 e M3): segurança do paciente e linhas de cuidado', () => {
  const FICHA_MEDIANA = {
    ...FICHA,
    codigo: 'sepseMediana',
    nome: 'Sepse: mediana do tempo até a meta-chave',
    formula: 'Mediana dos minutos entre a referência da meta e a meta-chave cumprida',
    numerador: 'Mediana, em minutos, dos tempos das metas-chave cumpridas na competência',
    denominador: null,
    fator: 1,
    unidade: 'minutos',
    programas: ['anahp', 'ona'],
    origem: 'linhaCuidado',
  };
  const FICHA_QUEDA = {
    ...FICHA,
    codigo: 'taxaQueda',
    nome: 'Taxa de queda por 1.000 pacientes-dia',
    denominador: 'Pacientes-dia do censo diário na competência',
    programas: ['anahp', 'ona'],
    origem: 'seguranca',
  };
  const item = (ficha: object, extra: object) => ({
    ficha,
    competencia: '2026-09',
    meta: null,
    situacaoMeta: 'sem-meta',
    parcial: false,
    analise: null,
    pendente: true,
    ...extra,
  });
  it('a mediana em minutos com os tempos, a origem, a série mensal na ficha e a planilha das parcelas', async () => {
    sessao('qualidade.indicador.ler');
    const c = simular(
      base((url) => {
        if (url.includes('/analises')) return { itens: [] };
        if (url.includes('/exportacao')) return 'codigo;indicador';
        if (url.includes('/serie'))
          return {
            codigo: 'sepseMediana',
            itens: [
              {
                competencia: '2026-08',
                numerador: 70,
                denominador: null,
                valor: 70,
                conta: 'mediana de 1 tempo (70 min) = 70 min',
                meta: null,
                situacaoMeta: 'sem-meta',
                parcial: false,
              },
              {
                competencia: '2026-09',
                numerador: 55,
                denominador: null,
                valor: 55,
                conta: 'mediana de 3 tempos (40, 55 e 90 min) = 55 min',
                meta: null,
                situacaoMeta: 'sem-meta',
                parcial: false,
              },
            ],
          };
        if (url.startsWith('/api/qualidade/indicadores'))
          return {
            competencia: '2026-09',
            itens: [
              item(FICHA_QUEDA, {
                numerador: 2,
                denominador: 300,
                valor: 6.67,
                conta: '2 ÷ 300 × 1.000 = 6,67',
              }),
              item(FICHA_MEDIANA, {
                numerador: 55,
                denominador: null,
                valor: 55,
                conta: 'mediana de 3 tempos (40, 55 e 90 min) = 55 min',
              }),
            ],
            ligada: true,
            motivo: null,
            podeAnalisar: false,
          };
        return undefined;
      }),
    );
    const w = montar(IndicadoresTela);
    await flushPromises();
    const queda = w.find('[data-testid="indicador-taxaQueda"]');
    expect(queda.text()).toContain('6,67 por mil');
    expect(queda.text()).toContain('Segurança do paciente (NSP)');
    const med = w.find('[data-testid="indicador-sepseMediana"]');
    expect(med.text()).toContain('55 min');
    expect(med.text()).toContain('mediana de 3 tempos (40, 55 e 90 min) = 55 min');
    expect(med.text()).toContain('Linhas de cuidado');
    await clicar(w, 'abrir-indicador-sepseMediana');
    expect(c.some((x) => x.url === '/api/qualidade/indicadores/sepseMediana/serie?ate=2026-09&meses=6')).toBe(
      true,
    );
    const serie = w.find('[data-testid="serie-indicador"]');
    expect(serie.find('[data-testid="serie-2026-08"]').text()).toContain('70 min');
    expect(serie.text()).toContain('Os últimos 6 meses');
    // sem o denominador na ficha (mediana)
    expect(w.find('[data-testid="ficha-indicador"]').text()).not.toContain('Denominador');
    await clicar(w, 'ind-exportar');
    expect(c.some((x) => x.url === '/api/qualidade/indicadores/exportacao?competencia=2026-09')).toBe(true);
    expect(baixados).toContain('indicadores-qualidade-2026-09.csv');
    expect(w.find('[data-testid="gestao-aviso"]').text()).toContain('Planilha das parcelas');
  });
});

const AUD = {
  id: 12,
  titulo: 'Auditoria sintética da UTI',
  area: 'UTI',
  referencial: 'ona',
  realizadaEm: '2026-09-15',
  auditores: 'Auditor sintético',
  itens: [
    { requisito: 'Identificação do paciente', secao: 'Seção 1', resultado: 'conforme', evidencia: null },
  ],
  resultado: {
    conformes: 1,
    parciais: 0,
    naoConformes: 0,
    naoAplicaveis: 0,
    avaliados: 1,
    conformidade: 100,
    conta: '(1 + 0,5 × 0) ÷ 1 × 100 = 100%',
  },
  conclusao: 'Conclusão sintética.',
  naoConformidades: 0,
  registradaPor: 'SINT.QUALIDADE',
  registradaEm: '2026-09-15T12:00:00',
};
describe('auditorias', () => {
  it('a nova auditoria usa a anterior como modelo, mostra a prévia e grava o checklist', async () => {
    sessao('qualidade.gestao.ler', 'qualidade.gestao.registrar');
    const c = simular(
      base((url, init) => {
        if (url === '/api/qualidade/gestao/auditorias' && init?.method === 'POST') return { id: 13 };
        if (url.startsWith('/api/qualidade/gestao/auditorias/')) return { ...AUD, id: 13 };
        if (url.startsWith('/api/qualidade/gestao/auditorias')) return PAGINA([AUD]);
        return undefined;
      }),
    );
    const w = montar(AuditoriasTela);
    await flushPromises();
    expect(w.find('[data-testid="auditoria-12"]').text()).toContain('100%');
    await clicar(w, 'aud-nova');
    await escolher(w, 'aud-modelo', '12');
    await clicar(w, 'aud-usar-modelo');
    expect((w.find('[data-testid="aud-item-requisito-0"] input').element as HTMLInputElement).value).toBe(
      'Identificação do paciente',
    );
    await escolher(w, 'aud-item-resultado-0', 'parcial');
    await digitar(w, 'aud-item-evidencia-0', 'Pulseira sem leito em um caso.');
    expect(w.find('[data-testid="aud-previa"]').text()).toContain('(0 + 0,5 × 1) ÷ 1 × 100 = 50%');
    await digitar(w, 'aud-titulo', 'Auditoria sintética de outubro');
    await digitar(w, 'aud-auditores', 'Auditor sintético');
    await digitar(w, 'aud-conclusao', 'Conclusão sintética de outubro.');
    await enviarForm(w, 'form-auditoria');
    const p = posts(c)[0]!;
    expect(p.corpo).toMatchObject({
      referencial: 'ona',
      area: 'UTI',
      realizadaEm: '2026-10-27',
      itens: [
        {
          requisito: 'Identificação do paciente',
          secao: 'Seção 1',
          resultado: 'parcial',
          evidencia: 'Pulseira sem leito em um caso.',
        },
      ],
    });
    expect(w.find('[data-testid="auditoria-detalhe"]').exists()).toBe(true);
    expect(w.find('[data-testid="aud-abrir-nc"]').attributes('href')).toBe(
      '/qualidade/gestao/riscos?aba=naoConformidades&origem=auditoria&id=13',
    );
  });
});

const COMISSAO = {
  id: 3,
  versao: 2,
  tipo: 'ccih',
  nome: 'Comissão sintética de controle de infecção',
  periodicidade: 'mensal',
  membros: [
    { nome: 'Membro Um', funcao: 'Presidente', login: null },
    { nome: 'Membro Dois', funcao: 'Secretária', login: null },
    { nome: 'Membro Três', funcao: 'Membro', login: null },
  ],
  ativa: true,
  ultimaReuniao: '2026-08-10T14:00:00',
  proximaReuniaoAte: '2026-09-10',
  atrasada: true,
};
describe('comissões', () => {
  it('a atrasada fica destacada; a reunião mostra o quórum e grava os presentes', async () => {
    sessao('qualidade.gestao.ler', 'qualidade.gestao.registrar');
    const c = simular(
      base((url, init) => {
        if (url.endsWith('/reunioes') && init?.method === 'POST') return { id: 30 };
        if (url.endsWith('/reunioes')) return { itens: [] };
        if (url.startsWith('/api/qualidade/gestao/comissoes')) return { itens: [COMISSAO] };
        return undefined;
      }),
    );
    const w = montar(ComissoesTela);
    await flushPromises();
    expect(w.find('[data-testid="atrasada-3"]').text()).toBe('Atrasada');
    await clicar(w, 'abrir-comissao-3');
    await clicar(w, 'reu-nova');
    await w.find('[data-testid="reu-presente-0"]').setValue(true);
    expect(w.find('[data-testid="reu-quorum"]').text()).toContain('1 presentes de 3 membros: Sem quórum');
    await w.find('[data-testid="reu-presente-2"]').setValue(true);
    expect(w.find('[data-testid="reu-quorum"]').text()).toContain('Quórum');
    await digitar(w, 'reu-pauta', 'Pauta sintética');
    await digitar(w, 'reu-ata', 'Ata sintética da reunião ordinária.');
    await enviarForm(w, 'form-reuniao');
    const p = posts(c)[0]!;
    expect(p.url).toBe('/api/qualidade/gestao/comissoes/3/reunioes');
    expect(p.corpo).toMatchObject({
      versaoComissao: 2,
      tipo: 'ordinaria',
      realizadaEm: '2026-10-27T09:00',
      presentes: [0, 2],
    });
  });
});

const RISCO = {
  id: 8,
  versao: 1,
  titulo: 'Queda de paciente',
  descricao: 'Descrição sintética.',
  area: 'Internação',
  categoria: 'assistencial',
  gravidade: 4,
  urgencia: 4,
  tendencia: 4,
  pontuacao: 64,
  prioridade: 'critica',
  controles: null,
  controlesLista: [],
  eficaciaControles: 'semControle',
  responsavel: 'Coordenação',
  situacao: 'identificado',
  reavaliarEm: '2026-10-01',
  reavaliacaoVencida: true,
  justificativa: null,
  registradoPor: 'SINT.QUALIDADE',
  registradoEm: '2026-09-01T10:00:00',
  atualizadoPor: null,
  atualizadoEm: null,
};
describe('riscos e não conformidades', () => {
  it('o risco mostra a conta; o novo risco tem a prévia GUT e grava os eixos', async () => {
    sessao('qualidade.gestao.ler', 'qualidade.gestao.registrar');
    const c = simular(
      base((url, init) => {
        if (url === '/api/qualidade/gestao/riscos' && init?.method === 'POST') return { id: 9, versao: 1 };
        if (url.startsWith('/api/qualidade/gestao/riscos')) return PAGINA([RISCO]);
        return undefined;
      }),
    );
    const w = montar(RiscosTela);
    await flushPromises();
    const linha = w.find('[data-testid="risco-8"]');
    expect(linha.text()).toContain('4 × 4 × 4 = 64');
    expect(linha.text()).toContain('Crítica');
    expect(linha.text()).toContain('Reavaliação vencida');
    await clicar(w, 'risco-novo');
    await digitar(w, 'risco-titulo', 'Erro de dispensação');
    await digitar(w, 'risco-descricao', 'Descrição sintética do risco.');
    await digitar(w, 'risco-area', 'Farmácia');
    await escolher(w, 'risco-categoria', 'assistencial');
    await escolher(w, 'risco-gravidade', '5');
    await escolher(w, 'risco-urgencia', '3');
    await escolher(w, 'risco-tendencia', '2');
    expect(w.find('[data-testid="risco-previa"]').text()).toContain('5 × 3 × 2 = 30; prioridade Alta');
    await digitar(w, 'risco-responsavel', 'Farmacêutico');
    await digitar(w, 'risco-reavaliar', '31/01/2027');
    await enviarForm(w, 'form-risco');
    expect(posts(c)[0]!.corpo).toMatchObject({
      risco: null,
      gravidade: 5,
      urgencia: 3,
      tendencia: 2,
      reavaliarEm: '2027-01-31',
    });
  });

  it('a não conformidade abre pela origem no endereço e grava o registro de origem', async () => {
    rotaAtual.query = { aba: 'naoConformidades', origem: 'auditoria', id: '12' };
    sessao('qualidade.gestao.ler', 'qualidade.gestao.registrar');
    const c = simular(
      base((url, init) => {
        if (url === '/api/qualidade/gestao/nao-conformidades' && init?.method === 'POST')
          return { id: 4, versao: 1 };
        if (url.startsWith('/api/qualidade/gestao/nao-conformidades')) return PAGINA([]);
        return undefined;
      }),
    );
    const w = montar(RiscosTela);
    await flushPromises();
    expect(w.find('[data-testid="aba-naoConformidades"]').attributes('aria-selected')).toBe('true');
    expect((w.find('[data-testid="nc-id-origem"] input').element as HTMLInputElement).value).toBe('12');
    await escolher(w, 'nc-classificacao', 'maior');
    await digitar(w, 'nc-area', 'UTI');
    await digitar(w, 'nc-descricao', 'Não conformidade sintética da auditoria.');
    await enviarForm(w, 'form-nc');
    expect(posts(c)[0]!.corpo).toMatchObject({ origem: 'auditoria', idOrigem: 12, situacao: 'aberta' });
  });
});

const MANIF = (x: Record<string, unknown> = {}) => ({
  id: 5,
  versao: 1,
  protocolo: '2026.10.0001',
  canal: 'telefone',
  tipo: 'reclamacao',
  identificada: false,
  paciente: null,
  manifestante: null,
  contato: null,
  area: 'Recepção',
  relato: 'Relato sintético.',
  recebidaEm: '2026-10-20T08:00:00',
  prazoEm: '2026-11-03',
  situacao: 'aberta',
  encaminhadaA: null,
  observacao: null,
  resposta: null,
  procedente: null,
  respondidaEm: null,
  respondidaPor: null,
  pesquisa: null,
  estadoPrazo: 'noPrazo',
  registradaPor: 'SINT.OUVIDORIA',
  registradaEm: '2026-10-20T08:05:00',
  ...x,
});
const LISTA_MANIF = (itens: unknown[]) => ({
  ...PAGINA(itens),
  ligada: true,
  motivo: null,
  podeResponder: true,
  agora: AGORA,
});
describe('ouvidoria', () => {
  it('a anônima vai sem identificação; a resposta da reclamação exige a procedência', async () => {
    sessao('qualidade.ouvidoria.ler', 'qualidade.ouvidoria.responder');
    const c = simular(
      base((url, init) => {
        if (url === '/api/qualidade/ouvidoria/manifestacoes' && init?.method === 'POST')
          return { id: 6, protocolo: '2026.10.0002' };
        if (url.endsWith('/resposta') && init?.method === 'POST') return { versao: 2 };
        if (url.startsWith('/api/qualidade/ouvidoria/manifestacoes')) return LISTA_MANIF([MANIF()]);
        return undefined;
      }),
    );
    const w = montar(OuvidoriaTela);
    await flushPromises();
    expect(w.find('[data-testid="manifestacao-5"]').text()).toContain('Anônima');
    expect(w.find('[data-testid="manifestacao-5"]').text()).toContain('No prazo até 03/11/2026');
    await clicar(w, 'man-nova');
    await escolher(w, 'man-canal', 'caixa');
    await escolher(w, 'man-tipo', 'sugestao');
    await digitar(w, 'man-area', 'Nutrição');
    await w.find('[data-testid="man-identificada"]').setValue(false);
    expect(w.find('[data-testid="man-anonima"]').exists()).toBe(true);
    await digitar(w, 'man-relato', 'Sugestão sintética de cardápio.');
    await w.find('[data-testid="man-relato"]').element.closest('form')!.dispatchEvent(new Event('submit'));
    await flushPromises();
    const p = posts(c)[0]!;
    expect(p.corpo).toMatchObject({
      canal: 'caixa',
      identificada: false,
      paciente: null,
      manifestante: null,
      contato: null,
      recebidaEm: '2026-10-27T09:00',
      pesquisa: null,
    });
    expect(w.find('[data-testid="gestao-aviso"]').text()).toContain('2026.10.0002');
    await clicar(w, 'abrir-manifestacao-5');
    await clicar(w, 'man-responder');
    await digitar(w, 'man-resposta', 'Resposta sintética ao manifestante.');
    await enviarForm(w, 'form-responder');
    expect(posts(c)).toHaveLength(1);
    expect(w.find('[data-testid="erros-gestao"]').text()).toContain('procede');
    await escolher(w, 'man-procedente', 'sim');
    await enviarForm(w, 'form-responder');
    expect(posts(c)[1]!.url).toBe('/api/qualidade/ouvidoria/manifestacoes/5/resposta');
    expect(posts(c)[1]!.corpo).toEqual({
      versao: 1,
      resposta: 'Resposta sintética ao manifestante.',
      procedente: true,
    });
  });

  it('quem liga dá o protocolo: a busca vai ao servidor e volta à primeira página', async () => {
    sessao('qualidade.ouvidoria.ler');
    const c = simular(
      base((url) =>
        url.startsWith('/api/qualidade/ouvidoria/manifestacoes') ? LISTA_MANIF([MANIF()]) : undefined,
      ),
    );
    const w = montar(OuvidoriaTela);
    await flushPromises();
    await digitar(w, 'man-busca', ' OUV-2026-000005 ');
    await w.find('[data-testid="man-busca"]').element.closest('form')!.dispatchEvent(new Event('submit'));
    await flushPromises();
    const lidas = c.filter((x) => x.url.startsWith('/api/qualidade/ouvidoria/manifestacoes?'));
    expect(lidas.at(-1)!.url).toContain('busca=OUV-2026-000005');
    expect(lidas.at(-1)!.url).toContain('pagina=1');
  });

  it('a resposta da pesquisa vira manifestação pelo canal da pesquisa; o NPS sai com as parcelas', async () => {
    sessao('qualidade.ouvidoria.ler', 'qualidade.ouvidoria.responder');
    const c = simular(
      base((url, init) => {
        if (url === '/api/qualidade/ouvidoria/manifestacoes' && init?.method === 'POST')
          return { id: 7, protocolo: '2026.10.0003' };
        if (url.startsWith('/api/qualidade/ouvidoria/manifestacoes')) return LISTA_MANIF([]);
        if (url.startsWith('/api/qualidade/ouvidoria/pesquisas'))
          return {
            itens: [
              {
                id: 31,
                tipo: 'Consulta',
                agenda: 'Agenda sintética',
                dataAtendimento: '2026-10-10',
                nota: 3,
                comentario: 'Demora sintética.',
                manifestacao: null,
              },
            ],
            cortada: false,
          };
        if (url.startsWith('/api/qualidade/ouvidoria/nps'))
          return {
            itens: [
              {
                competencia: '2026-10',
                respostas: 10,
                promotores: 6,
                neutros: 2,
                detratores: 2,
                nps: 40,
                conta: '60% − 20% = 40',
              },
            ],
            cortada: false,
          };
        return undefined;
      }),
    );
    const w = montar(OuvidoriaTela);
    await flushPromises();
    await clicar(w, 'aba-pesquisas');
    expect(c.some((x) => x.url === '/api/qualidade/ouvidoria/pesquisas?competencia=2026-10')).toBe(true);
    await clicar(w, 'pesquisa-registrar-31');
    await digitar(w, 'man-area', 'Ambulatório');
    await w.find('[data-testid="man-relato"]').element.closest('form')!.dispatchEvent(new Event('submit'));
    await flushPromises();
    expect(posts(c)[0]!.corpo).toMatchObject({
      canal: 'pesquisa',
      tipo: 'reclamacao',
      identificada: true,
      paciente: null,
      relato: 'Demora sintética.',
      pesquisa: 31,
    });
    await clicar(w, 'aba-nps');
    expect(w.find('[data-testid="nps-2026-10"]').text()).toContain('60% − 20% = 40');
  });
});

const ENVIO = (x: Record<string, unknown> = {}) => ({
  id: 3,
  versao: 1,
  tipo: 'iras',
  competencia: '2026-09',
  revisao: 1,
  arquivo: 'IRAS_PC_202609_R1.csv',
  hash: HASH,
  linhas: 4,
  resumo: { setores: 3 },
  situacao: 'gerado',
  geradoPor: 'SINT.CCIH',
  geradoEm: '2026-10-05T10:00:00',
  transmitidoEm: null,
  transmitidoPor: null,
  protocolo: null,
  ...x,
});
const TIPOS = [
  { codigo: 'pmQualiss', rotulo: 'PM-QUALISS', destino: 'Portal do programa' },
  { codigo: 'iras', rotulo: 'IRAS', destino: 'Formulário estadual' },
  { codigo: 'notivisa', rotulo: 'Notivisa', destino: 'Portal Notivisa' },
];
describe('envios regulatórios', () => {
  it('gera e baixa o arquivo; a transmissão confere o resumo e grava o protocolo', async () => {
    sessao('relatorio.envioRegulatorio.gerar');
    const c = simular(
      base((url, init) => {
        if (url === '/api/relatorio/envios-regulatorios' && init?.method === 'POST')
          return {
            id: 4,
            revisao: 1,
            arquivo: 'PMQUALISS_PC_202609_R1.csv',
            hash: HASH,
            linhas: 8,
            resumo: {},
            conteudo: 'a;b',
          };
        if (url.endsWith('/arquivo'))
          return { arquivo: 'IRAS_PC_202609_R1.csv', conteudo: 'x;y', hash: HASH, igual: true };
        if (url.endsWith('/transmissao') && init?.method === 'POST') return { versao: 2 };
        if (url.startsWith('/api/relatorio/envios-regulatorios'))
          return {
            tipos: TIPOS,
            itens: [ENVIO(), ENVIO({ id: 2, situacao: 'substituido', revisao: 0 })],
            ligada: true,
            motivo: null,
            podeGerar: true,
            competenciaSugerida: '2026-09',
            agora: AGORA,
          };
        return undefined;
      }),
    );
    const w = montar(EnviosRegulatoriosTela);
    await flushPromises();
    expect(w.find('[data-testid="envio-linha-2"]').exists()).toBe(false);
    await clicar(w, 'envio-gerar-pmQualiss');
    expect(posts(c)[0]!.corpo).toEqual({ tipo: 'pmQualiss', competencia: '2026-09' });
    expect(baixados).toContain('PMQUALISS_PC_202609_R1.csv');
    await clicar(w, 'envio-baixar-3');
    expect(w.find('[data-testid="envio-conferido-3"]').text()).toContain('os dados não mudaram');
    await clicar(w, 'envio-transmitir-3');
    expect((w.find('[data-testid="tx-hash"] input').element as HTMLInputElement).value).toBe(HASH);
    await digitar(w, 'tx-hash', 'd'.repeat(64));
    await digitar(w, 'tx-protocolo', 'PROT-SINT-1');
    await enviarForm(w, 'form-transmissao');
    expect(posts(c)).toHaveLength(1);
    expect(w.find('[data-testid="erros-gestao"]').text()).toContain('não é o do arquivo gerado');
    await digitar(w, 'tx-hash', HASH);
    await enviarForm(w, 'form-transmissao');
    expect(posts(c)[1]!.url).toBe('/api/relatorio/envios-regulatorios/3/transmissao');
    expect(posts(c)[1]!.corpo).toEqual({
      versao: 1,
      transmitidoEm: '2026-10-27T09:00',
      protocolo: 'PROT-SINT-1',
      hash: HASH,
    });
  });

  it('só os tipos que o servidor devolve para a sessão (os dados de cada área) têm o botão de gerar', async () => {
    sessao('relatorio.envioRegulatorio.gerar');
    simular(
      base((url) =>
        url.startsWith('/api/relatorio/envios-regulatorios')
          ? {
              tipos: TIPOS.filter((t) => t.codigo === 'pmQualiss'),
              itens: [],
              ligada: true,
              motivo: null,
              podeGerar: true,
              competenciaSugerida: '2026-09',
              agora: AGORA,
            }
          : undefined,
      ),
    );
    const w = montar(EnviosRegulatoriosTela);
    await flushPromises();
    expect(w.find('[data-testid="envio-gerar-pmQualiss"]').exists()).toBe(true);
    expect(w.find('[data-testid="envio-gerar-notivisa"]').exists()).toBe(false);
    expect(w.find('[data-testid="envio-gerar-iras"]').exists()).toBe(false);
  });

  it('desligado: só consulta (sem gerar nem transmitir)', async () => {
    sessao('relatorio.envioRegulatorio.gerar');
    simular(
      base((url) =>
        url.startsWith('/api/relatorio/envios-regulatorios')
          ? {
              tipos: TIPOS,
              itens: [ENVIO()],
              ligada: false,
              motivo: null,
              podeGerar: false,
              competenciaSugerida: '2026-09',
              agora: AGORA,
            }
          : undefined,
      ),
    );
    const w = montar(EnviosRegulatoriosTela);
    await flushPromises();
    expect(w.find('[data-testid="gestao-desligada"]').exists()).toBe(true);
    expect(w.find('[data-testid="envio-gerar-iras"]').exists()).toBe(false);
    expect(w.find('[data-testid="envio-transmitir-3"]').exists()).toBe(false);
    expect(w.find('[data-testid="envio-baixar-3"]').exists()).toBe(true);
  });
});

describe('W0-04 (M5): revisão de prontuários', () => {
  const CHK = [
    { codigo: 'evolucao-diaria', titulo: 'Evolução diária' },
    { codigo: 'sumario-alta', titulo: 'Sumário de alta' },
  ];
  const SORTEIO = {
    id: 3,
    comissao: 9,
    checklist: 5,
    checklistRevisao: 1,
    competencia: '2026-09',
    semente: 'SINT-1',
    quantidade: 1,
    universo: 24,
    resumoUniverso: 'a'.repeat(64),
    sorteadoPor: 'SINT.QUALIDADE',
    sorteadoEm: '2026-10-20T10:00:00',
    canceladoEm: null,
    canceladoPor: null,
    motivoCancelamento: null,
    revisados: 0,
    versao: 1,
  };
  const PRONT = {
    id: 7,
    ordem: 1,
    reg: 9480100,
    alta: '2026-09-10',
    clinica: 'Clínica médica',
    medico: 'MEDICO SINTETICO',
    situacao: 'aRevisar',
    respostas: [],
    observacao: null,
    revisadoPor: null,
    revisadoEm: null,
    avalPor: null,
    avalEm: null,
    podeAval: false,
    pendencias: [],
    versao: 1,
  };
  it('sorteia com a semente, revisa pelo checklist (o não conforme com observação) e mostra a conformidade', async () => {
    sessao('qualidade.revisaoProntuario.ler', 'qualidade.revisaoProntuario.registrar');
    const c = simular(
      base((url, init) => {
        if (url.startsWith('/api/qualidade/revisao-prontuarios/comissoes'))
          return {
            itens: [{ id: 9, nome: 'Comissão de prontuários', ativa: true }],
            sugerido: CHK,
            tetoAmostra: 200,
            ligada: true,
            motivo: null,
            podeRegistrar: true,
          };
        if (url.startsWith('/api/qualidade/revisao-prontuarios/checklists'))
          return {
            itens: [
              {
                id: 5,
                comissao: 9,
                revisao: 1,
                itens: CHK,
                situacao: 'vigente',
                motivo: null,
                publicadoPor: 'SINT.QUALIDADE',
                publicadoEm: '2026-10-01T10:00:00',
                inativadoPor: null,
                inativadoEm: null,
                versao: 1,
              },
            ],
          };
        if (url.startsWith('/api/qualidade/revisao-prontuarios/altas'))
          return { competencia: '2026-09', universo: 24, cortada: false, sugerida: 10, porClinica: [] };
        if (url.startsWith('/api/qualidade/revisao-prontuarios/sorteios/3'))
          return {
            sorteio: SORTEIO,
            checklist: {
              id: 5,
              comissao: 9,
              revisao: 1,
              itens: CHK,
              situacao: 'vigente',
              motivo: null,
              publicadoPor: 'Q',
              publicadoEm: '2026-10-01T10:00:00',
              inativadoPor: null,
              inativadoEm: null,
              versao: 1,
            },
            prontuarios: [PRONT],
            podeRegistrar: true,
          };
        if (url.startsWith('/api/qualidade/revisao-prontuarios/sorteios') && init?.method === 'POST')
          return { id: 3, semente: 'SINT-1', quantidade: 10, universo: 24 };
        if (url.startsWith('/api/qualidade/revisao-prontuarios/sorteios')) return { itens: [SORTEIO] };
        if (url.includes('/revisao') && init?.method === 'POST') return { versao: 2 };
        if (url.startsWith('/api/qualidade/revisao-prontuarios/indicador'))
          return {
            competencia: '2026-09',
            total: {
              clinica: 'Todas as clínicas',
              revisados: 1,
              conformes: 0,
              percentual: 0,
              conta: '0 ÷ 1 × 100 = 0%',
            },
            porClinica: [
              {
                clinica: 'Clínica médica',
                revisados: 1,
                conformes: 0,
                percentual: 0,
                conta: '0 ÷ 1 × 100 = 0%',
              },
            ],
            pendenciasAbertas: 1,
            pendenciasVencidas: 0,
          };
        return undefined;
      }),
    );
    const w = montar(RevisaoProntuariosTela);
    await flushPromises();
    expect(w.find('[data-testid="revisao-universo"]').text()).toContain('Altas na competência: 24');
    await digitar(w, 'revisao-semente', 'SINT-1');
    await enviarForm(w, 'form-sorteio');
    const p = posts(c).find((x) => x.url === '/api/qualidade/revisao-prontuarios/sorteios')!;
    expect(p.corpo).toEqual({ comissao: 9, competencia: '2026-09', quantidade: 10, semente: 'SINT-1' });
    expect(p.chave).toBeTruthy();
    expect(w.find('[data-testid="revisao-aviso"]').text()).toContain('semente SINT-1: 10 de 24');
    expect(w.find('[data-testid="tabela-prontuarios"]').text()).toContain('MEDICO SINTETICO');
    await clicar(w, 'revisar-9480100');
    const d = document.body.querySelector('[data-testid="dialogo-correcao"]')!;
    expect(
      d.querySelector<HTMLButtonElement>(
        '[data-testid="correcao-confirmar"] button, button[data-testid="correcao-confirmar"]',
      )?.disabled ?? true,
    ).toBe(true);
    (d.querySelector('[data-testid="resultado-evolucao-diaria-conforme"]') as HTMLInputElement).click();
    (d.querySelector('[data-testid="resultado-sumario-alta-naoConforme"]') as HTMLInputElement).click();
    await flushPromises();
    const obs = d.querySelector<HTMLTextAreaElement | HTMLInputElement>(
      '[data-testid="observacao-sumario-alta"] input, input[data-testid="observacao-sumario-alta"]',
    )!;
    obs.value = 'Sem orientações.';
    obs.dispatchEvent(new Event('input'));
    await flushPromises();
    d.dispatchEvent(new Event('submit'));
    await flushPromises();
    const rev = posts(c).find((x) => x.url === '/api/qualidade/revisao-prontuarios/prontuarios/7/revisao')!;
    expect(rev.corpo).toEqual({
      versao: 1,
      respostas: [
        { item: 'evolucao-diaria', resultado: 'conforme', observacao: null },
        { item: 'sumario-alta', resultado: 'naoConforme', observacao: 'Sem orientações.' },
      ],
      observacao: null,
      justificativa: null,
    });
    await clicar(w, 'revisao-aba-indicador');
    expect(w.find('[data-testid="conformidade-total"]').text()).toContain('0 ÷ 1 × 100 = 0%');
  });

  it('minhas pendências: o profissional responde a própria com o texto mínimo', async () => {
    sessao('qualidade.revisaoProntuario.responder');
    const c = simular(
      base((url, init) => {
        if (url.includes('/resposta') && init?.method === 'POST') return { versao: 2 };
        if (url.startsWith('/api/qualidade/revisao-prontuarios/minhas-pendencias'))
          return {
            itens: [
              {
                id: 40,
                prontuario: 7,
                reg: 9480100,
                item: 'sumario-alta',
                descricao: 'Item não conforme: Sumário de alta.',
                profissionalNome: 'MEDICO SINTETICO',
                profissionalLogin: 'SINT.MEDICO',
                prazo: '2026-11-11',
                situacao: 'aberta',
                vencida: false,
                resposta: null,
                resolvidaPor: null,
                resolvidaEm: null,
                canceladaPor: null,
                canceladaEm: null,
                motivoCancelamento: null,
                criadaEm: '2026-10-27T10:00:00',
                versao: 1,
              },
            ],
          };
        return undefined;
      }),
    );
    const w = montar(MinhasPendenciasProntuarioTela);
    await flushPromises();
    expect(w.find('[data-testid="minha-40"]').text()).toContain('Prazo: 11/11/2026');
    await clicar(w, 'responder-40');
    const f = document.body.querySelector('[data-testid="form-resposta"]')!;
    const t = f.querySelector<HTMLTextAreaElement>('textarea')!;
    t.value = 'curta';
    t.dispatchEvent(new Event('input'));
    await flushPromises();
    f.dispatchEvent(new Event('submit'));
    await flushPromises();
    expect(posts(c)).toHaveLength(0);
    t.value = 'Sumário completado com as orientações.';
    t.dispatchEvent(new Event('input'));
    await flushPromises();
    f.dispatchEvent(new Event('submit'));
    await flushPromises();
    expect(posts(c)[0]).toMatchObject({
      url: '/api/qualidade/revisao-prontuarios/pendencias/40/resposta',
      corpo: { versao: 1, resposta: 'Sumário completado com as orientações.' },
    });
    expect(w.find('[data-testid="minhas-aviso"]').text()).toContain('Resposta enviada');
  });
});
