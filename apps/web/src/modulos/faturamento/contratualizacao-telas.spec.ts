// @vitest-environment jsdom
// Tela da contratualização SUS (M55, etapa 5): os textos sem citar o sistema anterior nem nome de tabela; os apoios puros
// (centavos digitados, competência do campo, competência anterior, faltas e corpo da meta só com os campos do tipo,
// permissão de editar, período encerrado); a lista e o contrato aberto com as pendências, as metas e o painel com o
// repasse e as parcelas; a apuração da meta qualitativa enviada com a Idempotency-Key igual à chave do corpo; o cadastro
// recusa contrato sem orçamento antes de enviar e envia os centavos; a meta quantitativa sai sem os campos da
// qualitativa; com a funcionalidade em consulta, as ações desabilitadas e o motivo. Dados SINTÉTICOS; o fetch é simulado.
import {
  type ApuracaoSus,
  type ContratoSus,
  MENSAGENS_CONTRATUALIZACAO,
  type MetaSus,
  type PainelContratualizacaoSus,
} from '@sgh/contratos';
import { criarI18n, instalarUi, resolverMarca } from '@sgh/ui';
import { QueryClient, VueQueryPlugin } from '@tanstack/vue-query';
import { flushPromises, mount } from '@vue/test-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { App } from 'vue';
import { mensagensWeb } from '../../i18n/pt-BR.js';
import ContratoSusFormulario from './componentes/ContratoSusFormulario.vue';
import {
  centavosDe,
  competenciaAnterior,
  competenciaDoCampo,
  competenciaParaCampo,
  competenciaTexto,
  corpoDaMeta,
  faltasDaMeta,
  type FormularioMetaSus,
  numeroDe,
  periodoEncerrado,
  podeEditarSus,
  reaisDeCentavos,
  rotuloEsfera,
  textoDeCentavos,
} from './componentes/contratualizacao-tela.js';
import DominiosSus from './componentes/DominiosSus.vue';
import MetaSusFormulario from './componentes/MetaSusFormulario.vue';
import { mensagensContratualizacao } from './i18n-contratualizacao.js';
import ContratualizacaoTela from './telas/ContratualizacaoTela.vue';

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

const gravacao = (ligada: boolean) => ({
  ligada,
  motivo: ligada ? null : MENSAGENS_CONTRATUALIZACAO.desligado,
  operacoes: { editar: { pode: ligada, motivo: null } },
});

