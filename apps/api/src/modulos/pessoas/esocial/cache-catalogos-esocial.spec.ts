// M53.6 (achado do corretor; F2.2 lote 03-05: sem o banco de origem): o cache curto dos catálogos oficiais do eSocial (ficha do M53, seção 4), sem banco.
import { describe, expect, it } from 'vitest';
import type { PortaEsocial } from './porta-esocial.js';
import { comCacheCurtoDosCatalogos, TTL_CATALOGOS_ESOCIAL_MS } from './cache-catalogos-esocial.js';

describe('cache curto dos catálogos do eSocial', () => {
  it('relê só depois da validade; separa estabelecimento e data; falha não fica no cache', async () => {
    const leituras: string[] = [];
    let falhar = false;
    const base = {
      eventosCatalogo: async (c: { estabelecimento: number }) => {
        leituras.push(`eventos:${c.estabelecimento}`);
        return [];
      },
      leiauteCatalogo: async (_c: unknown, d: string) => {
        leituras.push(`leiaute:${d}`);
        if (falhar) throw new Error('banco fora');
        return [];
      },
      motivosAfastamento: async () => {
        leituras.push('motivos');
        return [];
      },
      categorias: async () => {
        leituras.push('categorias');
        return [];
      },
    };
    let t = 1_000;
    const p = comCacheCurtoDosCatalogos(base as unknown as PortaEsocial, TTL_CATALOGOS_ESOCIAL_MS, () => t);
    const pc = { cliente: 'r', estabelecimento: 1, usuario: null, correlacao: 't' };
    const hs = { cliente: 'r', estabelecimento: 2, usuario: null, correlacao: 't' };
    await p.eventosCatalogo(pc);
    await p.eventosCatalogo(pc);
    await p.eventosCatalogo(hs);
    await p.leiauteCatalogo(pc, '2026-10-28');
    await p.leiauteCatalogo(pc, '2026-10-28');
    await p.leiauteCatalogo(pc, '2026-10-29');
    await p.motivosAfastamento(pc);
    await p.categorias(pc);
    await p.categorias(pc);
    expect(leituras).toEqual([
      'eventos:1',
      'eventos:2',
      'leiaute:2026-10-28',
      'leiaute:2026-10-29',
      'motivos',
      'categorias',
    ]);
    t += TTL_CATALOGOS_ESOCIAL_MS + 1;
    await p.eventosCatalogo(pc);
    expect(leituras.at(-1)).toBe('eventos:1');
    expect(leituras).toHaveLength(7);
    falhar = true;
    await expect(p.leiauteCatalogo(pc, '2026-11-01')).rejects.toThrow('banco fora');
    falhar = false;
    await p.leiauteCatalogo(pc, '2026-11-01');
    expect(leituras.filter((x) => x === 'leiaute:2026-11-01')).toHaveLength(2);
  });
});
