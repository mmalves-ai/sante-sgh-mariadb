// Cliente da tela do período financeiro (F3.8, 07-FIN linha 85): as competências do estabelecimento, fechar e reabrir,
// e o saldo diário gravado no fechamento por conta.
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
  readonly justificativa: string | null;
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
export const reabrirPeriodo = (
  competencia: string,
  justificativa: string,
  chave: string,
): Promise<ResultadoFinanceiro> =>
  enviar(`${P}/reabrir`, { competencia, justificativa }, confiar<ResultadoFinanceiro>(), chave);
