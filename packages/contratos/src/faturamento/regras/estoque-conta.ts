// A saída de estoque ao paciente vira item da conta (F3.0, motor estoque → conta): o preço do material ou medicamento
// na conta e o estorno do item quando o produto volta. Regras puras; a gravação (o item, a memória do preço e a ligação
// com o lançamento do razão do estoque, na mesma transação do movimento) fica na API.
// Preço (prática de mercado, TISS e contratos com operadoras):
//   1. o preço negociado com a fonte pagadora vigente na data do consumo prevalece; entre os negociados vale o mais
//      específico (plano, depois tipo de conta, depois tabela da conta), e no empate a vigência mais recente;
//   2. o negociado traz valor fixo, ou percentual sobre a referência de mercado (o mesmo item na publicação), e pode
//      fixar a quantidade cobrada;
//   3. sem negociado, vale a referência de mercado vigente pela base de preço da tabela da conta (preço de fábrica ou
//      máximo ao consumidor; sem base declarada, o máximo ao consumidor), dividida pelo fator da embalagem;
//   4. sem preço nenhum, o item entra com valor zero e a regra "sem_preco", para a conferência da conta tratar: a falta de
//      preço nunca impede a dispensação ao paciente.
// Estorno: a devolução do produto reduz o item na proporção do que voltou e, devolvido tudo, o item fica "estornado"
// (o item não é apagado: a memória guarda cada versão). Conta fechada ou item glosado ou transferido recusa: reabra a
// conta ou trate o item antes de devolver.

export type BasePrecoReferencia = 'pf' | 'pmc';

export interface PrecoNegociadoEstoque {
  readonly id: number;
  readonly plano: number | null;
  readonly tipoConta: number | null;
  readonly tabelaPreco: number | null;
  /** AAAA-MM-DD. */
  readonly vigenciaInicio: string;
  readonly vigenciaFim: string | null;
  readonly valorUnitario: number | null;
  readonly percentualAjuste: number | null;
  readonly quantidadeFixa: number | null;
}

export interface ReferenciaEstoque {
  readonly id: number;
  /** AAAA-MM-DD. */
  readonly vigenciaInicio: string;
  readonly precoFabrica: number | null;
  readonly precoMaximoConsumidor: number | null;
  /** Divisor da embalagem para a unidade cobrada (nulo ou zero: 1). */
  readonly fatorDivisao: number | null;
}

export interface ContaDoLancamentoEstoque {
  readonly plano: number | null;
  readonly tipoConta: number | null;
  readonly tabelaPreco: number | null;
  readonly basePreco: BasePrecoReferencia | null;
}

export interface EntradaPrecoEstoque {
  /** Data do consumo, AAAA-MM-DD (a data-base da vigência). */
  readonly dataBase: string;
  /** Quantidade que saiu, na unidade de estoque. */
  readonly quantidade: number;
  /** Quantas unidades de estoque valem uma unidade da referência (nulo ou zero: 1). */
  readonly fatorConversao: number | null;
  readonly conta: ContaDoLancamentoEstoque;
  readonly negociados: readonly PrecoNegociadoEstoque[];
  readonly referencias: readonly ReferenciaEstoque[];
}

export type RegraPrecoEstoque = 'negociado_fixo' | 'negociado_percentual' | 'referencia' | 'sem_preco';

export interface PrecoEstoque {
  readonly regra: RegraPrecoEstoque;
  readonly valorUnitario: number;
  readonly quantidadeCobrada: number;
  readonly valorTotal: number;
  readonly quantidadeFixa: boolean;
  readonly negociado: number | null;
  readonly referencia: number | null;
  /** Os passos do cálculo, para a memória do preço. */
  readonly passos: readonly string[];
}

const r2 = (x: number) => Math.round(x * 100) / 100;
const r4 = (x: number) => Math.round(x * 10_000) / 10_000;
const dia = (d: string) => d.slice(0, 10);
const fator = (f: number | null) => (f !== null && f > 0 ? f : 1);

const vigente = (inicio: string, fim: string | null, data: string) =>
  dia(inicio) <= data && (fim === null || dia(fim) >= data);

