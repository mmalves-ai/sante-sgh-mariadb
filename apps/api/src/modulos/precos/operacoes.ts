// Operações de gravação do M12 (as duas fontes): o nome, a entrada (Zod de @sgh/contratos) e a criticidade
// (reautenticação recente). A fonte própria grava pelo Executor do @sgh/nucleo; a memória, com as mesmas entradas.
import {
  esquemaAlterarContratoConvenio,
  esquemaAlterarSituacaoConvenio,
  esquemaDesfazerReajuste,
  esquemaReajustar,
} from '@sgh/contratos';
import type { ZodType } from 'zod';

export interface DefinicaoOperacaoPreco {
  readonly entrada: ZodType<unknown>;
  readonly critica: boolean;
}

export const OPERACOES_PRECO = {
  'convenio.alterarSituacao': { entrada: esquemaAlterarSituacaoConvenio, critica: true },
  'convenio.alterarContrato': { entrada: esquemaAlterarContratoConvenio, critica: true },
  'preco.reajustar': { entrada: esquemaReajustar, critica: true },
  'preco.desfazerReajuste': { entrada: esquemaDesfazerReajuste, critica: true },
} as const satisfies Readonly<Record<string, DefinicaoOperacaoPreco>>;

export type NomeOperacaoPreco = keyof typeof OPERACOES_PRECO;
