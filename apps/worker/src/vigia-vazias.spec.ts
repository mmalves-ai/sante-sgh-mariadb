// Correção do M14 (regra 14): a vigia diária das tabelas vazias no worker — só na janela, uma vez por dia civil e
// por estabelecimento, sem retrato não roda, falha de um não para o outro; o aviso vai à TI e ao responsável
// técnico. Dublês de leitor e escritor (nada conecta a banco).
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Escritor, Leitor } from '@sgh/legado';
import { afterAll, describe, expect, it } from 'vitest';
import { destinatariosTabelaVazia } from './email.service.js';
import { vigiaVaziasLigada } from './vigia-vazias.service.js';
import { cicloVigiaVazias, diaCivil, lerPovoadas } from './vigia-vazias.js';

const pasta = mkdtempSync(join(tmpdir(), 'vigia-vazias-'));
afterAll(() => rmSync(pasta, { recursive: true, force: true }));
writeFileSync(join(pasta, 'populadas.aa.json'), JSON.stringify({ tabelas: ['POVOADA'] }));

const leitor: Leitor = {
  hospital: 'aa',
  async consultar(sql: string) {
    if (sql.includes('RDB$RELATIONS')) return [{ T: 'POVOADA' }, { T: 'VAZIA1' }, { T: 'NOVA' }] as never;
    if (sql.includes('FROM NOVA')) return [{ U: 1 }] as never;
    return [];
  },
  async lerBlob() {
    return Buffer.alloc(0);
  },
};
function escritor(comandos: string[]): Escritor {
  return {
    ...leitor,
    async consultar(sql: string) {
      comandos.push(sql);
      return [];
    },
    async executar(sql: string) {
      comandos.push(sql);
      return 1;
    },
    async executarRetornando(sql: string) {
      comandos.push(sql);
      return {};
    },
  };
}

describe('vigia diária das tabelas vazias (worker)', () => {
  it('na janela, uma vez por dia; grava a situação e o aviso; fora da janela e sem retrato não roda', async () => {
    const comandos: string[] = [];
    const ultimas = new Map<string, string>();
    const deps = {
      rede: 'rede-teste',
      hospitais: ['aa', 'bb'],
      povoadas: (h: string) => lerPovoadas(pasta, h),
      ler: <T>(_h: string, fn: (l: Leitor) => Promise<T>) => fn(leitor),
      gravarSgh: <T>(_h: string, fn: (e: Escritor) => Promise<T>) => fn(escritor(comandos)),
      janela: { inicio: '02:00', fim: '05:00' },
      agoraMinutos: () => 3 * 60,
      hoje: () => '2026-10-21',
      ultimas,
    };
    const r = await cicloVigiaVazias(deps);
    expect(r.map((x) => x.situacao)).toEqual(['feita', 'sem-retrato']);
    expect(r[0]?.resultado).toMatchObject({ verificadas: 2, vazias: 1, comDados: ['NOVA'] });
    expect(comandos.some((c) => /SGH_CFG_TABELA_VAZIA/.test(c))).toBe(true);
    expect(comandos.some((c) => /SGH_OUTBOX/.test(c))).toBe(true);
    expect((await cicloVigiaVazias(deps)).map((x) => x.situacao)).toEqual(['ja-rodou-hoje', 'sem-retrato']);
    expect(
      (await cicloVigiaVazias({ ...deps, agoraMinutos: () => 12 * 60 })).every(
        (x) => x.situacao === 'fora-da-janela',
      ),
    ).toBe(true);
  });
  it('falha de leitura num estabelecimento não para o ciclo e não marca o dia', async () => {
    const ultimas = new Map<string, string>();
    const r = await cicloVigiaVazias({
      rede: 'r',
      hospitais: ['aa'],
      povoadas: () => new Set(['X']),
      ler: async () => Promise.reject(new Error('caiu')),
      gravarSgh: async () => Promise.reject(new Error('não chega')),
      janela: { inicio: '02:00', fim: '05:00' },
      agoraMinutos: () => 150,
      hoje: () => '2026-10-21',
      ultimas,
    });
    expect(r[0]?.situacao).toBe('falhou');
    expect(ultimas.size).toBe(0);
  });
  it('ligada fora de dev/ci; em dev só com VIGIA_VAZIAS=ligado; dia civil; retrato inválido', () => {
    expect(vigiaVaziasLigada({ AMBIENTE: 'producao' })).toBe(true);
    expect(vigiaVaziasLigada({ AMBIENTE: 'producao', VIGIA_VAZIAS: 'desligado' })).toBe(false);
    expect(vigiaVaziasLigada({ AMBIENTE: 'dev' })).toBe(false);
    expect(vigiaVaziasLigada({ AMBIENTE: 'dev', VIGIA_VAZIAS: 'ligado' })).toBe(true);
    expect(diaCivil(new Date('2026-10-22T02:00:00Z'))).toBe('2026-10-21');
    expect(lerPovoadas(pasta, '../x')).toBeNull();
  });
  it('o aviso vai à TI e ao responsável técnico', () => {
    expect(
      destinatariosTabelaVazia({ AVISO_TI_EMAIL: 'ti@x.br', AVISO_RT_EMAIL: 'rt@x.br' }, 'aud@x.br', 'r'),
    ).toEqual(['ti@x.br', 'rt@x.br']);
    expect(destinatariosTabelaVazia({}, 'aud@x.br', 'rede')).toEqual([
      'aud@x.br',
      'responsavel-tecnico@rede.invalid',
    ]);
  });
});
