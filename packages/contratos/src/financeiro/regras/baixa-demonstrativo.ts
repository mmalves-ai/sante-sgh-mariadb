// F3.8, 07-FIN linha 76: baixa dos títulos do convênio a partir do demonstrativo de pagamento importado da operadora.
// Cada linha do demonstrativo traz o que a operadora pagou e glosou num item da conta; a regra soma por título (o da
// conta do item) e devolve UMA baixa por título, com o recebido e o glosado por item, em vez de alguém digitar item a
// item. A glosa não quita: o saldo glosado continua aberto no título até a glosa ser aceita ou o recurso voltar.
import { centavos, type RecusaFinanceiro, recusaFin, TOLERANCIA } from './recusa.js';

export interface LinhaDoDemonstrativo {
  /** Item da conta hospitalar conciliado com a linha (nulo: a linha não foi reconhecida). */
  readonly itemConta: number | null;
  /** Título a receber da conta do item (nulo: a conta ainda não tem título). */
  readonly titulo: number | null;
  readonly informado: number;
  readonly liberado: number;
  readonly glosa: number;
  /** Motivo da glosa informado pela operadora. */
  readonly motivoGlosa: number | null;
}

export interface TituloDoDemonstrativo {
  readonly titulo: number;
  /** Situação do título: aberto, recebido_parcial, recebido, renegociado, cancelado. */
  readonly situacao: string;
  /** Parcela em aberto que recebe a baixa (nula: não há). */
  readonly parcela: number | null;
  readonly saldo: number;
}

export interface EntradaBaixaDemonstrativo {
  /** Situação do demonstrativo importado: importado, conciliado, com_divergencia, cancelado. */
  readonly situacao: string;
  /** Já existe recebimento efetivado por este demonstrativo. */
  readonly jaBaixado: boolean;
  readonly linhas: readonly LinhaDoDemonstrativo[];
  readonly titulos: readonly TituloDoDemonstrativo[];
}

export interface ItemRecebidoDoDemonstrativo {
  readonly itemConta: number;
  readonly apresentado: number;
  readonly recebido: number;
  readonly glosa: number;
  readonly motivoGlosa: number | null;
  /** recebido (sem glosa), parcial (pago em parte) ou glosado (nada pago). */
  readonly situacao: 'recebido' | 'parcial' | 'glosado';
}

export interface BaixaDoTituloPeloDemonstrativo {
  readonly titulo: number;
  readonly parcela: number;
  readonly recebido: number;
  readonly glosa: number;
  /** O saldo da parcela depois da baixa. */
  readonly saldoRestante: number;
  readonly quita: boolean;
  readonly itens: readonly ItemRecebidoDoDemonstrativo[];
}

export interface PlanoBaixaDemonstrativo {
  readonly baixas: readonly BaixaDoTituloPeloDemonstrativo[];
  readonly totalRecebido: number;
  readonly totalGlosa: number;
  /** Linhas que ficaram de fora (sem item da conta ou sem título), para conferência; não impedem as outras. */
  readonly linhasSemTitulo: number;
  readonly valorSemTitulo: number;
}

/**
 * Planeja a baixa: o demonstrativo cancelado ou já baixado é recusado; a linha sem item ou sem título fica de fora e é
 * contada; o título já recebido, renegociado ou cancelado e o pagamento acima do saldo do título são recusados (nada é
 * baixado pela metade); sem nenhum título a baixar não há o que gravar.
 */
