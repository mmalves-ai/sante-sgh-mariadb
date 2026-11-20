// Transações curtas (cap-09 §9.6; cap-10 §10.11). Leitura: READ COMMITTED READ ONLY, teto de linhas e
// tempo máximo por consulta (o Firebird 3 não tem tempo-limite: o driver cancela e a conexão volta ao
// pool; se o pedido chegou depois do fim da consulta, ela é descartada). Escrita: reservada ao executor do M04 (READ COMMITTED, LOCK TIMEOUT de poucos segundos); não é
// exportada pelo pacote.
import type { ConfiguracaoNucleo } from './configuracao.js';
import { sufixoModuloBanco } from '@sgh/contratos';
import { type ContextoLegado, conferirContexto } from './contexto.js';
import type { Linha, TransacaoFirebird } from './driver.js';
import { erroDeConexao, GDS_CANCELADO, gdscodeDe } from './erros.js';
import type { ConexaoEmprestada, PoolsDaRede } from './pool.js';
import { comRastro } from './telemetria.js';

export class ErroLeitura extends Error {
  override readonly name: string = 'ErroLeitura';
}
export class ErroTempoEsgotado extends ErroLeitura {
  override readonly name = 'ErroTempoEsgotado';
}
export class ErroTetoLinhas extends ErroLeitura {
  override readonly name = 'ErroTetoLinhas';
}

/**
 * SQL com efeito colateral fora da transação: generator (não transacional; o ROLLBACK não devolve o
 * valor), procedimento executável e bloco PSQL. Recusados na leitura; GEN_ID(x, 0) só lê e é aceito.
 */
const EFEITO_COLATERAL: readonly (readonly [RegExp, string])[] = [
  [/\bGEN_ID\s*\(\s*[^,()]+,(?!\s*0\s*\))/i, 'GEN_ID com passo diferente de 0'],
  [/\bNEXT\s+VALUE\s+FOR\b/i, 'NEXT VALUE FOR'],
  [/\bEXECUTE\s+PROCEDURE\b/i, 'EXECUTE PROCEDURE'],
  [/\bEXECUTE\s+BLOCK\b/i, 'EXECUTE BLOCK'],
];

/** A leitura recusa SQL que avança generator ou executa PSQL (convencoes.md §5: escrita só no executor). */
export function conferirSqlLeitura(
  sql: string,
  opcoes: Pick<OpcoesConsultaLeitura, 'permitirBloco'> = {},
): void {
  for (const [re, nome] of EFEITO_COLATERAL) {
    if (nome === 'EXECUTE BLOCK' && opcoes.permitirBloco) continue;
    if (re.test(sql))
      throw new ErroLeitura(`Leitura recusada: ${nome} não é permitido no caminho de leitura.`);
  }
}

export interface OpcoesConsultaLeitura {
  /**
   * Só para a prova do 409 (exceção do legado lançada por EXECUTE BLOCK sem gravação): aceita EXECUTE
   * BLOCK. Generators e procedimentos continuam recusados.
   */
  readonly permitirBloco?: boolean;
  /** Padrão: FB_CONSULTA_TETO_LINHAS. Passar do teto é erro (pagine no servidor). */
  readonly teto?: number;
  /** Padrão: FB_CONSULTA_TEMPO_MS. */
  readonly tempoMaximoMs?: number;
}

export interface Leitor {
  readonly hospital: string;
  consultar<T extends Linha = Linha>(
    sql: string,
    parametros?: readonly unknown[],
    opcoes?: OpcoesConsultaLeitura,
  ): Promise<T[]>;
  lerBlob(blob: unknown): Promise<Buffer>;
}

/** Garante que a conexão é do estabelecimento do contexto (nenhuma transação cruza bancos). */
/** Sufixo do módulo no banco (M59-F1); módulo fora do padrão cai na conta única (o comportamento de antes). */
function sufixoDoContexto(modulo: string | undefined): string | null {
  if (!modulo) return null;
  try {
    return sufixoModuloBanco(modulo.replace(/[-_]+([a-z0-9])/g, (_, c: string) => c.toUpperCase()));
  } catch {
    return null;
  }
}

function conferirBanco(emprestada: ConexaoEmprestada, hospital: string): void {
  if (emprestada.estabelecimento !== hospital) {
    throw new ErroLeitura(
      `Conexão do estabelecimento "${emprestada.estabelecimento}" usada para "${hospital}".`,
    );
  }
}

