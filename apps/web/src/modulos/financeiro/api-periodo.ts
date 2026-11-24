// Cliente da tela do período financeiro (F3.8, 07-FIN linha 85): as competências do estabelecimento, fechar e reabrir,
// o pedido de reabertura e a decisão de outro usuário, o histórico dos ciclos e o saldo diário gravado por conta.
import type { ResultadoFinanceiro } from '@sgh/contratos';
import { z } from 'zod';
import { enviar, ler, qs } from '../exames/api-exames.js';

const P = '/api/financeiro/periodos';

export interface PeriodoFinanceiro {
  readonly competencia: string;
  readonly situacao: 'aberto' | 'fechado' | 'reaberto';
  readonly fechadoEm: string | null;
  readonly fechadoPor: string | null;
  readonly movimentos: number | null;
  readonly reabertoEm: string | null;
  readonly reabertoPor: string | null;
  readonly autorizadoPor: string | null;
  readonly justificativa: string | null;
  /** O pedido de reabertura à espera de decisão (outro usuário autoriza ou recusa). */
  readonly pedido: { readonly por: string; readonly usuario: number; readonly justificativa: string } | null;
}
export interface EventoPeriodo {
  readonly competencia: string;
  readonly tipo: 'fechamento' | 'pedido_reabertura' | 'reabertura' | 'reabertura_recusada';
  readonly em: string | null;
  readonly por: string | null;
  readonly justificativa: string | null;
  readonly movimentos: number | null;
}
export interface SaldoDiario {
  readonly data: string;
  readonly saldoAnterior: number;
  readonly entradas: number;
  readonly saidas: number;
  readonly saldoFinal: number;
  readonly fechado: boolean;
}

const confiar = <X>() => z.custom<X>((v) => v !== null && typeof v === 'object');

export const lerPeriodos = (): Promise<PeriodoFinanceiro[]> => ler(P, z.array(confiar<PeriodoFinanceiro>()));
export const lerSaldoDiario = (f: { conta: number; de: string; ate: string }): Promise<SaldoDiario[]> =>
  ler(`${P}/saldo-diario${qs(f)}`, z.array(confiar<SaldoDiario>()));
export const fecharPeriodo = (competencia: string, chave: string): Promise<ResultadoFinanceiro> =>
  enviar(`${P}/fechar`, { competencia }, confiar<ResultadoFinanceiro>(), chave);
export const lerEventosPeriodo = (): Promise<EventoPeriodo[]> =>
  ler(`${P}/eventos`, z.array(confiar<EventoPeriodo>()));
export const pedirReabertura = (
  competencia: string,
  justificativa: string,
  chave: string,
): Promise<ResultadoFinanceiro> =>
  enviar(`${P}/pedir-reabertura`, { competencia, justificativa }, confiar<ResultadoFinanceiro>(), chave);
export const decidirReabertura = (
  competencia: string,
  decisao: 'autorizar' | 'recusar',
  observacao: string,
  chave: string,
): Promise<ResultadoFinanceiro> =>
  enviar(
    `${P}/reabrir`,
    { competencia, decisao, ...(observacao.trim() ? { observacao: observacao.trim() } : {}) },
    confiar<ResultadoFinanceiro>(),
    chave,
  );
