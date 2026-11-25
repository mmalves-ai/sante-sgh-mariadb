// F3.8, 07-FIN linha 109 (telas, dados sintéticos, API simulada no fetch): na ficha do título a receber, a retenção do
// tomador vem sugerida pela regra, a soma é conferida na hora contra o saldo e um clique registra todos os tributos; o
// estorno pede o motivo. No painel fiscal, o saldo a compensar por tributo e a compensação na competência da tela. No
// cadastro da regra, o ISS só entra com o município do serviço, escolhido pelo nome.
import { criarI18n, instalarUi, resolverMarca } from '@sgh/ui';
import { QueryClient, VueQueryPlugin } from '@tanstack/vue-query';
import { flushPromises, mount } from '@vue/test-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { type App, type Component, nextTick } from 'vue';
import { mensagensWeb } from '../../../i18n/pt-BR.js';
import RetencaoSofridaTitulo from './RetencaoSofridaTitulo.vue';
import RetencoesPainel from './RetencoesPainel.vue';
import SaldoCompensarPainel from './SaldoCompensarPainel.vue';

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
const montar = (c: Component, props: Record<string, unknown>) =>
  mount(c, {
    props,
    global: {
      plugins: [
        criarI18n(mensagensWeb as unknown as Record<string, unknown>),
        ui,
        [VueQueryPlugin, { queryClient: new QueryClient({ defaultOptions: { queries: { retry: false } } }) }],
      ],
    },
    attachTo: document.body,
  });
const OK = { mensagem: 'Gravado.', repetida: false, avisos: [] };
const json = (c: unknown) =>
  new Response(JSON.stringify(c), { status: 200, headers: { 'content-type': 'application/json' } });
/** O fetch simulado: responde pela rota (função: a resposta muda depois de gravar) e guarda o corpo de cada POST. */
function api(rotas: Record<string, unknown | (() => unknown)>) {
  const enviados: { url: string; corpo: Record<string, unknown> }[] = [];
  const f = vi.fn(async (url: string, init?: RequestInit) => {
    const u = String(url);
    if (init?.method === 'POST') {
      enviados.push({ url: u, corpo: JSON.parse(String(init.body)) as Record<string, unknown> });
      return json(OK);
    }
    const caminho = u.split('?')[0]!;
    const chave = Object.keys(rotas).find((k) => caminho.endsWith(k));
    const r = chave ? rotas[chave] : [];
    return json(typeof r === 'function' ? (r as () => unknown)() : r);
  });
  vi.stubGlobal('fetch', f);
  return { f, enviados };
}
const digitar = async (w: ReturnType<typeof mount>, testid: string, valor: string) => {
  await w.get(`[data-testid="${testid}"]`).setValue(valor);
  await flushPromises();
};
const escolher = async (w: ReturnType<typeof mount>, testid: string, valor: string) => {
  await w.find(`[data-testid="${testid}"] [role="combobox"]`).trigger('click');
  await flushPromises();
  await nextTick();
  const opcao = document.body.querySelector<HTMLElement>(`[role="option"]:has([data-valor="${valor}"])`);
  expect(opcao, `opção ${valor} em ${testid}`).not.toBeNull();
  opcao!.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
  await flushPromises();
};

afterEach(() => {
  vi.unstubAllGlobals();
  document.body.innerHTML = '';
});