export function planejarBaixaDemonstrativo(
  e: EntradaBaixaDemonstrativo,
): PlanoBaixaDemonstrativo | RecusaFinanceiro {
  if (e.situacao === 'cancelado')
    return recusaFin('demonstrativo-cancelado', 'O demonstrativo foi cancelado: não há o que baixar.');
  if (e.jaBaixado)
    return recusaFin(
      'demonstrativo-ja-baixado',
      'Este demonstrativo já foi baixado nos títulos. Para refazer, desfaça a baixa dele antes (com o motivo).',
    );
  const titulos = new Map(e.titulos.map((t) => [t.titulo, t]));
  const porTitulo = new Map<number, Map<number, ItemRecebidoDoDemonstrativo>>();
  let linhasSemTitulo = 0;
  let valorSemTitulo = 0;
  for (const l of e.linhas) {
    if (!(l.liberado > 0) && !(l.glosa > 0)) continue;
    if (l.itemConta === null || l.titulo === null) {
      linhasSemTitulo += 1;
      valorSemTitulo = centavos(valorSemTitulo + l.liberado);
      continue;
    }
    const itens = porTitulo.get(l.titulo) ?? new Map<number, ItemRecebidoDoDemonstrativo>();
    const antes = itens.get(l.itemConta);
    const recebido = centavos((antes?.recebido ?? 0) + l.liberado);
    const glosa = centavos((antes?.glosa ?? 0) + l.glosa);
    itens.set(l.itemConta, {
      itemConta: l.itemConta,
      apresentado: centavos((antes?.apresentado ?? 0) + l.informado),
      recebido,
      glosa,
      motivoGlosa: antes?.motivoGlosa ?? l.motivoGlosa,
      situacao: glosa <= 0 ? 'recebido' : recebido <= 0 ? 'glosado' : 'parcial',
    });
    porTitulo.set(l.titulo, itens);
  }
  if (porTitulo.size === 0)
    return recusaFin(
      'demonstrativo-sem-titulo',
      'Nenhuma linha do demonstrativo corresponde a um título em aberto: gere o título da competência das contas antes.',
    );
  const baixas: BaixaDoTituloPeloDemonstrativo[] = [];
  for (const [id, itens] of porTitulo) {
    const t = titulos.get(id);
    if (!t || t.parcela === null || !['aberto', 'recebido_parcial'].includes(t.situacao))
      return recusaFin(
        'titulo-nao-aberto',
        'Há linha do demonstrativo para um título já recebido, renegociado ou cancelado: confira o título antes de baixar.',
      );
    const lista = [...itens.values()];
    const recebido = centavos(lista.reduce((x, i) => x + i.recebido, 0));
    const glosa = centavos(lista.reduce((x, i) => x + i.glosa, 0));
    if (recebido > t.saldo + TOLERANCIA)
      return recusaFin(
        'recebido-acima-do-saldo',
        'O demonstrativo paga mais do que o saldo de um título: confira se o título já teve baixa por outra via.',
      );
    const saldoRestante = centavos(Math.max(0, t.saldo - recebido));
    baixas.push({
      titulo: id,
      parcela: t.parcela,
      recebido,
      glosa,
      saldoRestante,
      quita: saldoRestante < TOLERANCIA,
      itens: lista,
    });
  }
  return {
    baixas,
    totalRecebido: centavos(baixas.reduce((x, b) => x + b.recebido, 0)),
    totalGlosa: centavos(baixas.reduce((x, b) => x + b.glosa, 0)),
    linhasSemTitulo,
    valorSemTitulo,
  };
}

/** O motivo mínimo para desfazer a baixa de um demonstrativo (o estorno tem de dizer por quê). */
export const MOTIVO_DESFAZER_BAIXA_MINIMO = 5;

export interface RecebimentoDoDemonstrativo {
  readonly recebimento: number;
  readonly parcela: number;
  readonly titulo: number;
  /** Quanto este recebimento baixou na parcela. */
  readonly recebido: number;
  /** A parcela hoje: situação, saldo e total recebido. */
  readonly situacaoParcela: string;
  readonly saldoParcela: number;
  readonly recebidoParcela: number;
  /** O título hoje: situação e total recebido. */
  readonly situacaoTitulo: string;
  readonly recebidoTitulo: number;
}

export interface EntradaDesfazerBaixaDemonstrativo {
  /** Os recebimentos efetivados que a baixa do demonstrativo gravou. */
  readonly recebimentos: readonly RecebimentoDoDemonstrativo[];
  /** O crédito bancário da baixa já foi conciliado com o extrato. */
  readonly creditoConciliado: boolean;
  readonly motivo: string;
}

