// @vitest-environment jsdom
// "Contas do banco de dados e privilégios" (M59-F1): o inventário com o resumo, o contexto do hospital e os avisos;
// busca e filtros (SanteSelecao, ADR 0027) pela função, destino e situação; o agregado das contas fora do catálogo
// sem nome; a aba Desvios com o plano não aplicado, os módulos e as listas com o teto; só consulta (nenhum botão de
// revogar); a rota exige acesso.contaBanco.ler. Dados sintéticos.
import { esquemaDesviosPrivilegiosResposta, esquemaInventarioContasBancoResposta } from '@sgh/contratos';
import { criarI18n, instalarUi, resolverMarca } from '@sgh/ui';
import { QueryClient, VueQueryPlugin } from '@tanstack/vue-query';
import { flushPromises, mount } from '@vue/test-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { type App, nextTick } from 'vue';
import { createMemoryHistory } from 'vue-router';
import { mensagensWeb } from '../../../i18n/pt-BR.js';
import { criarRoteador } from '../../../roteador.js';
import ContasBancoTela from './ContasBancoTela.vue';

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
const i18n = () => criarI18n(mensagensWeb as unknown as Record<string, unknown>);

const escolher = async (w: ReturnType<typeof mount>, testid: string, valor: string) => {
  await w.find(`[data-testid="${testid}"] [role="combobox"]`).trigger('click');
  await flushPromises();
  await nextTick();
  const opcao = document.body.querySelector<HTMLElement>(`[role="option"]:has([data-valor="${valor}"])`);
  expect(opcao, `opção ${valor} em ${testid}`).not.toBeNull();
  opcao!.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
  await flushPromises();
};

const linha = (o: Record<string, unknown>) => ({
  tipo: 'usuario',
  quantidade: 1,
  existeLogin: true,
  ativa: true,
  leitura: 10,
  escrita: 0,
  execucao: 0,
  papeis: [],
  uso: null,
  motivo: 'medir sessões e consultas por pelo menos 30 dias',
  ...o,
});
const inventario = {
  hospital: 'pc',
  em: '2026-10-28T12:00:00.000Z',
  contexto: {
    desligado: false,
    contingenciaAtiva: true,
    janelaMinimaDias: 30,
    avisos: ['uso das contas ainda não medido: a medição é feita no servidor do hospital, pela TI'],
  },
  resumo: {
    contasComPrivilegio: 4,
    contasComEscrita: 2,
    contasComEscritaAmpla: 1,
    maiorAlcanceEscrita: 2345,
    naoCatalogadas: '<5',
    loginsSemPrivilegio: 7,
    papeisSemPrivilegio: ['MASTER'],
    porSituacao: {
      pronta: 0,
      'medir-uso': 0,
      'aguardando-contingencia': 0,
      'aguardando-decisao': 0,
      identificar: 1,
      'aguardando-desligamento': 3,
    },
  },
  contas: [
    linha({
      nome: 'TISSWS',
      classe: 'servico-legado',
      destino: 'funcao-sgh',
      situacao: 'aguardando-desligamento',
      escrita: 2345,
      motivo: 'o hospital ainda não concluiu a migração de todos os usuários',
    }),
    linha({
      nome: 'EXCEL',
      classe: 'planilha',
      destino: 'revogar',
      situacao: 'aguardando-desligamento',
      uso: {
        conta: 'EXCEL',
        inicio: '2026-09-01',
        fim: '2026-09-30',
        sessoes: 12,
        consultas: null,
        ultimoUso: '2026-09-29',
        fonte: 'mon-attachments',
      },
    }),
    linha({
      nome: 'SGH_APP_ACESSO',
      classe: 'aplicacao-sgh',
      destino: 'privilegio-minimo',
      situacao: 'aguardando-desligamento',
      escrita: 40,
      papeis: ['SGH_MOD_ACESSO'],
    }),
    linha({
      nome: null,
      quantidade: '<5',
      classe: 'nao-catalogada',
      destino: 'revogar',
      situacao: 'identificar',
      motivo: 'conta fora do catálogo: a TI identifica o dono e o uso',
    }),
  ],
};
const item = (i: number) => ({ titular: 'SGH_MOD_ACESSO', objeto: `TABELA_${i}`, acao: 'SELECT' });
const desvios = {
  hospital: 'pc',
  em: '2026-10-28T12:00:00.000Z',
  versaoPlano: '73b4834e65a9',
  modulos: [
    {
      modulo: 'acesso',
      papel: 'SGH_MOD_ACESSO',
      conta: 'SGH_APP_ACESSO',
      objetos: 12,
      itens: 30,
      contaConfigurada: false,
    },
  ],
  iguais: 0,
  excessoTotal: 0,
  faltaTotal: 620,
  excesso: [],
  falta: Array.from({ length: 500 }, (_, i) => item(i)),
  planoAplicado: false,
};

