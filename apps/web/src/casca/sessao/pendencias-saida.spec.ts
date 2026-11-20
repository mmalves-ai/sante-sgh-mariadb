// Regra 9 do M23: o aviso ao sair conta as pendências de assinatura; sem a permissão ou com erro, sai direto.
import { describe, expect, it } from 'vitest';
import { pendenciasAoSair } from './pendencias-saida.js';

describe('pendências de assinatura ao sair (M23, regra 9)', () => {
  it('com pendências, devolve o total; sem pendências, zero', async () => {
    expect(
      await pendenciasAoSair(
        async () => ({ total: 3 }),
        () => true,
      ),
    ).toBe(3);
    expect(
      await pendenciasAoSair(
        async () => ({ total: 0 }),
        () => true,
      ),
    ).toBe(0);
  });

  it('sem a permissão não consulta; erro do servidor não prende a saída', async () => {
    let consultou = false;
    const ler = async () => {
      consultou = true;
      return { total: 2 };
    };
    expect(await pendenciasAoSair(ler, () => false)).toBe(0);
    expect(consultou).toBe(false);
    expect(
      await pendenciasAoSair(
        () => Promise.reject(new Error('fora do ar')),
        () => true,
      ),
    ).toBe(0);
  });
});