const contrato: ContratoSus = {
  id: 7,
  numero: 'SUS-SINT-01',
  esfera: 3,
  gestor: 'Secretaria Municipal Sintética',
  objeto: 'Prestação sintética de serviços ambulatoriais',
  inicio: '2026-01-01',
  fim: '2026-12-31',
  cnes: '1234567',
  habilitacao: 'Portaria sintética 1',
  habilitacaoValidade: '2027-12-31',
  redeAssistencia: 2,
  valorPreMensalCentavos: 10_000_000,
  valorPosMensalCentavos: 5_000_000,
  parteQualitativaPct: 40,
  incentivos: [
    {
      incentivo: null,
      nome: 'Incentivo sintético',
      valorMensalCentavos: 100_000,
      inicio: '2026-01-01',
      fim: null,
    },
  ],
  observacao: null,
  situacao: 'ativo',
  motivoEncerramento: null,
  encerradoPor: null,
  encerradoEm: null,
  criadoPor: 'SINT.CONTRATUALIZACAO',
  criadoEm: '2026-01-02T09:00:00',
  alteradoPor: null,
  alteradoEm: null,
  versao: 1,
};
const metaBase = {
  contrato: 7,
  periodicidade: 5,
  inicio: '202601',
  fim: null,
  pontos: 10,
  nivelSigtap: null,
  codigoSigtap: null,
  modalidade: null,
  complexidade: null,
  indicador: null,
  formato: null,
  sentido: null,
  unidade: null,
  afericao: null,
  ativa: true,
  por: 'SINT.CONTRATUALIZACAO',
  em: '2026-01-02T09:00:00',
  versao: 1,
} as const;
const metaQuanti: MetaSus = {
  ...metaBase,
  id: 11,
  tipo: 'quantitativa',
  descricao: 'Consultas especializadas',
  nivelSigtap: 'subgrupo',
  codigoSigtap: '0301',
  modalidade: 'ambulatorial',
  valorMeta: 100,
};
const metaQuali: MetaSus = {
  ...metaBase,
  id: 12,
  tipo: 'qualitativa',
  descricao: 'Comissão de óbitos ativa',
  indicador: 2,
  formato: 2,
  sentido: 'maior',
  valorMeta: 1,
};
const apuracao: ApuracaoSus = {
  id: 21,
  meta: 11,
  competencia: '202608',
  inicioPeriodo: '202608',
  metaPeriodo: 100,
  realizado: 96,
  cumprimentoPct: 96,
  escore: 4,
  origem: 'contas-sus',
  observacao: null,
  por: 'SINT.CONTRATUALIZACAO',
  em: '2026-09-02T09:00:00',
  versao: 1,
};
const periodo = { inicio: '202609', fim: '202609', competencias: ['202609'], meses: 1 };
const painel: PainelContratualizacaoSus = {
  contrato,
  competencia: '202609',
  fonte: 'contas-sus',
  resultados: [
    {
      meta: 11,
      tipo: 'quantitativa',
      descricao: 'Consultas especializadas',
      periodo,
      metaPeriodo: 100,
      realizado: 90,
      realizadoPorCompetencia: [{ competencia: '202609', quantidade: 90 }],
      cumprimentoPct: 90,
      escore: 3,
      pontos: 10,
      pontosObtidos: 9,
      origem: 'contas-sus',
      apurada: false,
      apuracaoRegistrada: null,
      conta: ['realizado 90 ÷ meta 100 = 90%'],
    },
    {
      meta: 12,
      tipo: 'qualitativa',
      descricao: 'Comissão de óbitos ativa',
      periodo,
      metaPeriodo: 1,
      realizado: null,
      realizadoPorCompetencia: [],
      cumprimentoPct: null,
      escore: null,
      pontos: 10,
      pontosObtidos: null,
      origem: null,
      apurada: false,
      apuracaoRegistrada: null,
      conta: [],
    },
  ],
  repasse: {
    meses: 1,
    preFixadoCentavos: 10_000_000,
    partes: [
      {
        tipo: 'quantitativa',
        valorCentavos: 6_000_000,
        pontosPossiveis: 10,
        pontosObtidos: 9,
        cumprimentoPct: 90,
        escore: 3,
        repassePct: 90,
        repasseCentavos: 5_400_000,
        conta: ['60% de 100.000,00 = 60.000,00; faixa 85% → 90% = 54.000,00'],
      },
    ],
    incentivosCentavos: 100_000,
    posFixadoEstimadoCentavos: 5_000_000,
    totalEstimadoCentavos: null,
    conta: ['pré-fixado 100.000,00 = 60.000,00 + 40.000,00'],
  },
  faixas: [
    { minimoPct: 95, escore: 4, repassePct: 100 },
    { minimoPct: 85, escore: 3, repassePct: 90 },
    { minimoPct: 70, escore: 2, repassePct: 70 },
    { minimoPct: 0, escore: 1, repassePct: 0 },
  ],
  avisos: [],
};
const inicio = (ligada = true) => ({
  hoje: '2026-10-28',
  competencia: '202610',
  contratos: [contrato],
  cortada: false,
  dominios: {
    CMESCORE: [{ codigo: 4, rotulo: 'Ótimo', sigla: null }],
    CMINCENTIVO: [{ codigo: 1, rotulo: 'Incentivo de qualificação', sigla: null }],
  },
  parametros: { faixas: painel.faixas, faixasValidas: true, cnes: '1234567', conveniosSus: [1] },
  fonte: 'contas-sus',
  gravacao: gravacao(ligada),
});
const detalhe = {
  contrato,
  metas: [metaQuanti, metaQuali],
  apuracoes: [apuracao],
  requisitos: [],
};
const ok = { ok: true, id: 99, versao: 1, repetida: false, mensagem: 'Gravado.' };
function rotas(ligada = true, p: PainelContratualizacaoSus = painel) {
  return (url: string, metodo: string): unknown => {
    if (metodo !== 'GET') return ok;
    if (url.includes('/painel?')) return p;
    if (url.includes('/contratos/7')) return detalhe;
    return inicio(ligada);
  };
}

