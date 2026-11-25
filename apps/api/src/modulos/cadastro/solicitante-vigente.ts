// Solicitante externo que responde hoje (F3.1, 02-CAD linha 20): leitura única para quem ESCOLHE ou GRAVA um registro
// novo em qualquer módulo. O cadastro unificado em outro não recebe pedido novo: o registro novo nasce no cadastro
// que continua (segue o ponteiro, pela regra do domínio); o registro antigo fica como está, com o cadastro da época.
import { solicitanteVigente } from '@sgh/dominio-cadastro';

/** O mínimo de leitura que esta função usa (o leitor do núcleo e a transação do executor servem). */
export interface LeitorDoSolicitante {
  uma(sql: string, parametros?: readonly unknown[]): Promise<Record<string, unknown> | null>;
}

/** Trecho de filtro para as buscas de escolha: deixa de fora o cadastro unificado em outro (`alias` da tabela). */
export const filtroSolicitanteNaoUnificado = (alias: string): string =>
  ` AND ${alias}.sucessor_solicitante_externo_id IS NULL`;

/**
 * Cadastro que responde hoje pelo solicitante `id`: ele mesmo, ou o cadastro em que foi unificado. `null` devolve
 * `null`. O cadastro que não existe (ou foi excluído) devolve o próprio id, para a validação de quem chama recusar.
 */
export async function solicitanteQueRespondeHoje(
  l: LeitorDoSolicitante,
  id: number | null,
): Promise<number | null> {
  if (id === null) return null;
  const sucessorDe = new Map<number, number | null>();
  // A operação não deixa cadeia; o laço segue o que houver e para no teto (dado torto não gira).
  let atual: number | null = id;
  for (let passo = 0; atual !== null && !sucessorDe.has(atual) && passo < 8; passo++) {
    const r = await l.uma(
      'SELECT sucessor_solicitante_externo_id AS s FROM solicitante_externo WHERE id = ? AND excluido_em IS NULL',
      [atual],
    );
    const prox = r && r['s'] !== null && r['s'] !== undefined ? Number(r['s']) : null;
    sucessorDe.set(atual, prox);
    atual = prox;
  }
  return solicitanteVigente(id, sucessorDe);
}
