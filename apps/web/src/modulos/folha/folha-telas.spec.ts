// @vitest-environment jsdom
// Tela da folha da competência (M53.1, etapa F0): os comuns (competências, centavos, minutos, leitura do retorno); a rota
// com a permissão do catálogo; a lista de lotes com a soma no formato certo do sentido; a geração barrada pelas
// pendências (texto traduzido, só IDs de vínculo); a importação do retorno com as divergências e a conta dos títulos; o
// perfil de consulta sem botões de gravar; e os afastamentos da competência. Dados SINTÉTICOS; o fetch é simulado.
import { PERMISSOES_FOLHA_M53 } from '@sgh/contratos';
import { criarI18n, instalarUi, resolverMarca } from '@sgh/ui';
import { QueryClient, VueQueryPlugin } from '@tanstack/vue-query';
import { flushPromises, mount } from '@vue/test-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { App } from 'vue';
import { routerKey } from 'vue-router';
import { ErroApi } from '../../casca/erros/problem-details.js';
import { CHAVE_SESSAO } from '../../casca/sessao/sessao.js';
import { mensagensWeb } from '../../i18n/pt-BR.js';
import {
  competenciasAte,
  horas,
  instanteBr,
  lerRetorno,
  reais,
  recusaDe,
  rotuloCompetencia,
  somaDoLote,
} from './comum-folha.js';
import { mensagensFolha } from './i18n.js';
import { rotasFolha } from './rotas.js';
import FolhaCompetenciaTela from './telas/FolhaCompetenciaTela.vue';

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
  mount(FolhaCompetenciaTela as never, {
    attachTo: document.body,
    global: {
      plugins: [
        criarI18n(mensagensWeb as unknown as Record<string, unknown>),
        ui,
        [VueQueryPlugin, { queryClient: new QueryClient({ defaultOptions: { queries: { retry: false } } }) }],
      ] as never,
      stubs: { RouterLink: { template: '<a><slot /></a>' } },
    },
  });

type Pedido = { url: string; metodo: string; corpo: unknown };
function simular(rota: (p: Pedido) => { status?: number; corpo: unknown }): Pedido[] {
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
      // M53.3: a tela abre na aba do cálculo, com o apoio próprio (sem gravação nestes testes da interface).
      const r = p.url.endsWith('/calculo/apoio') ? { corpo: APOIO_CALCULO_SEM_GRAVAR } : rota(p);
      return new Response(JSON.stringify(r.corpo), {
        status: r.status ?? 200,
        headers: { 'content-type': 'application/json' },
      });
    }),
  );
  return pedidos;
}
const APOIO_CALCULO_SEM_GRAVAR = {
  hoje: '2026-10-26',
  competenciaSugerida: '2026-09',
  gravacao: { ligada: true, motivo: null },
  acoes: { calcular: false, salario: false, verSalario: false, parametros: false, motivo: null },
  empresas: [{ codigo: 1, rotulo: 'Empresa Sintética' }],
  papeis: [],
};
/** Os testes da F0 olham a aba da interface com a folha externa (a tela abre no cálculo desde o M53.3). */
async function naInterface(w: {
  find: (s: string) => { exists: () => boolean; trigger: (e: string) => Promise<void> };
}) {
  const b = w.find('[data-testid="folha-aba-interface"]');
  if (b.exists()) {
    await b.trigger('click');
    await flushPromises();
  }
}
afterEach(() => {
  vi.unstubAllGlobals();
  document.body.innerHTML = '';
});

const RESUMO = 'a'.repeat(64);
const apoio = (grava: boolean) => ({
  hoje: '2026-10-26',
  competenciaSugerida: '2026-09',
  gravacao: { ligada: true, motivo: null },
  acoes: {
    exportar: grava,
    importar: grava,
    afastamento: grava,
    motivo: grava ? null : null,
    buscarColaborador: grava,
  },
  empresas: [{ codigo: 1, rotulo: 'Empresa Sintética' }],
  eventosPonto: [],
  motivosAfastamento: [{ codigo: 3, rotulo: 'Licença sintética' }],
  remessas: [],
});
const lote = (id: number, sentido: 'exportado' | 'recebido', situacao: string, soma: number) => ({
  id,
  sentido,
  empresa: 1,
  competencia: '2026-09',
  situacao,
  geradoEm: '2026-10-20T09:15:00',
  geradoPor: 'SINT.DP.FOLHA',
  colaboradores: 3,
  soma,
  divergencias: [],
  resumo: RESUMO,
});