describe('textos da contratualização SUS', () => {
  it('não citam o sistema anterior nem nomes de tabela nos textos visíveis', () => {
    const { dominios, ...resto } = mensagensContratualizacao;
    const { nomes, ...dominiosTexto } = dominios;
    const textos = JSON.stringify([resto, dominiosTexto, Object.values(nomes)]);
    expect(textos).not.toMatch(/sp\s*data|legado|sistema (atual|anterior)/i);
    expect(textos).not.toMatch(/\bCM[A-Z]{3,}/);
    expect(Object.keys(nomes)).toHaveLength(11);
  });
});

describe('apoios puros', () => {
  it('lê o dinheiro em centavos e devolve o texto de edição', () => {
    expect(centavosDe('1.234,56')).toBe(123_456);
    expect(centavosDe('R$ 10')).toBe(1000);
    expect(centavosDe('10.5')).toBe(1050);
    expect(centavosDe('')).toBeNull();
    expect(centavosDe('abc')).toBeNull();
    expect(centavosDe('1,234')).toBeNull();
    expect(textoDeCentavos(123_456)).toBe('1234,56');
    expect(textoDeCentavos(0)).toBe('');
    expect(reaisDeCentavos(null)).toBe('—');
    expect(reaisDeCentavos(150)).toMatch(/1,50/);
    expect(numeroDe('2,5')).toBe(2.5);
    expect(numeroDe('x')).toBeNull();
  });
  it('converte a competência entre o campo e a API', () => {
    expect(competenciaDoCampo('2026-09')).toBe('202609');
    expect(competenciaDoCampo('')).toBeNull();
    expect(competenciaParaCampo('202609')).toBe('2026-09');
    expect(competenciaTexto('202609')).toBe('09/2026');
    expect(competenciaTexto(null)).toBe('—');
    expect(competenciaAnterior('202601')).toBe('202512');
    expect(competenciaAnterior('202610')).toBe('202609');
    expect(periodoEncerrado('202609', '202610')).toBe(true);
    expect(periodoEncerrado('202610', '202610')).toBe(false);
    expect(rotuloEsfera(3)).toBe('Municipal');
  });
  it('pode editar só com a funcionalidade ligada e a permissão', () => {
    expect(podeEditarSus(gravacao(true))).toBe(true);
    expect(podeEditarSus(gravacao(false))).toBe(false);
    expect(podeEditarSus({ ligada: true, motivo: null, operacoes: {} })).toBe(false);
    expect(podeEditarSus(null)).toBe(false);
  });
  const form = (x: Partial<FormularioMetaSus> = {}): FormularioMetaSus => ({
    tipo: 'quantitativa',
    descricao: 'Consultas',
    periodicidade: 5,
    inicio: '2026-01',
    fim: '',
    pontos: '10',
    nivelSigtap: 'subgrupo',
    codigoSigtap: '0301',
    modalidade: 'ambulatorial',
    complexidade: null,
    indicador: 3,
    formato: 6,
    sentido: 'menor',
    unidade: '%',
    afericao: 2,
    valorMeta: '100',
    ativa: true,
    ...x,
  });
  it('confere a meta antes de enviar', () => {
    expect(faltasDaMeta(form())).toEqual([]);
    expect(faltasDaMeta(form({ codigoSigtap: '03' }))).toEqual(['codigoSigtap']);
    expect(faltasDaMeta(form({ fim: '2025-12' }))).toEqual(['fim']);
    expect(faltasDaMeta(form({ pontos: '0', valorMeta: '' }))).toEqual(['pontos', 'valorMeta']);
    expect(faltasDaMeta(form({ tipo: 'qualitativa', indicador: null, formato: null }))).toEqual([
      'indicador',
      'formato',
    ]);
    expect(faltasDaMeta(form({ tipo: 'qualitativa', formato: 2, valorMeta: '2' }))).toEqual(['valorMeta']);
    expect(faltasDaMeta(form({ tipo: 'qualitativa', formato: 7, valorMeta: '2,5' }))).toEqual(['valorMeta']);
  });
  it('o corpo leva só os campos do tipo', () => {
    const q = corpoDaMeta(form(), null);
    expect(q).toMatchObject({
      tipo: 'quantitativa',
      inicio: '202601',
      fim: null,
      codigoSigtap: '0301',
      indicador: null,
      formato: null,
      sentido: null,
      unidade: null,
      afericao: null,
      valorMeta: 100,
      versaoVista: null,
    });
    const l = corpoDaMeta(form({ tipo: 'qualitativa', formato: 2, valorMeta: '1' }), 3);
    expect(l).toMatchObject({
      nivelSigtap: null,
      codigoSigtap: null,
      modalidade: null,
      complexidade: null,
      formato: 2,
      sentido: 'maior',
      versaoVista: 3,
    });
  });
});