interface EstadoLeitor {
  /**
   * Pedido de cancelamento que a consulta não consumiu (o tempo estourou no fim da busca e a consulta
   * terminou antes): o pedido pode cair no ROLLBACK ou na próxima consulta, então a conexão é descartada.
   * Cancelamento consumido (a consulta voltou com "cancelado") deixa a conexão limpa: volta ao pool.
   */
  cancelamentoPendente: boolean;
}

function leitorSobre(
  tr: TransacaoFirebird,
  emprestada: ConexaoEmprestada,
  config: ConfiguracaoNucleo,
  hospital: string,
  estado: EstadoLeitor,
  somenteLeitura: boolean,
  rede = '',
): Leitor {
  return {
    hospital,
    async consultar<T extends Linha>(
      sql: string,
      parametros: readonly unknown[] = [],
      opcoes: OpcoesConsultaLeitura = {},
    ) {
      if (somenteLeitura) conferirSqlLeitura(sql, opcoes);
      const teto = opcoes.teto ?? config.tetoLinhas;
      const tempo = opcoes.tempoMaximoMs ?? config.tempoConsultaMs;
      let cancelou = false;
      const temporizador = setTimeout(() => {
        cancelou = true;
        estado.cancelamentoPendente = true;
        emprestada.conexao.cancelar().catch(() => undefined);
      }, tempo);
      try {
        // Rastro OpenTelemetry sem valor de parâmetro (M09, regra 12); se cancelou, o pedido segue pendente.
        const r = await comRastro(
          { rede, estabelecimento: hospital, sql, parametros: parametros.length },
          () => tr.consultar(sql, parametros, { teto }),
          (x) => x.linhas.length,
        );
        if (r.estourou) throw new ErroTetoLinhas(`Consulta passou do teto de ${teto} linhas.`);
        return r.linhas as T[];
      } catch (erro) {
        if (gdscodeDe(erro) === GDS_CANCELADO) estado.cancelamentoPendente = false; // consumido
        if (cancelou || gdscodeDe(erro) === GDS_CANCELADO) {
          throw new ErroTempoEsgotado(`Consulta cancelada ao passar de ${tempo} ms.`);
        }
        throw erro;
      } finally {
        clearTimeout(temporizador);
      }
    },
    lerBlob: (blob) => tr.lerBlob(blob),
  };
}

/**
 * Leitura somente leitura no banco do estabelecimento do contexto. A transação é sempre desfeita no
 * fim (é só leitura) e a conexão volta ao pool, inclusive depois de cancelamento.
 */
export async function lerSomente<T>(
  pools: PoolsDaRede,
  config: ConfiguracaoNucleo,
  contexto: Pick<ContextoLegado, 'rede' | 'hospital' | 'traceId' | 'modulo'>,
  fn: (leitor: Leitor) => Promise<T>,
): Promise<T> {
  conferirContexto(contexto);
  if (contexto.rede !== pools.rede) {
    throw new ErroLeitura(`Contexto da rede "${contexto.rede}" usado nos pools da rede "${pools.rede}".`);
  }
  const pool = pools.para(contexto.hospital, sufixoDoContexto(contexto.modulo));
  const emprestada = await pool.obter();
  let quebrou = false;
  const estado: EstadoLeitor = { cancelamentoPendente: false };
  try {
    conferirBanco(emprestada, contexto.hospital);
    const tr = await emprestada.conexao.iniciar({ tipo: 'leitura' });
    try {
      return await fn(leitorSobre(tr, emprestada, config, contexto.hospital, estado, true, contexto.rede));
    } finally {
      await tr.desfazer().catch(() => {
        quebrou = true;
      });
    }
  } catch (erro) {
    if (erroDeConexao(erro)) quebrou = true;
    throw erro;
  } finally {
    await pool.devolver(emprestada, quebrou || estado.cancelamentoPendente || !emprestada.conexao.valida);
  }
}

export interface Escritor extends Leitor {
  /** Comando de escrita; devolve as linhas afetadas. Só o executor do M04 chama. */
  executar(sql: string, parametros?: readonly unknown[]): Promise<number>;
  /** Comando com RETURNING (uma linha); só o executor do M04 chama. */
  executarRetornando(sql: string, parametros?: readonly unknown[]): Promise<Linha>;
  /**
   * Espera curta e limitada (trilha, 18/11/2026): presente no escritor real; os dublês e o CRUD em memória não têm
   * (a trilha cai no `executar` comum). Os invólucros (somenteSgh, imagem do "como") repassam com a mesma conferência.
   */
  readonly esperaCurta?: EsperaCurta;
}

