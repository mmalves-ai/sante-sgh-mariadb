// Interface do driver Firebird dentro do núcleo (ADR 0010). O restante do adaptador só conhece estas
// interfaces: trocar o driver (plano B, node-firebird com a correção de charset da sante-api) é trocar
// a implementação em driver-nativo.ts, sem mudar pool, transação, codec nem repositórios.

export interface DestinoConexao {
  readonly host: string;
  readonly porta: number;
  readonly banco: string;
  readonly usuario: string;
  readonly senha: string;
  /** Papel SQL da conexão (M04: SGH_APLICACAO, que recebe os privilégios das tabelas SGH_). */
  readonly papel?: string;
}

export type ModoTransacao =
  | { readonly tipo: 'leitura' }
  /** Reservado ao executor do M04. */
  | {
      readonly tipo: 'escrita';
      readonly lockTimeoutSegundos: number;
      /** SNAPSHOT (CONCURRENCY) em vez de READ COMMITTED: só a captura desfeita do M03. */
      readonly instantaneo?: true;
      /**
       * M19: NO WAIT (sem LOCK TIMEOUT): a trava ocupada falha na hora. Só a operação de fila concorrente (chamar a
       * senha: o laço de candidatas passa à seguinte; cap-14 §14.2.2, o Firebird 3 não tem SKIP LOCKED).
       */
      readonly semEspera?: true;
    };

export type Linha = Record<string, unknown>;

export interface OpcoesConsulta {
  /** Linhas no máximo; a consulta pede teto + 1 para saber se estourou. */
  readonly teto: number;
}

export interface ResultadoConsulta {
  readonly linhas: Linha[];
  /** Havia mais linhas que o teto (a lista vem cortada no teto). */
  readonly estourou: boolean;
}

export interface TransacaoFirebird {
  consultar(sql: string, parametros: readonly unknown[], opcoes: OpcoesConsulta): Promise<ResultadoConsulta>;
  /** Comando sem conjunto de resultado; devolve o número de linhas afetadas informado pelo servidor. */
  executar(sql: string, parametros: readonly unknown[]): Promise<number>;
  /** Comando com RETURNING (uma linha só, ex.: INSERT ... RETURNING ID); devolve a linha. */
  executarRetornando(sql: string, parametros: readonly unknown[]): Promise<Linha>;
  /** Conteúdo de um BLOB lido nesta transação (o driver devolve um identificador, não os bytes). */
  lerBlob(blob: unknown): Promise<Buffer>;
  /**
   * Cursor de leitura em lotes, sem teto (M58-F3: o bombeamento do ensaio do UTF-8 percorre a tabela inteira de uma
   * vez). Opcional: só o driver nativo o oferece; os dublês dos testes não precisam.
   */
  percorrer?(
    sql: string,
    parametros: readonly unknown[],
    tamanhoLote: number,
    aoLote: (linhas: Linha[]) => Promise<void>,
  ): Promise<number>;
  /** Comando preparado uma vez e executado muitas (M58-F3: a carga do banco convertido). Opcional, como `percorrer`. */
  preparar?(sql: string): Promise<ComandoPreparado>;
  confirmar(): Promise<void>;
  desfazer(): Promise<void>;
}

export interface ComandoPreparado {
  executar(parametros: readonly unknown[]): Promise<void>;
  liberar(): Promise<void>;
}

export interface ConexaoFirebird {
  iniciar(modo: ModoTransacao): Promise<TransacaoFirebird>;
  /** Cancela a operação em andamento nesta conexão (o Firebird 3 não tem tempo-limite de consulta). */
  cancelar(): Promise<void>;
  fechar(): Promise<void>;
  readonly valida: boolean;
}

export interface DriverFirebird {
  readonly nome: string;
  conectar(destino: DestinoConexao): Promise<ConexaoFirebird>;
  encerrar(): Promise<void>;
}

/** Biblioteca cliente padrão (libfbclient2 3.0.11 do sistema, instalada pelo dono; TEC-1). */
export const BIBLIOTECA_CLIENTE_PADRAO = '/lib/x86_64-linux-gnu/libfbclient.so.2';

