// @vitest-environment jsdom
// Conferência da instalação (M60, etapa 2): as funções de apresentação, a rota com sistema.saude.ler, e a tela com a
// situação geral, os itens na ordem do contrato, a conexão, as atualizações do banco (pendentes, divergentes e
// desconhecidas) e o erro da API traduzido. Dados SINTÉTICOS; o fetch é simulado.
import {
  type ConferenciaInstalacao,
  esquemaConferenciaInstalacao,
  ITENS_CONFERENCIA_INSTALACAO,
  ROTA_CONFERENCIA_INSTALACAO,
  SITUACOES_ITEM_CONFERENCIA,
} from '@sgh/contratos';
import { criarI18n, instalarUi, resolverMarca } from '@sgh/ui';
import { QueryClient, VueQueryPlugin } from '@tanstack/vue-query';
import { flushPromises, mount } from '@vue/test-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { App } from 'vue';
import { createMemoryHistory } from 'vue-router';
import { mensagensWeb } from '../../i18n/pt-BR.js';
import { criarRoteador } from '../../roteador.js';
import {
  buscarConferenciaInstalacao,
  chaveSimNao,
  contagemPorSituacao,
  itensOrdenados,
  pendentesAlemDaLista,
} from './api.js';
import { mensagensImplantacao } from './i18n.js';
import ConferenciaInstalacaoTela from './telas/ConferenciaInstalacaoTela.vue';

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

function conferencia(sobre: Partial<ConferenciaInstalacao> = {}): ConferenciaInstalacao {
  return esquemaConferenciaInstalacao.parse({
    hospital: 'pc',
    em: '2026-10-27T12:00:00.000Z',
    ambiente: 'homologacao',
    versao: { identificacao: '0.60.2+abc1234', versao: '0.60.2' },
    conexao: {
      versaoMotor: '3.0.12',
      charsetBanco: 'WIN1252',
      charsetConexao: 'WIN1252',
      charsetParametro: 'CP1252',
      autenticacao: 'Srp256',
      canalCifrado: true,
      canalComprimido: null,
      protocolo: 'TCPv4',
      conta: 'SGH_APP',
      papel: 'SGH_APLICACAO',
    },
    scripts: {
      registroLido: true,
      noPacote: 30,
      ultimoNoPacote: '0975',
      aplicados: 30,
      ultimoAplicado: '0975',
      pendentes: [],
      pendentesTotal: 0,
      divergentes: [],
      desconhecidos: [],
    },
    itens: [...ITENS_CONFERENCIA_INSTALACAO].reverse().map((codigo) => ({
      codigo,
      titulo: `Título ${codigo}`,
      situacao: 'ok',
      detalhe: `Detalhe ${codigo}`,
    })),
    situacao: 'ok',
    ...sobre,
  });
}

function simular(status: number, corpo: unknown): string[] {
  const urls: string[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      urls.push(String(url));
      return new Response(JSON.stringify(corpo), {
        status,
        headers: { 'content-type': status >= 400 ? 'application/problem+json' : 'application/json' },
      });
    }),
  );
  return urls;
}

