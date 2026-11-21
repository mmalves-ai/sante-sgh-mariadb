// Idempotency-Key do pedido no contexto da porta do módulo: o controlador põe a chave do cabeçalho na sessão, e cada
// gravação direta da porta (gravarSgh) deriva dela a chave de idempotência do executor, na ordem em que acontece no
// pedido. O reenvio do mesmo pedido (mesma chave) devolve o resultado gravado, sem gravar de novo.
// Melhoria: o contador de gravações fica num objeto do pedido, compartilhado pelas cópias do contexto (o espalhamento
// do contexto mantém a referência), e não num mapa indexado pelo objeto de contexto.
import { createHash, randomUUID } from 'node:crypto';
import type { SessaoCadastro } from '../cadastro/comum.js';

/** O formato aceito da Idempotency-Key (o mesmo da portaria; a coluna da chave tem 80 posições). */
const CHAVE = /^[A-Za-z0-9._:-]{8,80}$/;

/** A chave do pedido e quantas gravações diretas ele já fez. */
export interface PedidoDaSessao {
  readonly chave: string;
  ordem: number;
}

/** O contexto da porta com o pedido (ausente: gravação sem chave do cliente, cada uma com chave nova). */
export type ContextoComPedido = { readonly pedido?: PedidoDaSessao | null };

/** A sessão com o pedido (Idempotency-Key válida do cabeçalho) no contexto da porta. */
export function comPedido(s: SessaoCadastro): SessaoCadastro {
  const bruto = s.req.headers['idempotency-key'];
  const k = Array.isArray(bruto) ? bruto[0] : bruto;
  const pedido: PedidoDaSessao | null = typeof k === 'string' && CHAVE.test(k) ? { chave: k, ordem: 0 } : null;
  return { ...s, porta: Object.assign({}, s.porta, { pedido }) };
}

/** A chave de idempotência da próxima gravação direta do pedido (sem pedido: uma chave nova a cada gravação). */
export function chaveDaGravacao(modulo: string, c: object): string {
  const p = (c as ContextoComPedido).pedido;
  if (!p) return `${modulo}:${randomUUID()}`;
  p.ordem += 1;
  return `${modulo}:${createHash('sha256').update(`${p.chave}#${p.ordem}`).digest('hex').slice(0, 64)}`;
}
