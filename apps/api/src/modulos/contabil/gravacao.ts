// O pedido de gravação da contabilidade vindo da tela: a Idempotency-Key (mais a ordem da gravação na requisição, para
// a requisição que grava mais de uma vez) vai ao contexto da porta, e o corpo do pedido, sem a senha, vai à entrada da
// operação. Assim o reenvio do mesmo pedido devolve o resultado gravado e a mesma chave com outro pedido é recusada
// (idempotencia-divergente). Sem a chave, cada gravação é única.
import type { SessaoCadastro } from '../cadastro/comum.js';
import type { ContextoContabil, PedidoDeGravacao } from './porta.js';

/** Permissão de gravar no plano de contas compartilhado pela rede (o administrador da plataforma pode tudo). */
export const PERMISSAO_PLANO_DA_REDE = 'contabil.plano.rede';

const IDEMPOTENCIA = /^[A-Za-z0-9._:-]{8,64}$/;
const ordemNaRequisicao = new WeakMap<object, number>();

export function gravacaoDaTela(
  s: SessaoCadastro,
  operacao: string,
): { readonly contexto: ContextoContabil; readonly pedido: PedidoDeGravacao } {
  const bruto = s.req.headers['idempotency-key'];
  const chave = Array.isArray(bruto) ? bruto[0] : bruto;
  const base = { ...s.porta, gravaPlanoDaRede: s.pode(PERMISSAO_PLANO_DA_REDE) } as ContextoContabil;
  const corpo: unknown = (s.req as { body?: unknown }).body;
  const pedido =
    corpo && typeof corpo === 'object' && !Array.isArray(corpo)
      ? Object.fromEntries(Object.entries(corpo as Record<string, unknown>).filter(([k]) => k !== 'senha'))
      : (corpo ?? null);
  if (typeof chave !== 'string' || !IDEMPOTENCIA.test(chave))
    return { contexto: base, pedido: { operacao, pedido } };
  const ordem = (ordemNaRequisicao.get(s.req) ?? 0) + 1;
  ordemNaRequisicao.set(s.req, ordem);
  return { contexto: { ...base, chaveIdempotencia: `${chave}:${ordem}` }, pedido: { operacao, pedido } };
}
