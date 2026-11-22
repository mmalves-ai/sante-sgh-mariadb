// Gravação direta das portas próprias da enfermagem (o que não é uma operação de tela com receita própria: o sinal
// vital, a passagem de plantão, o lançamento do balanço, a bolsa da agência, a ordem de contenção...): a função do
// gravador roda dentro de uma operação do Executor do @sgh/nucleo, com as tabelas declaradas, a trilha (a linha da tela
// vira os dados da trilha) e a idempotência na mesma transação.
// Melhoria: nenhuma gravação fora do Executor (antes, transação à parte com a trilha escrita à mão).
// Melhoria: a idempotência é a do pedido: com o ato (`comAto`: a Idempotency-Key da requisição ou a chave do ato feito
// sem conexão, mais a assinatura do conteúdo), o reenvio devolve o resultado gravado da primeira vez (`ato.repetida`) e
// a mesma chave com outro conteúdo é recusada pelo Executor; sem o ato, a chave é aleatória (cada chamada grava).
// Melhoria: o gravador anota na trilha o motivo e os dados que a tela não conhece (o valor anterior da retificação, o
// motivo do estorno) e, com `conferirAtendimento`, recusa o atendimento de outro estabelecimento ou de outro paciente.
import { randomUUID } from 'node:crypto';
import {
  type ContextoNucleo,
  definirOperacao,
  type Executor,
  recusa,
  type ResultadoOperacao,
  type TxOperacao,
} from '@sgh/nucleo';
import { z } from 'zod';
import type { SessaoCadastro } from '../cadastro/comum.js';
import type { TrilhaDaGravacao } from '../exames/public-api.js';
import { estabelecimentoDe } from './banco-apoio.js';

/** O que o gravador acrescenta à trilha da operação (o motivo e os dados que só a transação conhece). */
export interface AnotacaoGravacao {
  motivo: string | null;
  dados: Record<string, unknown> | null;
}

/** O ato idempotente do pedido: a chave, a assinatura do conteúdo e, depois da gravação, se foi repetição. */
export interface AtoIdempotente {
  readonly chave: string;
  readonly assinatura: string;
  repetida: boolean;
}

type ContextoComAto = ContextoNucleo & { readonly ato?: AtoIdempotente };

/** O contexto com o ato do pedido (a chave e a assinatura do conteúdo). */
export function comAto<C extends ContextoNucleo>(
  c: C,
  chave: string,
  assinatura: unknown,
): C & {
  readonly ato: AtoIdempotente;
} {
  return {
    ...c,
    ato: { chave: chave.slice(0, 100), assinatura: JSON.stringify(assinatura ?? null), repetida: false },
  };
}

const CHAVE_PEDIDO = /^[A-Za-z0-9._:-]{8,100}$/;

/**
 * A sessão com o ato da Idempotency-Key da requisição (quando veio e é válida) ou da chave dada (o ato sem conexão).
 * Sem chave nenhuma, a sessão volta como está (a gravação não é idempotente).
 */
export function sessaoComAto(
  s: SessaoCadastro,
  assinatura: unknown,
  chave?: string | null,
  sufixo = '',
): SessaoCadastro & { readonly porta: SessaoCadastro['porta'] & { readonly ato?: AtoIdempotente } } {
  const bruto = chave ?? s.req.headers['idempotency-key'];
  const k = Array.isArray(bruto) ? bruto[0] : bruto;
  if (typeof k !== 'string' || !CHAVE_PEDIDO.test(k)) return s;
  return { ...s, porta: comAto(s.porta, `${k}${sufixo}`, assinatura) };
}

/** O ato da sessão (nulo sem a chave). */
export function atoDe(c: ContextoNucleo): AtoIdempotente | null {
  return (c as ContextoComAto).ato ?? null;
}

export interface PedidoGravacaoDireta<G, T> {
  readonly nome: string;
  readonly tabelas: readonly string[];
  readonly trilha: TrilhaDaGravacao | ((r: T) => TrilhaDaGravacao);
  /** Monta o gravador sobre a transação da operação (estabelecimento já conferido). */
  readonly gravador: (tx: TxOperacao, estabelecimento: number, anotacao: AnotacaoGravacao) => G;
  readonly fn: (g: G) => Promise<T>;
}

/**
 * Roda a gravação direta numa operação do Executor e devolve o que a função devolveu (na repetição do ato, o resultado
 * guardado da primeira gravação; o resultado tem de ser serializável em JSON).
 */
