// W0-10: o mapa de dependências das tabelas SGH_ dos portais confere com os scripts versionados, e o portão "conta com
// operação não se exclui fisicamente" (nenhum DELETE das contas dos portais nem das tabelas só de inclusão no código
// de packages/legado e apps/api; nenhuma FK para as contas com ON DELETE).
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  CONTAS_DOS_PORTAIS,
  DEPENDENTES_DAS_CONTAS,
  TABELAS_SO_INCLUSAO_W0_10,
} from './dependencias-portais.js';

const SRC = resolve(import.meta.dirname, '../..');
const API = resolve(SRC, '../../../apps/api/src');

function arquivos(dir: string, fim: RegExp): string[] {
  const saida: string[] = [];
  for (const nome of readdirSync(dir)) {
    if (nome === 'node_modules') continue;
    const p = join(dir, nome);
    if (statSync(p).isDirectory()) saida.push(...arquivos(p, fim));
    else if (fim.test(nome)) saida.push(p);
  }
  return saida;
}

// Scripts SGH_ de aplicação (o recolher apaga por definição e não entra).
const scripts = arquivos(SRC, /^\d{4}_.*\.sql$/)
  .filter((p) => /\/sgh\//.test(p) && !/recolher/i.test(p))
  .map((p) => ({ p, nome: p.split('/').pop()!, sql: readFileSync(p, 'utf8') }));

interface Fk {
  tabela: string;
  coluna: string;
  destino: string;
  trecho: string;
}
function fksDe(sql: string): Fk[] {
  const fks: Fk[] = [];
  // CREATE TABLE … ( … FOREIGN KEY (COL) REFERENCES T (ID) … );
  for (const m of sql.matchAll(/CREATE TABLE\s+([A-Z0-9_$]+)\s*\(([\s\S]*?)\n\);/g)) {
    for (const f of m[2]!.matchAll(
      /FOREIGN KEY\s*\(([A-Z0-9_$]+)\)\s*REFERENCES\s+([A-Z0-9_$]+)\s*\([^)]*\)([^,\n]*)/g,
    ))
      fks.push({ tabela: m[1]!, coluna: f[1]!, destino: f[2]!, trecho: f[0]! });
  }
  // ALTER TABLE T ADD CONSTRAINT … FOREIGN KEY (COL) REFERENCES …
  for (const f of sql.matchAll(
    /ALTER TABLE\s+([A-Z0-9_$]+)\s+ADD\s+CONSTRAINT\s+\S+\s+FOREIGN KEY\s*\(([A-Z0-9_$]+)\)\s*REFERENCES\s+([A-Z0-9_$]+)\s*\([^)]*\)([^;]*)/g,
  ))
    fks.push({ tabela: f[1]!, coluna: f[2]!, destino: f[3]!, trecho: f[0]! });
  return fks;
}
const todasFks = scripts.flatMap((s) => fksDe(s.sql));
const contas: readonly string[] = CONTAS_DOS_PORTAIS;

describe('W0-10: mapa de dependências das tabelas SGH_ dos portais', () => {
  it('toda FK declarada para uma conta de portal está no mapa (e nada sobra no mapa)', () => {
    for (const conta of CONTAS_DOS_PORTAIS) {
      const declaradas = todasFks
        .filter((f) => f.destino === conta)
        .map((f) => `${f.tabela}.${f.coluna}`)
        .sort();
      const noMapa = DEPENDENTES_DAS_CONTAS[conta]
        .filter((d) => d.origem === 'fk')
        .map((d) => `${d.tabela}.${d.coluna}`)
        .sort();
      expect(noMapa, conta).toEqual(declaradas);
    }
  });

  it('os vínculos só por código existem nos scripts e não têm FK', () => {
    for (const conta of CONTAS_DOS_PORTAIS)
      for (const d of DEPENDENTES_DAS_CONTAS[conta].filter((x) => x.origem === 'codigo')) {
        const existe = scripts.some(
          (s) =>
            new RegExp(`CREATE TABLE\\s+${d.tabela}\\s*\\([\\s\\S]*?\\b${d.coluna}\\b`).test(s.sql) ||
            new RegExp(`ALTER TABLE\\s+${d.tabela}\\s+ADD\\s+${d.coluna}\\b`).test(s.sql),
        );
        expect(existe, `${d.tabela}.${d.coluna}`).toBe(true);
        expect(todasFks.some((f) => f.tabela === d.tabela && f.coluna === d.coluna)).toBe(false);
        expect(d.grupo.trim()).not.toBe('');
      }
  });

  it('toda tabela criada pelos scripts 1140 a 1159 está no mapa, com as FKs do script', () => {
    const doPacote = scripts.filter((s) => /^11(4\d|5\d)_/.test(s.nome));
    const criadas = doPacote.flatMap((s) =>
      [...s.sql.matchAll(/CREATE TABLE\s+([A-Z0-9_$]+)/g)].map((m) => ({
        tabela: m[1]!,
        script: s.nome.slice(0, 4),
      })),
    );
    expect(criadas.map((c) => c.tabela).sort()).toEqual(
      TABELAS_SO_INCLUSAO_W0_10.map((t) => t.tabela).sort(),
    );
    for (const t of TABELAS_SO_INCLUSAO_W0_10) {
      expect(criadas.find((c) => c.tabela === t.tabela)?.script, t.tabela).toBe(t.script);
      const fks = todasFks.filter((f) => f.tabela === t.tabela).map((f) => `${f.coluna} → ${f.destino}`);
      expect(t.referencias, t.tabela).toEqual(fks);
      expect(t.porque.trim()).not.toBe('');
    }
  });
});

describe('W0-10: portão "conta com operação não se exclui fisicamente"', () => {
  const protegidas = [...contas, ...TABELAS_SO_INCLUSAO_W0_10.map((t) => t.tabela)];
  const codigo = [...arquivos(SRC, /\.ts$/), ...arquivos(API, /\.ts$/)].filter(
    (p) => !/\.(spec|int\.spec|spec-util)\.ts$/.test(p) && !/\.spec\.ts$/.test(p),
  );

  it('nenhum DELETE das contas dos portais nem das tabelas só de inclusão no código', () => {
    const achados: string[] = [];
    const re = new RegExp(`DELETE\\s+FROM\\s+(${protegidas.join('|')})\\b`, 'i');
    for (const p of codigo) {
      const m = re.exec(readFileSync(p, 'utf8'));
      if (m) achados.push(`${p}: ${m[0]}`);
    }
    expect(achados).toEqual([]);
  });

  it('nenhuma FK para as contas dos portais apaga ou anula junto (ON DELETE)', () => {
    const comRegra = todasFks.filter((f) => contas.includes(f.destino) && /ON\s+DELETE/i.test(f.trecho));
    expect(comRegra).toEqual([]);
  });

  it('o próprio portão acusa um DELETE de conta (o padrão pega o caso)', () => {
    const re = new RegExp(`DELETE\\s+FROM\\s+(${protegidas.join('|')})\\b`, 'i');
    expect(re.test('await e.executar(`DELETE FROM SGH_OPE_PORTAL_ACESSO WHERE ID = ?`, [id]);')).toBe(true);
    expect(re.test('DELETE FROM SGH_OPE_PORTAL_ACESSO_X WHERE 1=0')).toBe(false);
  });
});
