// Verificador do data mart (ficha do M16, regra 17): falha com coluna identificadora (nome, documento, contato,
// endereço, nascimento, texto clínico, identificador cru de paciente ou internação) no esquema declarado em
// @sgh/dominio-relatorio/datamart e, quando já houver carga, nos arquivos SQLite de DATA_MART_DIR (.tmp/data-mart).
import { existsSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { colunasIdentificadoras, ESQUEMA_DATAMART } from '@sgh/dominio-relatorio/datamart';

const raiz = resolve(import.meta.dirname, '../../..');
const ruins = colunasIdentificadoras(ESQUEMA_DATAMART);
const pasta = resolve(raiz, process.env['DATA_MART_DIR']?.trim() || '.tmp/data-mart');
let arquivos = 0;
if (existsSync(pasta)) {
  for (const f of readdirSync(pasta).filter((x) => x.endsWith('.sqlite'))) {
    arquivos++;
    const db = new DatabaseSync(resolve(pasta, f), { readOnly: true });
    try {
      const tabelas = (
        db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as { name: string }[]
      ).map((t) => ({
        nome: `${f}:${t.name}`,
        colunas: Object.fromEntries(
          (db.prepare(`PRAGMA table_info(${t.name})`).all() as { name: string }[]).map((c) => [
            c.name,
            'texto' as const,
          ]),
        ),
      }));
      ruins.push(...colunasIdentificadoras(tabelas));
    } finally {
      db.close();
    }
  }
}
console.log(
  `[datamart] ${ESQUEMA_DATAMART.length} tabela(s) declarada(s), ${arquivos} arquivo(s) carregado(s); coluna identificadora ${ruins.length} → ${ruins.length === 0 ? 'verde' : 'VERMELHO'}`,
);
for (const r of ruins) console.log(`  ${r}`);
process.exit(ruins.length === 0 ? 0 : 1);
