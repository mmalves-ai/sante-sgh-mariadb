// Entradas das operações do centro cirúrgico (M18) gravadas pelo Executor: o Zod de cada uma vem do contrato da tela
// (packages/contratos/src/cirurgia/entradas.ts). A porta própria e a de memória validam pelo mesmo mapa.
// Melhoria: o mapa é do próprio módulo (antes, a receita do sistema de origem); operação fora dele é recusada.
import {
  esquemaAgendarCirurgia,
  esquemaCancelarCirurgia,
  esquemaDefinirSalaUsuario,
  esquemaRegistrarCirurgia,
  esquemaRemarcarCirurgia,
} from '@sgh/contratos';
import { recusa } from '@sgh/nucleo';
import type { ZodType } from 'zod';

export const ENTRADAS_CIRURGIA: Readonly<Record<string, ZodType>> = Object.freeze({
  'cirurgia.agendarCirurgia': esquemaAgendarCirurgia,
  'cirurgia.remarcarCirurgia': esquemaRemarcarCirurgia,
  'cirurgia.cancelarCirurgia': esquemaCancelarCirurgia,
  'cirurgia.definirSalaUsuario': esquemaDefinirSalaUsuario,
  'cirurgia.registrarCirurgia': esquemaRegistrarCirurgia,
});

/** A entrada da operação e o que falta provar dela (null: nada). Operação desconhecida: recusa. */
export function entradaDaOperacao(op: string): { entrada: ZodType; receita: { pendente: string | null } } {
  const entrada = ENTRADAS_CIRURGIA[op];
  if (!entrada) throw recusa('operacao-desconhecida', `Operação desconhecida no centro cirúrgico: ${op}.`);
  return { entrada, receita: { pendente: null } };
}
