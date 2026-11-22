// Gravação direta (gravarSgh) com a idempotência da requisição: a chave do cabeçalho Idempotency-Key, mais a ordem da
// gravação direta dentro da mesma requisição, segue no contexto da porta até o Executor. A repetição do mesmo pedido
// (nova tentativa do cliente, duplo clique) devolve o resultado gravado em vez de gravar de novo.
// Melhoria: antes, cada gravação direta levava uma chave aleatória e a idempotência do Executor não valia.
import type { SessaoCadastro } from '../cadastro/comum.js';
import { type AlvoSgh, ApoioGravacao } from '../exames/public-api.js';

const IDEMPOTENCIA = /^[A-Za-z0-9._:-]{8,100}$/;
const ordemNaRequisicao = new WeakMap<object, number>();

/** O contexto da porta com a chave de idempotência da requisição (quando a tela a envia). */
export interface ComIdempotencia {
  readonly idempotencia?: string;
}

/** A chave da gravação direta: a da requisição, ou única (sem repetição possível) quando a requisição não tem chave. */
export function chaveDaGravacaoDireta(c: ComIdempotencia, prefixo: string, unica: () => string): string {
  return c.idempotencia ? `${prefixo}:${c.idempotencia}` : `${prefixo}:${unica()}`;
}

export class ApoioGravacaoIdempotente<G> extends ApoioGravacao<G> {
  override sgh<T>(
    s: SessaoCadastro,
    evento: string,
    recurso: string,
    alvoOuFn: AlvoSgh | ((r: T) => AlvoSgh),
    fn: (g: G) => Promise<T>,
  ): Promise<T> {
    const bruto = s.req.headers['idempotency-key'];
    const chave = Array.isArray(bruto) ? bruto[0] : bruto;
    if (typeof chave !== 'string' || !IDEMPOTENCIA.test(chave))
      return super.sgh(s, evento, recurso, alvoOuFn, fn);
    const ordem = (ordemNaRequisicao.get(s.req) ?? 0) + 1;
    ordemNaRequisicao.set(s.req, ordem);
    const porta = { ...s.porta, idempotencia: `${chave}:${ordem}` };
    return super.sgh({ ...s, porta } as SessaoCadastro, evento, recurso, alvoOuFn, fn);
  }
}
