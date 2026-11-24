// M60, etapa 3, refeito sobre o banco próprio: os privilégios do papel da aplicação (`papel_aplicacao`) nos dois bancos
// que a aplicação abre: o banco de cada cliente (as migrações de db/migracoes) e o banco da plataforma (db/plataforma:
// clientes, credencial do administrador, fila do conector). Gerados na hora do pacote, das migrações e do código das
// portas (quais tabelas sofrem exclusão física): nunca desatualizam. Os anexos `privilegios-papel.sql` (banco do
// cliente) e `privilegios-plataforma.sql` (banco da plataforma) são executados pela TI como administrador, conectada
// ao banco do anexo, depois de cada migração: só CREATE ROLE, GRANT e REVOKE, nenhuma estrutura nem dado.
// Melhoria: menor privilégio por regra do modelo, conferida pelo próprio banco:
//   - a trilha de auditoria e a linha do tempo do cliente só recebem SELECT e INSERT (só de acréscimo);
//   - tabela com exclusão lógica (`excluido_em`, criada no CREATE TABLE ou acrescentada depois por ALTER TABLE) não
//     recebe DELETE, salvo quando o código de uma porta a apaga de fato (`DELETE FROM <t>` literal ou a exclusão
//     física do núcleo, `.excluir('<t>', ...)` / `excluirAuditado(e, '<t>', ...)`).
// Melhoria: o anexo converge: depois de cada GRANT vem o REVOKE do que a tabela não deve ter. Reaplicar o anexo depois
// de uma migração que passou a tabela à exclusão lógica tira o DELETE concedido antes (o GRANT antes do REVOKE garante
// que o REVOKE nunca falha por falta de concessão).
// Melhoria: nome de tabela só passa pelo padrão de identificador do modelo (nada de SQL montado com texto livre).
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { deleteClinicoProibido } from '@sgh/contratos';
import { lerMigracoes } from './listas.ts';

export const PAPEL = 'papel_aplicacao';
const ORDEM_ACOES = ['SELECT', 'INSERT', 'UPDATE', 'DELETE'] as const;
export type AcaoGrant = (typeof ORDEM_ACOES)[number];

/** Tabelas só de acréscimo: a aplicação lê e inclui, nunca altera nem apaga. */
export const SO_ACRESCIMO: ReadonlySet<string> = new Set([
  'trilha_auditoria',
  'trilha_auditoria_fecho',
  'trilha_encadeamento_inicio',
  'cliente_evento',
  // história de aprovação dos modelos de formulário (com o SHA-256 da definição publicada): só inclusão
  'modelo_documento_evento',
  // qualidade: a sugestão de notificação já resolvida (resumo da origem) é registro histórico, só inclusão
  'sugestao_notificacao_resolvida',
  // banco plataforma (ADR 0021): auditoria das contas da plataforma e o aviso ao Auditor de cada sessão "como"
  'conta_plataforma_evento',
  'sessao_suporte_aviso',
]);

/**
 * Registro de auditoria que a aplicação altera (estado, contagem, encerramento) mas nunca apaga, sem exclusão lógica:
 * sem DELETE. Banco plataforma (ADR 0021): contas, atribuições e as sessões "como" com as suas escritas e leituras.
 */
export const SEM_EXCLUSAO_FISICA: ReadonlySet<string> = new Set([
  'conta_plataforma',
  'atribuicao_suporte',
  'sessao_suporte',
  'sessao_suporte_acao',
  'sessao_suporte_leitura',
]);

/** O banco a que o anexo se aplica. */
export type BancoDoAnexo = 'cliente' | 'plataforma';

export interface TabelaDoModelo {
  readonly tabela: string;
  /** Tem a coluna `excluido_em` (exclusão lógica). */
  readonly exclusaoLogica: boolean;
}

export interface PrivilegioTabela {
  readonly tabela: string;
  /** Ações na ordem SELECT, INSERT, UPDATE, DELETE. */
  readonly acoes: readonly AcaoGrant[];
}

const NOME_VALIDO = /^[a-z][a-z0-9_]{0,63}$/;

const semComentarios = (sql: string) =>
  sql
    .split('\n')
    .filter((l) => !l.trim().startsWith('--'))
    .join('\n');

/** As tabelas de um DDL (`CREATE TABLE <nome> (...)`), com a marca da exclusão lógica do próprio CREATE. */
export function tabelasDoDdl(sql: string): TabelaDoModelo[] {
  const r: TabelaDoModelo[] = [];
  const partes = semComentarios(sql)
    .split(/\bCREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?/i)
    .slice(1);
  for (const p of partes) {
    const nome = /^`?([A-Za-z0-9_]+)`?/.exec(p)?.[1] ?? '';
    const corpo = p.split(/\b(?:ALTER|CREATE)\s+TABLE\b/i)[0] ?? '';
    r.push({ tabela: nome, exclusaoLogica: /^\s*`?excluido_em`?\s/m.test(corpo) });
  }
  return r;
}