/** O negociado que vale para a conta na data: o mais específico, depois a vigência mais recente, depois o maior id. */
export function negociadoDaConta(
  negociados: readonly PrecoNegociadoEstoque[],
  conta: ContaDoLancamentoEstoque,
  dataBase: string,
): PrecoNegociadoEstoque | null {
  const data = dia(dataBase);
  let melhor: { n: PrecoNegociadoEstoque; peso: number } | null = null;
  for (const n of negociados) {
    if (!vigente(n.vigenciaInicio, n.vigenciaFim, data)) continue;
    if (n.plano !== null && n.plano !== conta.plano) continue;
    if (n.tipoConta !== null && n.tipoConta !== conta.tipoConta) continue;
    if (n.tabelaPreco !== null && n.tabelaPreco !== conta.tabelaPreco) continue;
    if (n.valorUnitario === null && n.percentualAjuste === null) continue;
    const peso = (n.plano !== null ? 4 : 0) + (n.tipoConta !== null ? 2 : 0) + (n.tabelaPreco !== null ? 1 : 0);
    const ganha =
      !melhor ||
      peso > melhor.peso ||
      (peso === melhor.peso &&
        (dia(n.vigenciaInicio) > dia(melhor.n.vigenciaInicio) ||
          (dia(n.vigenciaInicio) === dia(melhor.n.vigenciaInicio) && n.id > melhor.n.id)));
    if (ganha) melhor = { n, peso };
  }
  return melhor?.n ?? null;
}

/** A referência vigente na data (a de vigência mais recente até a data) e o preço unitário dela pela base da conta. */
export function referenciaVigente(
  referencias: readonly ReferenciaEstoque[],
  base: BasePrecoReferencia | null,
  dataBase: string,
): { readonly ref: ReferenciaEstoque; readonly unitario: number; readonly base: BasePrecoReferencia } | null {
  const data = dia(dataBase);
  let ref: ReferenciaEstoque | null = null;
  for (const r of referencias) {
    if (dia(r.vigenciaInicio) > data) continue;
    if (r.precoFabrica === null && r.precoMaximoConsumidor === null) continue;
    if (!ref || dia(r.vigenciaInicio) > dia(ref.vigenciaInicio) || (r.vigenciaInicio === ref.vigenciaInicio && r.id > ref.id))
      ref = r;
  }
  if (!ref) return null;
  const pedida: BasePrecoReferencia = base ?? 'pmc';
  const usada: BasePrecoReferencia =
    (pedida === 'pf' ? ref.precoFabrica : ref.precoMaximoConsumidor) !== null ? pedida : pedida === 'pf' ? 'pmc' : 'pf';
  const preco = (usada === 'pf' ? ref.precoFabrica : ref.precoMaximoConsumidor) ?? 0;
  return { ref, unitario: r4(preco / fator(ref.fatorDivisao)), base: usada };
}

/** O preço do item de estoque na conta do paciente (regras 1 a 4 do cabeçalho). */
export function precoDoItemDeEstoque(e: EntradaPrecoEstoque): PrecoEstoque {
  const passos: string[] = [];
  const data = dia(e.dataBase);
  const qEstoque = r4(e.quantidade);
  const qReferencia = r4(qEstoque / fator(e.fatorConversao));
  const neg = negociadoDaConta(e.negociados, e.conta, data);
  const ref = referenciaVigente(e.referencias, e.conta.basePreco, data);
  const fechar = (
    regra: RegraPrecoEstoque,
    unitario: number,
    quantidade: number,
    quantidadeFixa: boolean,
  ): PrecoEstoque => {
    const q = r4(quantidade);
    const vu = r4(unitario);
    passos.push(`total = ${q} x ${vu}`);
    return {
      regra,
      valorUnitario: vu,
      quantidadeCobrada: q,
      valorTotal: r2(q * vu),
      quantidadeFixa,
      negociado: neg?.id ?? null,
      referencia: ref?.ref.id ?? null,
      passos,
    };
  };
  if (neg) {
    const fixa = neg.quantidadeFixa !== null && neg.quantidadeFixa > 0;
    if (neg.valorUnitario !== null) {
      passos.push(`negociado ${neg.id}: valor fixo ${neg.valorUnitario} por unidade de estoque`);
      if (fixa) passos.push(`quantidade fixa ${neg.quantidadeFixa}`);
      return fechar('negociado_fixo', neg.valorUnitario, fixa ? neg.quantidadeFixa! : qEstoque, fixa);
    }
    if (ref) {
      const pct = neg.percentualAjuste ?? 0;
      passos.push(
        `negociado ${neg.id}: ${pct}% sobre a referência ${ref.ref.id} (${ref.base}, ${ref.unitario} por unidade)`,
      );
      if (fixa) passos.push(`quantidade fixa ${neg.quantidadeFixa}`);
      return fechar(
        'negociado_percentual',
        ref.unitario * (1 + pct / 100),
        fixa ? neg.quantidadeFixa! : qReferencia,
        fixa,
      );
    }
    passos.push(`negociado ${neg.id} é percentual e não há referência vigente`);
  }
  if (ref) {
    passos.push(`referência ${ref.ref.id} (${ref.base}): ${ref.unitario} por unidade da referência`);
    return fechar('referencia', ref.unitario, qReferencia, false);
  }
  passos.push('sem preço negociado nem referência vigente na data');
  return fechar('sem_preco', 0, qEstoque, false);
}

