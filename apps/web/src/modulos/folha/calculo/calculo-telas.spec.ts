// @vitest-environment jsdom
// Telas do cálculo mensal da folha (M53.3, etapa F2): os comuns (percentuais, valores digitados, quantidade da linha,
// grade, rubricas do papel, rascunho dos parâmetros, vigência); a prévia sem gravar, o cálculo depois da confirmação, a
// prova da soma com as parcelas, a grade com filtro e ordem e a memória do colaborador; as pendências traduzidas; o
// descarte com motivo; o perfil de consulta sem botões de gravar; o salário com permissão sensível (aba só para quem
// consulta) e a nova vigência; os parâmetros com a rubrica do papel. Dados SINTÉTICOS; o fetch é simulado.
import {
  CODIGOS_PENDENCIA_CALCULO,
  INCIDENCIAS_RUBRICA_FOLHA,
  PAPEIS_LINHA_FOLHA,
  SITUACOES_PROCESSO_FOLHA,
  TIPOS_LINHA_FOLHA,
  TRIBUTOS_INCIDENCIA_ESOCIAL,
} from '@sgh/contratos';
import { criarI18n, instalarUi, resolverMarca } from '@sgh/ui';
import { QueryClient, VueQueryPlugin } from '@tanstack/vue-query';
import { flushPromises, mount } from '@vue/test-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { App } from 'vue';
import { routeLocationKey } from 'vue-router';
import { CHAVE_SESSAO } from '../../../casca/sessao/sessao.js';
import { mensagensWeb } from '../../../i18n/pt-BR.js';
import FolhaCompetenciaTela from '../telas/FolhaCompetenciaTela.vue';
import MeuHoleriteTela from './MeuHoleriteTela.vue';
import {
  filtrarColaboradores,
  lerCentavos,
  lerCentesimos,
  percentualBr,
  quantidadeDaLinha,
  rascunhoParametros,
  rubricasDoPapel,
  somaDoTipo,
  textoCentesimos,
  ultimoDia,
  vigenteEm,
} from './comum-calculo.js';
import { mensagensCalculo } from './i18n.js';

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
const PERMISSOES_TODAS = [
  'pessoas.folha.abrir',
  'pessoas.folha.ler',
  'pessoas.folha.calcular',
  'pessoas.salario.ler',
  'pessoas.salario.editar',
  'pessoas.parametroFolha.editar',
  'pessoas.colaborador.ler',
  'pessoas.rubrica.ler',
];
function montar(permissoes: readonly string[] = PERMISSOES_TODAS) {
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
  return mount(FolhaCompetenciaTela as never, {
    attachTo: document.body,
    global: {
      plugins: [
        criarI18n(mensagensWeb as unknown as Record<string, unknown>),
        ui,
        [VueQueryPlugin, { queryClient: cliente }],
      ] as never,
      stubs: { RouterLink: { template: '<a><slot /></a>' } },
    },
  });
}

