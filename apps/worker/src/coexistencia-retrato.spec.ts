// M37 (regras 1 e 2): o ciclo do worker lê as conexões e as contagens do dia e grava o retrato e o uso numa transação
// SGH_ por estabelecimento; a falha de um não para os outros; ligado fora de dev/ci (em dev/ci só com a marca).
import { MEDIDAS_USO } from '@sgh/legado';
import { describe, expect, it, vi } from 'vitest';
import { cicloRetrato } from './coexistencia-retrato.js';
import { estacoesTecnicas, retratoLigado } from './coexistencia-retrato.service.js';

function leitorFalso(): { consultar: (sql: string) => Promise<Record<string, unknown>[]> } {
  return {
    consultar: async (sql: string) => {
      if (sql.includes('CURRENT_TIMESTAMP')) return [{ H: new Date('2026-11-04T10:00:00Z') }];
      if (sql.includes('FROM TBSGHCONEXAO'))
        return [
          { USUARIO: 'SINT.A', MODULO: 1, D: new Date('2026-11-04T09:00:00Z') },
          { USUARIO: 'SINT.B', MODULO: 1, D: new Date('2026-11-01T09:00:00Z') },
        ];
      if (sql.includes('MAX(ULTIMA)'))
        return [{ LOGIN: 'SINT.A', MODULO: 1, U: new Date('2026-11-03T09:00:00Z') }];
      if (sql.includes('MON$ATTACHMENTS'))
        return [
          { PROC: 'C:\\SIS\\HOSP.EXE', ENDERECO: '10.0.0.5', MARCA: null },
          { PROC: 'C:\\SIS\\HOSP.EXE', ENDERECO: '10.0.0.9', MARCA: null },
        ];
      if (sql.includes('SGH_TRILHA')) return [{ N: 1 }];
      if (sql.includes('COUNT(*)')) return [{ N: 4 }];
      return [];
    },
  };
}

describe('retrato das conexões no worker', () => {
  it('grava o retrato (com a mudança) e o uso do dia por operação; a falha de um estabelecimento não para o outro', async () => {
    const gravados: string[] = [];
    const r = await cicloRetrato({
      rede: 'rede-teste',
      hospitais: ['aa', 'bb'],
      ler: async (h, fn) => {
        if (h === 'bb') throw new Error('banco fora');
        return fn(leitorFalso() as never);
      },
      gravarSgh: async (_h, fn) =>
        fn({
          consultar: async () => [],
          executar: async (sql: string) => {
            gravados.push(sql.trim().split(/\s+/).slice(0, 3).join(' '));
            return 0;
          },
          executarRetornando: async () => ({ ID: '1' }),
        } as never),
    });
    // Uma linha de uso por medida da lista fechada (as do M37 e, desde a revisão do M40, as seis da onda 2).
    expect(r[0]).toMatchObject({
      hospital: 'aa',
      situacao: 'feito',
      conexoes: 2,
      mudaram: 1,
      operacoes: MEDIDAS_USO.length,
    });
    expect(r[1]).toMatchObject({ hospital: 'bb', situacao: 'falhou' });
    expect(gravados.some((g) => g.startsWith('INSERT INTO SGH_CFG_COEX_CONEXAO'))).toBe(true);
    expect(gravados.some((g) => g.startsWith('INSERT INTO SGH_CFG_COEX_USO_DIA'))).toBe(true);
    // M43: a série das conexões do outro sistema ao banco (o executável fora das estações técnicas).
    expect(r[0]).toMatchObject({ conexoesOutroSistema: 2 });
    expect(gravados.filter((g) => g.startsWith('UPDATE SGH_CFG_COEX_USO_DIA')).length).toBeGreaterThan(0);
  });

  it('M43: a série das conexões ao banco falha sozinha (o retrato segue; o dia fica sem coleta)', async () => {
    const r = await cicloRetrato({
      rede: 'rede-teste',
      hospitais: ['aa'],
      ler: async (_h, fn) =>
        fn({
          consultar: async (sql: string) => {
            if (sql.includes('MON$ATTACHMENTS')) throw new Error('MON$ indisponível');
            return leitorFalso().consultar(sql);
          },
        } as never),
      gravarSgh: async (_h, fn) =>
        fn({
          consultar: async () => [],
          executar: async () => 0,
          executarRetornando: async () => ({}),
        } as never),
      estacoesTecnicas: ['10.0.0.9'],
    });
    expect(r[0]).toMatchObject({ situacao: 'feito', conexoesOutroSistema: null });
  });

  it('M43: as estações técnicas do ambiente', () => {
    expect(estacoesTecnicas({ COEX_ESTACOES_TECNICAS: ' 10.0.0.9, ,srv-backup ' })).toEqual([
      '10.0.0.9',
      'srv-backup',
    ]);
    expect(estacoesTecnicas({})).toEqual([]);
  });

  it('ligado fora de dev/ci; em dev/ci só com COEX_RETRATO=ligado; desligado sempre manda', () => {
    expect(retratoLigado({ AMBIENTE: 'producao' })).toBe(true);
    expect(retratoLigado({ AMBIENTE: 'dev' })).toBe(false);
    expect(retratoLigado({ AMBIENTE: 'ci', COEX_RETRATO: 'ligado' })).toBe(true);
    expect(retratoLigado({ AMBIENTE: 'homolog', COEX_RETRATO: 'desligado' })).toBe(false);
    vi.restoreAllMocks();
  });
});