/**
 * M58.2 (ensaio do Firebird 5; ADR 0031): identificadores do banco que viraram palavra reservada no Firebird 4 em
 * diante. O catálogo da cópia tem 37 colunas chamadas `LOCAL` (estoque, cirurgia e outras), e o 5 recusa `LOCAL` sem
 * aspas ("Token unknown"); os gatilhos e procedimentos já compilados não são afetados, só o texto que o Sante envia.
 * Conferido no catálogo do 5 (`RDB$KEYWORDS` reservadas × nomes de coluna e de tabela): só `LOCAL`.
 */
export const IDENTIFICADORES_RESERVADOS_FB5: readonly string[] = ['LOCAL'];

/**
 * O SQL com os identificadores de `IDENTIFICADORES_RESERVADOS_FB5` entre aspas (`LOCAL` → `"LOCAL"`, `a.local` →
 * `a."LOCAL"`: sem aspas o Firebird já trata o nome em maiúsculas, então o significado é o mesmo, e o 3.0.14 aceita a
 * forma com aspas no dialeto 3). Não mexe em literal de texto, identificador já entre aspas, comentário nem no uso
 * como palavra-chave (`AT LOCAL`, `TIME ZONE LOCAL`). Puro e idempotente.
 */
export function sqlCompativelComFirebird5(sql: string): string {
  if (!/local/i.test(sql)) return sql;
  const reservados = new Set(IDENTIFICADORES_RESERVADOS_FB5);
  let saida = '';
  let i = 0;
  let anterior = '';
  let anterior2 = '';
  const n = sql.length;
  while (i < n) {
    const c = sql[i] as string;
    const d = sql[i + 1];
    if (c === "'" || c === '"') {
      // literal de texto ou identificador entre aspas (aspas dobradas escapam)
      let j = i + 1;
      while (j < n) {
        if (sql[j] === c) {
          if (sql[j + 1] === c) j += 2;
          else break;
        } else j++;
      }
      saida += sql.slice(i, j + 1);
      i = j + 1;
      anterior2 = anterior;
      anterior = c;
      continue;
    }
    if (c === '-' && d === '-') {
      const j = sql.indexOf('\n', i);
      const fim = j < 0 ? n : j;
      saida += sql.slice(i, fim);
      i = fim;
      continue;
    }
    if (c === '/' && d === '*') {
      const j = sql.indexOf('*/', i + 2);
      const fim = j < 0 ? n : j + 2;
      saida += sql.slice(i, fim);
      i = fim;
      continue;
    }
    if (/[A-Za-z_]/.test(c)) {
      let j = i + 1;
      while (j < n && /[A-Za-z0-9_$]/.test(sql[j] as string)) j++;
      const palavra = sql.slice(i, j);
      const alta = palavra.toUpperCase();
      const comoPalavraChave = anterior === 'AT' || (anterior === 'ZONE' && anterior2 === 'TIME');
      saida += reservados.has(alta) && !comoPalavraChave ? `"${alta}"` : palavra;
      anterior2 = anterior;
      anterior = alta;
      i = j;
      continue;
    }
    if (/[0-9]/.test(c)) {
      // número (inclui sufixos como 1E5): copiado inteiro, nunca lido como identificador
      let j = i + 1;
      while (j < n && /[A-Za-z0-9_.]/.test(sql[j] as string)) j++;
      saida += sql.slice(i, j);
      i = j;
      anterior2 = anterior;
      anterior = '#';
      continue;
    }
    if (!/\s/.test(c)) {
      anterior2 = anterior;
      anterior = c;
    }
    saida += c;
    i++;
  }
  return saida;
}

/** SQL só em ASCII: o texto do comando vai ao servidor em UTF-8 e quebraria o acento num banco NONE. */
export function conferirSqlAscii(sql: string): void {
  // eslint-disable-next-line no-control-regex
  if (/[^\x00-\x7f]/.test(sql)) {
    throw new Error('SQL com caractere fora do ASCII: passe texto acentuado como parâmetro.');
  }
}
