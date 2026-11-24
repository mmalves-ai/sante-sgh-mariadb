// @vitest-environment jsdom
// F3.8, 07-FIN linhas 100 e 109 (telas, dados sintéticos, API simulada no fetch): a grade do de-para grava ao sair do
// campo; o credor é achado pelo nome e ganha o código externo (vazio desliga mandando o código atual); a regra de
// retenção entra pelo formulário com validação na hora; o credor da guia é escolhido pelo nome; a sugestão da regra
// vigente é aplicada ao título a pagar com um clique (a dispensada não tem botão).
import { criarI18n, instalarUi, resolverMarca } from '@sgh/ui';
import { QueryClient, VueQueryPlugin } from '@tanstack/vue-query';
import { flushPromises, mount } from '@vue/test-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { type App, type Component, nextTick } from 'vue';
import { mensagensWeb } from '../../../i18n/pt-BR.js';
import DeParaContabilPainel from './DeParaContabilPainel.vue';
import RetencoesPainel from './RetencoesPainel.vue';
import SugestaoRetencaoTitulo from './SugestaoRetencaoTitulo.vue';

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
const montar = (c: Component, props: Record<string, unknown>) =>
  mount(c, {
    props,
    global: {
      plugins: [
        i18n(),
        ui,
        [VueQueryPlugin, { queryClient: new QueryClient({ defaultOptions: { queries: { retry: false } } }) }],
      ],
    },
    attachTo: document.body,
  });
const escolher = async (w: ReturnType<typeof mount>, testid: string, valor: string) => {
  await w.find(`[data-testid="${testid}"] [role="combobox"]`).trigger('click');
  await flushPromises();
  await nextTick();
  const opcao = document.body.querySelector<HTMLElement>(`[role="option"]:has([data-valor="${valor}"])`);
  expect(opcao, `opção ${valor} em ${testid}`).not.toBeNull();
  opcao!.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
  await flushPromises();
};

const OK = { mensagem: 'Gravado.', repetida: false, avisos: [] };
const json = (c: unknown) =>
  new Response(JSON.stringify(c), { status: 200, headers: { 'content-type': 'application/json' } });
/** O fetch simulado: responde pela rota e guarda o corpo de cada POST. */
function api(rotas: Record<string, unknown>) {
  const enviados: { url: string; corpo: Record<string, unknown> }[] = [];
  const f = vi.fn(async (url: string, init?: RequestInit) => {
    const u = String(url);
    if (init?.method === 'POST') {
      enviados.push({ url: u, corpo: JSON.parse(String(init.body)) as Record<string, unknown> });
      return json(OK);
    }
    const chave = Object.keys(rotas).find((k) => u.split('?')[0]!.endsWith(k));
    return json(chave ? rotas[chave] : []);
  });
  vi.stubGlobal('fetch', f);
  return { f, enviados };
}
const digitar = async (w: ReturnType<typeof mount>, testid: string, valor: string, evento = 'input') => {
  const i = w.get(`[data-testid="${testid}"]`);
  await i.setValue(valor);
  if (evento !== 'input') await i.trigger(evento);
  await flushPromises();
};
const FORNECEDORES = [{ id: 41, nome: 'Laboratório Sintético Alfa', documento: '00000000000191' }];

afterEach(() => {
  vi.unstubAllGlobals();
  document.body.innerHTML = '';
});

describe('de-para contábil (linha 100)', () => {
  const dePara = {
    eventos: [{ codigo: 'fin_despesa_apropriada', descricao: 'Despesa apropriada' }],
    regras: [],
    naturezas: [{ id: 3, codigo: '4.1', descricao: 'Material' }],
    centros: [],
    credores: [{ id: 77, nome: 'Fornecedor Sintético Beta', externo: 'F-77' }],
  };
  it('grade grava ao sair do campo; credor pelo nome com código; vazio desliga com o código atual', async () => {
    const { f, enviados } = api({ '/de-para': dePara, '/sem-de-para': [], '/fornecedores': FORNECEDORES });
    const w = montar(DeParaContabilPainel, { periodo: '2026-10', regua: 'competencia', podeEditar: true });
    await flushPromises();
    expect(w.get('[data-testid="dp-completo"]').exists()).toBe(true);
    await digitar(w, 'dp-debito-fin_despesa_apropriada-geral', '4.1.1', 'change');
    expect(enviados.at(-1)?.corpo).toMatchObject({
      tipo: 'conta',
      id: null,
      evento: 'fin_despesa_apropriada',
      lado: 'debito',
      natureza: null,
      conta: '4.1.1',
      ativo: true,
    });
    // O credor já mapeado aparece pelo nome; apagar o código desliga mandando o código que ele tem.
    expect(w.get('[data-testid="dp-credores"]').text()).toContain('Fornecedor Sintético Beta');
    await digitar(w, 'dp-cr-77', '', 'change');
    expect(enviados.at(-1)?.corpo).toEqual({ tipo: 'credor', fornecedor: 77, codigo: 'F-77', ativo: false });
    // Novo credor: busca pelo nome, escolhe na lista, digita o código; o botão só liga com os dois.
    expect(w.get('[data-testid="dp-credor-gravar"]').attributes('disabled')).toBeDefined();
    await digitar(w, 'dp-credor-busca', 'Labora');
    expect(f.mock.calls.some(([u]) => String(u).includes('/fornecedores?termo=Labora'))).toBe(true);
    await w.get('[data-testid="dp-credor-achados"] button').trigger('click');
    await flushPromises();
    expect(w.get('[data-testid="dp-credor-escolhido"]').text()).toContain('Laboratório Sintético Alfa');
    await digitar(w, 'dp-credor-codigo', 'F-41');
    await w.get('[data-testid="dp-credor-gravar"]').trigger('click');
    await flushPromises();
    expect(enviados.at(-1)?.corpo).toEqual({ tipo: 'credor', fornecedor: 41, codigo: 'F-41', ativo: true });
    w.unmount();
  });
});

