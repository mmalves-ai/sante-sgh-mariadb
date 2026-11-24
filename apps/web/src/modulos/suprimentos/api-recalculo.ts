// Cliente do recálculo auditado do saldo (F3.6, 05-SUP linha 16), validado pelos contratos: a prévia pelo razão (lê,
// nunca grava) e a aplicação (saldos refeitos e o registro do recálculo, pelo executor com a chave de idempotência).
import {
  esquemaPreviaRecalculo,
  esquemaResultadoSuprimentos,
  type PreviaRecalculo,
  type RecalcularSaldosEntrada,
  type ResultadoSuprimentos,
} from '@sgh/contratos';
import { enviar } from '../exames/api-exames.js';

const S = '/api/suprimentos/recalculos';

export const previaRecalculo = (e: RecalcularSaldosEntrada, chave: string): Promise<PreviaRecalculo> =>
  enviar(`${S}/previa`, e, esquemaPreviaRecalculo, chave);
export const aplicarRecalculo = (e: RecalcularSaldosEntrada, chave: string): Promise<ResultadoSuprimentos> =>
  enviar(S, e, esquemaResultadoSuprimentos, chave);
