// Adiantamento a fornecedor e a médico (F3.8, 07-FIN linha 67): conceder (saída na conta), compensar na baixa de um
// título do MESMO credor com o saldo conferido aqui, e devolver o saldo que sobrou (entrada na conta). O registro nunca
// se apaga: cada passo é um lançamento com trilha, e a situação deriva do valor, do compensado e do devolvido.
import { centavos, type RecusaFinanceiro, recusaFin } from '@sgh/contratos/regras-financeiro';

export const TIPOS_CREDOR_ADIANTAMENTO = ['fornecedor', 'profissional'] as const;
export type TipoCredorAdiantamento = (typeof TIPOS_CREDOR_ADIANTAMENTO)[number];

export type SituacaoAdiantamento = 'pago' | 'compensado_parcial' | 'compensado';

export interface CredorAdiantamento {
  readonly tipo: TipoCredorAdiantamento;
  readonly id: number;
}

export interface ConcessaoInformada {
  readonly valor: number;
  readonly referente: string;
  readonly data: string;
  readonly prazo: string | null;
}

/** Conceder: valor positivo, finalidade escrita e prazo (se houver) depois da data da concessão. */
export function conferirConcessao(c: ConcessaoInformada): RecusaFinanceiro | null {
  if (!(centavos(c.valor) > 0))
    return recusaFin('valor-obrigatorio', 'Informe o valor do adiantamento.', ['valor']);
  if (!c.referente.trim())
    return recusaFin('finalidade-obrigatoria', 'Informe a finalidade do adiantamento.', ['referente']);
  if (c.prazo && c.prazo < c.data)
    return recusaFin('prazo-invalido', 'O prazo para compensar não pode ser antes da concessão.', ['prazo']);
  return null;
}

export interface AdiantamentoParaUso {
  readonly credor: CredorAdiantamento;
  readonly saldo: number;
  readonly situacao: string;
}

const usavel = (s: string) => s === 'pago' || s === 'compensado_parcial';

/** Compensar na baixa do título: mesmo credor, valor até o saldo do adiantamento e até o saldo da parcela. */
export function conferirCompensacao(
  a: AdiantamentoParaUso,
  parcela: { readonly credor: CredorAdiantamento; readonly saldo: number },
  valor: number,
): RecusaFinanceiro | null {
  if (!usavel(a.situacao))
    return recusaFin('adiantamento-sem-saldo', 'O adiantamento não tem saldo a compensar.', ['adiantamento']);
  if (a.credor.tipo !== parcela.credor.tipo || a.credor.id !== parcela.credor.id)
    return recusaFin('credor-diferente', 'O adiantamento só compensa título do mesmo credor.', ['titulo']);
  if (!(centavos(valor) > 0))
    return recusaFin('valor-obrigatorio', 'Informe o valor a compensar.', ['valor']);
  if (centavos(valor) > centavos(a.saldo))
    return recusaFin('acima-do-saldo', 'O valor passa do saldo do adiantamento.', ['valor']);
  if (centavos(valor) > centavos(parcela.saldo))
    return recusaFin('acima-da-parcela', 'O valor passa do saldo do título.', ['valor']);
  return null;
}

/** Devolver o saldo (o credor devolve o que não usou): até o saldo, com motivo. */
export function conferirDevolucao(
  a: AdiantamentoParaUso,
  valor: number,
  motivo: string,
): RecusaFinanceiro | null {
  if (!usavel(a.situacao))
    return recusaFin('adiantamento-sem-saldo', 'O adiantamento não tem saldo a devolver.', ['adiantamento']);
  if (!(centavos(valor) > 0)) return recusaFin('valor-obrigatorio', 'Informe o valor devolvido.', ['valor']);
  if (centavos(valor) > centavos(a.saldo))
    return recusaFin('acima-do-saldo', 'O valor passa do saldo do adiantamento.', ['valor']);
  if (!motivo.trim()) return recusaFin('motivo-obrigatorio', 'Informe o motivo da devolução.', ['motivo']);
  return null;
}

/** Saldo e situação depois de usar `valor` (compensação ou devolução). */
export function aposUso(
  valorConcedido: number,
  saldo: number,
  valor: number,
): {
  saldo: number;
  situacao: SituacaoAdiantamento;
} {
  const novo = centavos(saldo - valor);
  if (novo <= 0) return { saldo: 0, situacao: 'compensado' };
  return { saldo: novo, situacao: novo < centavos(valorConcedido) ? 'compensado_parcial' : 'pago' };
}

/** A parcela depois da compensação: paga quando zera, parcial quando sobra saldo. */
export function parcelaAposCompensacao(
  saldo: number,
  valor: number,
): { saldo: number; situacao: 'paga' | 'parcial' } {
  const novo = centavos(saldo - valor);
  return novo <= 0 ? { saldo: 0, situacao: 'paga' } : { saldo: novo, situacao: 'parcial' };
}
