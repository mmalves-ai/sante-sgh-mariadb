// @vitest-environment jsdom
// M40: o cliente da onda 2 grava o critério do setor por PUT com o CSRF e a Idempotency-Key, lê o acompanhamento com o
// período na URL e valida o painel pelo contrato; os textos da onda 2 e do relatório de contingência não citam o outro
// sistema pelo nome.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { mensagensEnfermagem } from '../enfermagem/i18n.js';
import { gerarContingencia } from '../enfermagem/api-enfermagem.js';
import { mensagensCoexistencia } from './i18n.js';
import { gravarItensOnda2, lerAcompanhamentoOnda2, lerOnda2 } from './api.js';

afterEach(() => vi.unstubAllGlobals());

describe('onda 2 (cliente)', () => {
  it('grava os itens do critério por PUT, com o CSRF e a Idempotency-Key', async () => {
    const f = vi.fn(async () => new Response(JSON.stringify({ gravados: 1 }), { status: 200 }));
    vi.stubGlobal('fetch', f);
    const r = await gravarItensOnda2('enfermagem', {
      itens: [{ item: 'unidade-piloto', situacao: 'cumprido', evidencia: 'UTI (ata 3)', em: '2026-12-01' }],
      justificativa: 'Registro do comitê',
    });
    expect(r).toEqual({ gravados: 1 });
    const [url, init] = (f.mock.calls[0] ?? []) as unknown as [string, RequestInit];
    expect(url).toBe('/api/administracao/coexistencia/migracao/onda2/criterio/enfermagem');
    expect(init.method).toBe('PUT');
    const h = init.headers as Record<string, string>;
    expect(h['idempotency-key']).toMatch(/^web-/);
    expect('x-csrf' in h).toBe(true);
  });

  it('o acompanhamento leva o período; o painel fora do contrato é recusado', async () => {
    const f = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            estabelecimento: 'pc',
            de: '2026-12-01',
            ate: '2026-12-02',
            checagem: [],
            higienizacao: [],
            registros: [],
          }),
          { status: 200 },
        ),
    );
    vi.stubGlobal('fetch', f);
    expect((await lerAcompanhamentoOnda2('2026-12-01', '2026-12-02')).de).toBe('2026-12-01');
    expect((f.mock.calls[0] as unknown as [string])[0]).toBe(
      '/api/administracao/coexistencia/migracao/onda2/acompanhamento?de=2026-12-01&ate=2026-12-02',
    );
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ setores: 1 }), { status: 200 })),
    );
    await expect(lerOnda2()).rejects.toThrow();
  });

  it('o relatório de contingência: POST com o CSRF, o PDF e as contagens dos cabeçalhos', async () => {
    const f = vi.fn(
      async () =>
        new Response(new Blob(['%PDF-1.7']), {
          status: 200,
          headers: { 'content-type': 'application/pdf', 'x-sgh-pacientes': '3', 'x-sgh-horarios': '7' },
        }),
    );
    const r = await gerarContingencia('UTI', 6, f as unknown as typeof fetch);
    expect(r.pacientes).toBe(3);
    expect(r.horarios).toBe(7);
    const [url, init] = (f.mock.calls[0] ?? []) as unknown as [string, RequestInit];
    expect(url).toBe('/api/enfermagem/contingencia');
    expect(JSON.parse(String(init.body))).toEqual({ unidade: 'UTI', horas: 6 });
    expect('x-csrf' in (init.headers as Record<string, string>)).toBe(true);
  });

  it('os textos da onda 2 e da contingência não citam o outro sistema pelo nome', () => {
    expect(JSON.stringify(mensagensCoexistencia.onda2)).not.toMatch(/spdata|legado/i);
    expect(JSON.stringify(mensagensEnfermagem.contingencia)).not.toMatch(/spdata|legado/i);
  });
});
