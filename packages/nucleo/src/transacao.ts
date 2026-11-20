// Leitor e Escritor sobre uma conexão do MariaDB: a mesma ideia do núcleo antigo (consultar com teto e tempo,
// executar, executar com RETURNING), sem tipos do sistema de origem. A leitura roda numa transação READ ONLY e é
// sempre desfeita; a escrita abre transação, confirma ou desfaz, e devolve a conexão ao pool (descartada se caiu).
// `consultarParaAtualizar` é o SELECT ... FOR UPDATE, só no Escritor.
import type { ConfiguracaoNucleo } from './configuracao.js';
import { type ContextoNucleo, conferirContexto } from './contexto.js';
import {
  ERRO_BANCO,
  ErroLeitura,
  ErroTempoEsgotado,
  ErroTetoLinhas,
  codigoDe,
  erroDeConexao,
  errnoDe,
} from './erros.js';
import { comRastro } from './telemetria.js';

export type Linha = Record<string, unknown>;

export interface OpcoesConsulta {
  /** Padrão: SGH_CONSULTA_TETO_LINHAS. Passar do teto é erro (pagine no servidor). */
  readonly teto?: number;
  /** Padrão: SGH_CONSULTA_TEMPO_MS. */
  readonly tempoMaximoMs?: number;
}

export interface Leitor {
  /** Código do cliente dono do banco desta conexão. */
  readonly cliente: string;
  consultar<T extends Linha = Linha>(
    sql: string,
    parametros?: readonly unknown[],
    opcoes?: OpcoesConsulta,
  ): Promise<T[]>;
  /** Primeira linha da consulta, ou null. */
  uma<T extends Linha = Linha>(sql: string, parametros?: readonly unknown[]): Promise<T | null>;
}

export interface Escritor extends Leitor {
  /** Comando de escrita; devolve as linhas afetadas. */
  executar(sql: string, parametros?: readonly unknown[]): Promise<number>;
  /** INSERT; devolve o id gerado (AUTO_INCREMENT). */
  inserir(sql: string, parametros?: readonly unknown[]): Promise<number>;
  /** INSERT ou DELETE com RETURNING (uma linha). */
  executarRetornando(sql: string, parametros?: readonly unknown[]): Promise<Linha>;
  /** SELECT ... FOR UPDATE: trava as linhas lidas até o fim da transação. */
  consultarParaAtualizar<T extends Linha = Linha>(
    sql: string,
    parametros?: readonly unknown[],
    opcoes?: OpcoesConsulta,
  ): Promise<T[]>;
}

/** O mínimo da conexão do driver que o núcleo usa (o dublê dos testes implementa o mesmo). */
export interface ConexaoBanco {
  consultar(sql: string, parametros: readonly unknown[], tempoMaximoMs?: number): Promise<unknown>;
  iniciar(): Promise<void>;
  iniciarSomenteLeitura(): Promise<void>;
  confirmar(): Promise<void>;
  desfazer(): Promise<void>;
  /** Devolve ao pool; `descartar` fecha a conexão (caiu ou ficou em estado incerto). */
  devolver(descartar: boolean): Promise<void>;
}

/** Fonte das conexões do banco de um cliente. */
export interface FonteConexoes {
  readonly cliente: string;
  readonly banco: string;
  obter(): Promise<ConexaoBanco>;
}

