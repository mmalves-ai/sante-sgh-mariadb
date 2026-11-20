// Regra 16 do M52 (cap-07 §7.1.4): o prontuário ocupacional fica separado do PEP. Prova em três camadas:
//   1. no banco da cópia: nenhum objeto do outro sistema (visão, trigger, procedure) depende das tabelas do SESMT, e o
//      papel da aplicação só lê e inclui no prontuário ocupacional e nas vacinas (nem UPDATE nem DELETE);
//   2. no catálogo de permissões: nenhuma opção do outro sistema que dá permissão do PEP dá permissão do SESMT, e
//      vice-versa (quem tem só o PEP não abre o SESMT; o SESMT não abre o PEP);
//   3. no código: nenhum repositório nem módulo do PEP lê SGH_PES_*, e o módulo do SESMT não importa o PEP.
// A leitura auditada como dado de saúde está no teste HTTP (`sesmt.spec.ts`: `pessoas.ocupacional.lido`).
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { CATALOGO_DECLARADO, PERMISSOES_PESSOAS_M52_F5 } from '@sgh/contratos';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type AmbienteM27, ambienteM27, NA_COPIA } from '../../acesso/aplicacao/copia.spec-util.js';

const TABELAS = [
  'SGH_PES_OCUPACIONAL',
  'SGH_PES_VACINA',
  'SGH_PES_ACIDENTE',
  'SGH_PES_ACID_SOROLOGIA',
  'SGH_PES_RISCO_FUNCAO',
  'SGH_PES_EPI_ENTREGA',
];
const raiz = resolve(import.meta.dirname, '../../../../../..');

function arquivos(pasta: string): string[] {
  const r: string[] = [];
  for (const x of readdirSync(pasta)) {
    const p = join(pasta, x);
    if (statSync(p).isDirectory()) r.push(...arquivos(p));
    else if (/\.(ts|vue)$/.test(x) && !/\.spec\.ts$/.test(x)) r.push(p);
  }
  return r;
}

describe('segregação do prontuário ocupacional (regra 16)', () => {
  it('catálogo: as opções do SESMT não dão permissão do PEP, e as do PEP não dão permissão do SESMT', () => {
    const sesmt = new Set(PERMISSOES_PESSOAS_M52_F5.flatMap((p) => p.opcoesLegado));
    const doPep = CATALOGO_DECLARADO.filter((p) => p.codigo.startsWith('pep.'));
    expect(doPep.length).toBeGreaterThan(0);
    for (const p of doPep)
      for (const o of p.opcoesLegado) expect(sesmt.has(o), `${p.codigo} ${o}`).toBe(false);
    for (const p of PERMISSOES_PESSOAS_M52_F5) {
      expect(p.concessaoPorPerfil).toBeNull();
      expect(p.codigo.startsWith('pessoas.')).toBe(true);
    }
  });

  it('código: o PEP não lê SGH_PES_* e o SESMT não importa o PEP', () => {
    const pep = [
      ...arquivos(join(raiz, 'packages/legado/src/pep')),
      ...arquivos(join(raiz, 'apps/api/src/modulos/pep')),
      ...arquivos(join(raiz, 'apps/web/src/modulos/pep')),
    ];
    expect(pep.length).toBeGreaterThan(10);
    for (const f of pep) expect(readFileSync(f, 'utf8'), f).not.toMatch(/SGH_PES_|pessoas\/sesmt|sesmt\//);
    const sesmt = [
      ...arquivos(join(raiz, 'apps/api/src/modulos/pessoas/sesmt')),
      ...arquivos(join(raiz, 'apps/web/src/modulos/pessoas/sesmt')),
    ];
    for (const f of sesmt) expect(readFileSync(f, 'utf8'), f).not.toMatch(/from '[./]*\/?pep\/|modulos\/pep/);
  });

  describe.skipIf(!NA_COPIA)('na cópia', () => {
    let a: AmbienteM27;
    beforeAll(async () => {
      a = await ambienteM27();
    }, 900_000);
    afterAll(async () => {
      await a?.nucleo.encerrar();
    });

    it('nenhum objeto do outro sistema depende das tabelas do SESMT; o papel só lê e inclui no prontuário', async () => {
      const r = await a.nucleo.lerSomente({ ...a.c, traceId: 'int-m525-segregacao' }, async (l) => {
        const lista = TABELAS.map(() => '?').join(', ');
        const [dep] = await l.consultar(
          `SELECT COUNT(*) N FROM RDB$DEPENDENCIES WHERE RDB$DEPENDED_ON_NAME IN (${lista})
             AND RDB$DEPENDENT_NAME NOT STARTING WITH 'SGH_'
             AND RDB$DEPENDENT_NAME NOT IN (SELECT RDB$TRIGGER_NAME FROM RDB$TRIGGERS WHERE RDB$RELATION_NAME IN (${lista}))`,
          [...TABELAS, ...TABELAS],
          { teto: 1 },
        );
        const [existem] = await l.consultar(
          `SELECT COUNT(*) N FROM RDB$RELATIONS WHERE RDB$RELATION_NAME IN (${lista})`,
          TABELAS,
          { teto: 1 },
        );
        const privs = await l.consultar(
          `SELECT TRIM(RDB$RELATION_NAME) T, RDB$PRIVILEGE P FROM RDB$USER_PRIVILEGES
             WHERE RDB$USER = 'SGH_APLICACAO' AND RDB$RELATION_NAME IN ('SGH_PES_OCUPACIONAL', 'SGH_PES_VACINA')`,
          [],
          { teto: 50 },
        );
        return {
          dependentes: Number(dep?.['N'] ?? -1),
          existem: Number(existem?.['N'] ?? 0),
          privilegios: [...new Set(privs.map((x) => `${String(x['T'])}:${String(x['P']).trim()}`))].sort(),
        };
      });
      expect(r.existem).toBe(TABELAS.length);
      expect(r.dependentes).toBe(0);
      expect(r.privilegios).toEqual([
        'SGH_PES_OCUPACIONAL:I',
        'SGH_PES_OCUPACIONAL:S',
        'SGH_PES_VACINA:I',
        'SGH_PES_VACINA:S',
      ]);
    }, 900_000);
  });
});
