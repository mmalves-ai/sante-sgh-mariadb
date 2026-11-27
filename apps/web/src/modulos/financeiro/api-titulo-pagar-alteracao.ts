// F3.8, 07-FIN linha 63 (C1-008): cliente da alteração do título a pagar não pago e a conferência da tela. A regra (o que
// reabre a alçada, o que é recusado) é a do domínio, conferida de novo no servidor; a tela só confere na hora que as
// parcelas somam o valor do documento. A devolução ao fornecedor usa a emissão da nota de crédito ou débito
// (api-nota-credito-debito.ts) sobre a parcela em aberto do título.
import type { ResultadoFinanceiro } from '@sgh/contratos';
import { z } from 'zod';
import { enviar } from '../exames/api-exames.js';

export interface ParcelaAlteracao {
  readonly parcela: number;
  readonly vencimento: string;
  readonly valor: number;
}
export interface AlteracaoTituloPagar {
  readonly versao: string | null;
  readonly documento?: string;
  readonly serie?: string;
  readonly emissao?: string;
  readonly valorDocumento?: number;
  readonly referente?: string;
  readonly observacao?: string;
  readonly parcelas?: readonly ParcelaAlteracao[];
  readonly justificativa?: string;
}

const resultado = z.custom<ResultadoFinanceiro>((v) => v !== null && typeof v === 'object');

/** Altera o título a pagar não pago pela parcela que a ficha mostra (o "id do título" das telas). */
export const alterarTituloPagar = (
  parcela: number,
  corpo: AlteracaoTituloPagar,
  chave: string,
): Promise<ResultadoFinanceiro> =>
  enviar(`/api/financeiro/pagar/alteracao/titulos/${parcela}`, corpo, resultado, chave);

const centavos = (v: number) => Math.round(v * 100);

/** O que falta para as parcelas valerem: vencimento e valor em cada uma e a soma igual ao valor do documento. */
export function conferirParcelasAlteracao(
  parcelas: readonly { vencimento: string; valor: number }[],
  valorDocumento: number,
): { readonly erro: 'sem-parcela' | 'parcela-incompleta' | 'soma-diferente' | null; readonly soma: number } {
  const soma = parcelas.reduce((s, p) => s + centavos(Number(p.valor) || 0), 0) / 100;
  if (!parcelas.length) return { erro: 'sem-parcela', soma };
  if (parcelas.some((p) => !/^\d{4}-\d{2}-\d{2}$/.test(p.vencimento) || !(Number(p.valor) > 0)))
    return { erro: 'parcela-incompleta', soma };
  if (centavos(soma) !== centavos(valorDocumento)) return { erro: 'soma-diferente', soma };
  return { erro: null, soma };
}

/** Origem da devolução: o fornecedor manda a nota de crédito (recebida); o hospital emite a nota de débito. */
export const ORIGEM_DEVOLUCAO = {
  fornecedor: { direcao: 'recebida', natureza: 'credito' },
  hospital: { direcao: 'emitida', natureza: 'debito' },
} as const;
export type OrigemDevolucao = keyof typeof ORIGEM_DEVOLUCAO;

/** Os motivos que servem à origem escolhida (natureza da nota ou 'ambos'). */
export const motivosDaOrigem = <M extends { natureza?: 'credito' | 'debito' | 'ambos' }>(
  motivos: readonly M[],
  origem: OrigemDevolucao,
): M[] => motivos.filter((m) => m.natureza === 'ambos' || m.natureza === ORIGEM_DEVOLUCAO[origem].natureza);
