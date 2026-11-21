// Regra 16 do M52 (cap-07 §7.1.4): o prontuário ocupacional fica separado do PEP. Prova em três camadas:
//   1. no banco do cliente: nenhum gatilho nem visão depende das tabelas do SESMT (a regra fica no domínio);
//   2. no catálogo de permissões: nenhuma opção de origem que dá permissão do PEP dá permissão do SESMT, e
//      vice-versa (quem tem só o PEP não abre o SESMT; o SESMT não abre o PEP);
//   3. no código: nenhum módulo do PEP cita as tabelas do SESMT, e o módulo do SESMT não importa o PEP.
// A leitura auditada como dado de saúde está no teste HTTP (`sesmt.spec.ts`: `pessoas.ocupacional.lido`).
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { CATALOGO_DECLARADO, PERMISSOES_PESSOAS_M52_F5 } from '@sgh/contratos';
import { afterAll, describe, expect, it } from 'vitest';
import { NucleoProprio } from '@sgh/nucleo';

const CLIENTE_O3 = process.env['SGH_CLIENTE_TESTE']?.trim() || 'f22_o3';
const SEM_BANCO_O3 = process.env['SGH_NUCLEO_SEM_BANCO'] === '1';

const TABELAS = [
  'aso',
  'exame_ocupacional',
  'vacina_colaborador',
  'comunicacao_acidente',
  'exposicao_biologica',
  'risco_funcao',
  'epi_funcao',
  'entrega_epi',
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

  it('código: o PEP não lê as tabelas do SESMT e o SESMT não importa o PEP', () => {
    const pep = [
      ...arquivos(join(raiz, 'apps/api/src/modulos/pep')),
      ...arquivos(join(raiz, 'apps/web/src/modulos/pep')),
    ];
    expect(pep.length).toBeGreaterThan(10);
    for (const f of pep)
      expect(readFileSync(f, 'utf8'), f).not.toMatch(
        /\b(aso|exame_ocupacional|vacina_colaborador|exposicao_biologica|entrega_epi)\b|pessoas\/sesmt|sesmt\//,
      );
    const sesmt = [
      ...arquivos(join(raiz, 'apps/api/src/modulos/pessoas/sesmt')),
      ...arquivos(join(raiz, 'apps/web/src/modulos/pessoas/sesmt')),
    ];
    for (const f of sesmt) expect(readFileSync(f, 'utf8'), f).not.toMatch(/from '[./]*\/?pep\/|modulos\/pep/);
  });

  describe.skipIf(SEM_BANCO_O3)('no banco do cliente (f22_o3)', () => {
    const nucleo = new NucleoProprio();
    afterAll(async () => {
      await nucleo.encerrar();
    });

    it('nenhum gatilho nem visão do banco depende das tabelas do SESMT (regra 2 e regra 16)', async () => {
      const r = await nucleo.lerSomente(
        { cliente: CLIENTE_O3, correlacao: 'int-l0310-segregacao' },
        async (l) => {
          const lista = TABELAS.map(() => '?').join(', ');
          const [gatilhos] = await l.consultar<{ n: number }>(
            `SELECT COUNT(*) AS n FROM information_schema.triggers
            WHERE trigger_schema = DATABASE() AND event_object_table IN (${lista})`,
            TABELAS,
          );
          const visoes = await l.consultar<{ nome: string; definicao: string }>(
            `SELECT table_name AS nome, view_definition AS definicao FROM information_schema.views WHERE table_schema = DATABASE()`,
            [],
          );
          const [existem] = await l.consultar<{ n: number }>(
            `SELECT COUNT(*) AS n FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name IN (${lista})`,
            TABELAS,
          );
          return {
            gatilhos: Number(gatilhos?.n ?? -1),
            existem: Number(existem?.n ?? 0),
            visoes: visoes
              .filter((v) => TABELAS.some((t) => new RegExp(`\\b${t}\\b`).test(String(v.definicao))))
              .map((v) => v.nome),
          };
        },
      );
      expect(r.existem).toBe(TABELAS.length);
      expect(r.gatilhos).toBe(0);
      expect(r.visoes).toEqual([]);
    }, 60_000);
  });
});
