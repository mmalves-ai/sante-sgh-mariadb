// @vitest-environment jsdom
// Tela "Carga e sincronismo" (obra carga-painel, ADR 0010): cliente da API (CSRF só nas gravações, contratos, log) e
// a tela (seleção do conector, progresso por linhas com a barra segmentada gravado/recusado/restante, erros, ondas,
// tabela atual animada só com a execução ativa, batimento atrasado, top recusas, polling de 2 s só enquanto ativa,
// senha write-only, Testar conexão, Pausar). Dados sintéticos.
import { criarI18n, instalarUi, resolverMarca } from '@sgh/ui';
import { flushPromises, mount } from '@vue/test-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { App } from 'vue';
import { createMemoryHistory, createRouter, type Router } from 'vue-router';
import { mensagensWeb } from '../../i18n/pt-BR.js';
import {
  acessoDaCarga,
  cargaAtiva,
  gravarOrigemServidor,
  iniciarCarga,
  lerCarga,
  partesEndereco,
  segmentosCarga,
  velocidadeConferencia,
  duracaoTexto,
  urlLogCarga,
} from './api-carga.js';
import CargaSincronismoTela from './telas/CargaSincronismoTela.vue';

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
const i18n = () => criarI18n(mensagensWeb as unknown as Record<string, unknown>);

const execucao = (o: Record<string, unknown> = {}) => ({
  id: 12,
  tipo: 'importar',
  modo: 'completa',
  estado: 'gravando',
  etapa: 'onda 2 de 5',
  percentual: 40,
  motivoFalha: null,
  solicitadoEm: '2026-11-24T10:00:00.000Z',
  iniciadoEm: '2026-11-24T10:00:01.000Z',
  concluidoEm: null,
  batimentoEm: '2026-11-24T10:05:00.000Z',
  pausaSolicitadaEm: null,
  temLog: true,
  ...o,
});
const progresso = {
  tabelaAtual: 'atendimento',
  tabelaOrigemLinhas: 5000,
  tabelaProcessadas: 1200,
  onda: 2,
  ondas: 5,
  tabelasFeitas: 30,
  tabelasTotal: 120,
  linhasTotal: 10000,
  linhasProcessadas: 4000,
  gravadas: 3000,
  puladasIguais: 500,
  recusadas: 500,
  pendenciasAviso: 7,
  recusasPorRegra: { restricao_destino_1048: 500 },
  recusasPorTabela: [
    { tabela: 'prescricao_item', recusadas: 120 },
    { tabela: 'atendimento', recusadas: 380 },
  ],
  atualizadoEm: '2026-11-24T10:05:00.000Z',
};
const cargaAtivaResp = (o: Record<string, unknown> = {}) => ({
  codigo: 'prontocardio',
  execucao: execucao(),
  progresso,
  batimentoAtrasado: false,
  conciliacaoCarga: null,
  acoes: { iniciar: false, pausar: true, retomar: false },
  ...o,
});
const conectores = {
  conectores: [
    {
      codigo: 'outro',
      nome: 'Outro hospital',
      origem: null,
      ultimaExecucao: null,
    },
    {
      codigo: 'prontocardio',
      nome: 'Hospital sintético',
      origem: {
        tipo: 'firebird_servidor',
        nomeExibicao: 'Base sintética',
        endereco: 'fb-sintetico:3050/base_sintetica',
        senhaDefinida: true,
      },
      ultimaExecucao: execucao(),
    },
  ],
};

