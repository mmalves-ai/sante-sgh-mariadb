// Cliente da tela das notas de crédito e de débito (F8, 07-FIN linha 70): os apoios (motivos com a natureza que
// aceitam, motivos de cancelamento e tributos), as parcelas em aberto do lado escolhido (a pagar, de fornecedor; a
// receber, de cliente ou fonte pagadora), as notas do estabelecimento e as gravações (emitir sobre a parcela a pagar ou
// a receber, aplicar a emitida, cancelar com motivo). A regra (efeito, tributos, saldo) é a do domínio: a tela a
// mostra na hora e o servidor confere de novo na gravação.
import type { ResultadoFinanceiro } from '@sgh/contratos';
import { z } from 'zod';
import { enviar, ler, qs } from '../exames/api-exames.js';

const P = '/api/financeiro/nota-cessao';

export type LadoNotaTela = 'pagar' | 'receber';
export interface OpcaoNota {
  readonly id: number;
  readonly rotulo: string;
  /** Só no motivo: a natureza que ele aceita. */
  readonly natureza?: 'credito' | 'debito' | 'ambos';
}
export interface ApoiosNota {
  readonly motivos: readonly OpcaoNota[];
  readonly motivosCancelamento: readonly OpcaoNota[];
  readonly tributos: readonly OpcaoNota[];
}
export interface ParcelaNota {
  readonly parcela: number;
  readonly sequencia: number;
  readonly vencimento: string;
  readonly saldo: number;
  readonly situacao: string;
  readonly titulo: number;
  readonly numero: string;
  readonly documento: string;
  readonly contraparte: string | null;
  /** A parcela está com um portador (desconto ou cessão): a nota não a ajusta. */
  readonly portador: string | null;
}
export type SituacaoNota = 'emitida' | 'aplicada' | 'cancelada';
export interface NotaCreditoDebito {
  readonly nota: number;
  readonly numero: number;
  readonly direcao: 'emitida' | 'recebida';
  readonly natureza: 'credito' | 'debito';
  readonly efeito: 'abate' | 'acresce' | null;
  readonly lado: LadoNotaTela;
  readonly dataEmissao: string;
  readonly valorTotal: number;
  readonly valorImpostos: number;
  readonly valorAjuste: number | null;
  readonly situacao: SituacaoNota;
  readonly motivo: string;
  readonly contraparte: string | null;
}
export interface TributoNotaTela {
  readonly tributo: number;
  readonly base: number;
  readonly aliquota: number;
  readonly retido: boolean;
}
export interface EmissaoNota {
  readonly parcela: number;
  readonly direcao: 'emitida' | 'recebida';
  readonly natureza: 'credito' | 'debito';
  readonly motivo: number;
  readonly dataEmissao: string;
  readonly dataVencimento?: string | null;
  readonly serie?: string;
  readonly numeroDocumento?: string;
  readonly valorItens: number;
  readonly valorDesconto: number;
  readonly valorOutros: number;
  readonly tributos: readonly TributoNotaTela[];
  readonly observacao?: string;
  readonly aplicar: boolean;
}

const confiar = <X>() => z.custom<X>((v) => v !== null && typeof v === 'object');
const resultado = confiar<ResultadoFinanceiro>();

export const lerApoiosNota = (): Promise<ApoiosNota> => ler(`${P}/apoios`, confiar<ApoiosNota>());
export const lerParcelasNota = (lado: LadoNotaTela, busca: string): Promise<ParcelaNota[]> =>
  ler(`${P}/parcelas${qs({ lado, busca: busca.trim() || null })}`, z.array(confiar<ParcelaNota>()));
export const lerNotas = (): Promise<NotaCreditoDebito[]> =>
  ler(`${P}/notas`, z.array(confiar<NotaCreditoDebito>()));

/** Emite a nota sobre a parcela do lado (a pagar: fornecedor; a receber: cliente ou fonte pagadora). */
export const emitirNota = (lado: LadoNotaTela, e: EmissaoNota, chave: string): Promise<ResultadoFinanceiro> =>
  enviar(`${P}/notas/${lado}`, e, resultado, chave);
/** Aplica ao título a nota emitida sem aplicar. */
export const aplicarNota = (nota: number, chave: string): Promise<ResultadoFinanceiro> =>
  enviar(`${P}/notas/aplicar`, { nota }, resultado, chave);
/** Cancela com o motivo do cadastro e a justificativa; a aplicada tem o ajuste desfeito no título. */
export const cancelarNota = (
  nota: number,
  motivoCancelamento: number,
  observacao: string,
  chave: string,
): Promise<ResultadoFinanceiro> =>
  enviar(`${P}/notas/cancelar`, { nota, motivoCancelamento, observacao }, resultado, chave);
