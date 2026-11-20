// @vitest-environment jsdom
// M58 (etapa 4): o cliente do painel da fachada valida pelo contrato (fora dele, recusa); os textos cobrem todo modo,
// superfície, escopo, necessidade e parâmetro do contrato, sem chave técnica nem o sistema anterior; a tela mostra o
// estado, a prontidão, o motor em dois tempos, as superfícies com os totais e as 78 operações com filtro; configurar
// manda um parâmetro por vez com justificativa e a senha (sem a senha no texto da tela) e, sem a permissão de
// configurar, o formulário não aparece.
import {
  CATALOGO_FACHADA,
  ESCOPOS_TOKEN_FACHADA,
  MODOS_FACHADA,
  NECESSIDADES_FACHADA,
  type PainelFachada,
  PARAMETROS_FACHADA,
  SUPERFICIES_FACHADA,
} from '@sgh/contratos';
import { criarI18n, instalarUi, resolverMarca, SanteSelecao } from '@sgh/ui';
import type { App } from 'vue';
import { QueryClient, VueQueryPlugin } from '@tanstack/vue-query';
import { flushPromises, mount } from '@vue/test-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { mensagensWeb } from '../../i18n/pt-BR.js';
import { configurarFachada, lerPainelFachada } from './api-fachada.js';
import { mensagensFachada as m } from './i18n-fachada.js';
import Tela from './telas/FachadaTela.vue';

afterEach(() => vi.unstubAllGlobals());

// O combo (SanteSelecao, Select do OpenVue) usa matchMedia e ResizeObserver, que o jsdom não tem.
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

const operacoes = CATALOGO_FACHADA.map((o) => ({
  id: o.id,
  superficie: o.superficie,
  metodo: o.metodo,
  caminho: o.caminho,
  escreve: o.escreve,
  modo: o.servidaPeloSante ? ('servida' as const) : ('desligada' as const),
  motivo: o.servidaPeloSante ? null : 'Sem endereço de repasse configurado.',
  operacoesSgh: o.operacoesSgh.map((nome) => ({ nome, estado: 'verde' })),
  chamadas: o.caminho === '/medicos' ? 7 : 0,
  erros: 0,
}));
const conta = (modo: string) => operacoes.filter((o) => o.modo === modo).length;

function painel(configurar = true): PainelFachada {
  return {
    hospital: 'pc',
    versaoContrato: '0.23.0',
    necessidade: {
      situacao: 'necessaria',
      motivo: 'O banco vai para UTF-8 e a API da Hal-AI não acompanhou.',
    },
    configuracao: { ligada: false, escrita: false, superficies: [...SUPERFICIES_FACHADA], destino: null },
    destinoConfigurado: false,
    superficies: SUPERFICIES_FACHADA.map((superficie) => {
      const doGrupo = operacoes.filter((o) => o.superficie === superficie);
      return {
        superficie,
        ligada: false,
        escopo: superficie === 'gestao' ? 'gestao' : superficie === 'auditoria' ? 'auditoria' : 'principal',
        tokenConfigurado: superficie !== 'auditoria',
        operacoes: doGrupo.length,
        servidas: doGrupo.filter((o) => o.modo === 'servida').length,
        repassadas: 0,
        desligadas: doGrupo.filter((o) => o.modo === 'desligada').length,
      };
    }),
    operacoes,
    motor: { pendentes: 2, validadeMinutos: 15, maxPropostas: 500 },
    prontidaoUtf8: {
      pronta: false,
      usadasNaoServidas: ['GET /medicos'],
      motivo: 'Uma operação usada pelos Squads ainda não é servida aqui.',
    },
    totais: {
      operacoes: operacoes.length,
      servidas: conta('servida'),
      repassadas: 0,
      desligadas: conta('desligada'),
    },
    usoDesde: '2026-10-28T12:00:00.000Z',
    pode: { configurar },
  };
}

