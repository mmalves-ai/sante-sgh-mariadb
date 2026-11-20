// @vitest-environment jsdom
// M37: o cliente do painel valida pelo contrato e imprime a parcela com a conta; a faixa do treino aparece com o texto
// fixo; a abertura do chamado manda o CSRF e a Idempotency-Key.
import { criarI18n } from '@sgh/ui';
import { mount } from '@vue/test-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';
import FaixaTreino from '../../casca/FaixaTreino.vue';
import { mensagensWeb } from '../../i18n/pt-BR.js';
import { abrirChamado, lerIndicadores, textoParcela } from './api.js';

afterEach(() => vi.unstubAllGlobals());

describe('migração gradual (cliente)', () => {
  it('parcela impressa com a conta (regra 2)', () => {
    expect(textoParcela({ novo: 61, total: 100, percentual: 61 })).toBe('novo 61 de 100 = 61%');
    expect(textoParcela({ novo: 0, total: 0, percentual: null })).toBe('sem operações no dia');
  });

  it('a resposta fora do contrato é recusada; o erro da API vira mensagem', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ x: 1 }), { status: 200 })),
    );
    await expect(lerIndicadores(7)).rejects.toThrow();
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(JSON.stringify({ title: 'Sem permissão', status: 403 }), {
            status: 403,
            headers: { 'content-type': 'application/problem+json' },
          }),
      ),
    );
    await expect(lerIndicadores(7)).rejects.toThrow();
  });

  it('abrir chamado manda o CSRF e a Idempotency-Key', async () => {
    const f = vi.fn(
      async (...args: [string, RequestInit?]) =>
        new Response(
          JSON.stringify({ id: '7', prazoResposta: '2026-11-04 10:15', aviso: `x${args.length}` }),
          {
            status: 201,
          },
        ),
    );
    vi.stubGlobal('fetch', f);
    const r = await abrirChamado({
      sistema: 'novo',
      severidade: 'S2',
      descricao: 'Tela lenta ao marcar',
      dadoPessoal: false,
    });
    expect(r.id).toBe('7');
    const [url, init] = f.mock.calls[0]!;
    expect(url).toBe('/api/chamados');
    const h = init?.headers as Record<string, string>;
    expect(h['idempotency-key']).toMatch(/^web-/);
    expect('x-csrf' in h).toBe(true);
  });

  it('a faixa do ambiente de treino', () => {
    const w = mount(FaixaTreino, {
      global: { plugins: [criarI18n(mensagensWeb as unknown as Record<string, unknown>)] },
    });
    expect(w.get('[data-testid="faixa-treino"]').text()).toBe('AMBIENTE DE TREINAMENTO');
  });
});
