// @vitest-environment jsdom
// W0-09: "Voltar a herdar" no parâmetro hierárquico. A sobreposição em vigor oferece a retirada com justificativa (e
// a senha no crítico), manda nível e alvo à rota de retirada e as versões mostram quem retirou e o motivo. Dados
// SINTÉTICOS.
import type { ParametroNovoDescrito } from '@sgh/contratos';
import { criarI18n, instalarUi, resolverMarca } from '@sgh/ui';
import { QueryClient, VueQueryPlugin } from '@tanstack/vue-query';
import { flushPromises, mount } from '@vue/test-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { App } from 'vue';
import { mensagensWeb } from '../../../i18n/pt-BR.js';
import ParametroHeranca from './ParametroHeranca.vue';

vi.mock('../../../casca/sessao/pode.js', () => ({ pode: () => true }));

interface Pedido {
  url: string;
  corpo: Record<string, unknown> | null;
}
function simular(): Pedido[] {
  const pedidos: Pedido[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      const corpo = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : null;
      pedidos.push({ url: String(url), corpo });
      if (corpo) return Response.json({ atrasoInvalidacaoMs: 3, fechadas: 1 });
      return Response.json({
        parametro: {},
        versoes: [
          {
            id: 'v2',
            chave: 'agenda.x',
            nivel: 'estabelecimento',
            alvo: 'pc',
            valor: '30',
            vigenteDesde: '2026-11-01T10:00:00Z',
            vigenteAte: null,
            justificativa: 'ajuste do setor',
            autor: 'ANA',
          },
          {
            id: 'v1',
            chave: 'agenda.x',
            nivel: 'usuario',
            alvo: 'BIA',
            valor: '10',
            vigenteDesde: '2026-10-01T10:00:00Z',
            vigenteAte: '2026-10-20T10:00:00Z',
            justificativa: 'teste da pessoa',
            autor: 'ANA',
            retiradaPor: 'CAIO',
            retiradaMotivo: 'pessoa voltou ao padrão',
          },
        ],
      });
    }),
  );
  return pedidos;
}

const parametro = (critico: boolean): ParametroNovoDescrito =>
  ({
    chave: 'agenda.x',
    modulo: 'agenda',
    descricao: 'X',
    tipo: 'inteiro',
    padrao: '15',
    niveis: ['estabelecimento', 'usuario'],
    critico,
    dono: 'agenda',
    explicacao: {
      chave: 'agenda.x',
      valor: '30',
      origem: 'estabelecimento',
      alvo: 'pc',
      passos: [
        { nivel: 'usuario', alvo: null, valor: null, situacao: 'sem-valor' },
        { nivel: 'estabelecimento', alvo: 'pc', valor: '30', situacao: 'vale' },
        { nivel: 'padrao', alvo: null, valor: '15', situacao: 'sobreposto' },
      ],
      vigenteDesde: null,
      autor: null,
      justificativa: null,
    },
  }) as unknown as ParametroNovoDescrito;

const ui = { install: (app: App) => instalarUi(app, resolverMarca(undefined).pacote) };
const montar = (critico: boolean) =>
  mount(ParametroHeranca, {
    attachTo: document.body,
    props: { parametro: parametro(critico) },
    global: {
      plugins: [
        criarI18n(mensagensWeb as unknown as Record<string, unknown>),
        ui,
        [VueQueryPlugin, { queryClient: new QueryClient({ defaultOptions: { queries: { retry: false } } }) }],
      ] as never,
    },
  });

afterEach(() => {
  vi.unstubAllGlobals();
  document.body.innerHTML = '';
});

describe('voltar a herdar o parâmetro (W0-09)', () => {
  it('só a sobreposição em vigor oferece voltar a herdar; as versões mostram a retirada com motivo', async () => {
    simular();
    const w = montar(false);
    await flushPromises();
    expect(w.find('[data-testid="herdar-agenda.x-estabelecimento-pc"]').exists()).toBe(true);
    expect(w.findAll('[data-testid^="herdar-agenda.x-"]')).toHaveLength(1);
    expect(w.get('[data-testid="versao-retirada-v1"]').text()).toContain('pessoa voltou ao padrão (CAIO)');
  });

  it('exige justificativa e, no crítico, a senha; manda nível, alvo e justificativa à rota de retirada', async () => {
    const pedidos = simular();
    const w = montar(true);
    await flushPromises();
    await w.get('[data-testid="herdar-agenda.x-estabelecimento-pc"]').trigger('click');
    await w.get('[data-testid="form-herdar"]').trigger('submit');
    expect(w.get('[data-testid="herdar-falta"]').text()).toContain('10 caracteres');
    await w.get('[data-testid="herdar-justificativa"]').setValue('volta ao padrão da rede');
    await w.get('[data-testid="form-herdar"]').trigger('submit');
    expect(w.get('[data-testid="herdar-falta"]').text()).toContain('senha');
    expect(pedidos.filter((p) => p.corpo)).toHaveLength(0);
    await w.get('[data-testid="herdar-senha"]').setValue('segredo');
    await w.get('[data-testid="form-herdar"]').trigger('submit');
    await flushPromises();
    const post = pedidos.find((p) => p.corpo);
    expect(post?.url).toBe('/api/administracao/parametros/agenda.x/retirada');
    expect(post?.corpo).toEqual({
      nivel: 'estabelecimento',
      alvo: 'pc',
      justificativa: 'volta ao padrão da rede',
      senha: 'segredo',
    });
    expect(w.emitted('feito')?.[0]).toEqual([3]);
  });
});