function responder(corpo: unknown, status = 200) {
  const f = vi.fn(async () => new Response(JSON.stringify(corpo), { status }));
  vi.stubGlobal('fetch', f);
  return f;
}

function textos(o: unknown, caminho = ''): Array<[string, string]> {
  if (typeof o === 'string') return [[caminho, o]];
  if (o && typeof o === 'object')
    return Object.entries(o).flatMap(([k, v]) => textos(v, caminho ? `${caminho}.${k}` : k));
  return [];
}

async function montar() {
  const w = mount(Tela, {
    global: {
      plugins: [
        criarI18n(mensagensWeb as unknown as Record<string, unknown>),
        { install: (app: App) => instalarUi(app, resolverMarca(undefined).pacote) },
        [VueQueryPlugin, { queryClient: new QueryClient({ defaultOptions: { queries: { retry: false } } }) }],
      ],
    },
  });
  await flushPromises();
  return w;
}

describe('fachada (cliente)', () => {
  it('o painel é validado pelo contrato; fora dele, recusa', async () => {
    responder(painel());
    expect((await lerPainelFachada()).operacoes).toHaveLength(78);
    responder({ ...painel(), operacoes: [{ ...operacoes[0], modo: 'outro' }] });
    await expect(lerPainelFachada()).rejects.toThrow();
  });

  it('configurar manda CSRF, Idempotency-Key e o corpo do contrato', async () => {
    const f = responder({
      chave: PARAMETROS_FACHADA.ligada,
      valor: 'sim',
      configuracao: { ligada: true, escrita: false, superficies: ['saude'], destino: null },
      mensagem: 'Configuração da fachada gravada.',
    });
    const r = await configurarFachada({
      chave: PARAMETROS_FACHADA.ligada,
      valor: 'sim',
      justificativa: 'ligar no ensaio sintético',
      senha: 'x',
    });
    expect(r.configuracao.ligada).toBe(true);
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('/api/administracao/integracoes/fachada/configuracao');
    const h = init.headers as Record<string, string>;
    expect(h['idempotency-key']).toMatch(/^web-fachada-/);
    expect('x-csrf' in h).toBe(true);
  });
});

describe('textos da fachada', () => {
  it('todo código do contrato tem texto', () => {
    for (const s of SUPERFICIES_FACHADA) expect(m.superficies[s]).toBeTruthy();
    for (const e of ESCOPOS_TOKEN_FACHADA) expect(m.escopos[e]).toBeTruthy();
    for (const x of MODOS_FACHADA) expect(m.modos[x]).toBeTruthy();
    for (const n of NECESSIDADES_FACHADA) expect(m.necessidades[n]).toBeTruthy();
    expect(Object.keys(m.configurar.parametros).sort()).toEqual(Object.keys(PARAMETROS_FACHADA).sort());
  });

  it('nenhum texto cita o sistema anterior nem expõe chave técnica de parâmetro', () => {
    const ruins = textos(m).filter(([, t]) =>
      /spdata|legado|sistema (atual|antigo|anterior)|integracao\.fachada/i.test(t),
    );
    expect(ruins).toEqual([]);
  });

  it('as chaves estão registradas nas mensagens da aplicação', () => {
    expect((mensagensWeb as unknown as { fachada: unknown }).fachada).toBe(m);
  });
});