describe('retenções na fonte (linha 109)', () => {
  const apoio = {
    tributos: [{ id: 5, sigla: 'IRRF', descricao: 'Imposto de renda retido', codigoReceita: '1708' }],
    naturezas: [{ id: 9, codigo: '2.1', descricao: 'Tributos a recolher' }],
  };
  it('regra pelo formulário com validação na hora; guia com credor pelo nome', async () => {
    const { enviados } = api({
      '/retencao/regras': [],
      '/retencao/apoio': apoio,
      '/retencao/em-aberto': [{ tributo: 5, sigla: 'IRRF', codigoReceita: '1708', retencoes: 2, valor: 30 }],
      '/fornecedores': FORNECEDORES,
    });
    const w = montar(RetencoesPainel, { competencia: '2026-10', podeEditar: true, podeRecolher: true });
    await flushPromises();
    const incluir = () => w.get('[data-testid="rt-nova-incluir"]');
    expect(incluir().attributes('disabled')).toBeDefined();
    await escolher(w, 'rt-nova-tributo', '5');
    await digitar(w, 'rt-nova-descricao', 'IRRF serviços PJ');
    await digitar(w, 'rt-nova-aliquota', '1,5');
    expect(incluir().attributes('disabled')).toBeUndefined();
    await digitar(w, 'rt-nova-aliquota', '150');
    expect(incluir().attributes('disabled')).toBeDefined();
    await digitar(w, 'rt-nova-aliquota', '1,5');
    await digitar(w, 'rt-nova-minimo', '10');
    await w.get('[data-testid="rt-nova"]').trigger('submit');
    await flushPromises();
    expect(enviados.at(-1)?.url).toBe('/api/financeiro/contabil-fiscal/retencao/regras');
    expect(enviados.at(-1)?.corpo).toMatchObject({
      acao: 'incluir',
      tributo: 5,
      descricao: 'IRRF serviços PJ',
      momento: 'pagamento',
      participante: 'pessoa_juridica',
      percentualBase: 100,
      aliquota: 1.5,
      minimo: 10,
      deducao: 0,
      maximo: null,
      vigenciaFim: null,
    });
    // A guia: o botão só liga com o credor escolhido pelo nome; a natureza vazia herda a do tributo.
    expect(w.get('[data-testid="rt-gerar-IRRF"]').attributes('disabled')).toBeDefined();
    await digitar(w, 'rt-credor-busca', 'Alfa');
    await w.get('[data-testid="rt-credor-achados"] button').trigger('click');
    await flushPromises();
    await w.get('[data-testid="rt-gerar-IRRF"]').trigger('click');
    await flushPromises();
    expect(enviados.at(-1)?.corpo).toEqual({
      competencia: '2026-10',
      tributo: 5,
      credor: 41,
      natureza: null,
      codigoReceita: '1708',
    });
    w.unmount();
  });

  it('sugestão da regra vigente no título: aplicar leva tributo e valor; a dispensada não tem botão', async () => {
    const { f } = api({
      '/retencao/sugestao': [
        { tributo: 'IRRF', tributoId: 5, regra: 1, base: 1000, aliquota: 1.5, valor: 15, dispensada: false },
        { tributo: 'CSLL', tributoId: 6, regra: 2, base: 1000, aliquota: 1, valor: 10, dispensada: true },
      ],
    });
    const w = montar(SugestaoRetencaoTitulo, {
      valor: 0,
      data: '2026-10-05',
      participante: 'pessoa_juridica',
    });
    expect(w.get('[data-testid="tp-sugerir-retencao"]').attributes('disabled')).toBeDefined();
    await w.setProps({ valor: 1000 });
    await w.get('[data-testid="tp-sugerir-retencao"]').trigger('click');
    await flushPromises();
    expect(String(f.mock.calls[0]![0])).toBe(
      '/api/financeiro/contabil-fiscal/retencao/sugestao?valor=1000&data=2026-10-05&participante=pessoa_juridica&momento=pagamento',
    );
    expect(w.find('[data-testid="tp-aplicar-CSLL"]').exists()).toBe(false);
    expect(w.get('[data-testid="tp-sugestoes"]').text()).toContain('dispensada');
    await w.get('[data-testid="tp-aplicar-IRRF"]').trigger('click');
    expect(w.emitted('aplicar')).toEqual([[{ tributo: 5, valor: 15 }]]);
    w.unmount();
  });
});