type Rota = (url: string, init: RequestInit) => unknown;
/** GET /api/plataforma/eu da conta da plataforma (ADR 0021), sintética. */
const EU = (papel: 'PLATAFORMA' | 'SUPORTE') => ({
  conta: { id: '41', email: 'conta@exemplo.test', nome: null, papel },
  podeEntrarComo: true,
  podeDesignar: papel === 'PLATAFORMA',
  expiraEm: '2026-11-24T23:00:00.000Z',
  segundoFatorObrigatorio: true,
});
/** GET /api/sessao do hospital, sintética: o administrador da plataforma (ator 'plataforma') ou um usuário. */
const SESSAO = (ator: boolean) => ({
  usuario: {
    id: ator ? 'plataforma:7' : '15',
    nome: 'Pessoa sintética',
    ...(ator ? { ator: 'plataforma' } : {}),
  },
  rede: null,
  estabelecimentos: [],
  estabelecimentoAtivo: null,
  permissoes: ['config.conexao.ler'],
  sintetica: true,
  bloqueioInatividadeSegundos: 0,
});
/** Sem a rota no mapa: a conta da plataforma com papel plataforma (o caso do dono). */
function servidor(rotasDadas: Record<string, Rota>) {
  const rotas: Record<string, Rota> = { 'GET /api/plataforma/eu': () => EU('PLATAFORMA'), ...rotasDadas };
  const f = vi.fn(async (url: string, init: RequestInit = {}) => {
    const chave = `${init.method ?? 'GET'} ${url}`;
    const r = rotas[chave];
    if (!r) return new Response(JSON.stringify({ title: `sem rota ${chave}`, status: 404 }), { status: 404 });
    let corpo: unknown;
    try {
      corpo = r(url, init);
    } catch (resposta) {
      if (resposta instanceof Response) return resposta;
      throw resposta;
    }
    return new Response(JSON.stringify(corpo), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  });
  vi.stubGlobal('fetch', f);
  return f;
}
const B = '/api/plataforma/carga';
const Vazia = { template: '<div />' };
let roteador: Router;
const montar = () => {
  roteador = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/plataforma/carga', component: Vazia },
      { path: '/plataforma/entrar', component: Vazia },
    ],
  });
  void roteador.push('/plataforma/carga');
  return mount(CargaSincronismoTela, {
    global: { plugins: [i18n(), ui, roteador] },
    attachTo: document.body,
  });
};
const chamadas = (f: ReturnType<typeof servidor>, chave: string) =>
  f.mock.calls.filter(([u, i]) => `${(i as RequestInit | undefined)?.method ?? 'GET'} ${u}` === chave);
/** Responde com o erro (Problem Details) na rota dada. */
const falha = (status: number) => () => {
  throw new Response(JSON.stringify({ title: 'Recusado', status }), { status });
};

/** Responde "Sim" no diálogo de confirmação do SanteBotao destrutivo ("Confirmar", último botão do rodapé). */
async function confirmar() {
  const bs = document.querySelectorAll<HTMLElement>('[data-testid="confirmacao"] button');
  expect(bs.length).toBeGreaterThan(0);
  bs[bs.length - 1]!.click();
  await flushPromises();
  await flushPromises();
}

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  document.body.innerHTML = '';
});

