// Painel de cargas (ficha do M13, seção 4: agregados MAX e COUNT "em cache por horas"): a edição no banco de cada
// catálogo é lida uma vez e reaproveitada; uma carga do catálogo publicada (ou um lote a mais) invalida; depois
// do prazo, lê de novo. Fonte em memória.
import { describe, expect, it } from 'vitest';
import { FonteCatalogosMemoria } from './fonte-memoria.js';
import { ServicoCatalogos } from './servico.js';

describe('painel: cache da edição no banco', () => {
  it('lê uma vez por catálogo, invalida na publicação e no fim do prazo', async () => {
    const fonte = new FonteCatalogosMemoria();
    let leituras = 0;
    const original = fonte.edicao.bind(fonte);
    fonte.edicao = async (c, cat) => {
      leituras++;
      return original(c, cat);
    };
    let agora = new Date('2026-10-21T15:00:00Z');
    const s = new ServicoCatalogos(fonte, { ambiente: 'dev', agora: () => agora, cacheEdicaoMs: 3_600_000 });
    const ctx = { rede: 'r', hospital: 'aa', traceId: 't' };
    await s.painel(ctx);
    expect(leituras).toBe(13);
    await s.painel(ctx);
    expect(leituras).toBe(13);
    // Carga de um catálogo publicada: só esse catálogo é relido.
    const cargas = fonte.cargas.bind(fonte);
    fonte.cargas = async (c, cat) => [
      ...((await cargas(c, cat)) ?? []),
      {
        id: 1,
        hospital: 'aa',
        catalogo: 'cep',
        arquivo: 'x',
        sha256: 'a'.repeat(64),
        bytes: 1,
        situacao: 'publicada',
        edicao: null,
        responsavel: 'X',
        aprovador: 'X',
        criadaEm: '2026-10-21',
        totais: { linhas: 1, validas: 1, erros: 0, novos: 1, alterados: 0, iguais: 0, removidos: 0 },
        lotes: { total: 1, publicados: 1, tamanho: 500 },
        motivo: null,
        arquivoGuardado: false,
        versao: 2,
      },
    ];
    await s.painel(ctx);
    expect(leituras).toBe(14);
    agora = new Date('2026-10-21T16:30:00Z');
    await s.painel(ctx);
    expect(leituras).toBe(27);
  });
});