describe('ContratualizacaoTela', () => {
  it('em consulta: o motivo, o novo contrato desabilitado e a lista', async () => {
    simular(rotas(false));
    const w = montar(ContratualizacaoTela);
    await flushPromises();
    expect(w.get('[data-testid="ct-desligado"]').text()).toContain('ainda não foi liberada');
    expect(w.get('[data-testid="ct-novo"]').attributes('disabled')).toBeDefined();
    expect(w.get('[data-testid="ct-linha-7"]').text()).toContain('SUS-SINT-01');
    expect(w.get('[data-testid="ct-fonte"]').text()).toContain('Contas SUS');
  });

  it('abre o contrato: metas, apurações, painel com o repasse e as parcelas', async () => {
    simular(rotas());
    const w = montar(ContratualizacaoTela);
    await flushPromises();
    await w.get('[data-testid="ct-abrir-7"]').trigger('click');
    await flushPromises();
    expect(w.get('[data-testid="cd-requisitos"]').text()).toContain('podem ser apuradas');
    expect(w.get('[data-testid="cd-meta-11"]').text()).toContain('0301');
    expect(w.get('[data-testid="cd-apuracao-21"]').text()).toContain('Ótimo');
    expect(w.get('[data-testid="ps-realizado-11"]').text()).toContain('90');
    expect(w.get('[data-testid="ps-escore-11"]').text()).toBe('Bom');
    expect(w.get('[data-testid="ps-parte-quantitativa"]').text()).toContain('54.000,00');
    expect(w.get('[data-testid="ps-total"]').text()).toContain('Pendente');
    expect(w.get('[data-testid="ps-contas"]').text()).toContain('60.000,00 + 40.000,00');
  });

  it('registra a apuração da meta qualitativa com a Idempotency-Key', async () => {
    const chamadas = simular(rotas());
    const w = montar(ContratualizacaoTela);
    await flushPromises();
    await w.get('[data-testid="ct-abrir-7"]').trigger('click');
    await flushPromises();
    await w.get('[data-testid="ps-apurar-12"]').trigger('click');
    await w.get('[data-testid="ps-realizado-campo-12"]').setValue('1');
    await w.get('[data-testid="ps-apuracao-12"]').trigger('submit');
    await flushPromises();
    const post = chamadas.find((c) => c.metodo === 'POST');
    expect(post?.url).toBe('/api/faturamento/sus/contratualizacao/metas/12/apuracoes');
    expect(post?.corpo).toMatchObject({ competencia: '202609', realizado: 1, observacao: null });
    expect(post?.chave).toBeTruthy();
    expect(post?.corpo?.['chave']).toBe(post?.chave);
    expect(w.get('[data-testid="cd-mensagem"]').text()).toBe('Gravado.');
  });

  it('depois da gravação, o painel é lido de novo (o cache do painel não sobrevive à remontagem)', async () => {
    const chamadas = simular(rotas());
    const w = montar(ContratualizacaoTela);
    await flushPromises();
    await w.get('[data-testid="ct-abrir-7"]').trigger('click');
    await flushPromises();
    const lidas = () => chamadas.filter((c) => c.metodo === 'GET' && c.url.includes('/painel?')).length;
    const antes = lidas();
    expect(antes).toBeGreaterThan(0);
    await w.get('[data-testid="ps-apurar-12"]').trigger('click');
    await w.get('[data-testid="ps-realizado-campo-12"]').setValue('1');
    await w.get('[data-testid="ps-apuracao-12"]').trigger('submit');
    await flushPromises();
    expect(lidas()).toBeGreaterThan(antes + 1);
  });

  it('corrige a apuração registrada pela versão dela (versaoVista), com o formulário preenchido', async () => {
    const [quanti, quali] = painel.resultados;
    const apurado: PainelContratualizacaoSus = {
      ...painel,
      resultados: [
        { ...quanti!, apurada: true, apuracaoRegistrada: { id: 21, versao: 2, observacao: null } },
        {
          ...quali!,
          realizado: 0,
          cumprimentoPct: 0,
          escore: 1,
          pontosObtidos: 0,
          origem: 'informado',
          apurada: true,
          apuracaoRegistrada: { id: 22, versao: 3, observacao: 'Ata sintética pendente' },
        },
      ],
    };
    const chamadas = simular(rotas(true, apurado));
    const w = montar(ContratualizacaoTela);
    await flushPromises();
    await w.get('[data-testid="ct-abrir-7"]').trigger('click');
    await flushPromises();
    expect(w.find('[data-testid="ps-apurar-12"]').exists()).toBe(false);
    await w.get('[data-testid="ps-corrigir-12"]').trigger('click');
    expect(w.get('[data-testid="ps-corrigindo-12"]').text()).toContain('substitui a apuração');
    const campo = w.get<HTMLInputElement>('[data-testid="ps-realizado-campo-12"]');
    expect(campo.element.value).toBe('0');
    await campo.setValue('1');
    await w.get('[data-testid="ps-apuracao-12"]').trigger('submit');
    await flushPromises();
    const post = chamadas.find((c) => c.metodo === 'POST');
    expect(post?.url).toBe('/api/faturamento/sus/contratualizacao/metas/12/apuracoes');
    expect(post?.corpo).toMatchObject({
      competencia: '202609',
      realizado: 1,
      observacao: 'Ata sintética pendente',
      versaoVista: 3,
    });
    expect(post?.chave).toBeTruthy();

    // Na quantitativa o servidor relê a produção: vai a versão, sem o realizado.
    await w.get('[data-testid="ps-corrigir-11"]').trigger('click');
    await w.get('[data-testid="ps-apuracao-11"]').trigger('submit');
    await flushPromises();
    const posts = chamadas.filter((c) => c.metodo === 'POST');
    expect(posts.at(-1)?.url).toBe('/api/faturamento/sus/contratualizacao/metas/11/apuracoes');
    expect(posts.at(-1)?.corpo).toMatchObject({ realizado: null, versaoVista: 2 });
  });

  it('o primeiro registro da apuração vai sem versaoVista', async () => {
    const chamadas = simular(rotas());
    const w = montar(ContratualizacaoTela);
    await flushPromises();
    await w.get('[data-testid="ct-abrir-7"]').trigger('click');
    await flushPromises();
    expect(w.find('[data-testid="ps-corrigir-12"]').exists()).toBe(false);
    await w.get('[data-testid="ps-apurar-12"]').trigger('click');
    await w.get('[data-testid="ps-realizado-campo-12"]').setValue('1');
    await w.get('[data-testid="ps-apuracao-12"]').trigger('submit');
    await flushPromises();
    expect(chamadas.find((c) => c.metodo === 'POST')?.corpo).toMatchObject({ versaoVista: null });
  });

  it('mostra as tabelas de apoio com o nome do produto', async () => {
    simular(rotas());
    const w = montar(ContratualizacaoTela);
    await flushPromises();
    await w.get('[data-testid="ct-visao-dominios"]').trigger('click');
    const t = w.get('[data-testid="ds-dominios"]').text();
    expect(t).toContain('Escores');
    expect(t).toContain('Incentivo de qualificação');
    expect(t).not.toMatch(/CMESCORE|CMINCENTIVO/);
  });
});

