// Recálculo auditado do saldo e do custo médio do estoque (F3.6, 05-SUP linha 16): a entrada da operação (o escopo,
// o mês de partida, se refaz também o custo, o motivo) e a prévia que a tela mostra antes de aplicar.
import { z } from 'zod';
import { idBanco } from '../validacao/id-banco.js';
import { esquemaMotivoSuprimentos } from './entradas.js';

export {
  type AberturaRecalculo,
  conferirLotesRecalculo,
  conferirRecalculo,
  diferencaRecalculo,
  type LoteRecalculo,
  type MovimentoRecalculo,
  type PassoRecalculo,
  passosRazao,
  type ProjecaoRecalculo,
  projetarRazao,
} from './regras/recalculo-saldo.js';

export const esquemaRecalcularSaldos = z
  .object({
    /** Nulo: todos os locais do estabelecimento. */
    local: idBanco.nullable(),
    /** Nulo: todos os itens. */
    insumo: idBanco.nullable(),
    /**
     * Opcional: o mês que o pedido quer alcançar (recusado quando ele ou algum depois dele está fechado; sem ele, o mês
     * corrente). O período refeito é sempre o do razão: do mês seguinte ao último fechado de cada saldo (ou do primeiro
     * movimento) até hoje, e é esse que a prévia mostra e o registro grava.
     */
    ano: z.number().int().min(2000).max(2100).optional(),
    mes: z.number().int().min(1).max(12).optional(),
    recalculaCusto: z.boolean(),
    motivo: esquemaMotivoSuprimentos,
  })
  .strict();
export type RecalcularSaldosEntrada = z.infer<typeof esquemaRecalcularSaldos>;

const n = z.number();
/** A prévia (e o resultado gravado) de cada saldo atingido: o gravado, o refeito pelo razão e a diferença. */
export const esquemaDiferencaRecalculo = z.object({
  saldo: n,
  local: n,
  localNome: z.string(),
  insumo: n,
  insumoNome: z.string(),
  movimentos: n,
  quantidadeGravada: n,
  quantidadeRefeita: n,
  custoGravado: n,
  custoRefeito: n,
  diferencaQuantidade: n,
  diferencaValor: n,
  /** O razão deixaria o saldo negativo neste movimento (posição no período): o saldo não é aplicado, fica pendente. */
  negativoNoMovimento: n.nullable(),
  /**
   * Por que o saldo não é aplicado (nulo: é aplicado): o razão fica negativo; a soma dos lotes do razão não bate com o
   * refeito; ou não há razão nem mês fechado que expliquem o saldo gravado (nunca se zera um saldo sem movimento).
   */
  pendencia: z.enum(['razao-negativo', 'lote-divergente', 'sem-razao']).nullable(),
});
export type DiferencaRecalculo = z.infer<typeof esquemaDiferencaRecalculo>;

export const esquemaPreviaRecalculo = z.object({
  abertura: z.string().nullable(),
  /** O primeiro mês de fato refeito (MM/AAAA): o seguinte à menor abertura, ou o do primeiro movimento. */
  inicio: z.string(),
  saldos: n,
  diferencas: z.array(esquemaDiferencaRecalculo),
  diferencaQuantidadeTotal: n,
  diferencaValorTotal: n,
  pendentes: n,
});
export type PreviaRecalculo = z.infer<typeof esquemaPreviaRecalculo>;
