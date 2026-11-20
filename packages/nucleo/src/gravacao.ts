// Auditoria automática e trava otimista (ADR 0002, parte 2): toda inclusão grava criado_em, criado_por e versao 1;
// toda alteração grava alterado_em, alterado_por e versao + 1, só se a versão for a que a tela leu. A exclusão
// também confere a versão. Os nomes de tabela e coluna são conferidos (snake_case); os valores vão sempre como
// parâmetro.
import { erroConflitoVersao, erroRegistroInexistente } from './erros.js';
import type { Escritor, Linha } from './transacao.js';

export const NOME_OBJETO = /^[a-z][a-z0-9_]{0,63}$/;
export const COLUNAS_AUDITORIA = [
  'criado_em',
  'criado_por',
  'alterado_em',
  'alterado_por',
  'versao',
] as const;
const RESERVADAS = new Set<string>(['id', ...COLUNAS_AUDITORIA]);

/** Quem e quando, para as colunas de auditoria. */
export interface Carimbo {
  readonly usuario: number | null;
  readonly agora: Date;
}

export type Valores = Readonly<Record<string, unknown>>;

export function conferirNome(nome: string): string {
  if (!NOME_OBJETO.test(nome)) throw new Error('Nome de tabela ou coluna inválido.');
  return nome;
}

function colunasDe(valores: Valores): [string, unknown][] {
  const pares = Object.entries(valores).filter(([, v]) => v !== undefined);
  for (const [c] of pares) {
    conferirNome(c);
    if (RESERVADAS.has(c))
      throw new Error(`A coluna ${c} é do núcleo (id e auditoria): não vai nos valores.`);
  }
  return pares;
}

function idValido(id: number): number {
  if (!Number.isSafeInteger(id) || id <= 0) throw new Error('Id inválido.');
  return id;
}

function versaoValida(v: number): number {
  if (!Number.isSafeInteger(v) || v <= 0) throw new Error('Versão inválida.');
  return v;
}

/** INSERT com as colunas de auditoria; devolve o id gerado. */
export async function incluirAuditado(
  e: Escritor,
  tabela: string,
  valores: Valores,
  carimbo: Carimbo,
): Promise<number> {
  conferirNome(tabela);
  const pares = colunasDe(valores);
  const colunas = [...pares.map(([c]) => c), 'criado_em', 'criado_por', 'versao'];
  const parametros = [...pares.map(([, v]) => v), carimbo.agora, carimbo.usuario, 1];
  return e.inserir(
    `INSERT INTO ${tabela} (${colunas.join(', ')}) VALUES (${colunas.map(() => '?').join(', ')})`,
    parametros,
  );
}

/** Depois de 0 linhas afetadas: o registro sumiu (404) ou mudou de versão (409). */
async function explicarNenhumaLinha(e: Escritor, tabela: string, id: number): Promise<never> {
  const atual = await e.uma(`SELECT versao FROM ${tabela} WHERE id = ?`, [id]);
  throw atual ? erroConflitoVersao(['versao']) : erroRegistroInexistente();
}

/** UPDATE com trava otimista (WHERE versao = ?) e auditoria; devolve a nova versão. */
export async function alterarAuditado(
  e: Escritor,
  tabela: string,
  id: number,
  versaoEsperada: number,
  valores: Valores,
  carimbo: Carimbo,
): Promise<number> {
  conferirNome(tabela);
  idValido(id);
  versaoValida(versaoEsperada);
  const pares = colunasDe(valores);
  const sets = [
    ...pares.map(([c]) => `${c} = ?`),
    'alterado_em = ?',
    'alterado_por = ?',
    'versao = versao + 1',
  ];
  const n = await e.executar(`UPDATE ${tabela} SET ${sets.join(', ')} WHERE id = ? AND versao = ?`, [
    ...pares.map(([, v]) => v),
    carimbo.agora,
    carimbo.usuario,
    id,
    versaoEsperada,
  ]);
  if (n === 0) return explicarNenhumaLinha(e, tabela, id);
  return versaoEsperada + 1;
}

/** DELETE com trava otimista. */
export async function excluirAuditado(
  e: Escritor,
  tabela: string,
  id: number,
  versaoEsperada: number,
): Promise<void> {
  conferirNome(tabela);
  idValido(id);
  versaoValida(versaoEsperada);
  const n = await e.executar(`DELETE FROM ${tabela} WHERE id = ? AND versao = ?`, [id, versaoEsperada]);
  if (n === 0) await explicarNenhumaLinha(e, tabela, id);
}

/** SELECT ... FOR UPDATE da linha pelo id: devolve id, versao e as colunas pedidas, ou null. */
export async function travarRegistro(
  e: Escritor,
  tabela: string,
  id: number,
  colunas: readonly string[] = [],
): Promise<Linha | null> {
  conferirNome(tabela);
  idValido(id);
  const extras = colunas.filter((c) => c !== 'id' && c !== 'versao').map(conferirNome);
  const [l] = await e.consultarParaAtualizar(
    `SELECT ${['id', 'versao', ...extras].join(', ')} FROM ${tabela} WHERE id = ?`,
    [id],
    { teto: 1 },
  );
  return l ?? null;
}

const comparavel = (v: unknown): string =>
  v instanceof Date ? v.toISOString() : v === null || v === undefined ? '\u0000' : String(v).trimEnd();

/** Colunas relidas diferentes das que a tela leu (controle otimista por colunas). */
export function colunasMudadas(relido: Linha, esperado: Readonly<Record<string, unknown>>): string[] {
  return Object.keys(esperado)
    .filter((c) => comparavel(relido[c]) !== comparavel(esperado[c]))
    .sort();
}
