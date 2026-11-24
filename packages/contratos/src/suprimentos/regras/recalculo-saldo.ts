// Recálculo auditado do saldo e do custo médio (F3.6, 05-SUP linha 16). O razão (os movimentos) nunca é editado: o
// recálculo refaz a projeção (o saldo do item no local e o custo médio) a partir da abertura do período (a posição do
// último mês fechado antes dele, ou zero quando nunca houve fechamento) e dos movimentos depois dela, na ordem em que
// ocorreram, e apura a diferença para o que está gravado. Regras puras: a API confere e aplica; a tela mostra igual.
import { chaveCompetencia, type Competencia, rotuloCompetencia } from './competencia.js';
import { recusa, type RecusaSuprimentos } from './recusa.js';

/** A posição de partida do período (quantidade na unidade de estoque e custo médio unitário). */
export interface AberturaRecalculo {
  readonly quantidade: number;
  readonly custo: number;
}

/** Um movimento do razão, na ordem em que ocorreu. */
export interface MovimentoRecalculo {
  readonly natureza: 'entrada' | 'saida';
  /** Quantidade na unidade de estoque (sempre positiva). */
  readonly quantidade: number;
  /** Valor gravado no movimento (a entrada entra no custo por ele). */
  readonly valor: number;
  /** Saída que estorna uma entrada: sai pelo valor da entrada estornada (desfaz o custo que ela trouxe). */
  readonly valorEstornado?: number | null;
}

export interface ProjecaoRecalculo {
  readonly quantidade: number;
  readonly custo: number;
  /** O movimento (posição na lista, a partir de 1) em que o saldo ficaria negativo; nulo quando nunca fica. */
  readonly negativoNoMovimento: number | null;
}

const q4 = (v: number): number => Math.round(v * 10_000) / 10_000;
const c6 = (v: number): number => Math.round(v * 1_000_000) / 1_000_000;

/**
 * Refaz a projeção pelo razão com o custo médio ponderado (o mesmo do motor): a entrada soma a quantidade e o valor;
 * a saída tira a quantidade pelo custo do momento (o estorno de entrada, pelo valor dela). Sem `recalculaCusto`, só a
 * quantidade é refeita e o custo fica o gravado (`custoAtual`).
 */
export function projetarRazao(
  abertura: AberturaRecalculo,
  movimentos: readonly MovimentoRecalculo[],
  recalculaCusto: boolean,
  custoAtual: number,
): ProjecaoRecalculo {
  let quantidade = q4(abertura.quantidade);
  let custo = Math.max(0, abertura.custo);
  let negativoNoMovimento: number | null = null;
  movimentos.forEach((m, i) => {
    const antes = quantidade;
    if (m.natureza === 'entrada') {
      quantidade = q4(antes + m.quantidade);
      if (quantidade > 0) custo = Math.max(0, c6((antes * custo + m.valor) / quantidade));
    } else {
      quantidade = q4(antes - m.quantidade);
      if (quantidade < 0 && negativoNoMovimento === null) negativoNoMovimento = i + 1;
      if (m.valorEstornado !== null && m.valorEstornado !== undefined && quantidade > 0)
        custo = Math.max(0, c6((antes * custo - m.valorEstornado) / quantidade));
    }
  });
  return { quantidade, custo: recalculaCusto ? c6(custo) : custoAtual, negativoNoMovimento };
}

/** A diferença apurada de um saldo: projeção menos o gravado, em quantidade e em valor (quantidade × custo). */
export function diferencaRecalculo(
  gravado: { readonly quantidade: number; readonly custo: number },
  projecao: { readonly quantidade: number; readonly custo: number },
): { quantidade: number; valor: number } {
  return {
    quantidade: q4(projecao.quantidade - gravado.quantidade),
    valor:
      Math.round((projecao.quantidade * projecao.custo - gravado.quantidade * gravado.custo) * 100) / 100,
  };
}

/**
 * Confere o pedido de recálculo: o período começa num mês aberto (o mês fechado só se recalcula depois de reaberto,
 * para o fechamento continuar explicável), nunca depois do mês corrente, e o motivo é obrigatório.
 */
export function conferirRecalculo(
  e: { readonly competencia: Competencia; readonly motivo: string },
  fechados: readonly Competencia[],
  corrente: Competencia,
): RecusaSuprimentos[] {
  const rs: RecusaSuprimentos[] = [];
  if (chaveCompetencia(e.competencia) > chaveCompetencia(corrente))
    rs.push(
      recusa('competencia-futura', `O recálculo começa no máximo em ${rotuloCompetencia(corrente)}.`, [
        'competencia',
      ]),
    );
  const fechadoNoPeriodo = fechados
    .filter((f) => chaveCompetencia(f) >= chaveCompetencia(e.competencia))
    .sort((a, b) => chaveCompetencia(b) - chaveCompetencia(a))[0];
  if (fechadoNoPeriodo)
    rs.push(
      recusa(
        'periodo-fechado',
        `O mês ${rotuloCompetencia(fechadoNoPeriodo)} está fechado: reabra-o antes de recalcular a partir de ${rotuloCompetencia(e.competencia)}.`,
        ['competencia'],
      ),
    );
  if (e.motivo.replace(/\s+/g, ' ').trim().length < 10)
    rs.push(
      recusa('motivo-obrigatorio', 'Escreva o motivo do recálculo (ao menos 10 caracteres).', ['motivo']),
    );
  return rs;
}
