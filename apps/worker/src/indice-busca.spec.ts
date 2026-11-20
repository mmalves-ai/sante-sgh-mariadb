import { describe, expect, it } from 'vitest';
import type { PacienteLido } from '@sgh/legado';
import { avaliarPar, IndiceBuscaService, type NucleoVigia, vigiaLigado } from './indice-busca.service.js';

const paciente = (id: number, extra: Partial<PacienteLido> = {}): PacienteLido =>
  ({
    id,
    nome: 'ANA MARIA SINTETICA',
    nascimento: '1980-01-01',
    mae: 'JOANA SINTETICA',
    cpf: null,
    telefone: null,
    celular: null,
    ...extra,
  }) as PacienteLido;

describe('vigia do índice de busca (M11)', () => {
  it('fora de dev/ci liga por padrão; em dev/ci só com BUSCA_VIGIA=ligado; desligado sempre vale', () => {
    expect(vigiaLigado({ AMBIENTE: 'producao' })).toBe(true);
    expect(vigiaLigado({ AMBIENTE: 'homolog', BUSCA_VIGIA: 'desligado' })).toBe(false);
    expect(vigiaLigado({ AMBIENTE: 'dev' })).toBe(false);
    expect(vigiaLigado({ AMBIENTE: 'ci', BUSCA_VIGIA: 'ligado' })).toBe(true);
  });

  it('a regra pura do escore decide o par (nome + nascimento + mãe entra; só o nome não)', () => {
    expect(avaliarPar(paciente(1), paciente(2))).toMatchObject({
      criterios: expect.arrayContaining(['fonetica']),
    });
    expect(
      avaliarPar(paciente(1), paciente(2, { nascimento: '1999-09-09', mae: 'OUTRA PESSOA' })),
    ).toBeNull();
  });

  it('os pacientes reindexados vão à fila; a conferência por contagem roda no intervalo', async () => {
    const chamadas: string[] = [];
    const nucleo: NucleoVigia = {
      cicloIndiceBusca: async () => [
        { entidade: 'paciente', lidos: 2, indexados: 2, marca: 9, atrasados: 1, reparados: 0, ids: [7, 8] },
        { entidade: 'solicitante', lidos: 0, indexados: 0, marca: 3, atrasados: 0, reparados: 1, ids: [3] },
      ],
      alimentarFilaDuplicidade: async (_c, ids) => {
        chamadas.push(`fila:${ids.join(',')}`);
        return 1;
      },
      contagemIndiceBusca: async (_c, entidade) => {
        chamadas.push(`conta:${entidade}`);
        return { indice: 1, legado: entidade === 'paciente' ? 2 : 1 };
      },
      encerrar: async () => undefined,
    };
    const antes = process.env['ESTABELECIMENTOS'];
    process.env['ESTABELECIMENTOS'] = 'pc';
    try {
      const s = new IndiceBuscaService();
      s.usar(nucleo, 60_000);
      await s.ciclo();
      await s.ciclo();
      // Os pacientes reindexados vão à fila a cada ciclo; a conferência, uma vez no intervalo (3 entidades).
      expect(chamadas.filter((c) => c.startsWith('fila:'))).toEqual(['fila:7,8', 'fila:7,8']);
      expect(chamadas.filter((c) => c.startsWith('conta:'))).toEqual([
        'conta:paciente',
        'conta:profissional',
        'conta:solicitante',
      ]);
      await s.onApplicationShutdown();
    } finally {
      if (antes === undefined) delete process.env['ESTABELECIMENTOS'];
      else process.env['ESTABELECIMENTOS'] = antes;
    }
  });
});
