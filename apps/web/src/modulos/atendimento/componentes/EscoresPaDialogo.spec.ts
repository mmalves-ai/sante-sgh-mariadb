// @vitest-environment jsdom
// W0-07 (M1): o diálogo dos escores de deterioração do PA. O registro só liga com a aferição completa (a consciência
// inclusive) e manda os sinais em número (vírgula decimal aceita); o histórico mostra o estornado marcado com o motivo;
// o estorno só liga com o motivo e, com o relançamento marcado, manda os sinais certos na mesma chamada. Sintético.
import { esquemaEscoresPaDoAtendimento } from '@sgh/contratos';
import { criarI18n, instalarUi, resolverMarca } from '@sgh/ui';
import { QueryClient, VueQueryPlugin } from '@tanstack/vue-query';
import { flushPromises, mount } from '@vue/test-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { type App, nextTick } from 'vue';
import { createMemoryHistory, createRouter } from 'vue-router';
import { mensagensWeb } from '../../../i18n/pt-BR.js';
import EscoresPaDialogo from './EscoresPaDialogo.vue';

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

const SINAIS = {
  fr: 24,
  spo2: 95,
  o2: 0,
  pas: 98,
  fc: 112,
  consciencia: 'A',
  temperatura: 38.3,
  leucocitos: null,
  bastoes10: null,
};
const parcial = (total: number, completo = true) => ({
  total,
  completo,
  faltando: completo ? [] : ['leucocitos'],
});
const escore = (id: number, estorno: boolean) => ({
  id,
  origem: 'reavaliacao',
  sinais: SINAIS,
  news2: parcial(8),
  qsofa: parcial(2),
  sirs: parcial(3, false),
  nivel: 'alto',
  sugereSepse: true,
  limiares: { news2: 5, qsofa: 2 },
  substitui: null,
  motivo: null,
  aferidoEm: '2026-11-18T10:00:00',
  usuario: 'SINT.ENFERMEIRO.PA',
  estorno: estorno
    ? { motivo: 'Paciente trocado', usuario: 'SINT.ENFERMEIRO.PA', em: '2026-11-18T10:05:00' }
    : null,
});
const dados = {
  reg: 9001,
  limiares: { news2: 5, qsofa: 2 },
  sinaisRecentes: { ...SINAIS, o2: null, consciencia: null },
  alerta: {
    id: 2,
    origem: 'reavaliacao',
    news2: parcial(8),
    qsofa: parcial(2),
    sirs: parcial(3, false),
    nivel: 'alto',
    sugereSepse: true,
    motivoSepse: ['news2', 'qsofa'],
    aferidoEm: '2026-11-18T10:00:00',
  },
  historico: [escore(2, false), escore(1, true)],
  atualizadoEm: '2026-11-18T10:10:00',
};
const RESULTADO = { ok: true, resultado: {}, repetida: false, mensagem: 'Escore estornado e relançado.' };

function servidor() {
  return vi.fn(async (_url: string, init?: RequestInit) => {
    const corpo = init?.method === 'POST' ? RESULTADO : dados;
    return new Response(JSON.stringify(corpo), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  });
}

const montar = () =>
  mount(EscoresPaDialogo, {
    props: { reg: 9001, paciente: 'PACIENTE SINTETICO', podeRegistrar: true, visivel: true },
    global: {
      plugins: [
        i18n(),
        ui,
        createRouter({
          history: createMemoryHistory(),
          routes: [{ path: '/:p(.*)*', component: { render: () => null } }],
        }),
        [VueQueryPlugin, { queryClient: new QueryClient({ defaultOptions: { queries: { retry: false } } }) }],
      ],
    },
    attachTo: document.body,
  });

const el = <T extends Element = HTMLElement>(testid: string) =>
  document.body.querySelector<T>(`[data-testid="${testid}"]`);
async function digitar(testid: string, valor: string): Promise<void> {
  const i = el<HTMLInputElement>(testid);
  expect(i, testid).not.toBeNull();
  const alvo =
    i!.tagName === 'INPUT' || i!.tagName === 'TEXTAREA' ? i! : i!.querySelector('input, textarea')!;
  (alvo as HTMLInputElement).value = valor;
  alvo.dispatchEvent(new Event('input', { bubbles: true }));
  await flushPromises();
}
const botao = (testid: string) => {
  const b = el(testid);
  return (b?.tagName === 'BUTTON' ? b : b?.querySelector('button')) as HTMLButtonElement;
};

afterEach(() => {
  vi.unstubAllGlobals();
  document.body.innerHTML = '';
});

describe('EscoresPaDialogo (W0-07, M1)', () => {
  it('os dados sintéticos passam pelo contrato', () => {
    expect(esquemaEscoresPaDoAtendimento.safeParse(dados).error?.issues ?? []).toEqual([]);
  });

  it('pré-preenche com os sinais recentes; o registro só liga com a aferição completa', async () => {
    vi.stubGlobal('fetch', servidor());
    montar();
    await flushPromises();
    await nextTick();
    expect(el('escores-pa-alerta')?.textContent).toContain('NEWS2 8 · qSOFA 2 · SIRS 3');
    expect(el<HTMLInputElement>('escores-pa-fr')?.value).toBe('24');
    expect(el<HTMLInputElement>('escores-pa-temperatura')?.value).toBe('38,3');
    // Falta o oxigênio? Não: o padrão é 0 (ar ambiente) só no formulário vazio; dos sinais recentes vem vazio.
    expect(botao('escores-pa-registrar').disabled).toBe(true);
  });

  it('o estorno liga com o motivo e manda o relançamento com os sinais certos', async () => {
    const f = servidor();
    vi.stubGlobal('fetch', f);
    montar();
    await flushPromises();
    el<HTMLButtonElement>('aba-escore-historico')!.click();
    await flushPromises();
    expect(el('escores-pa-historico')?.textContent).toMatch(
      /Estornado em 2026-11-18 10:05 por SINT.ENFERMEIRO.PA: Paciente trocado/,
    );
    expect(el('escore-pa-estornar-1')).toBeNull();
    botao('escore-pa-estornar-2').click();
    await flushPromises();
    await nextTick();
    expect(botao('escore-pa-estorno-confirmar').disabled).toBe(true);
    await digitar('escore-pa-estorno-motivo', 'Pressão com manguito errado');
    expect(botao('escore-pa-estorno-confirmar').disabled).toBe(false);
    const caixa = el<HTMLInputElement>('escore-pa-estorno-relancar')!;
    caixa.checked = true;
    caixa.dispatchEvent(new Event('change', { bubbles: true }));
    await flushPromises();
    await digitar('escore-pa-estorno-pas', '128');
    expect(botao('escore-pa-estorno-confirmar').disabled).toBe(false);
    botao('escore-pa-estorno-confirmar').click();
    await flushPromises();
    const post = f.mock.calls.find((c) => (c[1] as RequestInit | undefined)?.method === 'POST');
    expect(String(post?.[0])).toBe('/api/pa/9001/escores/estornar');
    expect(JSON.parse(String((post?.[1] as RequestInit).body))).toEqual({
      escore: 2,
      motivo: 'Pressão com manguito errado',
      relancar: { ...SINAIS, pas: 128 },
    });
  });
});