describe('tela da fachada', () => {
  it('mostra o estado, a prontidão, o motor, as superfícies com os totais e as 78 operações', async () => {
    responder(painel());
    const w = await montar();
    expect(w.get('[data-testid="estado-ligada"]').text()).toBe(m.desligada);
    expect(w.get('[data-testid="estado-escrita"]').text()).toBe(m.desligada);
    expect(w.get('[data-testid="estado-destino"]').text()).toContain('não configurado');
    expect(w.get('[data-testid="cartao-necessidade"]').text()).toContain(m.necessidades.necessaria);
    expect(w.get('[data-testid="usadas-nao-servidas"]').text()).toContain('GET /medicos');
    expect(w.get('[data-testid="cartao-motor"]').text()).toContain('15 minutos');
    expect(w.findAll('[data-testid^="superficie-"]')).toHaveLength(5);
    expect(w.get('[data-testid="superficies-total"]').text()).toContain('78');
    expect(w.findAll('[data-testid="tabela-operacoes-fachada"] tbody tr')).toHaveLength(78);
    expect(w.get('[data-testid="filtro-contagem"]').text()).toContain('78 de 78');
    expect(w.text()).not.toMatch(/spdata|legado/i);
  });

  it('o filtro por modo e por caminho reduz a lista', async () => {
    responder(painel());
    const w = await montar();
    await w.get('[data-testid="filtro-busca"] input').setValue('/convenios');
    const linhas = w.findAll('[data-testid="tabela-operacoes-fachada"] tbody tr');
    expect(linhas.length).toBeGreaterThan(0);
    expect(linhas.length).toBeLessThan(78);
    for (const l of linhas) expect(l.text()).toContain('/convenios');
    await w.get('[data-testid="filtro-busca"] input').setValue('/nao-existe-sintetico');
    expect(w.text()).toContain(m.filtros.nenhuma);
  });

  it('configurar envia o parâmetro com justificativa e senha e limpa a senha depois', async () => {
    const f = vi.fn(async (_url: string, init?: RequestInit) =>
      init?.method === 'POST'
        ? new Response(
            JSON.stringify({
              chave: PARAMETROS_FACHADA.ligada,
              valor: 'sim',
              configuracao: { ...painel().configuracao, ligada: true },
              mensagem: 'ok',
            }),
            { status: 200 },
          )
        : new Response(JSON.stringify(painel()), { status: 200 }),
    );
    vi.stubGlobal('fetch', f);
    const w = await montar();
    expect((w.get('[data-testid="fachada-sim"]').element as HTMLInputElement).checked).toBe(true);
    await w
      .get('[data-testid="fachada-justificativa"] textarea, [data-testid="fachada-justificativa"] input')
      .setValue('ligar no ensaio sintético');
    await w.get('[data-testid="fachada-senha"]').setValue('segredo-sintetico');
    await w.get('form').trigger('submit');
    await flushPromises();
    const post = f.mock.calls.find(([, i]) => i?.method === 'POST');
    expect(post).toBeTruthy();
    expect(JSON.parse(String(post![1]!.body))).toEqual({
      chave: PARAMETROS_FACHADA.ligada,
      valor: 'sim',
      justificativa: 'ligar no ensaio sintético',
      senha: 'segredo-sintetico',
    });
    expect((w.get('[data-testid="fachada-senha"]').element as HTMLInputElement).value).toBe('');
    expect(w.get('[data-testid="fachada-gravado"]').text()).toContain(m.configurar.parametros.ligada);
    expect(w.text()).not.toContain('segredo-sintetico');
  });

  it('ligar a escrita mostra o aviso; superfícies viram lista separada por vírgula', async () => {
    responder(painel());
    const w = await montar();
    const sel = w.findAllComponents(SanteSelecao)[2]!; // superfície, modo (filtros) e o parâmetro
    sel.vm.$emit('update:modelValue', PARAMETROS_FACHADA.escrita);
    await flushPromises();
    await w.get('[data-testid="fachada-sim"]').setValue(true);
    expect(w.find('[data-testid="fachada-aviso-escrita"]').exists()).toBe(true);
    sel.vm.$emit('update:modelValue', PARAMETROS_FACHADA.superficies);
    await flushPromises();
    expect(w.findAll('[data-testid^="fachada-superficie-"]')).toHaveLength(5);
  });

  it('sem a permissão de configurar, o formulário não aparece', async () => {
    responder(painel(false));
    const w = await montar();
    expect(w.find('[data-testid="fachada-sem-permissao"]').exists()).toBe(true);
    expect(w.find('[data-testid="fachada-senha"]').exists()).toBe(false);
  });
});
