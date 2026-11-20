// @vitest-environment jsdom
// M42: o cliente da onda 4 grava o critério do setor por PUT com o CSRF e valida o painel pelo contrato; o painel da
// competência leva a competência e o convênio na URL e é validado pelo mesmo Zod da API; a conferência com o outro
// sistema vai por POST com o CSRF e a Idempotency-Key; os textos não citam o outro sistema pelo nome.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { conferirCompetencia, lerAcompanhamento, urlExportacaoAcompanhamento } from '../tiss/api-tiss.js';
import { mensagensTiss } from '../tiss/i18n.js';
import { gravarItensOnda4, lerOnda4 } from './api.js';
import { mensagensCoexistencia } from './i18n.js';

afterEach(() => vi.unstubAllGlobals());

const painel = {
  competencia: '2026-04',
  convenio: 7,
  contas: {
    disponivel: true,
    contas: 2,
    valor: 30,
    porSituacao: [{ situacao: 'S', rotulo: 'Fechada', contas: 2, valor: 30 }],
    fechadas: 2,
    fechadasPeloNovo: 1,
    fechadasPeloOutro: 1,
    parcelaDoNovo: 0.5,
    porConvenio: [{ convenio: 7, nome: 'C', contas: 2, fechadas: 2, fechadasPeloNovo: 1, valor: 30 }],
  },
  lotes: {
    disponivel: true,
    lotes: 0,
    comProtocolo: 0,
    semProtocolo: 0,
    contasEmLote: 0,
    conveniosFechados: 0,
    conveniosComConta: 1,
  },
  glosas: { disponivel: false, motivo: 'x' },
  titulos: { disponivel: false, motivo: 'x' },
  repasse: { disponivel: false, motivo: 'x' },
  gravacoes: [],
  uso: { disponivel: false, motivo: 'x' },
  geradoEm: '2026-10-24T10:00:00Z',
  emCache: false,
};

describe('onda 4 (cliente)', () => {
  it('grava o critério por PUT com o CSRF; o painel fora do contrato é recusado', async () => {
    const f = vi.fn(async () => new Response(JSON.stringify({ gravados: 1 }), { status: 200 }));
    vi.stubGlobal('fetch', f);
    expect(
      await gravarItensOnda4('faturamento-convenio', {
        itens: [
          { item: 'abertura-da-competencia', situacao: 'cumprido', evidencia: 'ata 42', em: '2027-01-04' },
        ],
        justificativa: 'Registro do comitê',
      }),
    ).toEqual({ gravados: 1 });
    const [url, init] = (f.mock.calls[0] ?? []) as unknown as [string, RequestInit];
    expect(url).toBe('/api/administracao/coexistencia/migracao/onda4/criterio/faturamento-convenio');
    expect(init.method).toBe('PUT');
    expect('x-csrf' in (init.headers as Record<string, string>)).toBe(true);
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ setores: 1 }), { status: 200 })),
    );
    await expect(lerOnda4()).rejects.toThrow();
  });

  it('o painel da competência leva o filtro e é validado; a conferência vai por POST com o CSRF', async () => {
    const f = vi.fn(async () => new Response(JSON.stringify(painel), { status: 200 }));
    vi.stubGlobal('fetch', f);
    expect((await lerAcompanhamento({ competencia: '2026-04', convenio: '7' })).contas.fechadasPeloNovo).toBe(
      1,
    );
    expect((f.mock.calls[0] as unknown as [string])[0]).toBe(
      '/api/tiss/painel/competencia?competencia=2026-04&convenio=7',
    );
    expect(urlExportacaoAcompanhamento({ competencia: '2026-04' })).toBe(
      '/api/tiss/painel/competencia/exportacao?competencia=2026-04',
    );
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ ...painel, contas: {} }), { status: 200 })),
    );
    await expect(lerAcompanhamento({ competencia: '2026-04' })).rejects.toThrow();
    const g = vi.fn(
      async () =>
        new Response(JSON.stringify({ competencia: '2026-04', comparados: 1, diferencas: [] }), {
          status: 200,
        }),
    );
    vi.stubGlobal('fetch', g);
    const r = await conferirCompetencia(
      { competencia: '2026-04', linhas: [{ convenio: 7, contas: 2, fechadas: 2, valor: 30 }] },
      'm42.teste',
    );
    expect(r.diferencas).toEqual([]);
    const [url, init] = (g.mock.calls[0] ?? []) as unknown as [string, RequestInit];
    expect(url).toBe('/api/tiss/painel/competencia/conferencia');
    expect(init.method).toBe('POST');
    expect('x-csrf' in (init.headers as Record<string, string>)).toBe(true);
    expect((init.headers as Record<string, string>)['idempotency-key']).toBe('m42.teste');
  });

  it('os textos da onda 4 e do acompanhamento não citam o outro sistema pelo nome', () => {
    expect(JSON.stringify(mensagensCoexistencia.onda4)).not.toMatch(/spdata|legado/i);
    expect(JSON.stringify(mensagensTiss.acompanhamento)).not.toMatch(/spdata|legado/i);
  });
});