describe('api da tela de carga', () => {
  it('lê sem CSRF, grava com CSRF; a senha vai só no PUT; log pelo endereço da execução', async () => {
    const f = servidor({
      [`GET ${B}/clientes/prontocardio/carga`]: () => cargaAtivaResp(),
      [`PUT ${B}/clientes/prontocardio/origem-servidor`]: () => ({
        host: 'fb-sintetico',
        porta: 3050,
        banco: 'base_sintetica',
        usuario: 'LEITOR',
        nomeExibicao: 'Base sintética',
        senhaDefinida: true,
      }),
      [`POST ${B}/clientes/prontocardio/carga`]: () => ({ execucao: 13 }),
    });
    expect((await lerCarga('prontocardio')).progresso?.linhasTotal).toBe(10000);
    const [, ig] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(JSON.stringify(ig.headers)).not.toContain('x-csrf');
    const o = await gravarOrigemServidor('prontocardio', {
      host: 'fb-sintetico',
      porta: 3050,
      banco: 'base_sintetica',
      usuario: 'LEITOR',
      senha: 'segredo-sintetico',
      nomeExibicao: 'Base sintética',
    });
    expect(o).not.toHaveProperty('senha');
    const [, ip] = f.mock.calls[1] as unknown as [string, RequestInit];
    expect(JSON.stringify(ip.headers)).toContain('x-csrf');
    await iniciarCarga('prontocardio', 'diferencial');
    const [u3, i3] = f.mock.calls[2] as unknown as [string, RequestInit];
    expect([u3, i3.method, i3.body]).toEqual([
      `${B}/clientes/prontocardio/carga`,
      'POST',
      '{"modo":"diferencial"}',
    ]);
    expect(urlLogCarga('prontocardio', 12)).toBe(`${B}/clientes/prontocardio/carga/12/log`);
  });

  it('segmentos por linhas: gravado = gravadas + iguais, recusado, restante; erros sobre o total', () => {
    const s = segmentosCarga(progresso as never);
    expect(s).toMatchObject({
      percentual: 40,
      gravado: 35,
      recusado: 5,
      restante: 60,
      linhasGravadas: 3500,
      linhasRecusadas: 500,
      linhasRestantes: 6000,
      percentualErros: 5,
    });
    // Sem total de linhas (plano ainda não contado): usa o percentual da execução.
    expect(segmentosCarga(null, 12.7)).toMatchObject({
      percentual: 12,
      gravado: 12,
      recusado: 0,
      restante: 88,
    });
    // Nunca passa de 100.
    const cheio = segmentosCarga({ ...progresso, gravadas: 9900, puladasIguais: 0, recusadas: 900 } as never);
    expect(cheio.gravado + cheio.recusado + cheio.restante).toBeCloseTo(100);
    expect(cheio.percentual).toBe(100);
  });

  it('ativa só na fila, lendo, gravando, conciliando e pausando; endereço do servidor em partes', () => {
    expect(cargaAtiva('pausando')).toBe(true);
    expect(cargaAtiva('gravando')).toBe(true);
    expect(cargaAtiva('pausada')).toBe(false);
    expect(cargaAtiva('concluida')).toBe(false);
    expect(cargaAtiva(null)).toBe(false);
    expect(partesEndereco('10.0.0.5:3050/C:\\dados\\base.fdb')).toEqual({
      host: '10.0.0.5',
      porta: 3050,
      banco: 'C:\\dados\\base.fdb',
    });
    expect(partesEndereco('origens/base.fdb')).toBeNull();
  });

  it('com a situação da base, a barra é na base / recusadas / faltam (não o andamento da execução)', () => {
    const s = segmentosCarga({
      tabelasFeitas: 0,
      tabelasTotal: 2,
      linhasTotal: 1000,
      linhasProcessadas: 10,
      gravadas: 0,
      puladasIguais: 10,
      recusadas: 0,
      pendenciasAviso: 0,
      base: {
        linhasOrigem: 1000,
        linhasNaBase: 900,
        linhasRecusadas: 50,
        linhasFaltam: 50,
        tabelas: 2,
        tabelasLidasNesta: 0,
        tabelasSemSituacao: 0,
      },
    });
    expect(s).toMatchObject({ daBase: true, percentual: 90, gravado: 90, recusado: 5, restante: 5 });
    expect(s).toMatchObject({ linhasGravadas: 900, linhasRecusadas: 50, linhasRestantes: 50 });
  });

  it('velocidade pela diferença entre batimentos e previsão de término', () => {
    const v = velocidadeConferencia({ linhas: 1000, em: 0 }, { linhas: 16000, em: 1000 * 1 }, 31000);
    expect(v).toEqual({ linhasPorSegundo: 15000, segundosRestantes: 1 });
    expect(velocidadeConferencia(null, { linhas: 1, em: 1 }, 10)).toBeNull();
    expect(velocidadeConferencia({ linhas: 5, em: 0 }, { linhas: 5, em: 1000 }, 10)).toBeNull();
    expect(duracaoTexto(10)).toBe('menos de 1 min');
    expect(duracaoTexto(12 * 60)).toBe('12 min');
    expect(duracaoTexto(3 * 3600 + 5 * 60)).toBe('3 h 05 min');
  });
});

