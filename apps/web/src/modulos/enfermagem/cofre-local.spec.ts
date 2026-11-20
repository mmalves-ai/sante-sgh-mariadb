// Cache da beira do leito sem cifra disponível (página fora de contexto seguro): o banco do navegador existe, mas
// nada em texto claro chega a ele; o valor fica só na memória da aba, e registro persistido sem cifra é descartado.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { apagarCofreLocal, guardar, idDono, lerGuardado } from './cofre-local.js';

type Lojas = Record<string, Map<string, unknown>>;

/** Banco do navegador mínimo (open, transaction, get, put, delete, clear), assíncrono como o real. */
function bancoFalso(lojas: Lojas): IDBFactory {
  const pedido = <T>(f: () => T) => {
    const r = { result: undefined as T | undefined, onsuccess: null as null | (() => void), onerror: null };
    queueMicrotask(() => {
      r.result = f();
      r.onsuccess?.();
    });
    return r;
  };
  const db = {
    transaction: (loja: string) => ({
      objectStore: () => {
        const m = (lojas[loja] ??= new Map());
        return {
          get: (k: string) => pedido(() => m.get(k)),
          put: (v: unknown, k: string) => pedido(() => (m.set(k, v), k)),
          delete: (k: string) => pedido(() => (m.delete(k), undefined)),
          clear: () => pedido(() => (m.clear(), undefined)),
        };
      },
    }),
    close: () => undefined,
  };
  return {
    open: () => {
      const r = { result: db, onupgradeneeded: null, onsuccess: null as null | (() => void), onerror: null };
      queueMicrotask(() => r.onsuccess?.());
      return r;
    },
  } as unknown as IDBFactory;
}

const DONO = { rede: 'sint', estabelecimento: 'aa', login: 'SINT.ENF.PLANTAO' };

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('cofre da beira do leito sem cifra', () => {
  it('não grava texto claro no banco do navegador: fica só na memória da aba', async () => {
    const lojas: Lojas = {};
    vi.stubGlobal('indexedDB', bancoFalso(lojas));
    vi.stubGlobal('crypto', { getRandomValues: (a: Uint8Array) => a });
    await apagarCofreLocal();
    await guardar(DONO, 'horarios:1', { leito: 'SINT-01', situacao: 'P' });
    expect(lojas['cofre']?.size ?? 0).toBe(0);
    expect(await lerGuardado(DONO, 'horarios:1', 12)).toEqual({ leito: 'SINT-01', situacao: 'P' });
  });

  it('descarta registro persistido sem cifra', async () => {
    const lojas: Lojas = {};
    vi.stubGlobal('indexedDB', bancoFalso(lojas));
    vi.stubGlobal('crypto', { getRandomValues: (a: Uint8Array) => a });
    await apagarCofreLocal();
    const id = `${idDono(DONO)}#horarios:2`;
    lojas['cofre'] = new Map([
      [id, { dono: idDono(DONO), chave: 'horarios:2', guardadoEm: Date.now(), dados: '{"x":1}' }],
    ]);
    expect(await lerGuardado(DONO, 'horarios:2', 12)).toBeNull();
    expect(lojas['cofre'].has(id)).toBe(false);
  });
});
