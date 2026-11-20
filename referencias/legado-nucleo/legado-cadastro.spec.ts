// M11: o núcleo roda o vigia do índice (com a memória da janela só depois do COMMIT), a leitura incremental da
// fila de duplicidades (pares e a linha da SGH_TRILHA na mesma transação SGH_) e a conferência por contagem.
// Dublê do driver; dados sintéticos.
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { ambienteFicticio, criarDubleDriver, type Responder } from './duble-driver.spec-util.js';
import { NucleoLegado, USUARIO_VIGIA } from './legado.js';

const pasta = mkdtempSync(join(tmpdir(), 'sgh-nucleo-cadastro-'));
afterAll(() => rmSync(pasta, { recursive: true, force: true }));

const vistos: { sql: string; parametros: readonly unknown[] }[] = [];
const responder: Responder = (sql, parametros) => {
  vistos.push({ sql, parametros });
  if (sql.includes("CAMPO = '$MARCA'") && sql.startsWith('SELECT')) return [{ PALAVRA: '10' }];
  if (sql.includes('FROM HTPACIENTE WHERE ID > ? AND ID <= ?')) return [{ ID: 9, R: 7 }];
  if (sql.includes('FROM HTPACIENTE WHERE ID > ?')) return [];
  if (sql.includes('FROM RICADPAC WHERE ID IN'))
    return parametros.map((id) => ({
      ID: id,
      ID_RICADPAC_UNIFICADO: id,
      PRONT: 1,
      NOME: 'ANA SINTETICA',
      ATIVO: 'T',
    }));
  if (sql.startsWith('SELECT DISTINCT FONETICA')) return [{ FONETICA: 'ANA' }];
  if (sql.includes('HAVING COUNT(DISTINCT FONETICA)')) return [{ ID_LEGADO: 8 }];
  if (sql.includes('COUNT(DISTINCT ID_LEGADO)')) return [{ N: 4 }];
  if (sql.includes('COUNT(*) N FROM')) return [{ N: 5 }];
  if (sql.includes('FROM SGH_TRILHA')) return [];
  if (sql.includes('NEXT VALUE FOR SGH_GEN_TRILHA'))
    return [{ ID: '9', H: '2026-10-20 10:00:00.0000', D: '2026-10-20' }];
  return [];
};

function nucleo() {
  return new NucleoLegado({
    env: ambienteFicticio(['pc']),
    driver: criarDubleDriver(responder),
    pastaHomologada: pasta,
  });
}

describe('núcleo: índice de busca e fila de duplicidades do M11', () => {
  it('vigia com memória entre ciclos (a versão vista não se repete); fila com trilha; contagem', async () => {
    const n = nucleo();
    try {
      const [p1] = await n.cicloIndiceBusca('pc');
      expect(p1).toMatchObject({ entidade: 'paciente', atrasados: 1, ids: [7] });
      const [p2] = await n.cicloIndiceBusca('pc');
      expect(p2).toMatchObject({ atrasados: 0, ids: [] });
      expect(await n.alimentarFilaDuplicidade('pc', [], () => null)).toBe(0);
      const antes = vistos.length;
      const novos = await n.alimentarFilaDuplicidade('pc', [7], () => ({
        escore: 80,
        criterios: ['fonetica'],
      }));
      expect(novos).toBe(1);
      // O dublê do driver só anota as consultas: o par conferido na fila e a trilha (gerador da SGH_TRILHA).
      const sqls = vistos.slice(antes).map((v) => v.sql);
      expect(sqls.some((x) => x.includes('FROM SGH_CAD_DUPLICIDADE'))).toBe(true);
      expect(sqls.some((x) => x.includes('SGH_GEN_TRILHA'))).toBe(true);
      expect(USUARIO_VIGIA).toBe('SGH.VIGIA');
      expect(await n.alimentarFilaDuplicidade('pc', [7], () => null)).toBe(0);
      expect(await n.contagemIndiceBusca('pc', 'solicitante')).toEqual({ indice: 4, legado: 5 });
    } finally {
      await n.encerrar();
    }
  });
});
