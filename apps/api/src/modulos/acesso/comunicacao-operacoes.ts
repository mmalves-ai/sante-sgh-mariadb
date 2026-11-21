// Operações do dicionário pessoal (M27) pelo Executor do @sgh/nucleo: nome, entrada (Zod do contrato) e o evento da
// trilha. A regra (uma palavra por usuário, teto de palavras, chave fonética) é a mesma na memória e no banco.
import { esquemaPalavraDicionario } from '@sgh/contratos';
import type { z } from 'zod';

export const OPERACOES_DICIONARIO = {
  incluir: 'acesso.incluir-palavra-dicionario',
  excluir: 'acesso.excluir-palavra-dicionario',
} as const;

export type OperacaoDicionario = (typeof OPERACOES_DICIONARIO)[keyof typeof OPERACOES_DICIONARIO];

export const ENTRADA_DICIONARIO: z.ZodType<{ palavra: string }> = esquemaPalavraDicionario;

export function operacaoDoDicionario(nome: string): OperacaoDicionario | null {
  return nome === OPERACOES_DICIONARIO.incluir || nome === OPERACOES_DICIONARIO.excluir ? nome : null;
}
