// Operações de tela do repasse pelo executor (F2.2): o nome, a permissão de agir e a entrada (Zod do contrato). A
// porta própria grava cada uma numa operação do @sgh/nucleo; a de memória valida a mesma entrada.
import {
  esquemaEmitirRpaCalculado,
  esquemaIncluirRegraRepasse,
  esquemaIntegrarItensRepasse,
  esquemaLancarEventoRepasse,
} from '@sgh/contratos';
import type { ZodType } from 'zod';

export const ENTRADAS_OPERACAO_REPASSE: Readonly<Record<string, ZodType<unknown>>> = {
  'repasse.lancarEvento': esquemaLancarEventoRepasse,
  'repasse.emitirRpa': esquemaEmitirRpaCalculado,
  'repasse.integrarItens': esquemaIntegrarItensRepasse,
  'repasse.incluirRegra': esquemaIncluirRegraRepasse,
};
