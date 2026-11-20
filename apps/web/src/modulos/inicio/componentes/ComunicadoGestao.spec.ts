// @vitest-environment jsdom
// W0-09: a gestão do comunicado na tela (detalhe com destinatários e eventos; corrigir só o não lido; encurtar a
// vigência e encerrar sempre com motivo; o 409 do lido vira o texto da recusa). Dados sintéticos.
import { esquemaComunicadoDetalhe } from '@sgh/contratos';
import { criarI18n, instalarUi, resolverMarca } from '@sgh/ui';
import { QueryClient, VueQueryPlugin } from '@tanstack/vue-query';
import { flushPromises, mount } from '@vue/test-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { App } from 'vue';
import { mensagensWeb } from '../../../i18n/pt-BR.js';
import ComunicadoGestao from './ComunicadoGestao.vue';

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

const detalhe = (o: Record<string, unknown> = {}) => ({
  id: 7,
  remetente: 'GESTOR',
  assunto: 'Escala de dezembro',
  texto: 'A escala sai dia 25.',
  cienciaObrigatoria: true,
  publicadoEm: '2026-11-18T08:00:00',
  vigenciaInicio: '2026-11-18T08:00:00',
  vigenciaFim: '2026-12-31T23:00:00',
  encerradoEm: null,
  encerradoPor: null,
  motivoEncerramento: null,
  destinatarios: [
    { login: 'ANA', via: 'usuario', lidaEm: null, cienciaEm: null },
    { login: 'BETO', via: 'grupo MEDICOS', lidaEm: null, cienciaEm: null },
  ],
  eventos: [],
  podeCorrigir: true,
  ...o,
});

type Chamada = { url: string; metodo: string; corpo: unknown };
function servidor(inicial: unknown, gravar: (c: Chamada) => Response) {
  const chamadas: Chamada[] = [];
  const f = vi.fn(async (url: string, init?: RequestInit) => {
    const c = {
      url: String(url),
      metodo: init?.method ?? 'GET',
      corpo: init?.body ? JSON.parse(String(init.body)) : null,
    };
    chamadas.push(c);
    if (c.metodo === 'GET') return Response.json(inicial);
    return gravar(c);
  });
  vi.stubGlobal('fetch', f);
  return chamadas;
}
const montar = () =>
  mount(ComunicadoGestao, {
    props: { id: 7 },
    global: {
      plugins: [
        i18n(),
        ui,
        [VueQueryPlugin, { queryClient: new QueryClient({ defaultOptions: { queries: { retry: false } } }) }],
      ],
    },
    attachTo: document.body,
  });
const digitar = async (w: ReturnType<typeof montar>, testid: string, v: string) => {
  const el = w.find(`[data-testid="${testid}"] input, [data-testid="${testid}"] textarea`);
  await el.setValue(v);
};

afterEach(() => {
  vi.unstubAllGlobals();
  document.body.innerHTML = '';
});

it('os dados sintéticos passam pelo contrato', () => {
  expect(esquemaComunicadoDetalhe.safeParse(detalhe()).error?.issues ?? []).toEqual([]);
});

describe('gestão do comunicado (W0-09)', () => {
  it('mostra destinatários e corrige o texto não lido só com motivo', async () => {
    const chamadas = servidor(detalhe(), () => Response.json(detalhe({ texto: 'A escala sai dia 26.' })));
    const w = montar();
    await flushPromises();
    expect(w.get('[data-testid="comunicado-destinatarios"]').text()).toContain('BETO');
    await w.get('[data-testid="comunicado-corrigir"]').trigger('click');
    await digitar(w, 'comunicado-novo-texto', 'A escala sai dia 26.');
    await w.get('[data-testid="comunicado-form"]').trigger('submit');
    await flushPromises();
    expect(w.find('[data-testid="erro-motivo"]').exists()).toBe(true);
    expect(chamadas.filter((c) => c.metodo !== 'GET')).toHaveLength(0);
    await digitar(w, 'comunicado-motivo', 'data errada no texto');
    await w.get('[data-testid="comunicado-form"]').trigger('submit');
    await flushPromises();
    const put = chamadas.find((c) => c.metodo === 'PUT');
    expect(put?.url).toBe('/api/acesso/comunicados/7');
    expect(put?.corpo).toEqual({
      assunto: 'Escala de dezembro',
      texto: 'A escala sai dia 26.',
      motivo: 'data errada no texto',
    });
    expect(w.get('[data-testid="comunicado-feito"]').text()).toBe('Texto corrigido.');
  });

  it('lido: não oferece corrigir e explica que corrigir é encerrar e publicar outro', async () => {
    servidor(detalhe({ podeCorrigir: false }), () => new Response(null));
    const w = montar();
    await flushPromises();
    expect(w.find('[data-testid="comunicado-corrigir"]').exists()).toBe(false);
    expect(w.get('[data-testid="comunicado-nao-corrige"]').text()).toContain('encerre');
  });

  it('encurta a vigência com motivo e mostra a recusa do servidor', async () => {
    const chamadas = servidor(detalhe(), () =>
      Response.json(
        { type: 'about:blank', title: 'Conflito', status: 409, codigo: 'comunicado-ja-lido' },
        { status: 409, headers: { 'content-type': 'application/problem+json' } },
      ),
    );
    const w = montar();
    await flushPromises();
    await w.get('[data-testid="comunicado-encurtar"]').trigger('click');
    await w.get('[data-testid="comunicado-novo-fim"]').setValue('2026-12-20T18:00');
    await digitar(w, 'comunicado-motivo', 'evento antecipado');
    await w.get('[data-testid="comunicado-form"]').trigger('submit');
    await flushPromises();
    const post = chamadas.find((c) => c.metodo === 'POST');
    expect(post?.url).toBe('/api/acesso/comunicados/7/vigencia');
    expect(post?.corpo).toEqual({ vigenciaFim: '2026-12-20T18:00', motivo: 'evento antecipado' });
    expect(w.text()).toContain('já foi lido');
  });

  it('encerrado: mostra quem, quando e o motivo, com as ciências e o histórico, sem ações', async () => {
    servidor(
      detalhe({
        encerradoEm: '2026-11-18T10:00:00',
        encerradoPor: 'GESTOR',
        motivoEncerramento: 'publicado outro corrigido',
        podeCorrigir: false,
        destinatarios: [
          { login: 'ANA', via: 'usuario', lidaEm: '2026-11-18T09:00:00', cienciaEm: '2026-11-18T09:01:00' },
        ],
        eventos: [
          {
            evento: 'encerramento',
            antes: null,
            motivo: 'publicado outro corrigido',
            por: 'GESTOR',
            em: '2026-11-18T10:00:00',
          },
        ],
      }),
      () => new Response(null),
    );
    const w = montar();
    await flushPromises();
    expect(w.get('[data-testid="comunicado-encerrado"]').text()).toContain('publicado outro corrigido');
    expect(w.find('[data-testid="comunicado-encerrar"]').exists()).toBe(false);
    expect(w.get('[data-testid="comunicado-eventos"]').text()).toContain('Encerramento');
    expect(w.get('[data-testid="comunicado-destinatarios"]').text()).toContain('ANA');
  });
});