type Pedido = { url: string; metodo: string; corpo: unknown };
function simular(rota: (p: Pedido) => { status?: number; corpo: unknown } | null): Pedido[] {
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
      const r = rota(p) ?? padrao(p);
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

const apoioF0 = {
  hoje: '2026-10-26',
  competenciaSugerida: '2026-09',
  gravacao: { ligada: true, motivo: null },
  acoes: { exportar: false, importar: false, afastamento: false, motivo: null, buscarColaborador: true },
  empresas: [{ codigo: 1, rotulo: 'Empresa Sintética' }],
  eventosPonto: [],
  motivosAfastamento: [],
  remessas: [],
};
const apoioCalculo = (grava: boolean, verSalario = true) => ({
  hoje: '2026-10-26',
  competenciaSugerida: '2026-09',
  gravacao: { ligada: true, motivo: null },
  acoes: { calcular: grava, salario: grava, verSalario, parametros: grava, motivo: null },
  empresas: [{ codigo: 1, rotulo: 'Empresa Sintética' }],
  papeis: [
    { papel: 'salario', tipo: 'provento' },
    { papel: 'inss', tipo: 'desconto' },
  ],
});
const totais = {
  colaboradores: 2,
  proventos: 800000,
  descontos: 120000,
  liquido: 680000,
  inss: 70000,
  irrf: 50000,
  fgts: 64000,
  inssPatronal: 160000,
  rat: 16000,
  terceiros: 46400,
};
const colaboradores = [
  {
    vinculo: 11,
    matricula: 'S-011',
    centroCusto: 5,
    diasPagos: 30,
    proventos: 300000,
    descontos: 30000,
    liquido: 270000,
    baseInss: 300000,
    baseIrrf: 270000,
    baseFgts: 300000,
    inss: 25000,
    irrf: 5000,
    fgts: 24000,
    encargos: 83400,
  },
  {
    vinculo: 12,
    matricula: 'S-012',
    centroCusto: 6,
    diasPagos: 30,
    proventos: 500000,
    descontos: 90000,
    liquido: 410000,
    baseInss: 500000,
    baseIrrf: 455000,
    baseFgts: 500000,
    inss: 45000,
    irrf: 45000,
    fgts: 40000,
    encargos: 139000,
  },
];
const conferencia = {
  ok: true,
  parcelas: [
    { rotulo: 'proventos', valor: 800000 },
    { rotulo: 'descontos', valor: 120000 },
    { rotulo: 'liquido', valor: 680000 },
    { rotulo: 'somaProventosVinculos', valor: 800000 },
    { rotulo: 'somaDescontosVinculos', valor: 120000 },
    { rotulo: 'somaLiquidosVinculos', valor: 680000 },
  ],
  divergencias: [],
};
const processo = (id: number, situacao: string, numero = 1) => ({
  id,
  empresa: 1,
  competencia: '2026-09',
  tipo: 'mensal',
  numero,
  situacao,
  pagamento: null,
  totais,
  tabelaLegal: '2026-01-01',
  parametros: '2026-01-01',
  foraDaFolha: 1,
  resumo: 'b'.repeat(64),
  calculadoPor: 'SINT.DP.FOLHA',
  calculadoEm: '2026-10-05T10:00:00',
  situacaoPor: null,
  situacaoEm: null,
  motivo: situacao === 'descartada' ? 'Teste sintético' : null,
  versao: 0,
});
const linhas = [
  {
    papel: 'salario',
    tipo: 'provento',
    rubrica: 101,
    codigoRubrica: 1,
    quantidade: 30,
    unidade: 'dias',
    valor: 300000,
    memoria: 'R$ 3.000,00 × 30/30 dias',
  },
  {
    papel: 'inss',
    tipo: 'desconto',
    rubrica: 201,
    codigoRubrica: 900,
    quantidade: 0,
    unidade: 'valor',
    valor: 25000,
    memoria: 'faixas progressivas',
  },
  {
    papel: 'irrf',
    tipo: 'desconto',
    rubrica: 202,
    codigoRubrica: 901,
    quantidade: 0,
    unidade: 'valor',
    valor: 5000,
    memoria: 'base × faixa',
  },
  {
    papel: 'baseInss',
    tipo: 'base',
    rubrica: null,
    codigoRubrica: null,
    quantidade: 0,
    unidade: 'valor',
    valor: 300000,
    memoria: 'soma das incidências',
  },
];
const rubrica = (id: number, codigo: number, tipo: string, descricao: string) => ({
  id,
  empresa: 1,
  codigo,
  descricao,
  tipo,
  referencia: null,
  percentual: 0,
  prioridade: null,
  ativa: true,
  vigencia: { inicio: null, fim: null },
  usos: ['mensal'],
  incidencias: Object.fromEntries(INCIDENCIAS_RUBRICA_FOLHA.map((i) => [i, false])),
  esocial: Object.fromEntries(TRIBUTOS_INCIDENCIA_ESOCIAL.map((i) => [i, null])),
  natureza: null,
});

/** O padrão: apoios, nenhum cálculo, nenhum parâmetro e nenhuma rubrica. */
function padrao(p: Pedido): { status?: number; corpo: unknown } {
  if (p.url.endsWith('/calculo/apoio')) return { corpo: apoioCalculo(true) };
  if (p.url.endsWith('/folha/apoio')) return { corpo: apoioF0 };
  if (p.url.includes('/calculos')) return { corpo: { itens: [], limitado: false } };
  if (p.url.includes('/parametros')) return { corpo: { empresa: 1, itens: [] } };
  if (p.url.includes('/rubricas'))
    return {
      corpo: {
        competencia: '2026-09',
        dataReferencia: '2026-09-30',
        rubricas: [
          rubrica(101, 1, 'provento', 'Salário sintético'),
          rubrica(201, 900, 'desconto', 'INSS sintético'),
        ],
        foraDeVigencia: 0,
        conferencia: [],
      },
    };
  return { corpo: { itens: [] } };
}
const clicar = async (seletor: string) => {
  const b = document.querySelector<HTMLElement>(seletor);
  expect(b, seletor).not.toBeNull();
  b!.click();
  await flushPromises();
};

describe('comuns do cálculo', () => {
  it('percentuais, valores digitados, quantidade da linha e somas', () => {
    expect(percentualBr(5000)).toBe('50%');
    expect(percentualBr(3333)).toBe('33,33%');
    expect(lerCentesimos('33,33')).toBe(3333);
    expect(lerCentesimos('50 %')).toBe(5000);
    expect(lerCentesimos('abc')).toBeNull();
    expect(lerCentesimos('1,234')).toBeNull();
    expect(textoCentesimos(3333)).toBe('33,33');
    expect(textoCentesimos(10000)).toBe('100');
    expect(lerCentavos('3.250,00')).toBe(325000);
    expect(lerCentavos('R$ 1234,5')).toBe(123450);
    expect(lerCentavos('1234')).toBe(123400);
    expect(lerCentavos('12,345')).toBeNull();
    expect(lerCentavos('1.23')).toBeNull();
    expect(quantidadeDaLinha({ quantidade: 30, unidade: 'dias' })).toBe('30 d');
    expect(quantidadeDaLinha({ quantidade: 90, unidade: 'minutos' })).toBe('1:30 h');
    expect(quantidadeDaLinha({ quantidade: 2, unidade: 'dependentes' })).toBe('2');
    expect(quantidadeDaLinha({ quantidade: 2000, unidade: 'percentual' })).toBe('20%');
    expect(quantidadeDaLinha({ quantidade: 0, unidade: 'valor' })).toBe('');
    expect(somaDoTipo(linhas as never, 'desconto')).toBe(30000);
    expect(ultimoDia('2026-02')).toBe('2026-02-28');
    expect(ultimoDia('2028-02')).toBe('2028-02-29');
    expect(ultimoDia('2026-12')).toBe('2026-12-31');
  });

  it('grade, rubricas do papel, rascunho dos parâmetros e vigência', () => {
    const cs = colaboradores as never;
    expect(filtrarColaboradores(cs, '', { campo: 'liquido', direcao: 'desc' }).map((c) => c.vinculo)).toEqual(
      [12, 11],
    );
    expect(
      filtrarColaboradores(cs, 's-011', { campo: 'vinculo', direcao: 'asc' }).map((c) => c.vinculo),
    ).toEqual([11]);
    expect(filtrarColaboradores(cs, '6', { campo: 'vinculo', direcao: 'asc' }).map((c) => c.vinculo)).toEqual(
      [12],
    );
    const rs = [
      rubrica(1, 1, 'provento', 'a'),
      rubrica(2, 2, 'desconto', 'b'),
      rubrica(3, 3, 'informativa', 'c'),
      rubrica(4, 4, 'base', 'd'),
    ] as never;
    expect(rubricasDoPapel(rs, 'provento').map((r) => r.id)).toEqual([1]);
    expect(rubricasDoPapel(rs, 'desconto').map((r) => r.id)).toEqual([2]);
    expect(rubricasDoPapel(rs, 'informativa').map((r) => r.id)).toEqual([3, 4]);
    const lei = rascunhoParametros(1, '2026-10-01', null);
    expect(lei.percentuais.horaExtra50).toBe(5000);
    expect(lei.encargos.fgts).toBe(800);
    expect(lei.divisorHoras).toBe(220);
    expect(Object.values(lei.rubricas).every((v) => v === null)).toBe(true);
    const atual = {
      ...lei,
      id: 9,
      registradoPor: 'X',
      registradoEm: '2026-01-01T00:00:00',
      divisorHoras: null,
    };
    const copia = rascunhoParametros(1, '2026-11-01', atual);
    expect(copia.divisorHoras).toBeNull();
    expect(copia.inicio).toBe('2026-11-01');
    const vs = [{ inicio: '2026-01-01' }, { inicio: '2026-09-15' }, { inicio: '2026-11-01' }];
    expect(vigenteEm(vs, '2026-09-30')?.inicio).toBe('2026-09-15');
    expect(vigenteEm(vs, '2025-12-31')).toBeNull();
  });

  it('todo código e papel que o contrato devolve tem texto, sem nome de outro sistema', () => {
    for (const c of CODIGOS_PENDENCIA_CALCULO) expect(mensagensCalculo.pendencia[c]).toBeTruthy();
    for (const p of PAPEIS_LINHA_FOLHA) expect(mensagensCalculo.papeis[p]).toBeTruthy();
    for (const s of SITUACOES_PROCESSO_FOLHA) expect(mensagensCalculo.situacoes[s]).toBeTruthy();
    for (const t of TIPOS_LINHA_FOLHA) expect(mensagensCalculo.memoria.tipos[t]).toBeTruthy();
    const texto = JSON.stringify(mensagensCalculo);
    expect(texto).not.toMatch(/SPDATA|legado|sistema atual|SGH_|FPEVENTO|\|/i);
  });
});

describe('aba do cálculo', () => {
  it('prévia sem gravar com a prova da soma; calcula depois da confirmação', async () => {
    let gravado = false;
    const pedidos = simular((p) => {
      if (p.url.endsWith('/folha/calculos') && p.metodo === 'POST') {
        const sim = (p.corpo as { simular: boolean }).simular;
        if (!sim) gravado = true;
        return {
          corpo: {
            calculado: !sim,
            simulado: sim,
            processo: sim ? null : processo(5, 'calculada'),
            pendencias: [],
            totais,
            colaboradores,
            conferencia,
            substituido: null,
          },
        };
      }
      if (p.url.includes('/calculos/5'))
        return { corpo: { processo: processo(5, 'calculada'), colaboradores, conferencia } };
      if (p.url.includes('/calculos?'))
        return { corpo: { itens: gravado ? [processo(5, 'calculada')] : [], limitado: false } };
      return null;
    });
    const w = montar();
    await flushPromises();
    await flushPromises();
    expect(w.find('[data-testid="folha-calculo-nenhum"]').exists()).toBe(true);
    await w.find('[data-testid="folha-calculo-previa"]').trigger('click');
    await flushPromises();
    expect(pedidos.find((p) => p.metodo === 'POST')?.corpo).toEqual({
      empresa: 1,
      competencia: '2026-09',
      simular: true,
    });
    expect(w.find('[data-testid="folha-calculo-visto-previa"]').exists()).toBe(true);
    expect(w.find('[data-testid="folha-calculo-total-liquido"]').text()).toBe('R$ 6.800,00');
    expect(w.find('[data-testid="folha-calculo-conta"]').text()).toContain(
      'R$ 8.000,00 − R$ 1.200,00 = R$ 6.800,00',
    );
    expect(w.find('[data-testid="folha-calculo-conta-encargos"]').text()).toContain(
      'R$ 1.600,00 + R$ 160,00 + R$ 464,00 = R$ 2.224,00',
    );
    expect(w.find('[data-testid="folha-calculo-conta-custo"]').text()).toContain(
      'R$ 8.000,00 + R$ 2.224,00 + R$ 640,00 = R$ 10.864,00',
    );
    expect(w.find('[data-testid="folha-calculo-prova"]').text()).toContain(
      'Soma dos líquidos dos colaboradores',
    );
    // Prévia: sem memória (nada gravado).
    expect(w.find('[data-testid="folha-calculo-memoria-11"]').exists()).toBe(false);
    // Grade: filtro e ordem.
    await w.find('[data-testid="folha-calculo-filtro"] input').setValue('S-012');
    expect(w.find('[data-testid="folha-calculo-colaborador-11"]').exists()).toBe(false);
    expect(w.find('[data-testid="folha-calculo-colaborador-12"]').exists()).toBe(true);
    await w.find('[data-testid="folha-calculo-filtro"] input').setValue('');
    await w.find('[data-testid="folha-calculo-ordem-liquido"]').trigger('click');
    const ordem = w
      .findAll('[data-testid^="folha-calculo-colaborador-"]')
      .map((x) => x.attributes('data-testid'));
    expect(ordem).toEqual(['folha-calculo-colaborador-12', 'folha-calculo-colaborador-11']);
    // Calcular: só depois da confirmação.
    await w.find('[data-testid="folha-calculo-calcular"]').trigger('click');
    await flushPromises();
    expect(pedidos.filter((p) => p.metodo === 'POST')).toHaveLength(1);
    await clicar('[data-testid="folha-calculo-confirmar"]');
    await flushPromises();
    expect(pedidos.filter((p) => p.metodo === 'POST')[1]?.corpo).toEqual({
      empresa: 1,
      competencia: '2026-09',
      simular: false,
    });
    expect(w.find('[data-testid="folha-calculo-aviso"]').text()).toContain('cálculo 1 da competência');
    expect(w.find('[data-testid="folha-calculo-visto-vigente"]').exists()).toBe(true);
    expect(w.find('[data-testid="folha-calculo-processo-5"]').text()).toContain('Em vigor');
    expect(w.text()).toContain('1 colaborador(es) fora desta folha');
  });

  it('pendências traduzidas, só com os vínculos; nada é mostrado como calculado', async () => {
    simular((p) => {
      if (p.metodo === 'POST')
        return {
          corpo: {
            calculado: false,
            simulado: true,
            processo: null,
            pendencias: [
              { codigo: 'sem-salario', vinculos: [11, 12], papel: null },
              { codigo: 'papel-sem-rubrica', vinculos: [], papel: 'horaExtra50' },
            ],
            totais: null,
            colaboradores: [],
            conferencia: null,
            substituido: null,
          },
        };
      return null;
    });
    const w = montar();
    await flushPromises();
    await flushPromises();
    await w.find('[data-testid="folha-calculo-previa"]').trigger('click');
    await flushPromises();
    const p = w.find('[data-testid="folha-calculo-pendencias"]');
    expect(p.text()).toContain('sem salário contratual em vigor');
    expect(p.text()).toContain('2 colaborador(es): vínculos 11, 12');
    expect(p.text()).toContain('Papel: Hora extra em dia útil');
    expect(w.find('[data-testid="folha-calculo-totais"]').exists()).toBe(false);
  });

  it('cálculo em vigor: memória do colaborador com a prova; recálculo avisa a substituição; descarte com motivo', async () => {
    const pedidos = simular((p) => {
      if (p.url.endsWith('/calculos/5/descarte'))
        return { corpo: { ok: true, id: 5, mensagem: 'Cálculo descartado.' } };
      if (p.url.endsWith('/calculos/5/vinculos/11'))
        return { corpo: { processo: 5, vinculo: 11, matricula: 'S-011', linhas } };
      if (p.url.endsWith('/calculos/5'))
        return { corpo: { processo: processo(5, 'calculada', 2), colaboradores, conferencia } };
      if (p.url.includes('/calculos?'))
        return {
          corpo: { itens: [processo(5, 'calculada', 2), processo(4, 'substituida', 1)], limitado: false },
        };
      return null;
    });
    const w = montar();
    await flushPromises();
    await flushPromises();
    await flushPromises();
    expect(w.find('[data-testid="folha-calculo-visto-vigente"]').text()).toContain('Cálculo 2');
    expect(w.find('[data-testid="folha-calculo-processo-4"]').text()).toContain('Substituído');
    await w.find('[data-testid="folha-calculo-memoria-11"]').trigger('click');
    await flushPromises();
    const memoria = document.querySelector('[data-testid="folha-calculo-memoria"]')!;
    expect(memoria.textContent).toContain('R$ 3.000,00 × 30/30 dias');
    expect(memoria.textContent).toContain('Base do INSS');
    expect(document.querySelector('[data-testid="folha-calculo-memoria-prova"]')!.textContent).toContain(
      'R$ 3.000,00 − R$ 300,00 = R$ 2.700,00',
    );
    expect(pedidos.some((p) => p.url.endsWith('/calculos/5/vinculos/11'))).toBe(true);
    // Recalcular: o texto da confirmação diz que substitui.
    await w.find('[data-testid="folha-calculo-calcular"]').trigger('click');
    await flushPromises();
    expect(document.querySelector('[data-testid="folha-calculo-confirmacao"]')!.textContent).toContain(
      'O novo cálculo o substitui',
    );
    // Descarte: sem motivo não confirma; com motivo envia a versão.
    await w.find('[data-testid="folha-calculo-descartar"]').trigger('click');
    await flushPromises();
    const confirmar = document.querySelector<HTMLButtonElement>(
      '[data-testid="folha-calculo-confirmar-descarte"]',
    )!;
    expect(confirmar.disabled).toBe(true);
    const motivo = document.querySelector<HTMLInputElement>(
      '[data-testid="folha-calculo-motivo-descarte"] input',
    )!;
    motivo.value = 'Ponto reaberto';
    motivo.dispatchEvent(new Event('input'));
    await flushPromises();
    await clicar('[data-testid="folha-calculo-confirmar-descarte"]');
    expect(pedidos.find((p) => p.url.endsWith('/descarte'))?.corpo).toEqual({
      versao: 0,
      motivo: 'Ponto reaberto',
    });
    expect(w.find('[data-testid="folha-calculo-aviso"]').text()).toBe('Cálculo descartado.');
  });

  it('perfil de consulta: sem prévia, cálculo nem descarte; sem a aba dos salários nem os valores por colaborador', async () => {
    simular((p) => {
      if (p.url.endsWith('/calculo/apoio')) return { corpo: apoioCalculo(false, false) };
      // D-PERM-SAL-533: sem a permissão do salário, o servidor omite a lista por colaborador.
      if (p.url.endsWith('/calculos/5'))
        return {
          corpo: {
            processo: processo(5, 'calculada'),
            colaboradores: [],
            colaboradoresOcultos: true,
            conferencia,
          },
        };
      if (p.url.includes('/calculos?'))
        return { corpo: { itens: [processo(5, 'calculada')], limitado: false } };
      return null;
    });
    const w = montar(['pessoas.folha.abrir', 'pessoas.folha.ler']);
    await flushPromises();
    await flushPromises();
    await flushPromises();
    expect(w.find('[data-testid="folha-calculo-visto-vigente"]').exists()).toBe(true);
    expect(w.find('[data-testid="folha-calculo-previa"]').exists()).toBe(false);
    expect(w.find('[data-testid="folha-calculo-calcular"]').exists()).toBe(false);
    expect(w.find('[data-testid="folha-calculo-descartar"]').exists()).toBe(false);
    expect(w.find('[data-testid="folha-aba-salarios"]').exists()).toBe(false);
    expect(w.find('[data-testid="folha-so-consulta"]').exists()).toBe(true);
    expect(w.find('[data-testid="folha-calculo-grade-oculta"]').text()).toContain('consultar o salário');
    expect(w.find('[data-testid="folha-calculo-pdf"]').exists()).toBe(false);
    expect(w.find('[data-testid^="folha-calculo-memoria-"]').exists()).toBe(false);
    expect(w.find('[data-testid="folha-calculo-filtro"]').exists()).toBe(false);
  });
});

describe('abas dos salários e dos parâmetros', () => {
  it('salário: busca o colaborador, mostra a vigência em vigor e registra uma nova', async () => {
    const pedidos = simular((p) => {
      if (p.url.includes('/colaboradores'))
        return {
          corpo: {
            itens: [{ vinculo: 11, nome: 'Pessoa Sintética', matricula: 'S-011', cargo: 'Cargo sintético' }],
            depois: null,
          },
        };
      if (p.url.endsWith('/folha/salarios') && p.metodo === 'POST')
        return { corpo: { ok: true, id: 3, mensagem: 'Vigência do salário gravada.' } };
      if (p.url.includes('/salarios?vinculo=11'))
        return {
          corpo: {
            vinculo: 11,
            matricula: 'S-011',
            itens: [
              {
                id: 1,
                vinculo: 11,
                inicio: '2026-01-01',
                salario: 300000,
                insalubridade: 2000,
                periculosidade: false,
                motivo: 'Admissão',
                registradoPor: 'X',
                registradoEm: '2026-01-01T00:00:00',
              },
              {
                id: 2,
                vinculo: 11,
                inicio: '2026-11-01',
                salario: 330000,
                insalubridade: 2000,
                periculosidade: false,
                motivo: 'Reajuste',
                registradoPor: 'X',
                registradoEm: '2026-10-01T00:00:00',
              },
            ],
          },
        };
      return null;
    });
    const w = montar();
    await flushPromises();
    await flushPromises();
    await w.find('[data-testid="folha-aba-salarios"]').trigger('click');
    await flushPromises();
    await w.find('[data-testid="folha-salario-termo"] input').setValue('Sint');
    await w.find('[data-testid="folha-salario-buscar"]').trigger('click');
    await flushPromises();
    await w.find('[data-testid="folha-salario-escolher-11"]').trigger('click');
    await flushPromises();
    // A competência 09/2026: a vigência de 01/01/2026 é a em vigor (a de novembro ainda não).
    expect(w.find('[data-testid="folha-salario-1"]').text()).toContain('Em vigor');
    expect(w.find('[data-testid="folha-salario-2"]').text()).not.toContain('Em vigor');
    expect(w.find('[data-testid="folha-salario-1"]').text()).toContain('Grau médio (20%)');
    await w.find('[data-testid="folha-salario-novo"]').trigger('click');
    const gravar = () => w.find('[data-testid="folha-salario-gravar"]').attributes('disabled');
    expect(gravar()).toBeDefined();
    const data = w.find('[data-testid="folha-salario-inicio"] input');
    await data.setValue('01/12/2026');
    await data.trigger('blur');
    await data.trigger('change');
    await w.find('[data-testid="folha-salario-valor"] input').setValue('3.500,00');
    await w.find('[data-testid="folha-salario-motivo"] input').setValue('Promoção sintética');
    await flushPromises();
    expect(gravar()).toBeUndefined();
    await w.find('[data-testid="folha-salario-form"]').trigger('submit');
    await flushPromises();
    expect(pedidos.find((p) => p.url.endsWith('/folha/salarios') && p.metodo === 'POST')?.corpo).toEqual({
      vinculo: 11,
      inicio: '2026-12-01',
      salario: 350000,
      insalubridade: 2000,
      periculosidade: false,
      motivo: 'Promoção sintética',
    });
    expect(w.find('[data-testid="folha-salario-aviso"]').text()).toBe('Vigência do salário gravada.');
  });

  it('parâmetros: sem vigência avisa; a nova parte da lei e envia a rubrica do papel', async () => {
    const pedidos = simular((p) => {
      if (p.url.endsWith('/folha/parametros') && p.metodo === 'POST')
        return { corpo: { ok: true, id: 7, mensagem: 'Parâmetros da folha gravados.' } };
      return null;
    });
    const w = montar();
    await flushPromises();
    await flushPromises();
    await w.find('[data-testid="folha-aba-parametros"]').trigger('click');
    await flushPromises();
    expect(w.find('[data-testid="folha-parametro-nenhum"]').exists()).toBe(true);
    expect(pedidos.some((p) => p.url.includes('/rubricas?competencia=2026-09&empresa=1&todas=1'))).toBe(true);
    await w.find('[data-testid="folha-parametro-novo"]').trigger('click');
    await flushPromises();
    expect(
      (w.find('[data-testid="folha-parametro-campo-sobreaviso"] input').element as HTMLInputElement).value,
    ).toBe('33,33');
    const data = w.find('[data-testid="folha-parametro-inicio"] input');
    await data.setValue('01/10/2026');
    await data.trigger('blur');
    await data.trigger('change');
    await w.find('[data-testid="folha-parametro-campo-horaExtra50"] input').setValue('60');
    await flushPromises();
    await w.find('[data-testid="folha-parametro-form"]').trigger('submit');
    await flushPromises();
    const enviado = pedidos.find((p) => p.url.endsWith('/folha/parametros') && p.metodo === 'POST')
      ?.corpo as {
      percentuais: { horaExtra50: number; sobreaviso: number };
      divisorHoras: number | null;
      rubricas: Record<string, number | null>;
      inicio: string;
    };
    expect(enviado.inicio).toBe('2026-10-01');
    expect(enviado.percentuais.horaExtra50).toBe(6000);
    expect(enviado.percentuais.sobreaviso).toBe(3333);
    expect(enviado.divisorHoras).toBe(220);
    expect(enviado.rubricas.salario).toBeNull();
    expect(w.find('[data-testid="folha-parametro-aviso"]').text()).toBe('Parâmetros da folha gravados.');
  });

  it('parâmetros em vigor: percentuais, divisor e a rubrica de cada papel', async () => {
    simular((p) => {
      if (p.url.includes('/parametros?empresa=1'))
        return {
          corpo: {
            empresa: 1,
            itens: [
              {
                ...rascunhoParametros(1, '2026-01-01', null),
                divisorHoras: null,
                rubricas: { ...rascunhoParametros(1, '2026-01-01', null).rubricas, salario: 101, inss: 201 },
                id: 3,
                registradoPor: 'SINT.DP.FOLHA',
                registradoEm: '2026-01-02T08:00:00',
              },
            ],
          },
        };
      return null;
    });
    const w = montar();
    await flushPromises();
    await flushPromises();
    await w.find('[data-testid="folha-aba-parametros"]').trigger('click');
    await flushPromises();
    await flushPromises();
    expect(w.find('[data-testid="folha-parametro-vigente"]').text()).toContain('Em vigor desde 01/01/2026');
    expect(w.find('[data-testid="folha-parametro-sobreaviso"]').text()).toBe('33,33%');
    expect(w.find('[data-testid="folha-parametro-divisor"]').text()).toBe('Carga semanal × 5');
    expect(w.find('[data-testid="folha-parametro-rubrica-salario"]').text()).toBe('1 · Salário sintético');
    expect(w.find('[data-testid="folha-parametro-rubrica-inss"]').text()).toBe('900 · INSS sintético');
  });
});

describe('meu holerite (autosserviço)', () => {
  const montarHolerite = (vinculo: string | null) =>
    mount(MeuHoleriteTela as never, {
      attachTo: document.body,
      global: {
        plugins: [
          criarI18n(mensagensWeb as unknown as Record<string, unknown>),
          ui,
          [
            VueQueryPlugin,
            { queryClient: new QueryClient({ defaultOptions: { queries: { retry: false } } }) },
          ],
        ] as never,
        provide: { [routeLocationKey as symbol]: { query: vinculo ? { vinculo } : {} } },
        stubs: { RouterLink: { template: '<a><slot /></a>' } },
      },
    });
  const base = {
    hoje: '2026-10-26',
    competencia: '2026-09',
    disponivel: true,
    mensagem: null,
    vinculo: 11,
    matricula: 'S-011',
    calculado: true,
    calculadoEm: '2026-10-05T10:00:00',
    linhas: linhas
      .filter((l) => l.papel !== 'baseInss')
      .concat([
        {
          papel: 'fgts',
          tipo: 'informativa',
          rubrica: 300,
          codigoRubrica: 950,
          quantidade: 0,
          unidade: 'valor',
          valor: 24000,
          memoria: '8%',
        },
      ]),
    proventos: 300000,
    descontos: 30000,
    liquido: 270000,
  };

  it('vencimentos, descontos e a conta do líquido do próprio vínculo', async () => {
    const pedidos = simular((p) => (p.url.startsWith('/api/pessoas/meu/holerite') ? { corpo: base } : null));
    const w = montarHolerite('11');
    await flushPromises();
    await flushPromises();
    expect(pedidos[0]?.url).toBe('/api/pessoas/meu/holerite?vinculo=11');
    expect(w.find('[data-testid="holerite-linha-salario"]').text()).toContain('R$ 3.000,00');
    expect(w.find('[data-testid="holerite-linha-inss"]').text()).toContain('R$ 250,00');
    expect(w.find('[data-testid="holerite-total-descontos"]').text()).toBe('R$ 300,00');
    expect(w.find('[data-testid="holerite-liquido"]').text()).toContain(
      'R$ 3.000,00 − R$ 300,00 = R$ 2.700,00',
    );
    expect(w.find('[data-testid="holerite-bases"]').text()).toContain('FGTS');
    expect(w.find('[data-testid="holerite-cabecalho"]').text()).toContain('09/2026');
  });

  it('não calculado, sem vínculo e folha desligada: só a frase', async () => {
    simular((p) =>
      p.url.startsWith('/api/pessoas/meu/holerite')
        ? { corpo: { ...base, calculado: false, linhas: [] } }
        : null,
    );
    let w = montarHolerite(null);
    await flushPromises();
    await flushPromises();
    expect(w.find('[data-testid="holerite-nao-calculado"]').exists()).toBe(true);
    w.unmount();
    vi.unstubAllGlobals();
    simular((p) =>
      p.url.startsWith('/api/pessoas/meu/holerite')
        ? { corpo: { ...base, disponivel: false, mensagem: 'Consulte o RH.', calculado: false, linhas: [] } }
        : null,
    );
    w = montarHolerite(null);
    await flushPromises();
    await flushPromises();
    expect(w.find('[data-testid="holerite-indisponivel"]').text()).toContain('Consulte o RH.');
    expect(w.find('[data-testid="holerite-linhas"]').exists()).toBe(false);
  });
});
