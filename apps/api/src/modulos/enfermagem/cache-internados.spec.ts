// O cache dos internados da unidade (30 s por cliente, estabelecimento e unidade; a falha não fica guardada).
// Dados sintéticos.
import { describe, expect, it } from 'vitest';
import { internadosEmCache } from './cache-internados.js';

const c = (cliente: string, estabelecimento: number) => ({ cliente, estabelecimento });

describe('internadosEmCache', () => {
  it('guarda por 30 s por estabelecimento e unidade e relê depois do prazo', async () => {
    let leituras = 0;
    const ler = async () => {
      leituras += 1;
      return [];
    };
    const t0 = 1_000_000_000;
    await internadosEmCache(c('sint', 1), 'SINT-A', ler, t0);
    await internadosEmCache(c('sint', 1), 'SINT-A', ler, t0 + 29_999);
    expect(leituras).toBe(1);
    await internadosEmCache(c('sint', 1), 'SINT-B', ler, t0 + 1);
    await internadosEmCache(c('sint', 2), 'SINT-A', ler, t0 + 1);
    expect(leituras).toBe(3);
    await internadosEmCache(c('sint', 1), 'SINT-A', ler, t0 + 30_001);
    expect(leituras).toBe(4);
  });

  it('outro cliente com o mesmo estabelecimento e unidade não recebe a lista guardada', async () => {
    const t0 = 3_000_000_000;
    const a = [{ atendimento: 1 }] as never;
    const b = [{ atendimento: 2 }] as never;
    expect(await internadosEmCache(c('cli_a', 1), 'SINT-R', async () => a, t0)).toBe(a);
    expect(await internadosEmCache(c('cli_b', 1), 'SINT-R', async () => b, t0 + 1)).toBe(b);
  });

  it('a falha não fica guardada', async () => {
    const t0 = 5_000_000_000;
    await expect(
      internadosEmCache(c('sint', 9), 'SINT-F', async () => Promise.reject(new Error('x')), t0),
    ).rejects.toThrow('x');
    expect(await internadosEmCache(c('sint', 9), 'SINT-F', async () => [], t0 + 1)).toEqual([]);
  });
});
