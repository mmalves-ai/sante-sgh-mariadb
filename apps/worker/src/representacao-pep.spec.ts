// pep.registrarRepresentacao no worker (M15): grava só o modelo cujo selo não tem representação; a falha de
// um modelo não para os outros; ligado fora de dev/ci e, em dev/ci, só com PEP_REPRESENTACAO=ligado.
import { describe, expect, it } from 'vitest';
import type { Escritor, Leitor } from '@sgh/legado';
import {
  atualizarRepresentacoes,
  type NucleoRepresentacao,
  representacaoLigada,
  RepresentacaoPepService,
} from './representacao-pep.service.js';

function nucleoFalso(gravadas: Set<number>, falhar: number | null) {
  const inserts: number[] = [];
  const leitor: Leitor = {
    hospital: 'pc',
    consultar: async (sql: string, p: readonly unknown[] = []) => {
      if (sql.includes('FROM PREVOLUCAO'))
        return [
          { ID_EVOLUCAO: 1, COD: 'A' },
          { ID_EVOLUCAO: 2, COD: 'B' },
          { ID_EVOLUCAO: 3, COD: 'C' },
        ] as never;
      if (sql.includes('FROM RDB$DATABASE') && sql.includes('PRPADEVOL')) {
        if (p[0] === falhar) throw new Error('falha simulada');
        return [{ NV: 1, MV: 1, NF: 1, MF: 1, VL: 1 }] as never;
      }
      if (sql.includes('FROM SGH_PEP_FORM_VERSAO'))
        return (
          gravadas.has(Number(p[1]))
            ? [{ ID: 1, IMPRESSAO: 'a'.repeat(64), SELO: '1.1.1.1.1', REPRESENTACAO: Buffer.from('{}') }]
            : []
        ) as never;
      return [] as never;
    },
    lerBlob: async (b: unknown) => b as Buffer,
  };
  const escritor = {
    ...leitor,
    consultar: async (sql: string) => (sql.includes('NEXT VALUE') ? [{ ID: 9 }] : []) as never,
    executar: async (_sql: string, p: readonly unknown[] = []) => {
      inserts.push(Number(p[2]));
      return 1;
    },
  } as unknown as Escritor;
  const nucleo = {
    rede: 'rede-teste',
    lerSomente: (_c: unknown, fn: (l: Leitor) => Promise<unknown>) => fn(leitor),
    gravarSgh: (_c: unknown, fn: (e: Escritor) => Promise<unknown>) => fn(escritor),
    encerrar: async () => undefined,
  } as unknown as NucleoRepresentacao;
  return { nucleo, inserts };
}

describe('representação dos formulários no worker', () => {
  it('grava só o modelo sem representação do selo; a falha de um não para os outros', async () => {
    const { nucleo, inserts } = nucleoFalso(new Set([1]), 3);
    expect(await atualizarRepresentacoes(nucleo, 'pc')).toEqual({
      modelos: 3,
      gravadas: 1,
      iguais: 1,
      falhas: 1,
    });
    expect(inserts).toEqual([2]);
  });

  it('ligado fora de dev/ci; em dev/ci só com PEP_REPRESENTACAO=ligado', () => {
    expect(representacaoLigada({ AMBIENTE: 'producao' })).toBe(true);
    expect(representacaoLigada({ AMBIENTE: 'producao', PEP_REPRESENTACAO: 'desligado' })).toBe(false);
    expect(representacaoLigada({ AMBIENTE: 'dev' })).toBe(false);
    expect(representacaoLigada({ AMBIENTE: 'ci', PEP_REPRESENTACAO: 'ligado' })).toBe(true);
  });

  it('o ciclo do serviço roda por estabelecimento e não roda em paralelo', async () => {
    const { nucleo, inserts } = nucleoFalso(new Set(), null);
    const s = new RepresentacaoPepService();
    s.usar(nucleo);
    const antes = process.env['ESTABELECIMENTOS'];
    process.env['ESTABELECIMENTOS'] = 'pc';
    try {
      await Promise.all([s.ciclo(), s.ciclo()]);
    } finally {
      if (antes === undefined) delete process.env['ESTABELECIMENTOS'];
      else process.env['ESTABELECIMENTOS'] = antes;
    }
    expect(inserts).toEqual([1, 2, 3]);
    await s.onApplicationShutdown();
  });
});
