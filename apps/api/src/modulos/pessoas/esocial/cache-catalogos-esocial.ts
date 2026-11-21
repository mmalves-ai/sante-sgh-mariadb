// Cache curto dos catálogos oficiais do eSocial (ficha do M53, seção 4: "versão de leiaute; cache curto"): por cliente,
// estabelecimento, catálogo e argumento (a data do leiaute vigente), por alguns minutos, para a tela não reler o banco a
// cada abertura. Falha não fica no cache. Os registros do eSocial e as contagens nunca passam por aqui.
// Melhoria: o cache envolve a porta pelo protótipo (vale para a classe da porta própria, sem perder os métodos).
import type { ContextoEsocial, PortaEsocial } from './porta-esocial.js';

type Catalogos = Pick<
  PortaEsocial,
  'eventosCatalogo' | 'leiauteCatalogo' | 'motivosAfastamento' | 'categorias'
>;

/** Validade do cache curto dos catálogos oficiais. */
export const TTL_CATALOGOS_ESOCIAL_MS = 5 * 60_000;
const TETO_ENTRADAS_CACHE = 200;

export function comCacheCurtoDosCatalogos<T extends Catalogos>(
  base: T,
  ttlMs = TTL_CATALOGOS_ESOCIAL_MS,
  agora: () => number = Date.now,
): T {
  const cache = new Map<string, { ate: number; valor: Promise<unknown> }>();
  const memo = <R>(chave: string, ler: () => Promise<R>): Promise<R> => {
    const t = agora();
    const x = cache.get(chave);
    if (x && x.ate > t) return x.valor as Promise<R>;
    if (cache.size >= TETO_ENTRADAS_CACHE)
      for (const [k, v] of cache) if (v.ate <= t || cache.size >= TETO_ENTRADAS_CACHE) cache.delete(k);
    const valor = ler();
    cache.set(chave, { ate: t + ttlMs, valor });
    valor.catch(() => cache.delete(chave));
    return valor;
  };
  const k = (c: ContextoEsocial, nome: string, arg = '') =>
    `${c.cliente}|${c.estabelecimento}|${nome}|${arg}`;
  const envolta = Object.create(base) as T;
  return Object.assign(envolta, {
    eventosCatalogo: (c: ContextoEsocial) => memo(k(c, 'eventos'), () => base.eventosCatalogo(c)),
    leiauteCatalogo: (c: ContextoEsocial, d: string) =>
      memo(k(c, 'leiaute', d), () => base.leiauteCatalogo(c, d)),
    motivosAfastamento: (c: ContextoEsocial) => memo(k(c, 'motivos'), () => base.motivosAfastamento(c)),
    categorias: (c: ContextoEsocial) => memo(k(c, 'categorias'), () => base.categorias(c)),
  });
}
