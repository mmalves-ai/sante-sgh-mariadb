// @vitest-environment jsdom
// Fumaça do servidor (M60, etapa 3): as funções de apresentação, a rota com sistema.saude.ler, e a tela com a situação
// geral, os itens na ordem do contrato, relógio, Valkey, filas (sem consumidor em destaque), estrutura do banco e
// chaves (inesperadas marcadas, escopo pessoa só contado) e o erro traduzido. Dados SINTÉTICOS; fetch simulado.
import {
  esquemaFumacaServidor,
  type FumacaServidor,
  ITENS_FUMACA_SERVIDOR,
  ROTA_FUMACA_IMPLANTACAO,
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
  buscarFumacaServidor,
  contagemOuTraco,
  derivaEmSegundos,
  filaSemConsumidor,
  fusoEmTexto,
  itensFumacaOrdenados,
  totalLigadas,
} from './api.js';
import { mensagensImplantacao } from './i18n.js';
import FumacaServidorTela from './telas/FumacaServidorTela.vue';

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

function fumaca(sobre: Partial<FumacaServidor> = {}): FumacaServidor {
  return esquemaFumacaServidor.parse({
    hospital: 'pc',
    em: '2026-10-27T12:00:00.000Z',
    ambiente: 'homologacao',
    relogio: {
      servidorEm: '2026-10-27T12:00:00.000Z',
      fuso: 'UTC',
      bancoLocal: '2026-10-27T09:00:00.400',
      fusoBancoMin: -180,
      derivaMs: 400,
    },
    horaConfiavel: {
      servidorNtp: 'a.st1.ntp.br',
      referencia: 'ntp',
      ntpEm: '2026-10-27T12:00:00.000Z',
      desvioServidorMs: 5,
      desvioBancoMs: 15,
      limiarMs: 1000,
      fusoInstituicao: 'America/Sao_Paulo',
      exibidoNoFuso: '27/10/2026 09:00:00',
    },
    valkey: { configurado: true, responde: true, latenciaMs: 2 },
    filas: [
      { codigo: 'email', consumidores: 1, aguardando: 0, ativos: 0, atrasados: 0, falhas: 0 },
      { codigo: 'relatorio', consumidores: 1, aguardando: 3, ativos: 1, atrasados: 0, falhas: 0 },
    ],
    impressao: {
      estado: 'homologado',
      resumo: 'abcdef0123456789',
      resumoHomologado: 'abcdef0123456789',
      verificadaEm: '2026-10-27T11:59:00.000Z',
      tabelasBloqueadas: 0,
      bloqueiaTudo: false,
    },
    chaves: { lidas: true, ligadas: [], esperadas: [], inesperadas: [] },
    itens: [...ITENS_FUMACA_SERVIDOR].reverse().map((codigo) => ({
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
  mount(FumacaServidorTela as never, {
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

describe('apresentação da fumaça', () => {
  it('ordena pelo contrato, formata deriva e fuso, e não finge contagem que faltou', () => {
    expect(itensFumacaOrdenados(fumaca().itens).map((i) => i.codigo)).toEqual([...ITENS_FUMACA_SERVIDOR]);
    expect(itensFumacaOrdenados(undefined)).toEqual([]);
    expect(derivaEmSegundos(400)).toBe('0,4 s');
    expect(derivaEmSegundos(-2100)).toBe('-2,1 s');
    expect(derivaEmSegundos(null)).toBeNull();
    expect(fusoEmTexto(-180)).toBe('UTC-03:00');
    expect(fusoEmTexto(330)).toBe('UTC+05:30');
    expect(fusoEmTexto(0)).toBe('UTC+00:00');
    expect(fusoEmTexto(null)).toBeNull();
    expect(contagemOuTraco(null)).toBe('—');
    expect(contagemOuTraco(0)).toBe('0');
    const f = { codigo: 'email' as const, aguardando: 0, ativos: 0, atrasados: 0, falhas: 0 };
    expect(filaSemConsumidor({ ...f, consumidores: 0 })).toBe(true);
    expect(filaSemConsumidor({ ...f, consumidores: 2 })).toBe(false);
    expect(filaSemConsumidor({ ...f, consumidores: null })).toBeNull();
    expect(totalLigadas({ hospital: 1, setor: 2, grupo: 3, pessoa: 4 })).toBe(10);
  });

  it('todo estado da estrutura e todo nome de fila têm texto', () => {
    for (const e of ['homologado', 'divergente', 'sem-homologacao', 'indisponivel', 'nulo'] as const) {
      expect(mensagensImplantacao.fumaca.impressao.estados[e]).toBeTruthy();
    }
    expect(mensagensImplantacao.fumaca.filas.nomes.email).toBeTruthy();
    expect(mensagensImplantacao.fumaca.filas.nomes.relatorio).toBeTruthy();
  });

  it('busca na rota do contrato e valida; erro vira rejeição', async () => {
    const urls = simular(200, fumaca());
    await expect(buscarFumacaServidor()).resolves.toMatchObject({ hospital: 'pc' });
    expect(urls).toEqual([ROTA_FUMACA_IMPLANTACAO]);
    simular(503, { type: 'about:blank', title: 'Indisponível', status: 503 });
    await expect(buscarFumacaServidor()).rejects.toBeTruthy();
  });
});

describe('rota da fumaça', () => {
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
    await sem.push('/administracao/saude/fumaca');
    expect(sem.currentRoute.value.name).toBe('sem-permissao');
    const com = criarRoteador(sessao(['acesso.inicio.ler', 'sistema.saude.ler']), {
      historico: createMemoryHistory(),
      desenvolvimento: true,
    });
    await com.push('/administracao/saude/fumaca');
    expect(com.currentRoute.value.name).toBe('implantacao.fumaca');
  });
});

describe('tela da fumaça', () => {
  it('em ordem: itens na ordem, relógio, Valkey, filas, estrutura homologada, nenhuma chave', async () => {
    simular(200, fumaca());
    const w = montar();
    await flushPromises();
    expect(w.get('[data-testid="fumaca-situacao"]').attributes('data-situacao')).toBe('ok');
    expect(w.get('[data-testid="fumaca-situacao"]').text()).toContain('Servidor em ordem');
    const linhas = w.findAll('[data-testid="fumaca-itens"] tbody tr').map((l) => l.attributes('data-testid'));
    expect(linhas).toEqual(ITENS_FUMACA_SERVIDOR.map((c) => `fumaca-item-${c}`));
    expect(w.get('[data-testid="relogio-fusoBanco"]').text()).toContain('UTC-03:00');
    expect(w.get('[data-testid="relogio-deriva"]').text()).toContain('0,4 s');
    expect(w.get('[data-testid="valkey-responde"]').text()).toContain('Sim');
    expect(w.get('[data-testid="fila-relatorio"]').text()).toContain('Relatórios em segundo plano');
    expect(w.find('[data-testid="fila-sem-consumidor"]').exists()).toBe(false);
    expect(w.get('[data-testid="fumaca-impressao"]').attributes('data-estado')).toBe('homologado');
    expect(w.find('[data-testid="impressao-bloqueio"]').exists()).toBe(false);
    expect(w.get('[data-testid="chaves-esperadas"]').text()).toContain('Nenhuma função deve estar liberada');
    expect(w.find('[data-testid="chaves-nenhuma"]').exists()).toBe(true);
    expect(w.get('[data-testid="aba-fumaca"]').attributes('aria-current')).toBe('page');
  });

  it('com falha: Valkey fora, fila sem trabalhador, estrutura divergente, chave inesperada; confere de novo', async () => {
    const f = fumaca({
      situacao: 'falha',
      relogio: {
        servidorEm: '2026-10-27T12:00:00.000Z',
        fuso: 'UTC',
        bancoLocal: null,
        fusoBancoMin: null,
        derivaMs: null,
      },
      valkey: { configurado: true, responde: false, latenciaMs: null },
      filas: [
        { codigo: 'email', consumidores: 0, aguardando: 5, ativos: 0, atrasados: 0, falhas: 1 },
        {
          codigo: 'relatorio',
          consumidores: null,
          aguardando: null,
          ativos: null,
          atrasados: null,
          falhas: null,
        },
      ],
      impressao: {
        estado: 'divergente',
        resumo: '1111111111111111',
        resumoHomologado: '2222222222222222',
        verificadaEm: null,
        tabelasBloqueadas: 3,
        bloqueiaTudo: false,
      },
      chaves: {
        lidas: true,
        ligadas: [
          { tipo: 'operacao', chave: 'agenda.marcar', hospital: 1, setor: 0, grupo: 0, pessoa: 0 },
          { tipo: 'recurso', chave: 'portal.ativo', hospital: 0, setor: 0, grupo: 0, pessoa: 2 },
        ],
        esperadas: ['agenda.*'],
        inesperadas: ['portal.ativo'],
      },
    });
    const itens = f.itens.map((i) => (i.codigo === 'valkey' ? { ...i, situacao: 'falha' as const } : i));
    const urls = simular(200, { ...f, itens });
    const w = montar();
    await flushPromises();
    expect(w.get('[data-testid="fumaca-situacao"]').attributes('data-situacao')).toBe('falha');
    expect(w.get('[data-testid="fumaca-item-valkey"]').text()).toContain('Falha');
    expect(w.get('[data-testid="relogio-deriva"]').text()).toContain('não lido');
    expect(w.get('[data-testid="valkey-responde"]').text()).toContain('Não');
    expect(w.get('[data-testid="fila-email"]').text()).toContain('nenhum trabalhador');
    expect(w.get('[data-testid="fila-relatorio"]').text()).toContain('—');
    expect(w.get('[data-testid="fumaca-impressao"]').attributes('data-estado')).toBe('divergente');
    expect(w.get('[data-testid="impressao-bloqueio"]').text()).toContain('3 tabela');
    expect(w.get('[data-testid="chaves-esperadas"]').text()).toContain('agenda.*');
    expect(w.get('[data-testid="chave-portal.ativo"]').attributes('data-inesperada')).toBe('sim');
    expect(w.get('[data-testid="chave-agenda.marcar"]').attributes('data-inesperada')).toBe('nao');
    expect(w.get('[data-testid="chave-portal.ativo"]').text()).toContain('pessoa 2');
    await w.get('[data-testid="fumaca-atualizar"]').trigger('click');
    await flushPromises();
    expect(urls.length).toBe(2);
  });

  it('chaves ilegíveis e estrutura ainda não conferida', async () => {
    simular(200, {
      ...fumaca(),
      impressao: {
        estado: null,
        resumo: null,
        resumoHomologado: null,
        verificadaEm: null,
        tabelasBloqueadas: 0,
        bloqueiaTudo: true,
      },
      chaves: { lidas: false, ligadas: [], esperadas: [], inesperadas: [] },
      filas: [],
    });
    const w = montar();
    await flushPromises();
    expect(w.get('[data-testid="fumaca-impressao"]').attributes('data-estado')).toBe('nulo');
    expect(w.get('[data-testid="impressao-bloqueio"]').text()).toContain('todas as tabelas');
    expect(w.find('[data-testid="chaves-nao-lidas"]').exists()).toBe(true);
    expect(w.find('[data-testid="chaves-esperadas"]').exists()).toBe(false);
    expect(w.find('[data-testid="filas-nenhuma"]').exists()).toBe(true);
  });

  it('API indisponível: alerta traduzido e nenhum dado', async () => {
    simular(503, { type: 'about:blank', title: 'Indisponível', status: 503 });
    const w = montar();
    await flushPromises();
    expect(w.get('[data-testid="fumaca-erro"]').text()).toContain('Não foi possível conferir o servidor');
    expect(w.find('[data-testid="fumaca-itens"]').exists()).toBe(false);
  });
});
