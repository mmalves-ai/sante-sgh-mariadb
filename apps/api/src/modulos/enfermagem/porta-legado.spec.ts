// M25: o cache dos internados da unidade (30 s por rede, estabelecimento e unidade; a falha não fica guardada; D-K6-25).
// Dados sintéticos.
import { describe, expect, it } from 'vitest';
import { internadosEmCache } from './porta-legado.js';

describe('internadosEmCache', () => {
  it('guarda por 30 s por estabelecimento e unidade e relê depois do prazo', async () => {
    let leituras = 0;
    const ler = async () => {
      leituras += 1;
      return [];
    };
    const t0 = 1_000_000_000;
    await internadosEmCache('sint', 'pc', 'SINT-A', ler, t0);
    await internadosEmCache('sint', 'pc', 'SINT-A', ler, t0 + 29_999);
    expect(leituras).toBe(1);
    await internadosEmCache('sint', 'pc', 'SINT-B', ler, t0 + 1);
    await internadosEmCache('sint', 'hs', 'SINT-A', ler, t0 + 1);
    expect(leituras).toBe(3);
    await internadosEmCache('sint', 'pc', 'SINT-A', ler, t0 + 30_001);
    expect(leituras).toBe(4);
  });

  it('outra rede com o mesmo estabelecimento e unidade não recebe a lista guardada', async () => {
    const t0 = 3_000_000_000;
    const a = [{ atendimento: 1 }] as never;
    const b = [{ atendimento: 2 }] as never;
    expect(await internadosEmCache('rede-a', 'pc', 'SINT-R', async () => a, t0)).toBe(a);
    expect(await internadosEmCache('rede-b', 'pc', 'SINT-R', async () => b, t0 + 1)).toBe(b);
  });

  it('não guarda a falha', async () => {
    const t0 = 2_000_000_000;
    await expect(
      internadosEmCache('sint', 'pc', 'SINT-F', () => Promise.reject(new Error('sem banco')), t0),
    ).rejects.toThrow();
    await Promise.resolve();
    const r = await internadosEmCache('sint', 'pc', 'SINT-F', async () => [], t0 + 1);
    expect(r).toEqual([]);
  });
});