describe('tela Carga e sincronismo', () => {
  it('ao montar escolhe o conector com carga ativa e mostra o andamento (barra, erros, ondas, top recusas)', async () => {
    servidor({
      [`GET ${B}/conectores`]: () => conectores,
      [`GET ${B}/clientes/prontocardio/carga`]: () => cargaAtivaResp(),
    });
    const w = montar();
    await flushPromises();
    await flushPromises();
    expect(w.find('[data-testid="carga-origem-endereco"]').text()).toBe('fb-sintetico:3050/base_sintetica');
    expect(w.find('[data-testid="carga-origem-senha"]').text()).toBe('definida');
    const barra = w.find('[role="progressbar"]');
    expect(barra.attributes('aria-valuenow')).toBe('40');
    expect(barra.attributes('aria-valuetext')).toContain('500 recusadas');
    expect(w.find('[data-testid="seg-gravado"]').attributes('style')).toContain('width: 35%');
    expect(w.find('[data-testid="seg-recusado"]').attributes('style')).toContain('width: 5%');
    expect(w.find('[data-testid="carga-percentual"]').text()).toBe('40%');
    expect(w.find('[data-testid="carga-tabela-atual"]').classes()).toContain('carga__tabela--ativa');
    expect(w.find('[data-testid="carga-tabela-atual"]').text()).toContain('atendimento');
    expect(w.find('[data-testid="carga-erros"]').text()).toContain('500 recusadas (5% do total)');
    expect(w.find('[role="meter"]').attributes('aria-valuenow')).toBe('5');
    expect(w.find('[data-testid="carga-onda"]').text()).toBe('Onda 2 de 5');
    expect(w.find('[data-testid="carga-tabelas"]').text()).toBe('30 de 120 tabelas');
    const linhas = w.findAll('[data-testid="carga-top-recusas"] tbody tr').map((r) => r.text());
    expect(linhas[0]).toContain('atendimento');
    expect(w.find('[data-testid="carga-log"]').attributes('href')).toBe(
      `${B}/clientes/prontocardio/carga/12/log`,
    );
    expect(w.find('[data-testid="carga-batimento"]').exists()).toBe(false);
    expect(w.find('[data-testid="carga-pausar"]').attributes('disabled')).toBeUndefined();
    expect(w.find('[data-testid="carga-iniciar"]').attributes('disabled')).toBeDefined();
    expect(w.html()).not.toMatch(/<select/);
    w.unmount();
  });

  it('acompanha a cada 2 s só enquanto ativa; ao concluir para e relê os conectores; batimento atrasado avisa', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    let n = 0;
    const f = servidor({
      [`GET ${B}/conectores`]: () => conectores,
      [`GET ${B}/clientes/prontocardio/carga`]: () => {
        n++;
        if (n === 1) return cargaAtivaResp({ batimentoAtrasado: true });
        return cargaAtivaResp({
          execucao: execucao({
            estado: 'concluida',
            concluidoEm: '2026-11-24T11:00:00.000Z',
            percentual: 100,
          }),
          progresso: { ...progresso, tabelaAtual: null, linhasProcessadas: 10000, gravadas: 9500 },
          conciliacaoCarga: { recusadas: 500, conferido: false },
          acoes: { iniciar: true, pausar: false, retomar: false },
        });
      },
    });
    const w = montar();
    await flushPromises();
    await flushPromises();
    expect(w.find('[data-testid="carga-batimento"]').exists()).toBe(true);
    vi.advanceTimersByTime(2000);
    await flushPromises();
    await flushPromises();
    expect(w.find('[data-testid="carga-estado"]').text()).toBe('Concluída');
    expect(w.find('[data-testid="carga-conciliacao"]').text()).toContain(
      '500 linhas recusadas, não conferida',
    );
    expect(chamadas(f, `GET ${B}/conectores`)).toHaveLength(2);
    vi.advanceTimersByTime(6000);
    await flushPromises();
    expect(chamadas(f, `GET ${B}/clientes/prontocardio/carga`)).toHaveLength(2);
    w.unmount();
  });

  it('pausar é POST com CSRF e relê o andamento; pausada oferece Retomar e não anima', async () => {
    let pausou = false;
    const f = servidor({
      [`GET ${B}/conectores`]: () => conectores,
      [`GET ${B}/clientes/prontocardio/carga`]: () =>
        pausou
          ? cargaAtivaResp({
              execucao: execucao({ estado: 'pausada', concluidoEm: '2026-11-24T10:06:00.000Z' }),
              acoes: { iniciar: true, pausar: false, retomar: true },
            })
          : cargaAtivaResp(),
      [`POST ${B}/clientes/prontocardio/carga/pausar`]: () => {
        pausou = true;
        return { ok: true };
      },
    });
    const w = montar();
    await flushPromises();
    await flushPromises();
    await w.find('[data-testid="carga-pausar"]').trigger('click');
    await flushPromises();
    expect(chamadas(f, `POST ${B}/clientes/prontocardio/carga/pausar`)).toHaveLength(0);
    expect(document.querySelector('[data-testid="confirmacao"]')?.textContent).toContain(
      'Pausar a carga do cliente prontocardio?',
    );
    await confirmar();
    const [, init] = chamadas(f, `POST ${B}/clientes/prontocardio/carga/pausar`)[0] as unknown as [
      string,
      RequestInit,
    ];
    expect(JSON.stringify(init.headers)).toContain('x-csrf');
    expect(w.find('[data-testid="carga-pausada"]').exists()).toBe(true);
    expect(w.find('[data-testid="carga-retomar"]').attributes('disabled')).toBeUndefined();
    expect(w.find('[data-testid="carga-tabela-atual"]').classes()).not.toContain('carga__tabela--ativa');
    w.unmount();
  });

  it('configurar origem: senha write-only (vai no PUT, some do campo, nunca aparece) e Testar conexão', async () => {
    const corpos: string[] = [];
    servidor({
      [`GET ${B}/conectores`]: () => conectores,
      [`GET ${B}/clientes/prontocardio/carga`]: () => cargaAtivaResp(),
      [`PUT ${B}/clientes/prontocardio/origem-servidor`]: (_u, i) => {
        corpos.push(String(i.body));
        return {
          host: 'fb-sintetico',
          porta: 3050,
          banco: 'base_sintetica',
          usuario: 'LEITOR',
          nomeExibicao: 'Base sintética',
          senhaDefinida: true,
        };
      },
      [`POST ${B}/clientes/prontocardio/origem-servidor/testar`]: () => ({
        ok: true,
        versaoServidor: '3.0.14',
        ods: '12.0',
        tabelas: 3824,
        mensagem: 'ok',
      }),
    });
    const w = montar();
    await flushPromises();
    await flushPromises();
    await w.find('[data-testid="carga-configurar"]').trigger('click');
    expect(w.find('#carga-host').element).toBeTruthy();
    expect((w.find('#carga-host').element as HTMLInputElement).value).toBe('fb-sintetico');
    expect((w.find('[data-testid="carga-porta"]').element as HTMLInputElement).value).toBe('3050');
    expect(w.find('[data-testid="carga-senha"]').attributes('type')).toBe('password');
    expect(w.find('[data-testid="carga-senha-ajuda"]').text()).toContain('Deixe em branco para manter');
    await w.find('#carga-usuario').setValue('LEITOR');
    await w.find('[data-testid="carga-senha"]').setValue('segredo-sintetico');
    await w.find('[data-testid="carga-gravar-origem"]').trigger('click');
    await flushPromises();
    await flushPromises();
    expect(corpos).toHaveLength(1);
    expect(JSON.parse(corpos[0]!)).toMatchObject({ host: 'fb-sintetico', porta: 3050, usuario: 'LEITOR' });
    expect(JSON.parse(corpos[0]!).senha).toBe('segredo-sintetico');
    expect((w.find('[data-testid="carga-senha"]').element as HTMLInputElement).value).toBe('');
    expect(w.html()).not.toContain('segredo-sintetico');
    await w.find('[data-testid="carga-testar"]').trigger('click');
    await flushPromises();
    expect(w.find('[data-testid="carga-teste"]').text()).toContain('3.824 tabelas');
    w.unmount();
  });

  it('iniciar pede confirmação: o primeiro clique não faz o POST; o POST sai só depois de Confirmar', async () => {
    const parada = () =>
      cargaAtivaResp({
        execucao: execucao({ estado: 'concluida', concluidoEm: '2026-11-24T11:00:00.000Z', percentual: 100 }),
        acoes: { iniciar: true, pausar: false, retomar: false },
      });
    const f = servidor({
      [`GET ${B}/conectores`]: () => conectores,
      [`GET ${B}/clientes/prontocardio/carga`]: parada,
      [`POST ${B}/clientes/prontocardio/carga`]: () => ({ execucao: 22 }),
    });
    const w = montar();
    await flushPromises();
    await flushPromises();
    await w.find('[data-testid="carga-iniciar"]').trigger('click');
    await flushPromises();
    expect(chamadas(f, `POST ${B}/clientes/prontocardio/carga`)).toHaveLength(0);
    expect(document.querySelector('[data-testid="confirmacao"]')?.textContent).toContain(
      'Iniciar a carga completa do cliente prontocardio?',
    );
    await confirmar();
    const posts = chamadas(f, `POST ${B}/clientes/prontocardio/carga`);
    expect(posts).toHaveLength(1);
    expect(JSON.parse(String((posts[0] as unknown as [string, RequestInit])[1].body))).toEqual({
      modo: 'completa',
    });
    w.unmount();
  });

  it('leitura que falha com a carga ativa não para o acompanhamento; a seguinte volta e limpa o alerta', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    let n = 0;
    const f = servidor({
      [`GET ${B}/conectores`]: () => conectores,
      [`GET ${B}/clientes/prontocardio/carga`]: () => {
        n++;
        if (n === 2) throw new TypeError('falha de rede');
        return cargaAtivaResp(
          n >= 3 ? { progresso: { ...progresso, linhasProcessadas: 900, tabelaAtual: 'internacao' } } : {},
        );
      },
    });
    const w = montar();
    await flushPromises();
    await flushPromises();
    vi.advanceTimersByTime(2000);
    await flushPromises();
    await flushPromises();
    expect(w.find('[data-testid="carga-erro"]').exists()).toBe(true);
    vi.advanceTimersByTime(2000);
    await flushPromises();
    await flushPromises();
    expect(chamadas(f, `GET ${B}/clientes/prontocardio/carga`)).toHaveLength(3);
    expect(w.find('[data-testid="carga-erro"]').exists()).toBe(false);
    expect(w.find('[data-testid="carga-tabela-atual"]').text()).toContain('internacao');
    w.unmount();
  });

  it('sessão que não é da plataforma (403) recebe o aviso claro, não o erro cru da API', async () => {
    servidor({ [`GET ${B}/conectores`]: falha(403) });
    const w = montar();
    await flushPromises();
    await flushPromises();
    expect(w.find('[data-testid="carga-erro"]').text()).toContain(
      'Esta tela é do administrador da plataforma',
    );
    expect(w.find('[data-testid="carga-erro"]').text()).not.toContain('Recusado');
    w.unmount();
  });
});

