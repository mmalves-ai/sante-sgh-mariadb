// @vitest-environment jsdom
// M39: o cliente da onda 1 grava a lista para ligar o setor por PUT com o CSRF e a Idempotency-Key e valida o painel
// pelo contrato; os textos da onda 1 não citam o outro sistema pelo nome.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { mensagensCoexistencia } from './i18n.js';
import { gravarItensLigar, lerOnda1 } from './api.js';

afterEach(() => vi.unstubAllGlobals());

describe('onda 1 (cliente)', () => {
  it('grava os itens da lista por PUT, com o CSRF e a Idempotency-Key', async () => {
    const f = vi.fn(
      async (...a: [string, RequestInit?]) =>
        new Response(JSON.stringify({ gravados: a.length > 0 ? 1 : 0 }), { status: 200 }),
    );
    vi.stubGlobal('fetch', f);
    const r = await gravarItensLigar('agendamento', {
      itens: [{ item: 'aceite-jornada', situacao: 'cumprido', evidencia: 'ata 7', em: '2026-11-09' }],
      justificativa: 'Registro do comitê',
    });
    expect(r).toEqual({ gravados: 1 });
    const [url, init] = f.mock.calls[0]!;
    expect(url).toBe('/api/administracao/coexistencia/migracao/onda1/ligar/agendamento');
    expect(init?.method).toBe('PUT');
    const h = init?.headers as Record<string, string>;
    expect(h['idempotency-key']).toMatch(/^web-/);
    expect('x-csrf' in h).toBe(true);
  });

  it('o painel fora do contrato é recusado', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ avaliacoes: 1 }), { status: 200 })),
    );
    await expect(lerOnda1()).rejects.toThrow();
  });

  it('os textos da onda 1 não citam o outro sistema pelo nome', () => {
    expect(JSON.stringify(mensagensCoexistencia.onda1)).not.toMatch(/spdata|legado/i);
  });
});
