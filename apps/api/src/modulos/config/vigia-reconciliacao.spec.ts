// Revisão do W0-02 (D-CRUD-SEM-GATILHO): o despertar da vigia de reconciliação dos cadastros. Com a fonte do banco
// (dublê), a rodada abre a transação SGH_ e roda a vigia em cada estabelecimento (desligada pelo parâmetro: só a
// leitura do parâmetro); a falha de uma rodada fica no resumo; o relatório lê os achados; a fonte em memória não roda.
import type { Escritor } from '@sgh/legado';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { FonteDominios } from './dominios-fonte.js';
import { VigiaReconciliacaoCrud } from './vigia-reconciliacao.js';

function fonte(destino: 'legado' | 'memoria', ligada: boolean, falhar = false) {
  const sqls: string[] = [];
  const e = {
    hospital: 'aa',
    consultar: async (sql: string) => {
      sqls.push(sql);
      if (falhar) throw new Error('conexão perdida');
      if (/SGH_CFG_PARAMETRO/.test(sql)) return ligada ? [{ VALOR: 'sim' }] : [];
      if (/SGH_CRUD_VIGIA_ACHADO/.test(sql))
        return [
          {
            TABELA: 'CHTPLIMPEZA',
            CONTAGEM_ANTES: 4,
            CONTAGEM_DEPOIS: 3,
            FORA_DO_SANTE: 1,
            CHAVES: '["9"]',
            DETECTADO_EM: 'x',
          },
        ];
      if (/COUNT\(\*\) N, COALESCE/.test(sql)) return [{ N: 0, S: 0 }];
      return [];
    },
    lerBlob: async () => Buffer.alloc(0),
    executar: async () => 1,
    executarRetornando: async () => ({ ID: '1' }),
    uma: async () => null,
  } as unknown as Escritor;
  const f = {
    destino,
    ler: async <T>(_r: string, _h: string, fn: (l: Escritor) => Promise<T>) => fn(e),
    gravarSgh: async <T>(_r: string, _h: string, fn: (l: Escritor) => Promise<T>) => fn(e),
  } as unknown as FonteDominios;
  return { f, sqls };
}

afterEach(() => vi.useRealTimers());

describe('vigia de reconciliação (despertar da API)', () => {
  it('desligada pelo parâmetro: a rodada só lê o parâmetro', async () => {
    const { f, sqls } = fonte('legado', false);
    const v = new VigiaReconciliacaoCrud(f, 'rede', ['aa'], () => new Date('2026-11-18T10:00:00Z'));
    expect(await v.rodarTodos()).toEqual([{ hospital: 'aa', ligada: false, tabelas: 0, achados: 0 }]);
    expect(sqls.every((s) => /SGH_CFG_PARAMETRO/.test(s))).toBe(true);
    expect(v.ultima('aa')).toMatchObject({ ligada: false, em: '2026-11-18T10:00:00.000Z' });
  });

  it('ligada: lê as tabelas dos domínios declarados; o relatório lê os achados com o rótulo', async () => {
    const { f, sqls } = fonte('legado', true);
    const v = new VigiaReconciliacaoCrud(f, 'rede', ['aa']);
    const [r] = await v.rodarTodos();
    expect(r?.ligada).toBe(true);
    expect(r?.tabelas).toBeGreaterThan(10);
    expect(sqls.some((s) => /FROM CHTPLIMPEZA/.test(s))).toBe(true);
    const rel = await v.relatorio('aa', () => 'Tipos de limpeza');
    expect(rel).toEqual([
      expect.objectContaining({ rotulo: 'Tipos de limpeza', foraDoSante: 1, chaves: ['9'] }),
    ]);
  });

  it('a falha da rodada fica no resumo (não derruba); a fonte em memória não roda nem liga o despertar', async () => {
    const { f } = fonte('legado', true, true);
    const v = new VigiaReconciliacaoCrud(f, 'rede', ['aa']);
    expect((await v.rodada('aa')).erro).toBe('conexão perdida');
    const mem = new VigiaReconciliacaoCrud(fonte('memoria', true).f, 'rede', ['aa']);
    mem.iniciar(10);
    expect(mem.ligadoODespertar).toBe(false);
    expect(await mem.rodada('aa')).toEqual({ hospital: 'aa', ligada: false, tabelas: 0, achados: 0 });
    expect(await mem.relatorio('aa', () => undefined)).toEqual([]);
  });

  it('o despertar roda a cada intervalo e para', async () => {
    vi.useFakeTimers();
    const { f } = fonte('legado', false);
    const v = new VigiaReconciliacaoCrud(f, 'rede', ['aa']);
    const rodar = vi.spyOn(v, 'rodarTodos');
    v.iniciar(1000);
    expect(v.ligadoODespertar).toBe(true);
    await vi.advanceTimersByTimeAsync(2500);
    expect(rodar).toHaveBeenCalledTimes(2);
    v.parar();
    expect(v.ligadoODespertar).toBe(false);
  });
});
