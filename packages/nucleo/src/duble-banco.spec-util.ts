// Banco dublê dos testes unitários: uma conexão que registra os comandos e responde por regra (regex do SQL).
// Padrões: SELECT devolve [], INSERT devolve um id novo, UPDATE e DELETE afetam 1 linha.
import { lerConfiguracaoNucleo } from './configuracao.js';
import type { ContextoNucleo } from './contexto.js';
import type { DependenciasExecutor } from './executor.js';
import { type ConexaoBanco, type FonteConexoes, escreverTransacao, lerSomente } from './transacao.js';

export type Resposta = unknown;
export type Regra = (parametros: readonly unknown[], sql: string) => Resposta;

export interface Comando {
  readonly sql: string;
  readonly parametros: readonly unknown[];
}

export const CONFIG_TESTE = lerConfiguracaoNucleo({ MARIADB_SENHA: 'senha-de-teste' });

export class BancoDuble {
  readonly comandos: Comando[] = [];
  readonly estados: string[] = [];
  private readonly regras: [RegExp, Regra][] = [];
  private proximoId = 100;

  /** A regra mais recente vale primeiro. A função pode lançar (erro do banco). */
  quando(re: RegExp, resposta: Regra | Resposta): this {
    this.regras.unshift([re, typeof resposta === 'function' ? (resposta as Regra) : () => resposta]);
    return this;
  }

  conexao(): ConexaoBanco {
    return {
      consultar: async (sql, parametros) => {
        this.comandos.push({ sql, parametros });
        for (const [re, r] of this.regras) if (re.test(sql)) return r(parametros, sql);
        if (/^\s*SELECT\b/i.test(sql)) return [];
        if (/^\s*INSERT\b/i.test(sql)) return { affectedRows: 1, insertId: this.proximoId++ };
        if (/^\s*(?:UPDATE|DELETE)\b/i.test(sql)) return { affectedRows: 1, insertId: 0 };
        return { affectedRows: 0, insertId: 0 };
      },
      iniciar: async () => void this.estados.push('iniciar'),
      iniciarSomenteLeitura: async () => void this.estados.push('somente-leitura'),
      confirmar: async () => void this.estados.push('confirmar'),
      desfazer: async () => void this.estados.push('desfazer'),
      devolver: async (descartar) => void this.estados.push(descartar ? 'descartar' : 'devolver'),
    };
  }

  fonte(cliente = 'teste_duble'): FonteConexoes {
    return { cliente, banco: `cliente_${cliente}`, obter: async () => this.conexao() };
  }

  /** Comandos cujo SQL casa com a expressão. */
  que(re: RegExp): Comando[] {
    return this.comandos.filter((c) => re.test(c.sql));
  }

  /** Dependências do executor sobre este dublê. */
  dependencias(extra: Partial<DependenciasExecutor> = {}): DependenciasExecutor {
    const fonte = this.fonte();
    return {
      ler: (ctx: ContextoNucleo, fn) => lerSomente(fonte, CONFIG_TESTE, ctx, fn),
      escrever: (ctx: ContextoNucleo, fn, confirmar) =>
        escreverTransacao(fonte, CONFIG_TESTE, ctx, fn, confirmar),
      agora: () => Date.UTC(2026, 10, 20, 12, 0, 0),
      ...extra,
    };
  }
}

/** Erro como o driver do MariaDB o lança (a mensagem do driver traz parâmetros; sqlMessage é a do servidor). */
export function erroDoBanco(errno: number, code: string, sqlMessage: string): Error {
  return Object.assign(
    new Error(`(conn:1, no: ${errno}) ${sqlMessage}\nsql: ... - parameters:['VALOR-SECRETO']`),
    {
      errno,
      code,
      sqlMessage,
      sqlState: '23000',
    },
  );
}