const ui = { install: (app: App) => instalarUi(app, resolverMarca(undefined).pacote) };
const montar = () =>
  mount(ConferenciaInstalacaoTela as never, {
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

afterEach(() => {
  vi.unstubAllGlobals();
  document.body.innerHTML = '';
});

describe('apresentação da conferência', () => {
  it('conta por situação, ordena pelo contrato e trata os opcionais', () => {
    const c = conferencia();
    expect(itensOrdenados(c.itens).map((i) => i.codigo)).toEqual([...ITENS_CONFERENCIA_INSTALACAO]);
    expect(itensOrdenados(undefined)).toEqual([]);
    const itens = c.itens.map(
      (i, n) => ({ ...i, situacao: n === 0 ? 'falha' : n < 3 ? 'alerta' : 'ok' }) as const,
    );
    expect(contagemPorSituacao(itens)).toEqual({ ok: itens.length - 3, alerta: 2, falha: 1 });
    expect(contagemPorSituacao(undefined)).toEqual({ ok: 0, alerta: 0, falha: 0 });
    expect([chaveSimNao(true), chaveSimNao(false), chaveSimNao(null)]).toEqual([
      'sim',
      'nao',
      'desconhecido',
    ]);
    expect(pendentesAlemDaLista(undefined)).toBe(0);
    const s = { ...c.scripts, pendentes: ['0001', '0002'], pendentesTotal: 25 };
    expect(pendentesAlemDaLista({ ...c, scripts: s })).toBe(23);
  });

  it('todo item e toda situação do contrato têm texto', () => {
    for (const s of SITUACOES_ITEM_CONFERENCIA) {
      expect(mensagensImplantacao.situacao[s]).toBeTruthy();
      expect(mensagensImplantacao.situacaoGeral[s]).toBeTruthy();
    }
  });

  it('busca na rota do contrato e valida a resposta; erro vira ErroApi', async () => {
    const urls = simular(200, conferencia());
    await expect(buscarConferenciaInstalacao()).resolves.toMatchObject({ hospital: 'pc' });
    expect(urls).toEqual([ROTA_CONFERENCIA_INSTALACAO]);
    simular(503, { type: 'about:blank', title: 'Indisponível', status: 503, codigo: 'banco-indisponivel' });
    await expect(buscarConferenciaInstalacao()).rejects.toBeTruthy();
  });
});

describe('rota da conferência', () => {
  const sessao = (permissoes: string[]) => async () => ({
    usuario: { id: 's', nome: 'S' },
    rede: null,
    estabelecimentos: [],
    estabelecimentoAtivo: null,
    permissoes,
    sintetica: true,
    bloqueioInatividadeSegundos: 0,
  });
  it('exige sistema.saude.ler', async () => {
    const sem = criarRoteador(sessao(['acesso.inicio.ler']), {
      historico: createMemoryHistory(),
      desenvolvimento: true,
    });
    await sem.push('/administracao/saude/instalacao');
    expect(sem.currentRoute.value.name).toBe('sem-permissao');
    const com = criarRoteador(sessao(['acesso.inicio.ler', 'sistema.saude.ler']), {
      historico: createMemoryHistory(),
      desenvolvimento: true,
    });
    await com.push('/administracao/saude/instalacao');
    expect(com.currentRoute.value.name).toBe('implantacao.conferencia');
  });
});

describe('tela da conferência', () => {
  it('em ordem: situação geral, itens na ordem, conexão e atualizações em dia', async () => {
    simular(200, conferencia());
    const w = montar();
    await flushPromises();
    expect(w.get('[data-testid="conferencia-situacao"]').attributes('data-situacao')).toBe('ok');
    expect(w.get('[data-testid="conferencia-situacao"]').text()).toContain('Instalação em ordem');
    const linhas = w.findAll('[data-testid="tabela-itens"] tbody tr').map((l) => l.attributes('data-testid'));
    expect(linhas).toEqual(ITENS_CONFERENCIA_INSTALACAO.map((c) => `item-${c}`));
    expect(w.get('[data-testid="conferencia-contagem"]').text()).toContain(
      `${ITENS_CONFERENCIA_INSTALACAO.length} em ordem`,
    );
    expect(w.get('[data-testid="conexao-canalCifrado"]').text()).toContain('Sim');
    expect(w.get('[data-testid="conexao-canalComprimido"]').text()).toContain('não informado');
    expect(w.get('[data-testid="conexao-papel"]').text()).toContain('SGH_APLICACAO');
    expect(w.get('[data-testid="conferencia-versao"]').text()).toContain('0.60.2+abc1234');
    expect(w.find('[data-testid="scripts-em-dia"]').exists()).toBe(true);
    expect(w.find('[data-testid="scripts-pendentes"]').exists()).toBe(false);
    expect(w.get('[data-testid="aba-conferencia"]').attributes('aria-current')).toBe('page');
  });

  it('com falha: pendentes (com o excedente), divergentes e desconhecidas aparecem; o botão confere de novo', async () => {
    const c = conferencia({
      situacao: 'falha',
      scripts: {
        registroLido: true,
        noPacote: 30,
        ultimoNoPacote: '0975',
        aplicados: 8,
        ultimoAplicado: null,
        pendentes: ['0010', '0011'],
        pendentesTotal: 22,
        divergentes: ['0003'],
        desconhecidos: ['0999'],
      },
    });
    const itens = c.itens.map((i) => (i.codigo === 'scripts' ? { ...i, situacao: 'falha' as const } : i));
    const urls = simular(200, { ...c, itens });
    const w = montar();
    await flushPromises();
    expect(w.get('[data-testid="conferencia-situacao"]').attributes('data-situacao')).toBe('falha');
    expect(w.get('[data-testid="item-scripts"]').attributes('data-situacao')).toBe('falha');
    expect(w.get('[data-testid="item-scripts"]').text()).toContain('Falha');
    expect(w.get('[data-testid="scripts-pendentes"]').text()).toContain('(22)');
    expect(w.get('[data-testid="scripts-pendentes"]').text()).toContain('e mais 20');
    expect(w.get('[data-testid="scripts-divergentes"]').text()).toContain('0003');
    expect(w.get('[data-testid="scripts-desconhecidos"]').text()).toContain('0999');
    expect(w.get('[data-testid="scripts-resumo"]').text()).toContain('nenhuma');
    expect(w.find('[data-testid="scripts-em-dia"]').exists()).toBe(false);
    await w.get('[data-testid="conferencia-atualizar"]').trigger('click');
    await flushPromises();
    expect(urls.length).toBe(2);
  });

  it('registro dos scripts ilegível: mostra que não foi lido e nunca "em dia"', async () => {
    const c = conferencia({ situacao: 'falha' });
    simular(200, {
      ...c,
      scripts: { ...c.scripts, registroLido: false, aplicados: 0, ultimoAplicado: null },
    });
    const w = montar();
    await flushPromises();
    expect(w.get('[data-testid="scripts-nao-lido"]').text()).toContain('não conseguiu ler');
    expect(w.find('[data-testid="scripts-resumo"]').exists()).toBe(false);
    expect(w.find('[data-testid="scripts-em-dia"]').exists()).toBe(false);
  });

  it('API indisponível: alerta com a mensagem traduzida e nenhum dado', async () => {
    simular(503, { type: 'about:blank', title: 'Indisponível', status: 503 });
    const w = montar();
    await flushPromises();
    expect(w.get('[data-testid="conferencia-erro"]').text()).toContain(
      'Não foi possível conferir a instalação',
    );
    expect(w.find('[data-testid="tabela-itens"]').exists()).toBe(false);
  });
});
