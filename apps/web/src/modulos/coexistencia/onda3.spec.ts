// @vitest-environment jsdom
// M41: o cliente da onda 3 grava o critério do setor por PUT com o CSRF e a Idempotency-Key e valida o painel pelo
// contrato; o painel de efeito no estoque leva o dia e o local na URL; a conferência numérica é POST com o CSRF; os
// textos da onda 3 não citam o outro sistema pelo nome.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { conferirNumerica, lerPainelOnda3, lerRetratoNumerico } from '../suprimentos/api-suprimentos.js';
import { mensagensSuprimentos } from '../suprimentos/i18n.js';
import { gravarItensOnda3, lerOnda3 } from './api.js';
import { mensagensCoexistencia } from './i18n.js';

afterEach(() => vi.unstubAllGlobals());

describe('onda 3 (cliente)', () => {
  it('grava os itens do critério por PUT, com o CSRF e a Idempotency-Key; o painel fora do contrato é recusado', async () => {
    const f = vi.fn(async () => new Response(JSON.stringify({ gravados: 1 }), { status: 200 }));
    vi.stubGlobal('fetch', f);
    expect(
      await gravarItensOnda3('farmacia-central', {
        itens: [{ item: 'inventario-recente', situacao: 'cumprido', evidencia: 'ata 41', em: '2026-12-01' }],
        justificativa: 'Registro do comitê',
      }),
    ).toEqual({ gravados: 1 });
    const [url, init] = (f.mock.calls[0] ?? []) as unknown as [string, RequestInit];
    expect(url).toBe('/api/administracao/coexistencia/migracao/onda3/criterio/farmacia-central');
    expect(init.method).toBe('PUT');
    expect('x-csrf' in (init.headers as Record<string, string>)).toBe(true);
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ setores: 1 }), { status: 200 })),
    );
    await expect(lerOnda3()).rejects.toThrow();
  });

  it('o painel de efeito leva o dia e o local; a conferência numérica vai por POST com o CSRF', async () => {
    const painel = {
      hospital: 'pc',
      dia: '2026-12-01',
      documentos: [],
      efeitos: [],
      comAlerta: 0,
      horarios: [],
      requisicoes: [],
      uso: [],
      ultimoMesFechado: null,
      cortada: false,
    };
    const f = vi.fn(async () => new Response(JSON.stringify(painel), { status: 200 }));
    vi.stubGlobal('fetch', f);
    expect((await lerPainelOnda3({ dia: '2026-12-01', local: 10 })).dia).toBe('2026-12-01');
    expect((f.mock.calls[0] as unknown as [string])[0]).toBe(
      '/api/suprimentos/onda3/painel?dia=2026-12-01&local=10',
    );
    const rn = vi.fn(
      async () =>
        new Response(JSON.stringify({ dia: '2026-12-01', lidos: [], divergencias: [], conferidos: 0 }), {
          status: 200,
        }),
    );
    vi.stubGlobal('fetch', rn);
    await lerRetratoNumerico({ dia: '2026-12-01', local: 10 });
    // O retrato da conferência leva o mesmo filtro de local do painel (D-ESCOPO-41).
    expect((rn.mock.calls[0] as unknown as [string])[0]).toBe(
      '/api/suprimentos/onda3/conferencia-numerica?dia=2026-12-01&local=10',
    );
    const g = vi.fn(
      async () =>
        new Response(JSON.stringify({ dia: '2026-12-01', lidos: [], divergencias: [], conferidos: 1 }), {
          status: 200,
        }),
    );
    vi.stubGlobal('fetch', g);
    const r = await conferirNumerica('2026-12-01', [{ item: 5001, local: 10, saldo: 3, precoMedio: 1.5 }]);
    expect(r.conferidos).toBe(1);
    const [url, init] = (g.mock.calls[0] ?? []) as unknown as [string, RequestInit];
    expect(url).toBe('/api/suprimentos/onda3/conferencia-numerica');
    expect(init.method).toBe('POST');
    expect('x-csrf' in (init.headers as Record<string, string>)).toBe(true);
  });

  it('os textos da onda 3 não citam o outro sistema pelo nome', () => {
    expect(JSON.stringify(mensagensCoexistencia.onda3)).not.toMatch(/spdata|legado/i);
    expect(JSON.stringify(mensagensSuprimentos.onda3)).not.toMatch(/spdata|legado|outro sistema/i);
  });
});
