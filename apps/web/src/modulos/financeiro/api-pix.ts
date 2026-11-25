// F7, 07-FIN linha 90: cliente da cobrança Pix sobre o título a receber (cobranca-pix.controller.ts): chaves Pix das
// contas, parcelas em aberto, cobranças com os Pix recebidos, emissão, cancelamento, devolução e, fora de produção, o
// pagamento pelo simulador.
import type { ResultadoFinanceiro } from '@sgh/contratos';
import type { MotivoDevolucaoPix, TipoChavePix } from '@sgh/dominio-financeiro';
import { z } from 'zod';
import { enviar, ler } from '../exames/api-exames.js';

const P = '/api/financeiro/pix';
const confiar = <X>() => z.custom<X>((v) => v !== null && typeof v === 'object');
const lista = <X>() => z.custom<X[]>((v) => Array.isArray(v));

export interface ChavePixTela {
  readonly id: number;
  readonly versao: number;
  readonly conta: number;
  readonly contaDescricao: string;
  readonly tipo: TipoChavePix;
  readonly chave: string;
  readonly padrao: boolean;
  readonly ativa: boolean;
}
export interface ParcelaPix {
  readonly parcela: number;
  readonly titulo: string;
  readonly sequencia: number;
  readonly vencimento: string | null;
  readonly saldo: number;
  readonly pagador: string;
  readonly temDocumento: boolean;
  readonly cobrancaAtiva: number | null;
}
export interface PixRecebidoTela {
  readonly retorno: number;
  readonly fimAFim: string;
  readonly valor: number;
  readonly pagoEm: string | null;
  readonly situacao: string;
  readonly baixado: number;
  readonly devolvido: number;
  readonly podeDevolver: number;
  readonly excedenteLivre: number;
  readonly aviso: string | null;
}
export interface CobrancaPixTela {
  readonly id: number;
  readonly txid: string;
  readonly modalidade: 'imediata' | 'com_vencimento';
  readonly valor: number;
  readonly situacao: string;
  readonly criadaEm: string | null;
  readonly vencimento: string | null;
  readonly pagador: string | null;
  readonly titulo: string | null;
  readonly parcela: number | null;
  readonly copiaECola: string | null;
  readonly valorPago: number | null;
  readonly pagoEm: string | null;
  readonly recebidos: readonly PixRecebidoTela[];
}
export type PedidoChavePix =
  | { acao: 'incluir'; conta: number; tipo: TipoChavePix; chave: string; padrao: boolean }
  | { acao: 'desativar'; chave: number };
export interface PedidoCobrancaPixTela {
  parcela: number;
  chave: number;
  modalidade: 'imediata' | 'com_vencimento';
  valor?: number;
  vencimento?: string;
  descricao?: string;
}

const consulta = (o: Record<string, string | null | undefined>) =>
  Object.entries(o)
    .filter(([, v]) => v !== null && v !== undefined && v !== '')
    .map(([k, v]) => `${k}=${encodeURIComponent(String(v))}`)
    .join('&');

export const lerChavesPix = () => ler(`${P}/chaves`, lista<ChavePixTela>());
export const lerParcelasParaPix = (busca: string) =>
  ler(`${P}/parcelas?${consulta({ busca })}`, lista<ParcelaPix>());
export const lerCobrancasPix = (f: { situacao: string | null; busca: string }) =>
  ler(`${P}/cobrancas?${consulta(f)}`, lista<CobrancaPixTela>());
const gravar = (caminho: string, corpo: unknown, chave: string) =>
  enviar(`${P}/${caminho}`, corpo, confiar<ResultadoFinanceiro>(), chave);
export const manterChavePix = (e: PedidoChavePix, chave: string) => gravar('chaves', e, chave);
export const emitirCobrancaPix = (e: PedidoCobrancaPixTela, chave: string) => gravar('cobrancas', e, chave);
export const cancelarCobrancaPix = (e: { cobranca: number; motivo: string }, chave: string) =>
  gravar('cobrancas/cancelar', e, chave);
export const devolverPix = (
  e: { retorno: number; valor: number; motivo: MotivoDevolucaoPix },
  chave: string,
) => gravar('devolucoes', e, chave);
/** Fora de produção: o simulador paga a cobrança (o servidor responde 404 em produção). */
export const pagarPixSimulado = (e: { cobranca: number; valor?: number }, chave: string) =>
  gravar('cobrancas/pagar-simulado', e, chave);