const responder = (inv: unknown, dv: unknown) =>
  vi.fn(async (url: string) => {
    const corpo = String(url).endsWith('/desvios') ? dv : inv;
    return new Response(JSON.stringify(corpo), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  });

const montar = () =>
  mount(ContasBancoTela, {
    global: {
      plugins: [
        i18n(),
        ui,
        [VueQueryPlugin, { queryClient: new QueryClient({ defaultOptions: { queries: { retry: false } } }) }],
      ],
    },
    attachTo: document.body,
  });

afterEach(() => {
  vi.unstubAllGlobals();
  document.body.innerHTML = '';
});

it('os dados sintéticos passam pelo contrato', () => {
  expect(esquemaInventarioContasBancoResposta.safeParse(inventario).error?.issues ?? []).toEqual([]);
  expect(esquemaDesviosPrivilegiosResposta.safeParse(desvios).error?.issues ?? []).toEqual([]);
});

describe('Contas do banco de dados e privilégios (M59-F1)', () => {
  it('inventário: resumo, contexto, avisos, agregado sem nome e só consulta', async () => {
    const f = responder(inventario, desvios);
    vi.stubGlobal('fetch', f);
    const w = montar();
    await flushPromises();
    expect(f).toHaveBeenCalledTimes(1);
    expect(String(f.mock.calls[0]![0])).toBe('/api/administracao/acesso/contas-banco');
    expect(w.find('h1').text()).toBe('Contas do banco de dados e privilégios');
    const resumo = w.get('[data-testid="contas-resumo"]').text();
    expect(resumo).toContain('2.345');
    expect(resumo).toContain('<5');
    expect(w.get('[data-testid="contas-contexto"]').text()).toContain('ainda não concluída');
    expect(w.get('[data-testid="contas-contexto"]').text()).toContain('Contingência aberta');
    expect(w.get('[data-testid="contas-avisos"]').text()).toContain('ainda não medido');
    expect(w.get('[data-testid="contas-por-situacao"]').text()).toContain('Identificar a conta: 1');
    expect(w.get('[data-testid="contas-contagem"]').text()).toBe('4 de 4 contas');
    expect(w.get('[data-testid="conta-demais"]').text()).toContain('Demais contas (somadas, sem nome)');
    expect(w.get('[data-testid="conta-EXCEL"]').text()).toContain('12 sessões de 01/09/2026 a 30/09/2026');
    expect(w.get('[data-testid="conta-TISSWS"]').text()).toContain('Sem medição');
    expect(w.text()).not.toMatch(/revogar agora|aplicar script/i);
    expect(w.findAll('button').map((b) => b.text())).not.toContain('Revogar');
  });

  it('busca e filtros por função, destino e situação; limpar volta a todas', async () => {
    vi.stubGlobal('fetch', responder(inventario, desvios));
    const w = montar();
    await flushPromises();
    await w.get('[data-testid="contas-busca"] input').setValue('modulo acesso');
    expect(w.get('[data-testid="contas-contagem"]').text()).toBe('0 de 4 contas');
    await w.get('[data-testid="contas-busca"] input').setValue('sgh_app');
    expect(w.get('[data-testid="contas-contagem"]').text()).toBe('1 de 4 contas');
    await w.get('[data-testid="contas-limpar"]').trigger('click');
    expect(w.get('[data-testid="contas-contagem"]').text()).toBe('4 de 4 contas');

    await escolher(w, 'contas-filtro-destino', 'revogar');
    expect(w.get('[data-testid="contas-contagem"]').text()).toBe('2 de 4 contas');
    await escolher(w, 'contas-filtro-situacao', 'identificar');
    expect(w.get('[data-testid="contas-contagem"]').text()).toBe('1 de 4 contas');
    expect(w.find('[data-testid="conta-demais"]').exists()).toBe(true);
    await escolher(w, 'contas-filtro-classe', 'planilha');
    expect(w.get('[data-testid="contas-vazio"]').text()).toContain('Nenhuma conta');
  });

  it('desvios: lido só ao abrir a aba; plano não aplicado, módulos e o teto da lista', async () => {
    const f = responder(inventario, desvios);
    vi.stubGlobal('fetch', f);
    const w = montar();
    await flushPromises();
    await w.get('[data-testid="contas-aba-desvios"]').trigger('click');
    await flushPromises();
    expect(String(f.mock.calls[1]![0])).toBe('/api/administracao/acesso/contas-banco/desvios');
    expect(w.get('[data-testid="desvios-nao-aplicado"]').text()).toContain('ainda não foram criados');
    expect(w.get('[data-testid="tabela-modulos"]').text()).toContain('SGH_APP_ACESSO');
    expect(w.get('[data-testid="tabela-modulos"]').text()).toContain('Não');
    expect(w.get('[data-testid="desvios-excesso-nenhum"]').text()).toBe('Nenhum desvio.');
    expect(w.findAll('[data-testid="tabela-falta"] tbody tr')).toHaveLength(500);
    expect(w.text()).toContain('Mostrando 500 de 620.');
    expect(w.get('[data-testid="desvios-totais"]').text()).toContain('Privilégios faltando: 620');
  });

  it('erro da API: a mensagem de erro, sem tabela', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('x', { status: 503 })),
    );
    const w = montar();
    await flushPromises();
    expect(w.find('[data-testid="tabela-contas"]').exists()).toBe(false);
    expect(w.find('[data-testid="mensagem-erro"]').exists()).toBe(true);
  });

  it('a rota exige acesso.contaBanco.ler', async () => {
    const sessao = (permissoes: string[]) => async () => ({
      usuario: { id: 's', nome: 'S' },
      rede: null,
      estabelecimentos: [],
      estabelecimentoAtivo: null,
      permissoes,
      sintetica: true,
      bloqueioInatividadeSegundos: 0,
    });
    const sem = criarRoteador(sessao(['acesso.inicio.ler']), {
      historico: createMemoryHistory(),
      desenvolvimento: true,
    });
    await sem.push('/administracao/acesso/contas-banco');
    expect(sem.currentRoute.value.name).toBe('sem-permissao');
    const com = criarRoteador(sessao(['acesso.inicio.ler', 'acesso.contaBanco.ler']), {
      historico: createMemoryHistory(),
      desenvolvimento: true,
    });
    await com.push('/administracao/acesso/contas-banco');
    expect(com.currentRoute.value.name).toBe('adm.contasBanco');
  });
});
