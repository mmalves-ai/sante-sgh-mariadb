// Entradas das operações de gravação do financeiro (M32): o mesmo Zod do contrato para a porta do banco e a de memória.
import {
  esquemaBaixarTitulo,
  esquemaCriarTituloPagar,
  esquemaCriarTituloReceber,
  esquemaLancarMovimento,
} from '@sgh/contratos';
import type { ZodType } from 'zod';

export const ESQUEMAS_OPERACAO_FINANCEIRO: Readonly<Record<string, ZodType<unknown>>> = {
  'financeiro.criarTituloPagar': esquemaCriarTituloPagar,
  'financeiro.baixarTitulo': esquemaBaixarTitulo,
  'financeiro.criarTituloReceber': esquemaCriarTituloReceber,
  'financeiro.lancarMovimento': esquemaLancarMovimento,
};
