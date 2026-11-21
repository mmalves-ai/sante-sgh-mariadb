// pnpm implantacao:listas [-- --conferir]
// M60, sobre o banco próprio: gera docs/implantacao/anexos/scripts-sgh.md (as migrações do banco do cliente, com o
// hash, na ordem do "criar novo cliente"), docs/implantacao/anexos/privilegios-papel.sql (o papel da aplicação no
// banco do cliente) e docs/implantacao/anexos/privilegios-plataforma.sql (o mesmo papel no banco da plataforma), das
// tabelas das migrações e da exclusão física que o código das portas faz. `--conferir`: não grava; falha se um anexo
// não cita todas as migrações com o hash atual ou todas as concessões e retiradas (uso no verificar).
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { anexoDeMigracoes, conferirAnexo, lerMigracoes, listaDeMigracoes } from './listas.ts';
import {
  ANEXOS_PRIVILEGIOS,
  anexoDePrivilegios,
  type BancoDoAnexo,
  conferirAnexoPrivilegios,
  privilegiosDoRepositorio,
} from './privilegios.ts';

const raiz = resolve(import.meta.dirname, '../../..');
const destino = resolve(raiz, 'docs/implantacao/anexos/scripts-sgh.md');
const bancos: readonly BancoDoAnexo[] = ['cliente', 'plataforma'];

const itens = listaDeMigracoes(lerMigracoes(raiz));
const privilegios = privilegiosDoRepositorio(raiz);
if (process.argv.includes('--conferir')) {
  const texto = existsSync(destino) ? readFileSync(destino, 'utf8') : '';
  const r = conferirAnexo(texto, itens);
  if (r.faltam.length + r.hashDivergente.length > 0) {
    console.error(
      `Anexo das migrações desatualizado: ${r.faltam.length} faltando, ${r.hashDivergente.length} com hash diferente. Rode pnpm implantacao:listas.`,
    );
    process.exit(1);
  }
  for (const b of bancos) {
    const arq = resolve(raiz, ANEXOS_PRIVILEGIOS[b]);
    const faltam = conferirAnexoPrivilegios(existsSync(arq) ? readFileSync(arq, 'utf8') : '', privilegios[b]);
    if (faltam.length > 0) {
      console.error(
        `Anexo de privilégios (${b}) desatualizado: ${faltam.length} tabela(s) sem a concessão ou a retirada exata. Rode pnpm implantacao:listas.`,
      );
      process.exit(1);
    }
  }
  console.log(
    `Anexos em dia: ${itens.length} migração(ões); privilégios do papel: ${privilegios.cliente.length} tabela(s) no cliente, ${privilegios.plataforma.length} na plataforma.`,
  );
} else {
  mkdirSync(dirname(destino), { recursive: true });
  writeFileSync(destino, anexoDeMigracoes(itens));
  console.log(`docs/implantacao/anexos/scripts-sgh.md: ${itens.length} migração(ões).`);
  for (const b of bancos) {
    writeFileSync(resolve(raiz, ANEXOS_PRIVILEGIOS[b]), anexoDePrivilegios(privilegios[b], b));
    console.log(`${ANEXOS_PRIVILEGIOS[b]}: ${privilegios[b].length} tabela(s).`);
  }
}