const COMANDO_DE_ESCRITA =
  /^\s*(?:\(\s*)*(?:INSERT|UPDATE|DELETE|REPLACE|MERGE|CALL|CREATE|ALTER|DROP|TRUNCATE|RENAME|GRANT|REVOKE|SET|LOCK|UNLOCK|LOAD|HANDLER|DO|SAVEPOINT|RELEASE|ROLLBACK|COMMIT|START|BEGIN|XA|FLUSH|KILL|SHUTDOWN|INSTALL|UNINSTALL|PREPARE|EXECUTE|DEALLOCATE)\b/i;
const EFEITO_NA_LEITURA: readonly (readonly [RegExp, string])[] = [
  [/\bNEXTVAL\s*\(|\bNEXT\s+VALUE\s+FOR\b|\bSETVAL\s*\(/i, 'avanço de sequência'],
  [
    /\bFOR\s+UPDATE\b|\bLOCK\s+IN\s+SHARE\s+MODE\b|\bFOR\s+SHARE\b/i,
    'trava de linha (use consultarParaAtualizar)',
  ],
  [/\bINTO\s+(?:OUTFILE|DUMPFILE|@)/i, 'SELECT INTO'],
  [/\b(?:GET_LOCK|RELEASE_LOCK|SLEEP|BENCHMARK|LOAD_FILE)\s*\(/i, 'função com efeito'],
  [/;\s*\S/, 'mais de um comando'],
];

/** O caminho de leitura recusa comando de escrita, trava, sequência e mais de um comando. */
export function conferirSqlLeitura(sql: string): void {
  if (COMANDO_DE_ESCRITA.test(sql))
    throw new ErroLeitura('Leitura recusada: comando de escrita no caminho de leitura.');
  for (const [re, nome] of EFEITO_NA_LEITURA)
    if (re.test(sql)) throw new ErroLeitura(`Leitura recusada: ${nome} não é permitido na leitura.`);
}

function ehTempoEsgotado(erro: unknown): boolean {
  return errnoDe(erro) === ERRO_BANCO.STATEMENT_TIMEOUT || codigoDe(erro) === 'ER_STATEMENT_TIMEOUT';
}

function linhasDe(r: unknown): Linha[] {
  if (!Array.isArray(r)) throw new ErroLeitura('O comando não devolveu linhas: use executar.');
  return r as Linha[];
}

interface ResultadoGravacao {
  readonly affectedRows?: unknown;
  readonly insertId?: unknown;
}

function numero(v: unknown, oque: string): number {
  const n = typeof v === 'bigint' ? Number(v) : v;
  if (typeof n !== 'number' || !Number.isSafeInteger(n)) throw new Error(`Resultado de escrita sem ${oque}.`);
  return n;
}

function leitorSobre(conexao: ConexaoBanco, config: ConfiguracaoNucleo, cliente: string): Leitor {
  const consultar = async <T extends Linha>(
    sql: string,
    parametros: readonly unknown[] = [],
    opcoes: OpcoesConsulta = {},
  ): Promise<T[]> => {
    conferirSqlLeitura(sql);
    const teto = opcoes.teto ?? config.tetoLinhas;
    const tempo = opcoes.tempoMaximoMs ?? config.tempoConsultaMs;
    try {
      const r = await comRastro(
        { cliente, sql, parametros: parametros.length },
        async () => linhasDe(await conexao.consultar(sql, parametros, tempo)),
        (x) => x.length,
      );
      if (r.length > teto) throw new ErroTetoLinhas(`Consulta passou do teto de ${teto} linhas.`);
      return r as T[];
    } catch (erro) {
      if (ehTempoEsgotado(erro)) throw new ErroTempoEsgotado(`Consulta cancelada ao passar de ${tempo} ms.`);
      throw erro;
    }
  };
  return {
    cliente,
    consultar,
    async uma<T extends Linha>(sql: string, parametros: readonly unknown[] = []) {
      const [l] = await consultar<T>(sql, parametros, { teto: Number.MAX_SAFE_INTEGER });
      return l ?? null;
    },
  };
}

function escritorSobre(conexao: ConexaoBanco, config: ConfiguracaoNucleo, cliente: string): Escritor {
  const leitor = leitorSobre(conexao, config, cliente);
  const gravar = (sql: string, parametros: readonly unknown[]) =>
    comRastro(
      { cliente, sql, parametros: parametros.length },
      () => conexao.consultar(sql, parametros),
      (r) => (Array.isArray(r) ? r.length : Number((r as ResultadoGravacao)?.affectedRows ?? 0)),
      'db.response.affected_rows',
    );
  return {
    ...leitor,
    async executar(sql, parametros = []) {
      const r = (await gravar(sql, parametros)) as ResultadoGravacao;
      return numero(r?.affectedRows, 'linhas afetadas');
    },
    async inserir(sql, parametros = []) {
      if (!/^\s*INSERT\b/i.test(sql)) throw new Error('inserir só aceita INSERT.');
      const r = (await gravar(sql, parametros)) as ResultadoGravacao;
      return numero(r?.insertId, 'id gerado');
    },
    async executarRetornando(sql, parametros = []) {
      if (!/\bRETURNING\b/i.test(sql)) throw new Error('executarRetornando exige RETURNING.');
      const [l] = linhasDe(await gravar(sql, parametros));
      if (!l) throw new Error('Comando com RETURNING sem linha.');
      return l;
    },
    async consultarParaAtualizar<T extends Linha>(
      sql: string,
      parametros: readonly unknown[] = [],
      opcoes: OpcoesConsulta = {},
    ) {
      conferirSqlLeitura(sql);
      const teto = opcoes.teto ?? config.tetoLinhas;
      const r = linhasDe(
        await comRastro(
          { cliente, sql, parametros: parametros.length },
          () => conexao.consultar(`${sql.trimEnd()} FOR UPDATE`, parametros),
          (x) => (Array.isArray(x) ? x.length : 0),
        ),
      );
      if (r.length > teto) throw new ErroTetoLinhas(`Consulta passou do teto de ${teto} linhas.`);
      return r as T[];
    },
  };
}

function conferirCliente(fonte: FonteConexoes, ctx: Pick<ContextoNucleo, 'cliente'>): void {
  if (fonte.cliente !== ctx.cliente)
    throw new ErroLeitura(
      `Contexto do cliente "${ctx.cliente}" usado no banco do cliente "${fonte.cliente}".`,
    );
}

/** Leitura no banco do cliente do contexto. A transação (READ ONLY) é sempre desfeita no fim. */
export async function lerSomente<T>(
  fonte: FonteConexoes,
  config: ConfiguracaoNucleo,
  contexto: Partial<ContextoNucleo>,
  fn: (leitor: Leitor) => Promise<T>,
): Promise<T> {
  const ctx = conferirContexto(contexto);
  conferirCliente(fonte, ctx);
  const conexao = await fonte.obter();
  let descartar = false;
  try {
    await conexao.iniciarSomenteLeitura();
    try {
      return await fn(leitorSobre(conexao, config, ctx.cliente));
    } finally {
      await conexao.desfazer().catch(() => {
        descartar = true;
      });
    }
  } catch (erro) {
    if (erroDeConexao(erro)) descartar = true;
    throw erro;
  } finally {
    await conexao.devolver(descartar);
  }
}

/**
 * Escrita numa transação no banco do cliente do contexto. `confirmar` false desfaz no fim (testes e simulação).
 * Erro em `fn`: desfaz e relança. Nenhuma transação cruza bancos.
 */
export async function escreverTransacao<T>(
  fonte: FonteConexoes,
  config: ConfiguracaoNucleo,
  contexto: Partial<ContextoNucleo>,
  fn: (escritor: Escritor) => Promise<T>,
  confirmar = true,
): Promise<T> {
  const ctx = conferirContexto(contexto);
  conferirCliente(fonte, ctx);
  const conexao = await fonte.obter();
  let descartar = false;
  try {
    await conexao.iniciar();
    let r: T;
    try {
      r = await fn(escritorSobre(conexao, config, ctx.cliente));
    } catch (erro) {
      await conexao.desfazer().catch(() => {
        descartar = true;
      });
      throw erro;
    }
    if (confirmar) await conexao.confirmar();
    else await conexao.desfazer();
    return r;
  } catch (erro) {
    if (erroDeConexao(erro)) descartar = true;
    throw erro;
  } finally {
    await conexao.devolver(descartar);
  }
}