describe('comuns da folha', () => {
  it('competências, rótulos, centavos, minutos e instantes', () => {
    expect(competenciasAte('2026-02-10', 4)).toEqual(['2026-02', '2026-01', '2025-12', '2025-11']);
    expect(rotuloCompetencia('2026-09')).toBe('09/2026');
    expect(reais(123456)).toBe('R$ 1.234,56');
    expect(horas(9630)).toBe('160:30');
    expect(horas(-5)).toBe('-0:05');
    expect(somaDoLote('exportado', 120)).toBe('2:00');
    expect(somaDoLote('recebido', 100)).toBe('R$ 1,00');
    expect(instanteBr('2026-10-20T09:15:00')).toBe('20/10/2026 09:15');
    expect(instanteBr('x')).toBe('x');
  });

  it('o retorno precisa ser um objeto JSON; a recusa traz o código e os campos', () => {
    expect(lerRetorno('\uFEFF{"leiaute":"1.0"}')).toEqual({ leiaute: '1.0' });
    expect(lerRetorno('[1]')).toBeNull();
    expect(lerRetorno('não é json')).toBeNull();
    const e = new ErroApi(
      { title: 'x', status: 422, codigo: 'campo-assistencial', campos: ['escala', 1] } as never,
      422,
    );
    expect(recusaDe(e)).toEqual({ codigo: 'campo-assistencial', campos: ['escala'] });
    expect(recusaDe(new Error('x'))).toBeNull();
  });

  it('D-ABRIR-532: quem só tem a tabela legal (sem a folha da competência) vai direto às rubricas, sem pedir o apoio', async () => {
    const pedidos: string[] = [];
    const sessao = {
      usuario: { id: '1', nome: 'X', login: 'X' },
      rede: 'r',
      estabelecimentos: [{ codigo: 'pc', nome: 'PC' }],
      estabelecimentoAtivo: 'pc',
      permissoes: ['pessoas.folha.abrir', 'pessoas.tabelaLegalFolha.ler'],
      sintetica: true,
      bloqueioInatividadeSegundos: 0,
    };
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        pedidos.push(String(url));
        const corpo = String(url).startsWith('/api/sessao') ? sessao : {};
        return new Response(JSON.stringify(corpo), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }),
    );
    // Como na casca: a sessão já está no cache quando a tela abre.
    const cliente = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    cliente.setQueryData(CHAVE_SESSAO, sessao);
    const replace = vi.fn(async () => undefined);
    const w = mount(FolhaCompetenciaTela as never, {
      attachTo: document.body,
      global: {
        plugins: [
          criarI18n(mensagensWeb as unknown as Record<string, unknown>),
          ui,
          [VueQueryPlugin, { queryClient: cliente }],
        ] as never,
        provide: { [routerKey as symbol]: { replace } },
        stubs: { RouterLink: { template: '<a><slot /></a>' } },
      },
    });
    await flushPromises();
    expect(replace).toHaveBeenCalledWith('/pessoas/folha/rubricas');
    expect(pedidos.some((u) => u.startsWith('/api/pessoas/folha/apoio'))).toBe(false);
    w.unmount();
  });

  it('a rota exige a permissão de leitura do catálogo e os textos não citam outro sistema nem tabela', () => {
    const codigos = new Set(PERMISSOES_FOLHA_M53.map((p) => p.codigo));
    // M53.3: o holerite do autosserviço usa a permissão do "Meu espaço" (todos os perfis de pessoa, só o próprio).
    // M53.4: as férias do autosserviço, idem.
    // M53.6: o eSocial (`pessoas.esocial.ler`). M53.8: as obrigações legais (`pessoas.obrigacao.ler`). M53.9: a integração da folha (`pessoas.integracao.ler`).
    expect(rotasFolha.map((r) => r.path)).toEqual([
      '/pessoas/folha',
      '/pessoas/esocial',
      '/pessoas/obrigacoes',
      '/pessoas/folha/integracao',
      '/pessoas/meu/holerite',
      '/pessoas/meu/ferias',
    ]);
    for (const r of rotasFolha)
      expect(
        codigos.has(String(r.meta?.['permissao'])) || r.meta?.['permissao'] === 'pessoas.autoatendimento.ler',
      ).toBe(true);
    const valores = (o: object): string[] =>
      Object.values(o).flatMap((v) => (typeof v === 'string' ? [v] : valores(v as object)));
    expect(valores(mensagensFolha).join('\n')).not.toMatch(
      /spdata|legado|sistema atual|sistema antigo|\bFP[A-Z_]{3,}|\bTB[A-Z]{3,}|SGH_/i,
    );
  });
});

