// Contratos de manutenção na F1 do M55 (ficha, F1 "contratos de manutenção"; cap-07 §7.2): a cobertura do equipamento por
// contrato com vigência e o que cobre. Ao acionar a empresa contratada na OS ou no plano, a cobertura tem de estar
// vigente na data e cobrir a natureza do serviço. O contrato de fornecedor completo (aditivos, reajuste, saldo, alertas
// de 90/60/30 dias) é da F3; aqui só o "vence em" para a tela do equipamento.
import type { CoberturaContrato, NaturezaOs } from '@sgh/contratos';
import type { Recusa } from './os.js';
import { diasEntre } from './tempo.js';

export interface CoberturaVigencia {
  readonly id: number;
  readonly cobertura: CoberturaContrato;
  readonly inicio: string;
  readonly fim: string;
  readonly equipamentos: readonly number[];
}

export function vigenteEm(c: Pick<CoberturaVigencia, 'inicio' | 'fim'>, data: string): boolean {
  return diasEntre(c.inicio, data) >= 0 && diasEntre(data, c.fim) >= 0;
}

/** O que cada cobertura atende: "preventiva" não cobre corretiva; as demais cobrem tudo. */
export function cobre(cobertura: CoberturaContrato, natureza: NaturezaOs): boolean {
  if (cobertura === 'preventiva')
    return (
      natureza === 'preventiva' ||
      natureza === 'calibracao' ||
      natureza === 'segurancaEletrica' ||
      natureza === 'inspecao'
    );
  return true;
}

export type RecusaCobertura = 'fora-do-contrato' | 'contrato-fora-da-vigencia' | 'nao-cobre';

export function conferirAcionamento(
  c: CoberturaVigencia,
  equipamento: number,
  natureza: NaturezaOs,
  data: string,
): { readonly ok: true } | Recusa<RecusaCobertura> {
  if (!c.equipamentos.includes(equipamento))
    return {
      ok: false,
      recusa: 'fora-do-contrato',
      mensagem: 'O equipamento não está neste contrato de manutenção.',
    };
  if (!vigenteEm(c, data))
    return {
      ok: false,
      recusa: 'contrato-fora-da-vigencia',
      mensagem: 'O contrato de manutenção não está vigente nesta data.',
    };
  if (!cobre(c.cobertura, natureza))
    return {
      ok: false,
      recusa: 'nao-cobre',
      mensagem: 'Este contrato de manutenção não cobre este tipo de serviço.',
    };
  return { ok: true };
}

/** Coberturas vigentes do equipamento na data, da que vence por último à que vence primeiro. */
export function coberturasVigentes<T extends CoberturaVigencia>(
  cs: readonly T[],
  equipamento: number,
  data: string,
): T[] {
  return cs
    .filter((c) => c.equipamentos.includes(equipamento) && vigenteEm(c, data))
    .sort((a, b) => diasEntre(a.fim, b.fim) || a.id - b.id);
}

/** Dias até o fim da vigência (negativo: vencido). */
export function diasParaVencer(c: Pick<CoberturaVigencia, 'fim'>, hoje: string): number {
  return diasEntre(hoje, c.fim);
}
