// As operações de gravação da conta do paciente (M30) pelo Executor: nome → esquema de entrada (Zod dos contratos).
// A memória de dev/ci e a porta própria validam pela mesma tabela.
import {
  esquemaConferirItem,
  esquemaFecharConta,
  esquemaLancarItem,
  esquemaReabrirConta,
} from '@sgh/contratos';
import type { z } from 'zod';

export const ENTRADAS_FATURAMENTO = {
  'faturamento.fecharConta': esquemaFecharConta,
  'faturamento.reabrirConta': esquemaReabrirConta,
  'faturamento.conferirItem': esquemaConferirItem,
  'faturamento.lancarItem': esquemaLancarItem,
} as const satisfies Readonly<Record<string, z.ZodTypeAny>>;

export type OperacaoFaturamento = keyof typeof ENTRADAS_FATURAMENTO;

export const OPERACOES_FATURAMENTO: readonly OperacaoFaturamento[] = Object.keys(
  ENTRADAS_FATURAMENTO,
) as OperacaoFaturamento[];

export function ehOperacaoFaturamento(op: string): op is OperacaoFaturamento {
  return Object.hasOwn(ENTRADAS_FATURAMENTO, op);
}

/**
 * A versão da conta e do item na tela: o número da coluna `versao` em texto, com o prefixo "v" e zeros à esquerda
 * (o contrato pede de 10 a 40 caracteres). "v000000003" ↔ 3.
 */
export const versaoTexto = (n: number): string => `v${String(n).padStart(9, '0')}`;
export function versaoNumero(t: string): number | null {
  const m = /^v(\d{9,39})$/.exec(t);
  return m ? Number(m[1]) : null;
}