/** Comando de escrita com espera de trava curta, sem mudar o LOCK TIMEOUT do resto da transação. */
export interface EsperaCurta {
  /** Espera de cada comando e teto total do elo da trilha (configuracao.ts: FB_TRILHA_ELO_ESPERA_MS / _TETO_MS). */
  readonly esperaMs: number;
  readonly tetoMs: number;
  /**
   * Executa o comando; se a trava não sair em `esperaMs`, cancela a operação desta conexão (fb_cancel_operation:
   * o comando é desfeito pelo ponto de salvamento dele, a transação segue viva) e lança ErroEsperaCurta.
   */
  executar(sql: string, parametros: readonly unknown[], esperaMs: number): Promise<number>;
}

/** A espera curta de um comando de escrita estourou (trava ocupada por outra transação). */
export class ErroEsperaCurta extends Error {
  override readonly name = 'ErroEsperaCurta';
}

/**
 * O cancelamento da espera curta saiu junto com a resposta do servidor e não foi possível consumi-lo: a transação
 * não pode receber outro comando (cairia nele). A trilha recusa com o 503 "trilha-indisponivel", sem refazer.
 */
export class ErroCancelamentoPendente extends Error {
  override readonly name = 'ErroCancelamentoPendente';
  constructor(mensagem: string, causa?: unknown) {
    super(mensagem, causa === undefined ? undefined : { cause: causa });
  }
}

/** Consulta inócua que consome o pedido de cancelamento armado no anexo (o fb_cancel_raise cai no próximo comando). */
export const SQL_CONSUMIR_CANCELAMENTO = 'SELECT 1 FROM RDB$DATABASE';

/**
 * true: o pedido caiu na consulta inócua e foi consumido (conexão limpa). false: a consulta passou (o pedido ainda
 * pode chegar depois). Erro: outra falha (devolvido para virar a causa).
 */
async function consumirCancelamento(rodar: () => Promise<unknown>): Promise<true | false | Error> {
  try {
    await rodar();
    return false;
  } catch (erro) {
    if (gdscodeDe(erro) === GDS_CANCELADO) return true;
    return erro instanceof Error ? erro : new Error(String(erro));
  }
}

/** Repassa a espera curta de `e` passando antes pela conferência do invólucro (o comando é o mesmo). */
export function repassarEsperaCurta(
  e: Escritor,
  conferir: (sql: string) => void,
): { esperaCurta?: EsperaCurta } {
  const ec = e.esperaCurta;
  if (!ec) return {};
  return {
    esperaCurta: {
      esperaMs: ec.esperaMs,
      tetoMs: ec.tetoMs,
      executar: async (sql, p, ms) => {
        conferir(sql);
        return ec.executar(sql, p, ms);
      },
    },
  };
}

/**
 * Escrita: RESERVADA ao executor do M04 (convencoes.md §5). READ COMMITTED, LOCK TIMEOUT configurável
 * (FB_LOCK_TIMEOUT_S). `confirmar: false` desfaz no fim (provas e testes com ROLLBACK); `instantaneo`: SNAPSHOT.
 */
