// Vigia do banco próprio (lote F2.2 05-17), unidade: configuração validada, coleta das transações sobre leitor dublê
// (com e sem permissão), alertas só com contagens e a rodada do serviço sem banco real.
import type { Leitor } from '@sgh/nucleo';
import { describe, expect, it } from 'vitest';
import { VigiaBancoService } from './vigia-banco.service.js';
import {
  alertasDaColeta,
  coletarTransacoes,
  lerConfiguracaoVigiaBanco,
  semPermissao,
} from './vigia-banco.js';

const leitor = (linha: Record<string, unknown> | Error): Leitor =>
  ({
    cliente: 'plataforma',
    consultar: async () => [],
    uma: async () => {
      if (linha instanceof Error) throw linha;
      return linha;
    },
  }) as Leitor;

describe('vigia do banco próprio', () => {
  it('configuração: padrões e faixa validada', () => {
    expect(lerConfiguracaoVigiaBanco({})).toEqual({ intervaloMs: 15_000, limiteTransacaoMs: 5_000 });
    expect(lerConfiguracaoVigiaBanco({ VIGIA_TRANSACAO_LIMITE_MS: '2000' }).limiteTransacaoMs).toBe(2_000);
    expect(() => lerConfiguracaoVigiaBanco({ VIGIA_BANCO_MS: '10' })).toThrow(/VIGIA_BANCO_MS/);
  });

  it('coleta as transações; sem permissão devolve null; outro erro sobe', async () => {
    const c = await coletarTransacoes(
      leitor({ abertas: 3, escrita: 1, mais_longa_us: 7_500_000, acima: 1, esperando: 0 }),
      5_000,
    );
    expect(c).toEqual({ abertas: 3, escrita: 1, maisLongaMs: 7_500, acimaDoLimite: 1, esperandoTrava: 0 });
    const negado = Object.assign(new Error('Access denied; you need the PROCESS privilege'), { errno: 1227 });
    expect(semPermissao(negado)).toBe(true);
    expect(await coletarTransacoes(leitor(negado), 5_000)).toBeNull();
    await expect(coletarTransacoes(leitor(new TypeError('x')), 5_000)).rejects.toThrow(TypeError);
  });

  it('alertas: plataforma, neutralização, transação longa e espera de trava', () => {
    expect(alertasDaColeta({ plataforma: true, neutralizacao: true }, null, 5_000)).toEqual([]);
    const a = alertasDaColeta(
      { plataforma: false, neutralizacao: false },
      { abertas: 2, escrita: 2, maisLongaMs: 9_000, acimaDoLimite: 1, esperandoTrava: 2 },
      5_000,
    );
    expect(a.map((x) => x.tipo)).toEqual([
      'plataforma-fora',
      'neutralizacao-falhou',
      'transacao-longa',
      'espera-trava',
    ]);
    expect(a[3]!.quantidade).toBe(2);
  });

  it('a rodada do serviço junta saúde, transações e serviços; sem núcleo não roda', async () => {
    const s = new VigiaBancoService();
    expect(await s.ciclo()).toBeNull();
    s.usar(
      {
        saude: async () => ({
          ambiente: 'dev',
          plataforma: true,
          neutralizacao: true,
          pools: [{ banco: 'cliente_x', ativas: 1, ociosas: 2, total: 3 }],
        }),
        lerPlataforma: async (_c: string, fn: (l: Leitor) => Promise<unknown>) =>
          fn(leitor({ abertas: 1, escrita: 0, mais_longa_us: 1000, acima: 0, esperando: 0 })),
        encerrar: async () => undefined,
      } as never,
      async () => new Map([['gotenberg', 1]]),
    );
    const r = await s.ciclo();
    expect(r).toMatchObject({ plataforma: true, transacoes: { abertas: 1, maisLongaMs: 1 }, alertas: [] });
    expect(r?.pools).toHaveLength(1);
    expect(s.ultimaRodada()).toBe(r);
  });
});
