// Comando de gravação montado da receita (passo 4): as colunas, na ordem da receita, com o valor de cada
// fonte (entrada, constante, sessão, relógio do banco, calculado). Coluna sem `valor` fica fora do comando
// (trigger ou DEFAULT do legado). Os nomes vêm da receita (conferidos); os valores vão sempre como parâmetro.
import type { Linha } from './driver.js';
import type { ContextoOperacao, PassoReceita, TxOperacao } from './operacao.js';

const NOME = /^[A-Z][A-Z0-9_$]{0,30}$/;

export interface ValoresGravacao {
  /** Campos de entrada já normalizados (ausente = undefined). */
  readonly entrada: Readonly<Record<string, unknown>>;
  /** Valores calculados pela operação (ex.: fonética). */
  readonly calculados?: Readonly<Record<string, unknown>>;
}

export interface ComandoMontado {
  readonly sql: string;
  readonly parametros: readonly unknown[];
  /** Coluna → valor posto (em memória; nunca sai em log). */
  readonly valores: Readonly<Record<string, unknown>>;
}

export function montarInsercao(
  passo: PassoReceita,
  v: ValoresGravacao,
  ctx: ContextoOperacao,
): ComandoMontado {
  if (passo.acao !== 'INSERT' || !NOME.test(passo.tabela)) throw new Error('montarInsercao: só INSERT.');
  const colunas: string[] = [];
  const marcas: string[] = [];
  const parametros: unknown[] = [];
  const valores: Record<string, unknown> = {};
  const param = (col: string, valor: unknown) => {
    colunas.push(col);
    marcas.push('?');
    parametros.push(valor);
    valores[col] = valor;
  };
  for (const [col, c] of Object.entries(passo.colunas)) {
    if (!NOME.test(col)) throw new Error(`Coluna inválida na receita: ${col}.`);
    const f = c.valor;
    if (!f) continue;
    switch (f.de) {
      case 'entrada': {
        const x = v.entrada[f.campo];
        param(col, x === undefined || x === null || x === '' ? f.seAusente : x);
        break;
      }
      case 'constante':
        param(col, f.valor);
        break;
      case 'sessao':
        param(col, ctx.usuarioLegado);
        break;
      case 'banco':
        colunas.push(col);
        marcas.push(f.expressao);
        break;
      case 'calculado': {
        if (!v.calculados || !(f.chave in v.calculados))
          throw new Error(`Valor calculado ausente: ${f.chave}.`);
        param(col, v.calculados[f.chave]);
        break;
      }
    }
  }
  const retorna = (passo.retorna ?? []).filter((c) => NOME.test(c));
  const sql =
    `INSERT INTO ${passo.tabela} (${colunas.join(', ')}) VALUES (${marcas.join(', ')})` +
    (retorna.length > 0 ? ` RETURNING ${retorna.join(', ')}` : '');
  return { sql, parametros, valores };
}

/** Grava o passo de inclusão e devolve a linha do RETURNING (ou {} sem RETURNING). */
export async function inserirPelaReceita(
  tx: TxOperacao,
  passo: PassoReceita,
  v: ValoresGravacao,
  ctx: ContextoOperacao,
): Promise<Linha> {
  const c = montarInsercao(passo, v, ctx);
  if ((passo.retorna ?? []).length > 0) return tx.executarRetornando(c.sql, c.parametros);
  const n = await tx.executar(c.sql, c.parametros);
  if (n !== 1) throw new Error(`Inclusão em ${passo.tabela}: esperava 1 linha, veio ${n}.`);
  return {};
}

/**
 * M20: o valor do generator do legado que o Delphi pede ANTES de gravar a linha (a ficha do atendimento externo leva o
 * próprio REG na guia: RECADATE.GUIA = REG em 98,7% da janela), só para os generators que a receita declara em
 * `generatorsReservados` (a transação da operação confere; a guarda do legado recusa GEN_ID com passo fora do núcleo).
 * O valor é o do generator do legado (nunca MAX+1) e a classe na assinatura continua `generator`.
 */
export async function reservarDoGenerator(
  tx: TxOperacao,
  receita: { readonly nome: string; readonly generatorsReservados?: readonly string[] },
  generator: string,
): Promise<number> {
  if (!(receita.generatorsReservados ?? []).includes(generator) || !tx.reservarGenerator)
    throw new Error(`Receita ${receita.nome}: o generator ${generator} não está entre os reservados.`);
  return tx.reservarGenerator(generator);
}
