// Recálculo auditado do saldo e do custo médio (F3.6, 05-SUP linha 16). O razão (o fato de cada movimento: natureza,
// quantidade, valor) nunca é editado: o recálculo refaz a projeção (o saldo do item no local, o custo médio, a posição
// depois de cada movimento e o saldo de cada lote) a partir da abertura do período (a posição do último mês fechado,
// ou zero quando nunca houve fechamento) e dos movimentos depois dela, na ordem em que ocorreram, e apura a diferença
// para o que está gravado. Regras puras: a API confere e aplica; a tela mostra igual.
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

/** A posição depois de cada movimento (o saldo e o custo médio que o histórico do item mostra). */
export interface PassoRecalculo {
  readonly quantidade: number;
  readonly custo: number;
}

/**
 * Os passos da projeção pelo razão com o custo médio ponderado (o mesmo do motor): a entrada soma a quantidade e o
 * valor; a saída tira a quantidade pelo custo do momento (o estorno de entrada, pelo valor dela). Cada passo é a
 * posição depois do movimento, que o recálculo regrava no histórico do item para ele explicar o saldo corrigido.
 */
export function passosRazao(
  abertura: AberturaRecalculo,
  movimentos: readonly MovimentoRecalculo[],
): { passos: PassoRecalculo[]; negativoNoMovimento: number | null } {
  let quantidade = q4(abertura.quantidade);
  let custo = Math.max(0, abertura.custo);
  let negativoNoMovimento: number | null = null;
  const passos: PassoRecalculo[] = [];
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
    passos.push({ quantidade, custo: c6(custo) });
  });
  return { passos, negativoNoMovimento };
}

/**
 * Refaz a projeção pelo razão (o último passo de `passosRazao`). Sem `recalculaCusto`, só a quantidade é refeita e o
 * custo fica o gravado (`custoAtual`).
 */
export function projetarRazao(
  abertura: AberturaRecalculo,
  movimentos: readonly MovimentoRecalculo[],
  recalculaCusto: boolean,
  custoAtual: number,
): ProjecaoRecalculo {
  const { passos, negativoNoMovimento } = passosRazao(abertura, movimentos);
  const fim = passos[passos.length - 1] ?? {
    quantidade: q4(abertura.quantidade),
    custo: c6(Math.max(0, abertura.custo)),
  };
  return { quantidade: fim.quantidade, custo: recalculaCusto ? fim.custo : custoAtual, negativoNoMovimento };
}

/** A quantidade de um lote do item no local (no razão: entradas menos saídas; gravada: o saldo do lote). */
export interface LoteRecalculo {
  readonly lote: number;
  readonly quantidade: number;
}

/**
 * Confere os lotes do saldo refeito. Item sem lote (nem no razão nem gravado): nada a fazer. Com lote, o saldo por
 * lote também é refeito pelo razão, e só se aplica quando a soma dos lotes do razão é a quantidade refeita e nenhum
 * lote fica negativo; senão o saldo fica pendente (`divergente`), para não deixar a soma dos lotes diferente do item.
 * `ajustes` são os lotes cujo gravado muda (o lote só gravado vai a zero).
 */
export function conferirLotesRecalculo(
  quantidadeRefeita: number,
  razao: readonly LoteRecalculo[],
  gravados: readonly LoteRecalculo[],
): { divergente: boolean; ajustes: { lote: number; de: number; para: number }[] } {
  if (razao.length === 0 && gravados.length === 0) return { divergente: false, ajustes: [] };
  const soma = q4(razao.reduce((a, l) => a + l.quantidade, 0));
  if (soma !== q4(quantidadeRefeita) || razao.some((l) => q4(l.quantidade) < 0))
    return { divergente: true, ajustes: [] };
  const para = new Map(razao.map((l) => [l.lote, q4(l.quantidade)]));
  const de = new Map(gravados.map((l) => [l.lote, q4(l.quantidade)]));
  const ajustes = [...new Set([...para.keys(), ...de.keys()])]
    .sort((a, b) => a - b)
    .map((lote) => ({ lote, de: de.get(lote) ?? 0, para: para.get(lote) ?? 0 }))
    .filter((x) => x.de !== x.para);
  return { divergente: false, ajustes };
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