describe('formulários', () => {
  it('o contrato sem orçamento não é enviado; com orçamento, vai em centavos e com a chave', async () => {
    const chamadas = simular(() => ok);
    const w = montar(ContratoSusFormulario, {
      pode: true,
      incentivosDominio: [{ codigo: 1, rotulo: 'Incentivo de qualificação', sigla: null }],
      cnesSugerido: '1234567',
    });
    await w.get('[data-testid="cs-numero"]').setValue('SUS-SINT-02');
    await w.get('[data-testid="cs-gestor"]').setValue('Secretaria Estadual Sintética');
    await w.get('[data-testid="cs-objeto"]').setValue('Objeto sintético do contrato');
    await w.get('[data-testid="cs-inicio"]').setValue('2026-01-01');
    await w.get('[data-testid="cs-fim"]').setValue('2026-12-31');
    expect(w.get('[data-testid="cs-conflito"]').text()).toContain('pré-fixado');
    expect(w.get('[data-testid="cs-gravar"]').attributes('disabled')).toBeDefined();
    await w.get('[data-testid="cs-pre"]').setValue('1.000,50');
    await w.get('[data-testid="cs-incentivo-adicionar"]').trigger('click');
    await w.get('[data-testid="cs-incentivo-0-nome"]').setValue('Incentivo sintético');
    await w.get('[data-testid="cs-incentivo-0-valor"]').setValue('200');
    await w.get('[data-testid="cs-formulario"]').trigger('submit');
    await flushPromises();
    const post = chamadas.find((c) => c.metodo === 'POST');
    expect(post?.url).toBe('/api/faturamento/sus/contratualizacao/contratos');
    expect(post?.corpo).toMatchObject({
      numero: 'SUS-SINT-02',
      cnes: '1234567',
      valorPreMensalCentavos: 100_050,
      valorPosMensalCentavos: 0,
      incentivos: [{ nome: 'Incentivo sintético', valorMensalCentavos: 20_000, inicio: '2026-01-01' }],
      versaoVista: null,
    });
    expect(post?.corpo?.['chave']).toBe(post?.chave);
    expect(w.emitted('gravado')?.[0]).toEqual([99, 'Gravado.']);
  });

  it('a alteração do contrato vai pela versão vista (PUT)', async () => {
    const chamadas = simular(() => ok);
    const w = montar(ContratoSusFormulario, {
      contrato,
      pode: true,
      incentivosDominio: [],
      cnesSugerido: null,
    });
    await w.get('[data-testid="cs-formulario"]').trigger('submit');
    await flushPromises();
    const put = chamadas.find((c) => c.metodo === 'PUT');
    expect(put?.url).toBe('/api/faturamento/sus/contratualizacao/contratos/7');
    expect(put?.corpo).toMatchObject({ versaoVista: 1, valorPreMensalCentavos: 10_000_000 });
  });

  it('a meta quantitativa sai sem os campos da qualitativa', async () => {
    const chamadas = simular(() => ok);
    const w = montar(MetaSusFormulario, { contrato: 7, pode: true, competencia: '202610' });
    await w.get('[data-testid="ms-descricao"]').setValue('Consultas sintéticas');
    await w.get('[data-testid="ms-sigtap"]').setValue('03');
    await w.get('[data-testid="ms-valor"]').setValue('50');
    await w.get('[data-testid="ms-formulario"]').trigger('submit');
    await flushPromises();
    const post = chamadas.find((c) => c.metodo === 'POST');
    expect(post?.url).toBe('/api/faturamento/sus/contratualizacao/contratos/7/metas');
    expect(post?.corpo).toMatchObject({
      tipo: 'quantitativa',
      inicio: '202610',
      nivelSigtap: 'grupo',
      codigoSigtap: '03',
      modalidade: 'todas',
      indicador: null,
      formato: null,
      sentido: null,
      valorMeta: 50,
    });
  });

  it('sem permissão, a meta não é enviada', async () => {
    const chamadas = simular(() => ok);
    const w = montar(MetaSusFormulario, { contrato: 7, pode: false, competencia: '202610' });
    expect(w.get('[data-testid="ms-gravar"]').attributes('disabled')).toBeDefined();
    await w.get('[data-testid="ms-formulario"]').trigger('submit');
    await flushPromises();
    expect(chamadas).toHaveLength(0);
  });

  it('as tabelas de apoio desconhecidas aparecem com o nome genérico', () => {
    const w = montar(DominiosSus, { dominios: { CMNOVA: [] } });
    expect(w.text()).toContain('Outra tabela de apoio');
    expect(w.text()).not.toContain('CMNOVA');
  });
});