export async function escreverReservado<T>(
  pools: PoolsDaRede,
  config: ConfiguracaoNucleo,
  contexto: Pick<ContextoLegado, 'rede' | 'hospital' | 'traceId' | 'modulo'>,
  fn: (escritor: Escritor) => Promise<T>,
  opcoes: { readonly confirmar: boolean; readonly instantaneo?: true; readonly semEspera?: true },
): Promise<T> {
  conferirContexto(contexto);
  if (contexto.rede !== pools.rede) throw new ErroLeitura('Contexto de outra rede.');
  const pool = pools.para(contexto.hospital, sufixoDoContexto(contexto.modulo));
  const emprestada = await pool.obter();
  let quebrou = false;
  const estado: EstadoLeitor = { cancelamentoPendente: false };
  try {
    conferirBanco(emprestada, contexto.hospital);
    const tr = await emprestada.conexao.iniciar({
      tipo: 'escrita',
      lockTimeoutSegundos: config.lockTimeoutSegundos,
      ...(opcoes.instantaneo ? { instantaneo: true as const } : {}),
      ...(opcoes.semEspera ? { semEspera: true as const } : {}),
    });
    let feito = false;
    try {
      const leitor = leitorSobre(tr, emprestada, config, contexto.hospital, estado, false, contexto.rede);
      // Rastro também na escrita (regra 12: toda consulta), com as linhas afetadas e sem valor de parâmetro.
      const executar = (sql: string, p: readonly unknown[] = []) =>
        comRastro(
          { rede: contexto.rede, estabelecimento: contexto.hospital, sql, parametros: p.length },
          () => tr.executar(sql, p),
          (n) => n,
          'db.response.affected_rows',
        );
      const executarRetornando = (sql: string, p: readonly unknown[] = []) =>
        comRastro(
          { rede: contexto.rede, estabelecimento: contexto.hospital, sql, parametros: p.length },
          () => tr.executarRetornando(sql, p),
          () => 1,
          'db.response.affected_rows',
        );
      const esperaCurta: EsperaCurta = {
        esperaMs: config.esperaEloTrilhaMs,
        tetoMs: config.tetoEloTrilhaMs,
        async executar(sql, p, ms) {
          // Cancelamento da conexão como na leitura (leitorSobre): o pedido não consumido descarta a conexão no fim.
          let cancelou = false;
          let pedido: Promise<unknown> = Promise.resolve();
          const temporizador = setTimeout(() => {
            cancelou = true;
            estado.cancelamentoPendente = true;
            pedido = emprestada.conexao.cancelar().catch(() => undefined);
          }, ms);
          let resultado:
            { readonly ok: true; readonly n: number } | { readonly ok: false; readonly erro: unknown };
          try {
            resultado = { ok: true, n: await executar(sql, p) };
          } catch (erro) {
            resultado = { ok: false, erro };
          } finally {
            clearTimeout(temporizador);
          }
          if (!resultado.ok && gdscodeDe(resultado.erro) === GDS_CANCELADO) {
            estado.cancelamentoPendente = false; // consumido pelo próprio comando: desfeito, a transação segue viva
            throw new ErroEsperaCurta(`Trava ocupada além de ${ms} ms: comando cancelado.`);
          }
          if (cancelou) {
            // Corrida (revisão 18/11/2026): o servidor respondeu ao comando (sucesso, única violada, outro erro) e o
            // pedido de cancelamento saiu na mesma janela. Ele não pode cair no comando seguinte desta transação
            // (outbox, idempotência, COMMIT, SELECT da nova tentativa): é consumido aqui por um comando inócuo.
            await pedido;
            const consumido = await consumirCancelamento(() =>
              comRastro(
                {
                  rede: contexto.rede,
                  estabelecimento: contexto.hospital,
                  sql: SQL_CONSUMIR_CANCELAMENTO,
                  parametros: 0,
                },
                () => tr.consultar(SQL_CONSUMIR_CANCELAMENTO, [], { teto: 1 }),
                (x) => x.linhas.length,
              ),
            );
            if (consumido !== true) {
              // Conexão caída (revisão da trilha-elo): o comando ou a consulta inócua voltou com erro de conexão. Não é
              // disputa da trilha: sobe o erro de conexão como veio (o original, se for ele), para o catch de fora
              // marcar a conexão como quebrada e o operador ver a queda, não um 503 de trilha. A conexão é descartada
              // de qualquer jeito (cancelamentoPendente segue true) e a transação não recebe outro comando.
              if (!resultado.ok && erroDeConexao(resultado.erro)) throw resultado.erro;
              if (consumido instanceof Error && erroDeConexao(consumido)) {
                throw resultado.ok ? consumido : resultado.erro;
              }
              // Não há como garantir que o pedido não caia depois: a transação é abandonada (desfeita no fim, conexão
              // descartada), sem outro comando. Quem chama recusa a operação (trilha: 503), nunca grava sem elo.
              throw new ErroCancelamentoPendente(
                'Pedido de cancelamento não consumido: transação abandonada.',
                resultado.ok ? (consumido === false ? undefined : consumido) : resultado.erro,
              );
            }
            estado.cancelamentoPendente = false;
          }
          // Sem cancelamento pendente: sucesso volta (o elo gravado vale); erro original sobe como veio (a única
          // violada e a trava ocupada continuam sendo disputa para a trilha; o resto não é reescrito).
          if (resultado.ok) return resultado.n;
          throw resultado.erro;
        },
      };
      const r = await fn({ ...leitor, executar, executarRetornando, esperaCurta });
      if (opcoes.confirmar) {
        await tr.confirmar();
        feito = true;
      }
      return r;
    } finally {
      if (!feito) await tr.desfazer().catch(() => (quebrou = true));
    }
  } catch (erro) {
    if (erroDeConexao(erro)) quebrou = true;
    throw erro;
  } finally {
    await pool.devolver(emprestada, quebrou || estado.cancelamentoPendente || !emprestada.conexao.valida);
  }
}
