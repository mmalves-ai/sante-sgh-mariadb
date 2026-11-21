// Contexto da gravação das telas da operadora (F2.2, lote 02-09): o contexto da porta da sessão mais a chave de
// idempotência do pedido, montada da Idempotency-Key que a tela manda, com o nome da operação (a mesma chave em
// duas operações diferentes não se confunde).
// Sem a Idempotency-Key válida, o controller gera uma chave só deste pedido (o pedido não é repetível): as telas de
// atendimento, autorização e contas ainda não mandam a chave (pedido na saída do lote). A porta própria nunca sorteia a
// chave: sem `chaveIdempotencia` no contexto, ela recusa a gravação (400).
import { randomUUID } from 'node:crypto';
import type { RequisicaoComCabecalhos } from '../../autorizacao/resolvedor-sessao.js';
import type { ContextoPorta } from '../cadastro/porta.js';

/** O contexto da porta com a chave de idempotência do pedido de gravação. */
export type ContextoGravacaoOperadora = ContextoPorta & { readonly chaveIdempotencia?: string };

const CHAVE = /^[A-Za-z0-9._:-]{8,64}$/;

/** A chave do pedido (Idempotency-Key válida) com a operação; sem ela, uma chave nova só deste pedido. */
export function chaveDoPedido(req: RequisicaoComCabecalhos, operacao: string): string {
  const bruto = req.headers['idempotency-key'];
  const chave = Array.isArray(bruto) ? bruto[0] : bruto;
  const base = typeof chave === 'string' && CHAVE.test(chave) ? chave : `pedido-${randomUUID()}`;
  return `${base}:${operacao.replace(/[^A-Za-z0-9._:-]/g, '')}`.slice(0, 80);
}

/** O contexto da gravação da tela: o da sessão com a chave do pedido. */
export function contextoGravacao(
  s: { readonly porta: ContextoPorta; readonly req: RequisicaoComCabecalhos },
  operacao: string,
): ContextoGravacaoOperadora {
  return { ...s.porta, chaveIdempotencia: chaveDoPedido(s.req, operacao) };
}