/** Tabelas que ganham `excluido_em` por `ALTER TABLE <t> ... ADD [COLUMN] [IF NOT EXISTS] excluido_em`. */
export function exclusaoLogicaPorAlter(sql: string): Set<string> {
  const r = new Set<string>();
  for (const cmd of semComentarios(sql).split(';')) {
    const t = /^\s*ALTER\s+TABLE\s+`?([A-Za-z0-9_]+)`?/i.exec(cmd)?.[1];
    if (t && /\bADD\s+(?:COLUMN\s+)?(?:IF\s+NOT\s+EXISTS\s+)?`?excluido_em`?\s/i.test(cmd))
      r.add(t.toLowerCase());
  }
  return r;
}

/**
 * As tabelas do modelo a partir de TODAS as migrações (as de criação e as posteriores): a tabela criada num arquivo e
 * que ganha `excluido_em` por ALTER TABLE em outro fica com a exclusão lógica.
 */
export function tabelasDoModelo(ddls: readonly string[]): TabelaDoModelo[] {
  const porAlter = new Set(ddls.flatMap((d) => [...exclusaoLogicaPorAlter(d)]));
  return ddls
    .flatMap(tabelasDoDdl)
    .map((t) => (porAlter.has(t.tabela.toLowerCase()) ? { ...t, exclusaoLogica: true } : t));
}

/**
 * Tabelas apagadas fisicamente pelo código, lidas dos fontes das portas: `DELETE FROM <tabela>` literal e a exclusão
 * física do núcleo (`Escritor.excluir('<tabela>', id, versao)`, que monta o DELETE com o nome dado, e
 * `excluirAuditado(e, '<tabela>', ...)`).
 */