describe('tela da folha da competência', () => {
  it('lista os lotes com a soma do sentido e gera o lote depois da confirmação; pendências traduzidas', async () => {
    let gerou = false;
    const pedidos = simular((p) => {
      if (p.url.endsWith('/apoio')) return { corpo: apoio(true) };
      if (p.url.includes('/lotes/exportacao')) {
        gerou = true;
        return {
          corpo: {
            gerado: false,
            lote: null,
            pendencias: [{ codigo: 'ponto-nao-fechado', vinculos: [11, 12], valor: 0 }],
            conta: '',
            substituido: null,
          },
        };
      }
      if (p.url.includes('/lotes'))
        return {
          corpo: {
            itens: [lote(7, 'exportado', 'gerado', 9630), lote(8, 'recebido', 'conferido', 123456)],
            limitado: false,
          },
        };
      return { corpo: { itens: [] } };
    });
    const w = montar();
    await flushPromises();
    await flushPromises();
    await naInterface(w);
    expect(pedidos.some((p) => p.url.includes('/lotes?empresa=1&competencia=2026-09'))).toBe(true);
    expect(w.find('[data-testid="folha-lote-soma-7"]').text()).toBe('160:30');
    expect(w.find('[data-testid="folha-lote-soma-8"]').text()).toBe('R$ 1.234,56');
    expect(w.find('[data-testid="folha-lote-situacao-7"]').text()).toBe('Gerado, aguardando retorno');
    expect(w.find('[data-testid="folha-baixar-7"]').exists()).toBe(true);
    expect(w.find('[data-testid="folha-baixar-8"]').exists()).toBe(false);
    await w.find('[data-testid="folha-gerar"]').trigger('click');
    await flushPromises();
    const confirmar = document.querySelector<HTMLButtonElement>('[data-testid="folha-confirmar-gerar"]');
    expect(confirmar).not.toBeNull();
    confirmar!.click();
    await flushPromises();
    expect(gerou).toBe(true);
    const ped = pedidos.find((p) => p.url.includes('/lotes/exportacao'))!;
    expect(ped.corpo).toEqual({ empresa: 1, competencia: '2026-09' });
    const pend = w.find('[data-testid="folha-pendencia-ponto-nao-fechado"]').text();
    expect(pend).toContain('Colaboradores sem o período de ponto fechado na competência');
    expect(pend).toContain('2 colaborador(es): vínculos 11, 12');
    w.unmount();
  });

  it('importa o retorno: divergências traduzidas, títulos barrados', async () => {
    const pedidos = simular((p) => {
      if (p.url.endsWith('/apoio')) return { corpo: apoio(true) };
      if (p.url.includes('/retorno'))
        return {
          corpo: {
            lote: lote(9, 'recebido', 'divergente', 5000),
            situacao: 'divergente',
            divergencias: [
              {
                codigo: 'liquido-colaborador',
                campo: 'liquido',
                declarado: 900,
                calculado: 1000,
                vinculo: 11,
              },
            ],
            podeLancar: false,
            contaTitulos: '',
            totalTitulos: 0,
            linhasResumo: 0,
          },
        };
      if (p.url.includes('/lotes'))
        return { corpo: { itens: [lote(7, 'exportado', 'gerado', 60)], limitado: false } };
      return { corpo: { itens: [] } };
    });
    const w = montar();
    await flushPromises();
    await flushPromises();
    await naInterface(w);
    await w.find('[data-testid="folha-importar-7"]').trigger('click');
    const input = w.find('[data-testid="folha-arquivo-retorno"]').element as HTMLInputElement;
    const arquivo = new File(['{"leiaute":"1.0","lote":7}'], 'retorno.json', { type: 'application/json' });
    Object.defineProperty(input, 'files', { value: [arquivo] });
    await w.find('[data-testid="folha-form-retorno"]').trigger('submit');
    await flushPromises();
    await flushPromises();
    expect(pedidos.find((p) => p.url.endsWith('/lotes/7/retorno'))?.corpo).toEqual({
      leiaute: '1.0',
      lote: 7,
    });
    expect(w.find('[data-testid="folha-conferencia-resultado"]').text()).toContain('Há divergência');
    const d = w.find('[data-testid="folha-divergencia-liquido-colaborador"]').text();
    expect(d).toContain('Líquido diferente de proventos menos descontos');
    expect(d).toContain('900');
    expect(d).toContain('1000');
    w.unmount();
  });

  it('retorno que não é JSON não sai da tela; recusa do servidor vira o texto do código', async () => {
    const pedidos = simular((p) => {
      if (p.url.endsWith('/apoio')) return { corpo: apoio(true) };
      if (p.url.includes('/retorno'))
        return {
          status: 422,
          corpo: {
            type: 'about:blank',
            title: 'Retorno recusado',
            status: 422,
            detail: 'x',
            codigo: 'campo-assistencial',
            campos: ['escala'],
          },
        };
      if (p.url.includes('/lotes'))
        return { corpo: { itens: [lote(7, 'exportado', 'gerado', 60)], limitado: false } };
      return { corpo: { itens: [] } };
    });
    const w = montar();
    await flushPromises();
    await flushPromises();
    await naInterface(w);
    await w.find('[data-testid="folha-importar-7"]').trigger('click');
    const input = w.find('[data-testid="folha-arquivo-retorno"]').element as HTMLInputElement;
    Object.defineProperty(input, 'files', { value: [new File(['nada'], 'r.txt')], configurable: true });
    await w.find('[data-testid="folha-form-retorno"]').trigger('submit');
    await flushPromises();
    expect(pedidos.some((p) => p.url.includes('/retorno'))).toBe(false);
    expect(w.find('[data-testid="recusa-folha"]').text()).toContain('não pôde ser lido');
    Object.defineProperty(input, 'files', { value: [new File(['{"leiaute":"1.0"}'], 'r.json')] });
    await w.find('[data-testid="folha-form-retorno"]').trigger('submit');
    await flushPromises();
    await flushPromises();
    expect(w.find('[data-testid="recusa-folha"]').text()).toContain('mantidos aqui (escala)');
    w.unmount();
  });

  it('perfil de consulta: sem botões de gravar; aba de afastamentos lista a competência', async () => {
    const pedidos = simular((p) => {
      if (p.url.endsWith('/apoio')) return { corpo: apoio(false) };
      if (p.url.includes('/afastamentos'))
        return {
          corpo: {
            itens: [
              {
                id: 4,
                vinculo: 11,
                matricula: 'S-001',
                motivo: 3,
                motivoRotulo: 'Licença sintética',
                inicio: '2026-09-02',
                fim: null,
                observacao: null,
                situacao: 'ativo',
                motivoCancelamento: null,
                versao: 0,
              },
            ],
          },
        };
      if (p.url.includes('/lotes'))
        return { corpo: { itens: [lote(7, 'exportado', 'gerado', 60)], limitado: false } };
      return { corpo: {} };
    });
    const w = montar();
    await flushPromises();
    await flushPromises();
    await naInterface(w);
    expect(w.find('[data-testid="folha-so-consulta"]').exists()).toBe(true);
    expect(w.find('[data-testid="folha-gerar"]').exists()).toBe(false);
    expect(w.find('[data-testid="folha-baixar-7"]').exists()).toBe(false);
    expect(w.find('[data-testid="folha-importar-7"]').exists()).toBe(false);
    await w.find('[data-testid="folha-aba-afastamentos"]').trigger('click');
    await flushPromises();
    await flushPromises();
    expect(pedidos.some((p) => p.url.includes('/afastamentos?competencia=2026-09'))).toBe(true);
    const linha = w.find('[data-testid="folha-afastamento-4"]').text();
    expect(linha).toContain('Matrícula S-001');
    expect(linha).toContain('Sem data de fim');
    expect(w.find('[data-testid="folha-afastamento-novo"]').exists()).toBe(false);
    expect(w.find('[data-testid="folha-afastamento-cancelar-4"]').exists()).toBe(false);
    w.unmount();
  });
  it('afastamentos: filtro por colaborador pela busca da gestão de pessoas, com o nome do escolhido na linha', async () => {
    const afast = {
      id: 5,
      vinculo: 12,
      matricula: 'S-002',
      motivo: 3,
      motivoRotulo: 'Licença sintética',
      inicio: '2026-09-03',
      fim: null,
      observacao: null,
      situacao: 'ativo',
      motivoCancelamento: null,
      versao: 0,
    };
    const pedidos = simular((p) => {
      if (p.url.endsWith('/apoio')) return { corpo: apoio(true) };
      if (p.url.includes('/colaboradores'))
        return {
          corpo: {
            itens: [
              {
                vinculo: 12,
                nome: 'Colaboradora Sintética',
                matricula: 'S-002',
                tipo: 'clt',
                cargo: 'Cargo sintético',
                lotacao: null,
                admissao: '2026-01-01',
                desligamento: null,
                estado: 'ativo',
                conselho: null,
              },
            ],
            proximo: null,
          },
        };
      if (p.url.includes('/afastamentos')) return { corpo: { itens: [afast] } };
      if (p.url.includes('/lotes')) return { corpo: { itens: [], limitado: false } };
      return { corpo: {} };
    });
    const w = montar();
    await flushPromises();
    await w.find('[data-testid="folha-aba-afastamentos"]').trigger('click');
    await flushPromises();
    await flushPromises();
    expect(w.find('[data-testid="folha-afastamento-5"]').text()).not.toContain('Colaboradora Sintética');
    await w.find('[data-testid="folha-afastamento-filtro-termo"] input').setValue('Sint');
    await w.find('[data-testid="folha-afastamento-filtro-buscar"]').trigger('click');
    await flushPromises();
    expect(pedidos.some((p) => p.url.includes('/colaboradores?termo=Sint'))).toBe(true);
    await w.find('[data-testid="folha-afastamento-filtro-escolher-12"]').trigger('click');
    await flushPromises();
    await flushPromises();
    expect(pedidos.some((p) => /\/afastamentos\?competencia=2026-09&vinculo=12/.test(p.url))).toBe(true);
    expect(w.find('[data-testid="folha-afastamento-filtrado"]').text()).toContain('Colaboradora Sintética');
    expect(w.find('[data-testid="folha-afastamento-5"]').text()).toContain(
      'Colaboradora Sintética · Matrícula S-002',
    );
    await w.find('[data-testid="folha-afastamento-filtro-limpar"]').trigger('click');
    await flushPromises();
    expect(w.find('[data-testid="folha-afastamento-filtro-termo"]').exists()).toBe(true);
    w.unmount();
  });

  it('afastamentos: sem a busca da gestão de pessoas, sem o filtro por colaborador', async () => {
    simular((p) => {
      if (p.url.endsWith('/apoio')) return { corpo: apoio(false) };
      if (p.url.includes('/afastamentos')) return { corpo: { itens: [] } };
      if (p.url.includes('/lotes')) return { corpo: { itens: [], limitado: false } };
      return { corpo: {} };
    });
    const w = montar();
    await flushPromises();
    await w.find('[data-testid="folha-aba-afastamentos"]').trigger('click');
    await flushPromises();
    expect(w.find('[data-testid="folha-afastamento-filtro"]').exists()).toBe(false);
    w.unmount();
  });
});