export interface DevolucaoDaBaixa {
  readonly recebimento: number;
  readonly parcela: number;
  readonly titulo: number;
  readonly estornado: number;
  /** A parcela depois do estorno. */
  readonly saldoParcela: number;
  readonly recebidoParcela: number;
  readonly situacaoParcela: 'aberta' | 'parcial';
}

export interface PlanoDesfazerBaixaDemonstrativo {
  readonly devolucoes: readonly DevolucaoDaBaixa[];
  /** O título depois do estorno (um por título). */
  readonly titulos: readonly {
    readonly titulo: number;
    readonly recebido: number;
    readonly situacao: 'aberto' | 'recebido_parcial';
  }[];
  /** O total que sai da conta bancária (o débito contrário ao crédito da baixa). */
  readonly totalEstornado: number;
}

/**
 * Desfazer a baixa do demonstrativo (conta ou data errada, demonstrativo trocado): todos os recebimentos dele são
 * estornados de uma vez, com o motivo; cada parcela recupera o saldo que a baixa tirou e o título volta a ficar em
 * aberto ou recebido em parte. Recusado quando a baixa não existe, quando o crédito já foi conciliado com o extrato ou
 * quando a parcela andou depois da baixa (renegociada, cancelada, protestada, perdida): nada é desfeito pela metade.
 */
export function planejarDesfazerBaixaDemonstrativo(
  e: EntradaDesfazerBaixaDemonstrativo,
): PlanoDesfazerBaixaDemonstrativo | RecusaFinanceiro {
  if (e.recebimentos.length === 0)
    return recusaFin(
      'demonstrativo-nao-baixado',
      'Este demonstrativo não tem baixa em vigor: releia a lista.',
    );
  if (e.motivo.trim().length < MOTIVO_DESFAZER_BAIXA_MINIMO)
    return recusaFin('motivo-obrigatorio', 'Diga o motivo de desfazer a baixa.', ['motivo']);
  if (e.creditoConciliado)
    return recusaFin(
      'credito-conciliado',
      'O crédito desta baixa já foi conciliado com o extrato bancário: a baixa não pode mais ser desfeita.',
    );
  const parcelas = new Map<number, { saldo: number; recebido: number }>();
  const titulos = new Map<number, number>();
  const devolucoes: DevolucaoDaBaixa[] = [];
  for (const r of e.recebimentos) {
    const p = parcelas.get(r.parcela) ?? { saldo: r.saldoParcela, recebido: r.recebidoParcela };
    const doTitulo = titulos.get(r.titulo) ?? r.recebidoTitulo;
    if (
      !['parcial', 'recebida'].includes(r.situacaoParcela) ||
      !['recebido_parcial', 'recebido'].includes(r.situacaoTitulo) ||
      r.recebido > p.recebido + TOLERANCIA ||
      r.recebido > doTitulo + TOLERANCIA
    )
      return recusaFin(
        'titulo-movimentado',
        'Há título que mudou depois desta baixa (renegociado, cancelado, protestado ou dado como perdido): a baixa não pode mais ser desfeita.',
      );
    p.saldo = centavos(p.saldo + r.recebido);
    p.recebido = centavos(Math.max(0, p.recebido - r.recebido));
    parcelas.set(r.parcela, p);
    titulos.set(r.titulo, centavos(Math.max(0, doTitulo - r.recebido)));
    devolucoes.push({
      recebimento: r.recebimento,
      parcela: r.parcela,
      titulo: r.titulo,
      estornado: centavos(r.recebido),
      saldoParcela: p.saldo,
      recebidoParcela: p.recebido,
      situacaoParcela: p.recebido > TOLERANCIA ? 'parcial' : 'aberta',
    });
  }
  return {
    devolucoes,
    titulos: [...titulos].map(([titulo, recebido]) => ({
      titulo,
      recebido,
      situacao: recebido > TOLERANCIA ? ('recebido_parcial' as const) : ('aberto' as const),
    })),
    totalEstornado: centavos(devolucoes.reduce((x, d) => x + d.estornado, 0)),
  };
}
