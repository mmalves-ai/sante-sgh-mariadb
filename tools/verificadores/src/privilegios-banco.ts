// Privilégios da conta da aplicação no MariaDB (regra 4 do M59 reescrita para o banco próprio): lidos do
// information_schema (USER_PRIVILEGES, SCHEMA_PRIVILEGES, TABLE_PRIVILEGES) numa transação de leitura, e classificados
// por regra pura: a conta da aplicação não tem privilégio global, administrativo, de estrutura nem de repasse
// (GRANT OPTION). DELETE no banco inteiro é alerta: a imutabilidade clínica por privilégio pede concessão por tabela.
// Melhoria: o desvio é calculado sobre o banco real do cliente, sem plano versionado por módulo do sistema de origem.
import type { Leitor } from '@sgh/nucleo';

export type NivelPrivilegio = 'global' | 'banco' | 'tabela';

export interface PrivilegioBanco {
  readonly conta: string;
  readonly nivel: NivelPrivilegio;
  /** `*` (global), o banco, ou `banco.tabela`. */
  readonly alvo: string;
  readonly privilegio: string;
  readonly repassa: boolean;
}

/** Privilégios de administração do servidor: nunca na conta da aplicação. */
export const PRIVILEGIOS_ADMINISTRATIVOS: readonly string[] = [
  'SUPER', 'FILE', 'SHUTDOWN', 'PROCESS', 'RELOAD', 'CREATE USER', 'CREATE TABLESPACE', 'REPLICATION SLAVE',
  'REPLICATION CLIENT', 'BINLOG ADMIN', 'BINLOG MONITOR', 'BINLOG REPLAY', 'CONNECTION ADMIN', 'FEDERATED ADMIN',
  'READ_ONLY ADMIN', 'REPLICATION MASTER ADMIN', 'REPLICATION SLAVE ADMIN', 'SET USER', 'SLAVE MONITOR',
];
/** Privilégios de estrutura: só a conta das migrações, nunca a da aplicação. */
export const PRIVILEGIOS_ESTRUTURA: readonly string[] = [
  'CREATE', 'DROP', 'ALTER', 'INDEX', 'REFERENCES', 'CREATE VIEW', 'TRIGGER', 'EVENT', 'CREATE ROUTINE',
  'ALTER ROUTINE', 'CREATE TEMPORARY TABLES', 'DELETE HISTORY',
];

type LinhaPrivilegio = { conta: string; nivel: string; alvo: string; privilegio: string; repassa: string };

/** Os privilégios visíveis à conta da sessão (os dela; os de outras contas só com acesso ao catálogo). */
export async function lerPrivilegiosDaConta(l: Leitor): Promise<PrivilegioBanco[]> {
  const r = await l.consultar<LinhaPrivilegio>(
    `SELECT GRANTEE AS conta, 'global' AS nivel, '*' AS alvo, PRIVILEGE_TYPE AS privilegio, IS_GRANTABLE AS repassa
       FROM information_schema.USER_PRIVILEGES
     UNION ALL
     SELECT GRANTEE, 'banco', TABLE_SCHEMA, PRIVILEGE_TYPE, IS_GRANTABLE FROM information_schema.SCHEMA_PRIVILEGES
     UNION ALL
     SELECT GRANTEE, 'tabela', CONCAT(TABLE_SCHEMA, '.', TABLE_NAME), PRIVILEGE_TYPE, IS_GRANTABLE
       FROM information_schema.TABLE_PRIVILEGES`,
  );
  return r.map((x) => ({
    conta: String(x.conta),
    nivel: x.nivel as NivelPrivilegio,
    alvo: String(x.alvo),
    privilegio: String(x.privilegio).toUpperCase(),
    repassa: String(x.repassa).toUpperCase() === 'YES',
  }));
}

/** Nome da conta sem o host (`'app'@'%'` vira `app`). */
export function nomeDaConta(grantee: string): string {
  return /^'?([^'@]*)'?(?:@.*)?$/.exec(grantee.trim())?.[1] ?? grantee;
}

export interface DesviosDaConta {
  readonly excesso: readonly string[];
  readonly alertas: readonly string[];
}

/** Desvios da conta da aplicação (só as linhas dela). */
export function desviosDaConta(privilegios: readonly PrivilegioBanco[], conta: string): DesviosDaConta {
  const excesso: string[] = [];
  const alertas: string[] = [];
  for (const p of privilegios.filter((x) => nomeDaConta(x.conta) === conta)) {
    const onde = `${p.privilegio} em ${p.alvo}`;
    if (p.repassa) excesso.push(`${onde} com GRANT OPTION`);
    if (p.nivel === 'global' && p.privilegio !== 'USAGE') excesso.push(`${onde} (global)`);
    else if (PRIVILEGIOS_ADMINISTRATIVOS.includes(p.privilegio)) excesso.push(`${onde} (administração)`);
    else if (PRIVILEGIOS_ESTRUTURA.includes(p.privilegio) || p.privilegio === 'ALL PRIVILEGES')
      excesso.push(`${onde} (estrutura)`);
    else if (p.nivel === 'banco' && p.privilegio === 'DELETE')
      alertas.push(`${onde}: DELETE no banco inteiro (a imutabilidade clínica pede concessão por tabela)`);
  }
  return { excesso, alertas };
}