describe('retenção sofrida no recebimento (linha 109)', () => {
  const sugestao = (
    tributo: string,
    tributoId: number,
    aliquota: number,
    valor: number,
    dispensada = false,
  ) => ({
    tributo,
    tributoId,
    regra: tributoId,
    base: 2000,
    aliquota,
    valor,
    dispensada,
  });
  const aberto = {
    titulo: 7,
    versao: 'v0000000001',
    emAberto: true,
    valorFatura: 2000,
    saldoParcela: 2000,
    retido: 0,
    retencoes: [],
    sugestoes: [sugestao('IRRF', 5, 1.5, 30), sugestao('COFINS', 6, 3, 60), sugestao('ISS', 8, 0.1, 2, true)],
  };
  const registrado = {
    ...aberto,
    versao: 'v0000000002',
    saldoParcela: 1910,
    retido: 90,
    sugestoes: [],
    retencoes: [
      {
        id: 91,
        tributoId: 5,
        tributo: 'IRRF',
        base: 2000,
        aliquota: 1.5,
        valor: 30,
        data: '2026-10-10',
        compensada: false,
      },
      {
        id: 92,
        tributoId: 6,
        tributo: 'COFINS',
        base: 2000,
        aliquota: 3,
        valor: 60,
        data: '2026-10-10',
        compensada: true,
      },
    ],
  };

  it('sugestão da regra com a soma conferida na hora; um clique registra tudo e a baixa recebe o saldo novo', async () => {
    let atual: unknown = aberto;
    const { f, enviados } = api({ '/titulo/7': () => atual });
    const w = montar(RetencaoSofridaTitulo, { titulo: 7, data: '2026-10-10', pode: true });
    await flushPromises();
    expect(String(f.mock.calls[0]?.[0])).toBe('/api/financeiro/retencao-sofrida/titulo/7?data=2026-10-10');
    expect(w.find('[data-testid="rs-nenhuma"]').exists()).toBe(true);
    // A dispensada aparece com o motivo e sem campo; as outras já vêm com o valor da regra.
    expect(w.find('[data-testid="rs-valor-ISS"]').exists()).toBe(false);
    expect((w.get('[data-testid="rs-valor-IRRF"]').element as HTMLInputElement).value).toBe('30,00');
    expect(w.get('[data-testid="rs-total"]').text()).toContain('90,00');
    expect(w.get('[data-testid="rs-total"]').text()).toContain('1.910,00');
    // Validação na hora: a soma acima do saldo desliga o botão e diz por quê.
    await digitar(w, 'rs-valor-IRRF', '1.990,00');
    expect(w.find('[data-testid="rs-passa"]').exists()).toBe(true);
    expect(w.get('[data-testid="rs-registrar"]').attributes('disabled')).toBeDefined();
    await digitar(w, 'rs-valor-IRRF', '30,00');
    expect(w.get('[data-testid="rs-registrar"]').attributes('disabled')).toBeUndefined();
    atual = registrado;
    await w.get('[data-testid="rs-sugestao"]').trigger('submit');
    await flushPromises();
    expect(enviados.at(-1)?.url).toBe('/api/financeiro/retencao-sofrida/registrar');
    expect(enviados.at(-1)?.corpo).toEqual({
      titulo: 7,
      versao: 'v0000000001',
      data: '2026-10-10',
      itens: [
        { tributo: 5, base: 2000, aliquota: 1.5, valor: 30 },
        { tributo: 6, base: 2000, aliquota: 3, valor: 60 },
      ],
    });
    expect(w.emitted('saldo')?.at(-1)).toEqual([1910]);
    expect(w.get('[data-testid="rs-registradas"]').text()).toContain('IRRF');
    w.unmount();
  });

  it('estorno pede o motivo; a compensada não oferece estorno; sem permissão não registra', async () => {
    const { enviados } = api({ '/titulo/7': registrado });
    const w = montar(RetencaoSofridaTitulo, { titulo: 7, data: '2026-10-10', pode: true });
    await flushPromises();
    expect(w.find('[data-testid="rs-estornar-COFINS"]').exists()).toBe(false);
    await w.get('[data-testid="rs-estornar-IRRF"]').trigger('click');
    expect(w.get('[data-testid="rs-confirmar-estorno"]').attributes('disabled')).toBeDefined();
    await digitar(w, 'rs-motivo', 'Retido informado errado');
    await w.get('[data-testid="rs-confirmar-estorno"]').trigger('click');
    await flushPromises();
    expect(enviados.at(-1)).toEqual({
      url: '/api/financeiro/retencao-sofrida/estornar',
      corpo: { titulo: 7, retencao: 91, motivo: 'Retido informado errado' },
    });
    w.unmount();
    api({ '/titulo/7': aberto });
    const semPermissao = montar(RetencaoSofridaTitulo, { titulo: 7, data: '2026-10-10', pode: false });
    await flushPromises();
    expect(semPermissao.get('[data-testid="rs-registrar"]').attributes('disabled')).toBeDefined();
    semPermissao.unmount();
  });

  it('saldo a compensar por tributo; compensa na competência da tela; crédito futuro não oferece o botão', async () => {
    const { enviados } = api({
      '/saldo': [
        { tributo: 'COFINS', tributoId: 6, retido: 60, compensado: 60, aCompensar: 0, desde: null },
        { tributo: 'IRRF', tributoId: 5, retido: 45, compensado: 15, aCompensar: 30, desde: '2026-10' },
        { tributo: 'PIS', tributoId: 9, retido: 13, compensado: 0, aCompensar: 13, desde: '2026-11' },
      ],
    });
    const w = montar(SaldoCompensarPainel, { competencia: '2026-10', pode: true });
    await flushPromises();
    expect(w.get('[data-testid="sc-linha-IRRF"]').text()).toContain('30,00');
    expect(w.find('[data-testid="sc-compensar-COFINS"]').exists()).toBe(false);
    expect(w.find('[data-testid="sc-compensar-PIS"]').exists()).toBe(false);
    await w.get('[data-testid="sc-compensar-IRRF"]').trigger('click');
    await flushPromises();
    expect(enviados.at(-1)).toEqual({
      url: '/api/financeiro/retencao-sofrida/compensar',
      corpo: { competencia: '2026-10', tributo: 5 },
    });
    expect(w.get('[data-testid="sc-ok"]').text()).toBe('Gravado.');
    w.unmount();
  });

  it('regra do ISS só entra com o município do serviço, escolhido pelo nome', async () => {
    const { f, enviados } = api({
      '/retencao/regras': [],
      '/retencao/apoio': {
        tributos: [{ id: 8, sigla: 'ISS', descricao: 'Imposto sobre serviços', codigoReceita: null }],
        naturezas: [],
      },
      '/retencao/em-aberto': [],
      '/municipios': [{ id: 3106200, nome: 'Município Sintético', uf: 'MG' }],
    });
    const w = montar(RetencoesPainel, { competencia: '2026-10', podeEditar: true, podeRecolher: true });
    await flushPromises();
    await escolher(w, 'rt-nova-tributo', '8');
    await digitar(w, 'rt-nova-descricao', 'ISS retido no município');
    await digitar(w, 'rt-nova-aliquota', '2');
    // Sem município, o botão não liga.
    expect(w.get('[data-testid="rt-nova-incluir"]').attributes('disabled')).toBeDefined();
    await digitar(w, 'rt-nova-municipio', 'Mun');
    expect(f.mock.calls.some(([u]) => String(u).includes('/retencao-sofrida/municipios?termo=Mun'))).toBe(
      true,
    );
    await w.get('[data-testid="rt-nova-municipio-achados"] button').trigger('click');
    await flushPromises();
    expect(w.get('[data-testid="rt-nova-municipio-escolhido"]').text()).toContain('Município Sintético (MG)');
    expect(w.get('[data-testid="rt-nova-incluir"]').attributes('disabled')).toBeUndefined();
    await w.get('[data-testid="rt-nova"]').trigger('submit');
    await flushPromises();
    expect(enviados.at(-1)?.url).toBe('/api/financeiro/contabil-fiscal/retencao/regras');
    expect(enviados.at(-1)?.corpo).toMatchObject({
      acao: 'incluir',
      tributo: 8,
      municipio: 3106200,
      aliquota: 2,
    });
    w.unmount();
  });
});