export async function gravacaoDireta<G, T>(
  executor: Executor,
  c: ContextoNucleo,
  p: PedidoGravacaoDireta<G, T>,
): Promise<T> {
  const est = estabelecimentoDe(c);
  const ato = atoDe(c);
  let saida: { valor: T } | null = null;
  const anotacao: AnotacaoGravacao = { motivo: null, dados: null };
  const linha = (): TrilhaDaGravacao | null =>
    typeof p.trilha === 'function' ? (saida ? p.trilha(saida.valor) : null) : p.trilha;
  const op = definirOperacao({
    nome: p.nome,
    tabelas: p.tabelas,
    entrada: z.object({ chave: z.string(), assinatura: z.string() }),
    async gravar(tx) {
      const valor = await p.fn(p.gravador(tx, est, anotacao));
      saida = { valor };
      return { valor: valor === undefined ? null : valor } as unknown as ResultadoOperacao;
    },
    alvo: () => {
      const l = linha();
      return { tabela: l?.entidade ?? p.tabelas[0] ?? 'trilha_auditoria', id: l?.entidadeId ?? null };
    },
    trilha: () => {
      const l = linha();
      const dadosTela = (l?.dadosDepois ?? null) as Record<string, unknown> | null;
      return {
        ...(l?.acao ? { acao: l.acao } : {}),
        dados: anotacao.dados ? { ...(dadosTela ?? {}), ...anotacao.dados } : dadosTela,
        motivo: (anotacao.motivo ?? l?.motivo ?? null)?.slice(0, 500) ?? null,
      };
    },
  });
  const chave = ato?.chave ?? `direta:${randomUUID()}`;
  const r = await executor.executar(
    op,
    c.cliente,
    { chave, assinatura: ato?.assinatura ?? '' },
    {
      cliente: c.cliente,
      estabelecimento: est,
      usuario: c.usuario,
      correlacao: (c.correlacao || p.nome).slice(0, 64),
      chaveIdempotencia: chave,
    },
  );
  if (ato) ato.repetida = r.repetida;
  if (r.repetida) return (r.resultado as unknown as { valor: T }).valor;
  if (!saida) throw new Error('Gravação direta sem resultado.');
  return (saida as { valor: T }).valor;
}

/**
 * Confere, na transação, que o atendimento é do estabelecimento da sessão e do paciente informado (o id vem da tela:
 * nunca se liga um registro ao atendimento de outro estabelecimento ou de outro paciente).
 */
export async function conferirAtendimento(
  tx: TxOperacao,
  est: number,
  atendimento: number | null,
  paciente: number,
): Promise<void> {
  if (atendimento === null) {
    const p = await tx.uma<{ id: number }>('SELECT id FROM paciente WHERE id = ? AND excluido_em IS NULL', [
      paciente,
    ]);
    if (!p) throw recusa('paciente-inexistente', 'O paciente não foi encontrado.');
    return;
  }
  const a = await tx.uma<{ paciente_id: number }>(
    'SELECT paciente_id FROM atendimento WHERE id = ? AND estabelecimento_id = ? AND excluido_em IS NULL',
    [atendimento, est],
  );
  if (!a) throw recusa('atendimento-inexistente', 'O atendimento não é deste estabelecimento.');
  if (Number(a.paciente_id) !== paciente)
    throw recusa('atendimento-de-outro-paciente', 'O atendimento informado é de outro paciente.');
}

/** O sinal vital (afericao_valor) da aferição deste estabelecimento: devolve a aferição, ou recusa. */
export async function afericaoDoSinal(
  tx: TxOperacao,
  est: number,
  sinal: number,
  paciente?: number,
): Promise<number> {
  const v = await tx.uma<{ afericao_id: number; paciente_id: number }>(
    `SELECT v.afericao_id, a.paciente_id FROM afericao_valor v JOIN afericao a ON a.id = v.afericao_id
      WHERE v.id = ? AND a.estabelecimento_id = ? AND v.excluido_em IS NULL AND a.excluido_em IS NULL`,
    [sinal, est],
  );
  if (!v) throw recusa('sinal-inexistente', 'O sinal vital não foi encontrado neste estabelecimento.');
  if (paciente !== undefined && Number(v.paciente_id) !== paciente)
    throw recusa('sinal-de-outro-paciente', 'O sinal vital informado é de outro paciente.');
  return Number(v.afericao_id);
}