/** Situações da conta em que ainda se lança e estorna item. */
export const SITUACOES_CONTA_LANCAVEL = ['aberta', 'em_conferencia', 'em_auditoria'] as const;
const SITUACOES_ITEM_ESTORNAVEL = ['lancado', 'conferido', 'sem_cobranca'] as const;

export interface EntradaEstornoEstoque {
  readonly situacaoConta: string;
  readonly situacaoItem: string;
  /** Quantidade cobrada hoje no item. */
  readonly quantidadeItem: number;
  readonly valorUnitario: number;
  /** Percentual de cobrança do item (100 = integral). */
  readonly percentualCobranca: number;
  /** A quantidade cobrada é fixa (negociada): só o estorno total a altera. */
  readonly quantidadeFixa: boolean;
  /** O que saiu do estoque no lançamento ligado ao item (unidade de estoque). */
  readonly quantidadeSaida: number;
  /** O que já voltou antes desta devolução (unidade de estoque). */
  readonly jaDevolvida: number;
  /** O que volta agora (unidade de estoque). */
  readonly devolvida: number;
}

export type EstornoEstoque =
  | { readonly recusa: { readonly codigo: string; readonly mensagem: string } }
  | {
      readonly recusa: null;
      readonly situacao: 'lancado' | 'conferido' | 'sem_cobranca' | 'estornado';
      readonly quantidade: number;
      readonly valorTotal: number;
      readonly total: boolean;
    };

/** O item da conta depois da devolução do produto (redução proporcional ou estorno total). */
export function estornoDoItemDeEstoque(e: EntradaEstornoEstoque): EstornoEstoque {
  if (!(SITUACOES_CONTA_LANCAVEL as readonly string[]).includes(e.situacaoConta))
    return {
      recusa: {
        codigo: 'conta-fechada',
        mensagem:
          'A conta do paciente já foi fechada: reabra a conta para devolver o produto (o item cobrado não pode ficar sem o estorno).',
      },
    };
  if (!(SITUACOES_ITEM_ESTORNAVEL as readonly string[]).includes(e.situacaoItem))
    return {
      recusa: {
        codigo: 'item-conta-bloqueado',
        mensagem: `O item da conta está ${e.situacaoItem.replace('_', ' ')}: trate o item na conta antes de devolver o produto.`,
      },
    };
  const antes = r4(e.quantidadeSaida - e.jaDevolvida);
  const resta = r4(antes - e.devolvida);
  if (e.devolvida <= 0 || resta < -1e-6)
    return {
      recusa: { codigo: 'devolucao-acima', mensagem: 'A devolução passa do que saiu para o paciente.' },
    };
  const valor = (q: number) => r2(q * e.valorUnitario * (e.percentualCobranca / 100));
  if (resta <= 1e-6)
    return {
      recusa: null,
      situacao: 'estornado',
      quantidade: e.quantidadeItem,
      valorTotal: valor(e.quantidadeItem),
      total: true,
    };
  const quantidade = e.quantidadeFixa ? e.quantidadeItem : r4((e.quantidadeItem * resta) / antes);
  return {
    recusa: null,
    situacao: e.situacaoItem as 'lancado' | 'conferido' | 'sem_cobranca',
    quantidade,
    valorTotal: valor(quantidade),
    total: false,
  };
}