describe('guarda da tela (rota pública, como as da conta da plataforma)', () => {
  it('conta da plataforma com papel plataforma: carrega e grava com o CSRF da conta', async () => {
    document.cookie = 'sgh_pcsrf=tok-conta';
    document.cookie = 'sgh_csrf=tok-hospital';
    const f = servidor({
      [`GET ${B}/conectores`]: () => conectores,
      [`GET ${B}/clientes/prontocardio/carga`]: () => cargaAtivaResp(),
      [`POST ${B}/clientes/prontocardio/carga/pausar`]: () => ({ execucao: 12 }),
    });
    expect(await acessoDaCarga()).toBe('conta');
    const w = montar();
    await flushPromises();
    await flushPromises();
    expect(chamadas(f, `GET ${B}/conectores`).length).toBe(1);
    expect(chamadas(f, 'GET /api/sessao').length).toBe(0);
    await import('./api-carga.js').then((m) => m.pausarCarga('prontocardio'));
    const [, i] = chamadas(f, `POST ${B}/clientes/prontocardio/carga/pausar`).at(-1)!;
    expect((i as RequestInit).headers).toMatchObject({ 'x-csrf-plataforma': 'tok-conta' });
    expect((i as RequestInit).headers).not.toHaveProperty('x-csrf');
    w.unmount();
  });

  it('papel suporte: aviso claro, sem ler os conectores', async () => {
    const f = servidor({ 'GET /api/plataforma/eu': () => EU('SUPORTE') });
    const w = montar();
    await flushPromises();
    await flushPromises();
    expect(w.find('[data-testid="carga-erro"]').text()).toContain(
      'Esta tela é do administrador da plataforma',
    );
    expect(chamadas(f, `GET ${B}/conectores`).length).toBe(0);
    w.unmount();
  });

  it('administrador (sessão do hospital, ator plataforma): carrega e grava com o CSRF da sessão do hospital', async () => {
    document.cookie = 'sgh_csrf=tok-hospital';
    const f = servidor({
      'GET /api/plataforma/eu': falha(401),
      'GET /api/sessao': () => SESSAO(true),
      [`GET ${B}/conectores`]: () => conectores,
      [`GET ${B}/clientes/prontocardio/carga`]: () => cargaAtivaResp(),
      [`POST ${B}/clientes/prontocardio/carga/pausar`]: () => ({ execucao: 12 }),
    });
    const w = montar();
    await flushPromises();
    await flushPromises();
    expect(chamadas(f, `GET ${B}/conectores`).length).toBe(1);
    await import('./api-carga.js').then((m) => m.pausarCarga('prontocardio'));
    const [, i] = chamadas(f, `POST ${B}/clientes/prontocardio/carga/pausar`).at(-1)!;
    expect((i as RequestInit).headers).toHaveProperty('x-csrf');
    expect((i as RequestInit).headers).not.toHaveProperty('x-csrf-plataforma');
    w.unmount();
  });

  it('usuário do hospital que não é o administrador: aviso claro', async () => {
    const f = servidor({ 'GET /api/plataforma/eu': falha(401), 'GET /api/sessao': () => SESSAO(false) });
    const w = montar();
    await flushPromises();
    await flushPromises();
    expect(w.find('[data-testid="carga-erro"]').exists()).toBe(true);
    expect(chamadas(f, `GET ${B}/conectores`).length).toBe(0);
    w.unmount();
  });

  it('sem sessão nenhuma: vai ao login da plataforma', async () => {
    const f = servidor({ 'GET /api/plataforma/eu': falha(401), 'GET /api/sessao': falha(401) });
    const w = montar();
    await flushPromises();
    await flushPromises();
    expect(roteador.currentRoute.value.path).toBe('/plataforma/entrar');
    expect(chamadas(f, `GET ${B}/conectores`).length).toBe(0);
    w.unmount();
  });
});
