// @vitest-environment jsdom
// Tela do vínculo do item com a referência de preço (F3.6, 05-SUP linha 28), na ficha do item: os vigentes (um por
// publicação) e o histórico; a busca escolhe a referência com o fator sugerido; a conferência na hora (início antes de
// hoje, mesma referência e fator) desabilita o "Vincular" sem chamar o servidor; o vínculo válido vai à rota do item com
// a Idempotency-Key, que se repete no reenvio depois de uma falha; o encerramento vai à rota do vínculo aberto escolhido.
// Dados SINTÉTICOS; o fetch é simulado.
import { criarI18n, instalarUi, resolverMarca } from '@sgh/ui';
import { flushPromises, mount } from '@vue/test-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { App } from 'vue';
import { mensagensWeb } from '../../i18n/pt-BR.js';
import VinculoReferenciaPreco from './componentes/VinculoReferenciaPreco.vue';

const ui = { install: (app: App) => instalarUi(app, resolverMarca(undefined).pacote) };
const ref = (id: number, codigo: string, fonte = 'outra') => ({
  id,
  fonte,
  codigo,
  descricao: `REFERENCIA SINTETICA ${codigo}`,
  apresentacao: null,
  tipoProduto: 'material',
  situacao: 'ativo',
  unidade: 'UN',
  ean: null,
});
const vigente = {
  id: 7,
  versao: 1,
  referencia: ref(10, 'A1'),
  edicao: { id: 3, numero: 'E1' },
  fator: 1,
  inicio: '2026-01-01',
  fim: null,
  vigente: true,
};
const outraPublicacao = { ...vigente, id: 9, referencia: ref(20, 'D4', 'brasindice'), fator: 5 };
const ficha = {
  hoje: '2026-11-24',
  item: { id: 5, codigo: 'IT5', nome: 'ITEM SINTETICO', unidade: 'UN' },
  vigentes: [vigente, outraPublicacao],
  historico: [outraPublicacao, vigente],
};
const opcoes = [
  { ...ref(10, 'A1'), fatorSugerido: 1, edicaoVigente: { id: 3, numero: 'E1' } },
  { ...ref(11, 'B2'), fatorSugerido: null, edicaoVigente: null },
];

function simular(falhasPost = 0) {
  let falhar = falhasPost;
  const chamadas: { url: string; metodo: string; corpo: unknown; chave: string | null }[] = [];
  const f = vi.fn(async (url: string, init?: RequestInit) => {
    const h = (init?.headers ?? {}) as Record<string, string>;
    chamadas.push({
      url,
      metodo: init?.method ?? 'GET',
      corpo: init?.body ? JSON.parse(String(init.body)) : null,
      chave: h['idempotency-key'] ?? null,
    });
    if (init?.method === 'POST' && falhar-- > 0)
      return new Response(JSON.stringify({ title: 'Tempo esgotado' }), {
        status: 504,
        headers: { 'content-type': 'application/problem+json' },
      });
    const corpo = url.includes('/buscar') ? opcoes : init?.method === 'POST' ? { id: 8 } : ficha;
    return new Response(JSON.stringify(corpo), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  });
  vi.stubGlobal('fetch', f);
  return chamadas;
}

const montar = () =>
  mount(VinculoReferenciaPreco, {
    props: { item: 5 },
    global: { plugins: [criarI18n(mensagensWeb as unknown as Record<string, unknown>), ui] as never },
  });

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('vínculo com a referência de preço na ficha do item', () => {
  it('mostra os vigentes de cada publicação e o histórico', async () => {
    simular();
    const w = montar();
    await flushPromises();
    expect(w.get('[data-testid="vinculo-referencia-vigente-outra"]').text()).toContain('A1');
    expect(w.get('[data-testid="vinculo-referencia-vigente-brasindice"]').text()).toContain('D4');
    expect(w.findAll('[data-testid="vinculo-referencia-historico"] tbody tr')).toHaveLength(2);
  });

  it('confere na hora e só envia o vínculo válido, com a Idempotency-Key repetida no reenvio', async () => {
    vi.useFakeTimers();
    const chamadas = simular(1);
    const w = montar();
    await flushPromises();
    await w.get('[data-testid="vinculo-referencia-busca"]').setValue('A1');
    await vi.advanceTimersByTimeAsync(350);
    await flushPromises();
    await w.get('[data-testid="vinculo-referencia-escolher-A1"]').trigger('click');
    // Mesma referência com o mesmo fator sugerido: recusado na hora.
    expect(w.find('[data-testid="vinculo-referencia-recusa-vinculo-sem-mudanca"]').exists()).toBe(true);
    expect(w.get('[data-testid="vinculo-referencia-vincular"]').attributes('disabled')).toBeDefined();
    await w.get('[data-testid="vinculo-referencia-fator"]').setValue('10');
    await w.get('[data-testid="vinculo-referencia-inicio"]').setValue('2025-12-01');
    expect(w.find('[data-testid="vinculo-referencia-recusa-vinculo-retroativo"]').exists()).toBe(true);
    await w.get('[data-testid="vinculo-referencia-inicio"]').setValue('2026-12-01');
    expect(w.findAll('small.erro')).toHaveLength(0);
    const antes = chamadas.length;
    await w.get('[data-testid="vinculo-referencia-vincular"]').trigger('click');
    await flushPromises();
    // A primeira resposta se perdeu (504): o reenvio leva a mesma chave, e o servidor devolve a primeira gravação.
    await w.get('[data-testid="vinculo-referencia-vincular"]').trigger('click');
    await flushPromises();
    const posts = chamadas.slice(antes).filter((c) => c.metodo === 'POST');
    expect(posts).toHaveLength(2);
    const post = posts[1];
    expect(post?.url).toBe('/api/suprimentos/cadastro/itens/5/referencias-preco');
    expect(post?.corpo).toEqual({ referencia: 10, edicao: 3, fator: 10, inicio: '2026-12-01' });
    expect(post?.chave).toBeTruthy();
    expect(posts[0]?.chave).toBe(post?.chave);
    expect(w.get('[data-testid="vinculo-referencia-ok"]').text()).toBeTruthy();
  });

  it('encerra o vínculo aberto escolhido na data escolhida', async () => {
    const chamadas = simular();
    const w = montar();
    await flushPromises();
    await w.get('[data-testid="vinculo-referencia-fim"]').setValue('2026-11-30');
    await w.get('[data-testid="vinculo-referencia-encerrar-7"]').trigger('click');
    await flushPromises();
    const post = chamadas.find((c) => c.metodo === 'POST');
    expect(post?.url).toBe('/api/suprimentos/cadastro/itens/5/referencias-preco/7/encerrar');
    expect(post?.corpo).toEqual({ fim: '2026-11-30' });
  });
});
