// pnpm implantacao:listas [-- --conferir]
// M60: gera docs/implantacao/anexos/scripts-sgh.md a partir dos scripts do repositório (nº, arquivo, sha256) e, desde a
// etapa 3, docs/implantacao/anexos/privilegios-papel.sql a partir do registro das receitas (D-PRIVILEGIOS-60.3).
// `--conferir`: não grava; falha se um anexo não cita todos os scripts com o hash atual ou todas as concessões
// (uso no verificar).
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { lerScriptsSgh, OPERACOES } from '@sgh/legado';
import { anexoDeScripts, conferirAnexo, listaDeScripts } from './listas.ts';
import { anexoDePrivilegios, conferirAnexoPrivilegios, privilegiosDoPapel } from './privilegios.ts';

const raiz = resolve(import.meta.dirname, '../../..');
const destino = resolve(raiz, 'docs/implantacao/anexos/scripts-sgh.md');
const itens = listaDeScripts(lerScriptsSgh(resolve(raiz, 'packages/legado/src')));
const destinoPriv = resolve(raiz, 'docs/implantacao/anexos/privilegios-papel.sql');
const privilegios = privilegiosDoPapel(Object.values(OPERACOES).map((o) => o.receita));
if (process.argv.includes('--conferir')) {
  const texto = existsSync(destino) ? readFileSync(destino, 'utf8') : '';
  const r = conferirAnexo(texto, itens);
  if (r.faltam.length + r.hashDivergente.length > 0) {
    console.error(
      `Anexo de scripts desatualizado: ${r.faltam.length} faltando, ${r.hashDivergente.length} com hash diferente. Rode pnpm implantacao:listas.`,
    );
    process.exit(1);
  }
  const faltamPriv = conferirAnexoPrivilegios(
    existsSync(destinoPriv) ? readFileSync(destinoPriv, 'utf8') : '',
    privilegios,
  );
  if (faltamPriv.length > 0) {
    console.error(
      `Anexo de privilégios desatualizado: ${faltamPriv.length} tabela(s) sem a concessão exata. Rode pnpm implantacao:listas.`,
    );
    process.exit(1);
  }
  console.log(
    `Anexo de scripts em dia: ${itens.length} script(s); privilégios do papel: ${privilegios.length} tabela(s).`,
  );
} else {
  mkdirSync(dirname(destino), { recursive: true });
  writeFileSync(destino, anexoDeScripts(itens));
  console.log(`docs/implantacao/anexos/scripts-sgh.md: ${itens.length} script(s).`);
  writeFileSync(destinoPriv, anexoDePrivilegios(privilegios));
  console.log(`docs/implantacao/anexos/privilegios-papel.sql: ${privilegios.length} tabela(s).`);
}