export function tabelasComExclusaoFisica(fontes: readonly string[]): Set<string> {
  const r = new Set<string>();
  const padroes = [
    /\bDELETE\s+FROM\s+`?([a-z][a-z0-9_]*)`?/gi,
    /\.excluir\(\s*['"`]([a-z][a-z0-9_]*)['"`]\s*,/g,
    /\bexcluirAuditado\(\s*[A-Za-z_$][\w$.]*\s*,\s*['"`]([a-z][a-z0-9_]*)['"`]/g,
  ];
  for (const f of fontes) for (const p of padroes) for (const m of f.matchAll(p)) r.add(m[1]!.toLowerCase());
  return r;
}

/** Os privilégios de cada tabela do modelo, em ordem de nome. Nome fora do padrão: erro. */
export function privilegiosDoPapel(
  tabelas: readonly TabelaDoModelo[],
  comExclusaoFisica: ReadonlySet<string> = new Set(),
): PrivilegioTabela[] {
  const porNome = new Map<string, TabelaDoModelo>();
  for (const t of tabelas) {
    if (!NOME_VALIDO.test(t.tabela)) throw new Error(`Tabela com nome inválido (${t.tabela}).`);
    const antes = porNome.get(t.tabela);
    porNome.set(t.tabela, antes ? { ...t, exclusaoLogica: antes.exclusaoLogica || t.exclusaoLogica } : t);
  }
  return [...porNome.values()]
    .sort((a, b) => (a.tabela < b.tabela ? -1 : 1))
    .map((t) => {
      if (SO_ACRESCIMO.has(t.tabela)) return { tabela: t.tabela, acoes: ['SELECT', 'INSERT'] as const };
      // SBIS-26: registro clínico nunca é apagado (corrige-se por nova versão): sem DELETE, mesmo sem exclusão lógica.
      // Exceção só onde o código apaga fisicamente (comExclusaoFisica), conflito registrado no teste do anexo.
      const apaga =
        comExclusaoFisica.has(t.tabela) ||
        (!t.exclusaoLogica && !deleteClinicoProibido(t.tabela) && !SEM_EXCLUSAO_FISICA.has(t.tabela));
      return { tabela: t.tabela, acoes: ORDEM_ACOES.filter((a) => a !== 'DELETE' || apaga) };
    });
}

/** Comando de concessão de uma tabela (o texto que o anexo traz e que a conferência procura). */
export function comandoGrant(p: PrivilegioTabela): string {
  return `GRANT ${p.acoes.join(', ')} ON ${p.tabela} TO ${PAPEL};`;
}

/** O REVOKE do que a tabela não deve ter (null quando ela tem as quatro ações). */
export function comandoRevoke(p: PrivilegioTabela): string | null {
  const tirar = ORDEM_ACOES.filter((a) => !p.acoes.includes(a));
  return tirar.length === 0 ? null : `REVOKE ${tirar.join(', ')} ON ${p.tabela} FROM ${PAPEL};`;
}

export const COMANDO_PAPEL = `CREATE ROLE IF NOT EXISTS ${PAPEL};`;

const CABECALHO: Readonly<Record<BancoDoAnexo, readonly string[]>> = {
  cliente: [
    `-- Anexo: privilégios do papel ${PAPEL} no banco do CLIENTE.`,
    '-- Execute como administrador, conectado ao banco do cliente (USE <banco do cliente>), depois de criar o cliente e',
    '-- de novo depois de cada atualização com migração. O banco da plataforma tem o seu anexo:',
    '-- privilegios-plataforma.sql (o mesmo papel; os dois são necessários).',
  ],
  plataforma: [
    `-- Anexo: privilégios do papel ${PAPEL} no banco da PLATAFORMA (clientes, credencial do administrador, fila do`,
    '-- conector). Execute como administrador, conectado ao banco da plataforma (USE <banco da plataforma>), na',
    '-- instalação e depois de cada migração de db/plataforma. Os bancos dos clientes têm o seu anexo:',
    '-- privilegios-papel.sql (o mesmo papel; os dois são necessários).',
  ],
};

/** O anexo SQL, para a TI (administrador do banco), conectada ao banco do anexo, depois de cada migração. */
export function anexoDePrivilegios(
  itens: readonly PrivilegioTabela[],
  banco: BancoDoAnexo = 'cliente',
): string {
  return [
    ...CABECALHO[banco],
    '-- Gerado por `pnpm implantacao:listas`; não edite à mão.',
    '--',
    '-- Só cria o papel, concede e retira: nenhuma tabela nem dado é alterado. Cada GRANT vem seguido do REVOKE do que a',
    '-- tabela não deve ter, para que reaplicar o anexo convirja (a tabela que passou à exclusão lógica perde o DELETE).',
    '-- Depois, atribua o papel à conta da aplicação e torne-o o papel padrão dela (GRANT e SET DEFAULT ROLE).',
    `-- ${itens.length} tabelas. Só de acréscimo: ${[...SO_ACRESCIMO].sort().join(', ')}; tabela com exclusão lógica e tabela clínica não recebem DELETE.`,
    '',
    COMANDO_PAPEL,
    '',
    ...itens.flatMap((i) => [comandoGrant(i), ...(comandoRevoke(i) ? [comandoRevoke(i)!] : [])]),
    '',
  ].join('\n');
}

/** Tabelas sem a concessão (ou a retirada) exata no anexo (o verificar falha quando uma migração nova muda algo) e o papel. */
export function conferirAnexoPrivilegios(texto: string, itens: readonly PrivilegioTabela[]): string[] {
  const linhas = new Set(texto.split('\n').map((l) => l.trim()));
  const faltam = itens
    .filter(
      (i) => !linhas.has(comandoGrant(i)) || (comandoRevoke(i) !== null && !linhas.has(comandoRevoke(i)!)),
    )
    .map((i) => i.tabela);
  if (!linhas.has(COMANDO_PAPEL)) faltam.push('(papel)');
  return faltam;
}

/** Fontes TypeScript (sem specs) das pastas dadas, para achar a exclusão física que o código faz. */
export function lerFontes(pastas: readonly string[]): string[] {
  const r: string[] = [];
  const andar = (p: string) => {
    for (const n of readdirSync(p)) {
      if (n === 'node_modules' || n === 'dist' || n.startsWith('.')) continue;
      const c = join(p, n);
      if (statSync(c).isDirectory()) andar(c);
      else if (n.endsWith('.ts') && !n.endsWith('.spec.ts') && !n.endsWith('.spec-util.ts'))
        r.push(readFileSync(c, 'utf8'));
    }
  };
  for (const p of pastas) if (existsSync(p)) andar(p);
  return r;
}

const sqlsDe = (pasta: string): string[] => {
  const r: string[] = [];
  const andar = (p: string) => {
    for (const n of readdirSync(p).sort()) {
      const c = join(p, n);
      if (statSync(c).isDirectory()) andar(c);
      else if (n.endsWith('.sql')) r.push(readFileSync(c, 'utf8'));
    }
  };
  if (existsSync(pasta)) andar(pasta);
  return r;
};

/** Os privilégios dos dois bancos, do repositório (todas as migrações de cada banco, de criação e posteriores, e os
 * fontes de apps e packages). */
export function privilegiosDoRepositorio(raiz: string): Readonly<Record<BancoDoAnexo, PrivilegioTabela[]>> {
  const fisica = tabelasComExclusaoFisica(lerFontes([resolve(raiz, 'apps'), resolve(raiz, 'packages')]));
  return {
    cliente: privilegiosDoPapel(
      tabelasDoModelo(
        lerMigracoes(raiz).map((m) => readFileSync(resolve(raiz, 'db/migracoes', m.arquivo), 'utf8')),
      ),
      fisica,
    ),
    plataforma: privilegiosDoPapel(tabelasDoModelo(sqlsDe(resolve(raiz, 'db/plataforma'))), fisica),
  };
}

export const ANEXOS_PRIVILEGIOS: Readonly<Record<BancoDoAnexo, string>> = {
  cliente: 'docs/implantacao/anexos/privilegios-papel.sql',
  plataforma: 'docs/implantacao/anexos/privilegios-plataforma.sql',
};
