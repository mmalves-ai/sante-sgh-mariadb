// Simulação de cenários de receita sobre a produção real (F8, 01-ADM L120). Regras puras, sem banco: o cenário (troca
// de tabela de preço ou de convênio, reajuste percentual e conversão de procedimentos), o recálculo de cada item da
// produção (o preço unitário vem do motor de preços, já buscado pela porta) e a consolidação do resultado por convênio,
// procedimento e tipo de atendimento, com as inconsistências (o que não se conseguiu precificar). Nada aqui grava nas
// contas: o recálculo é uma fotografia do "e se", gravada à parte com o cenário.

export const TIPOS_ATENDIMENTO_FILTRO = ['ambulatorial', 'urgencia', 'internacao', 'externo'] as const;
export type TipoAtendimentoFiltro = (typeof TIPOS_ATENDIMENTO_FILTRO)[number];
export type TipoAtendimentoResultado = TipoAtendimentoFiltro | 'domiciliar';
export const DATAS_REFERENCIA_SIMULACAO = ['competencia', 'atendimento'] as const;
export type DataReferenciaSimulacao = (typeof DATAS_REFERENCIA_SIMULACAO)[number];
export type ObjetivoCenarioReceita = 'reajuste_fonte_pagadora' | 'troca_tabela_preco' | 'nova_fonte_pagadora';
export type TipoSimulacaoReceita =
  'conversao_tabela' | 'conversao_procedimento' | 'reajuste' | 'cenario_completo';
export type MotivoInconsistenciaSimulacao = 'sem_preco_destino' | 'fator_invalido' | 'outro';

/** Período máximo da produção usada como base (um ano e um dia, para cobrir o mesmo mês do ano anterior). */
export const PERIODO_MAXIMO_DIAS = 366;
export const PERCENTUAL_MINIMO = -100;
export const PERCENTUAL_MAXIMO = 999;

export interface ConversaoProcedimentoCenario {
  /** Código do procedimento cobrado hoje (TUSS ou próprio). */
  readonly itemAtualCodigo: string;
  /** Código do procedimento que passa a ser cobrado na simulação. */
  readonly itemDestinoCodigo: string;
  /** `fatorAtual` unidades do procedimento atual equivalem a `fatorDestino` unidades do de destino. */
  readonly fatorAtual: number;
  readonly fatorDestino: number;
  /** Valor somado ao preço de destino de cada item convertido. */
  readonly acrescimoValor: number | null;
  /** Troca o código e conserva o valor atual (só o reajuste do convênio incide). */
  readonly mantemValorOriginal: boolean;
}

export interface RegraCenarioReceita {
  /** Convênio da produção real. */
  readonly fontePagadoraId: number;
  /** Plano da produção real (nulo: todos os planos do convênio). */
  readonly planoId: number | null;
  /** Tabela de preço simulada (nula: a tabela do convênio de destino ou a da própria conta). */
  readonly tabelaDestinoId: number | null;
  /** Convênio simulado (nulo: o mesmo). */
  readonly fonteDestinoId: number | null;
  readonly planoDestinoId: number | null;
  /** Reajuste sobre o valor simulado (negativo para redução). */
  readonly percentualAjuste: number | null;
  readonly conversoes: readonly ConversaoProcedimentoCenario[];
}

export interface CenarioReceitaEntrada {
  readonly nome: string;
  readonly descricao?: string | null;
  readonly producaoInicio: string;
  readonly producaoFim: string;
  readonly dataReferencia: DataReferenciaSimulacao;
  /** Recorte opcional da produção pelo tipo de atendimento. */
  readonly tipoAtendimento: TipoAtendimentoFiltro | null;
  readonly regras: readonly RegraCenarioReceita[];
}

export type ErrosCenario = Record<string, string>;

const DATA = /^\d{4}-\d{2}-\d{2}$/;
const dataValida = (d: string) => DATA.test(d) && !Number.isNaN(Date.parse(`${d}T00:00:00Z`));
const diasEntre = (a: string, b: string) =>
  Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);
const finito = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x);
const r2 = (x: number) => Math.round(x * 100) / 100;
const r4 = (x: number) => Math.round(x * 10_000) / 10_000;

/** A regra só muda algo se troca tabela ou convênio, reajusta ou converte procedimentos. */
export function regraMudaAlgo(r: RegraCenarioReceita): boolean {
  return (
    r.tabelaDestinoId !== null ||
    r.fonteDestinoId !== null ||
    (r.percentualAjuste !== null && r.percentualAjuste !== 0) ||
    r.conversoes.length > 0
  );
}

/** Erros do cenário por campo (vazio: válido). A mesma regra roda na tela, enquanto se digita, e no servidor. */
export function validarCenarioReceita(e: CenarioReceitaEntrada): ErrosCenario {
  const erros: ErrosCenario = {};
  const nome = (e.nome ?? '').trim();
  if (nome.length < 3 || nome.length > 150) erros['nome'] = 'Dê ao cenário um nome de 3 a 150 caracteres.';
  if (!dataValida(e.producaoInicio)) erros['producaoInicio'] = 'Informe o início da produção (AAAA-MM-DD).';
  if (!dataValida(e.producaoFim)) erros['producaoFim'] = 'Informe o fim da produção (AAAA-MM-DD).';
  if (!erros['producaoInicio'] && !erros['producaoFim']) {
    const dias = diasEntre(e.producaoInicio, e.producaoFim);
    if (dias < 0) erros['producaoFim'] = 'O fim da produção não pode ser antes do início.';
    else if (dias > PERIODO_MAXIMO_DIAS)
      erros['producaoFim'] = `A produção base vai até ${PERIODO_MAXIMO_DIAS} dias; divida o período.`;
  }
  if (!DATAS_REFERENCIA_SIMULACAO.includes(e.dataReferencia))
    erros['dataReferencia'] =
      'Escolha se a produção é recortada pela competência ou pela data do atendimento.';
  if (e.tipoAtendimento !== null && !TIPOS_ATENDIMENTO_FILTRO.includes(e.tipoAtendimento))
    erros['tipoAtendimento'] = 'Tipo de atendimento desconhecido.';
  if (!e.regras.length) erros['regras'] = 'Inclua ao menos um convênio com o que muda.';
  const chaves = new Set<string>();
  e.regras.forEach((r, i) => {
    const p = `regras.${i}`;
    if (!Number.isInteger(r.fontePagadoraId) || r.fontePagadoraId <= 0)
      erros[`${p}.fontePagadoraId`] = 'Escolha o convênio da produção.';
    const chave = `${r.fontePagadoraId}|${r.planoId ?? '*'}`;
    if (chaves.has(chave)) erros[`${p}.planoId`] = 'Este convênio (e plano) já está no cenário.';
    chaves.add(chave);
    if (r.fonteDestinoId !== null && r.fonteDestinoId === r.fontePagadoraId)
      erros[`${p}.fonteDestinoId`] = 'O convênio simulado é o mesmo da produção; deixe em branco.';
    if (r.planoDestinoId !== null && r.fonteDestinoId === null)
      erros[`${p}.planoDestinoId`] = 'O plano simulado pede o convênio simulado.';
    if (r.percentualAjuste !== null) {
      if (!finito(r.percentualAjuste)) erros[`${p}.percentualAjuste`] = 'O reajuste é um número (por cento).';
      else if (r.percentualAjuste < PERCENTUAL_MINIMO || r.percentualAjuste > PERCENTUAL_MAXIMO)
        erros[`${p}.percentualAjuste`] = `O reajuste vai de ${PERCENTUAL_MINIMO}% a ${PERCENTUAL_MAXIMO}%.`;
    }
    if (!regraMudaAlgo(r))
      erros[`${p}.destino`] =
        'Diga o que muda para este convênio: tabela, convênio simulado, reajuste ou conversão.';
    const atuais = new Set<string>();
    r.conversoes.forEach((c, j) => {
      const q = `${p}.conversoes.${j}`;
      const atual = (c.itemAtualCodigo ?? '').trim();
      const destino = (c.itemDestinoCodigo ?? '').trim();
      if (!atual) erros[`${q}.itemAtualCodigo`] = 'Informe o código cobrado hoje.';
      else if (atuais.has(atual))
        erros[`${q}.itemAtualCodigo`] = 'Este código já tem conversão neste convênio.';
      atuais.add(atual);
      if (!destino) erros[`${q}.itemDestinoCodigo`] = 'Informe o código de destino.';
      else if (destino === atual && !c.mantemValorOriginal && c.acrescimoValor === null)
        erros[`${q}.itemDestinoCodigo`] = 'O código de destino é o mesmo do atual.';
      if (!finito(c.fatorAtual) || c.fatorAtual <= 0)
        erros[`${q}.fatorAtual`] = 'O fator do código atual é maior que zero.';
      if (!finito(c.fatorDestino) || c.fatorDestino <= 0)
        erros[`${q}.fatorDestino`] = 'O fator do código de destino é maior que zero.';
      if (c.acrescimoValor !== null && !finito(c.acrescimoValor))
        erros[`${q}.acrescimoValor`] = 'O acréscimo é um valor em reais.';
    });
  });
  return erros;
}

/** O objetivo do cenário pelo que as regras mudam (o mais amplo vence). */
export function objetivoDoCenario(regras: readonly RegraCenarioReceita[]): ObjetivoCenarioReceita {
  if (regras.some((r) => r.fonteDestinoId !== null)) return 'nova_fonte_pagadora';
  if (regras.some((r) => r.tabelaDestinoId !== null)) return 'troca_tabela_preco';
  return 'reajuste_fonte_pagadora';
}

/** O tipo da simulação: uma só natureza de mudança dá o tipo dela; mais de uma, o cenário completo. */
export function tipoDaSimulacao(regras: readonly RegraCenarioReceita[]): TipoSimulacaoReceita {
  const tabela = regras.some((r) => r.tabelaDestinoId !== null || r.fonteDestinoId !== null);
  const reajuste = regras.some((r) => r.percentualAjuste !== null && r.percentualAjuste !== 0);
  const conversao = regras.some((r) => r.conversoes.length > 0);
  const n = [tabela, reajuste, conversao].filter(Boolean).length;
  if (n !== 1) return 'cenario_completo';
  if (tabela) return 'conversao_tabela';
  return reajuste ? 'reajuste' : 'conversao_procedimento';
}

/** O tipo de atendimento do resultado pela natureza da conta (o pronto-atendimento é a urgência). */
export function tipoAtendimentoDaConta(natureza: string): TipoAtendimentoResultado | null {
  switch (natureza) {
    case 'ambulatorial':
      return 'ambulatorial';
    case 'pronto_atendimento':
      return 'urgencia';
    case 'internacao':
      return 'internacao';
    case 'externo':
      return 'externo';
    case 'domiciliar':
      return 'domiciliar';
    default:
      return null;
  }
}

/** A regra que vale para o item: a do plano da conta vence a do convênio inteiro. */
export function regraDoItem<R extends Pick<RegraCenarioReceita, 'fontePagadoraId' | 'planoId'>>(
  regras: readonly R[],
  fonte: number,
  plano: number | null,
): R | null {
  return (
    regras.find((r) => r.fontePagadoraId === fonte && r.planoId !== null && r.planoId === plano) ??
    regras.find((r) => r.fontePagadoraId === fonte && r.planoId === null) ??
    null
  );
}

/** Item da produção real (o que está na conta hoje). */
export interface ItemProducao {
  readonly itemFaturavelId: number;
  readonly quantidade: number;
  /** Percentual de cobrança do item na conta (múltiplos, via de acesso): incide também no preço simulado. */
  readonly percentualCobranca: number;
  readonly valorAtual: number;
}

/** A conversão já resolvida para ids (a porta resolve os códigos). */
export interface ConversaoResolvida {
  readonly itemAtualId: number;
  readonly itemDestinoId: number;
  readonly fatorAtual: number;
  readonly fatorDestino: number;
  readonly acrescimoValor: number | null;
  readonly mantemValorOriginal: boolean;
}

export interface RegraResolvida {
  readonly tabelaDestinoId: number | null;
  readonly fonteDestinoId: number | null;
  readonly percentualAjuste: number | null;
  readonly conversoes: readonly ConversaoResolvida[];
}

/** O que buscar no motor de preços para o item: qual procedimento, quantas unidades e se precisa de preço. */
export interface PlanoDoItem {
  readonly itemCobradoId: number;
  readonly quantidade: number;
  readonly conversao: ConversaoResolvida | null;
  /** Falso quando o valor simulado parte do valor atual (só reajuste, ou conversão que conserva o valor). */
  readonly precisaPreco: boolean;
}

export function planoDoItem(item: ItemProducao, regra: RegraResolvida): PlanoDoItem {
  const conversao = regra.conversoes.find((c) => c.itemAtualId === item.itemFaturavelId) ?? null;
  const quantidade = conversao
    ? r4((item.quantidade * conversao.fatorDestino) / conversao.fatorAtual)
    : item.quantidade;
  const trocaPreco = regra.tabelaDestinoId !== null || regra.fonteDestinoId !== null;
  const precisaPreco = conversao ? !conversao.mantemValorOriginal : trocaPreco;
  return {
    itemCobradoId: conversao?.itemDestinoId ?? item.itemFaturavelId,
    quantidade,
    conversao,
    precisaPreco,
  };
}

export interface ValorSimulado {
  readonly valorSimulado: number;
  /** Nulo quando o item foi precificado; senão, o motivo (o valor simulado fica igual ao atual). */
  readonly inconsistencia: MotivoInconsistenciaSimulacao | null;
}

/**
 * O valor simulado do item: o preço unitário de destino × a quantidade convertida × o percentual de cobrança do item,
 * mais o acréscimo da conversão, e então o reajuste do convênio. Sem preço de destino, o item fica pelo valor atual
 * e vira inconsistência (o total não some com o item, e a diferença dele é zero).
 */
export function valorSimuladoDoItem(
  item: ItemProducao,
  regra: RegraResolvida,
  plano: PlanoDoItem,
  unitarioDestino: number | null,
): ValorSimulado {
  if (plano.conversao && (plano.conversao.fatorAtual <= 0 || plano.conversao.fatorDestino <= 0))
    return { valorSimulado: r2(item.valorAtual), inconsistencia: 'fator_invalido' };
  let base: number;
  if (plano.precisaPreco) {
    if (unitarioDestino === null || !Number.isFinite(unitarioDestino))
      return { valorSimulado: r2(item.valorAtual), inconsistencia: 'sem_preco_destino' };
    base = (unitarioDestino * plano.quantidade * item.percentualCobranca) / 100;
  } else base = item.valorAtual;
  if (plano.conversao?.acrescimoValor) base += plano.conversao.acrescimoValor * item.quantidade;
  const fator = 1 + (regra.percentualAjuste ?? 0) / 100;
  return { valorSimulado: Math.max(0, r2(base * fator)), inconsistencia: null };
}

/** Uma linha recalculada da produção, já com a chave do resultado. */
export interface LinhaRecalculada {
  readonly fontePagadoraId: number;
  readonly planoId: number | null;
  readonly fonteDestinoId: number | null;
  readonly planoDestinoId: number | null;
  readonly itemFaturavelId: number;
  readonly tipoAtendimento: TipoAtendimentoResultado | null;
  readonly atendimentoId: number;
  readonly quantidade: number;
  readonly valorAtual: number;
  readonly valorSimulado: number;
}

export interface LinhaResultado {
  readonly sequencia: number;
  readonly fontePagadoraId: number;
  readonly planoId: number | null;
  readonly fonteDestinoId: number | null;
  readonly planoDestinoId: number | null;
  readonly itemFaturavelId: number;
  readonly tipoAtendimento: TipoAtendimentoResultado | null;
  readonly quantidade: number;
  readonly quantidadeAtendimentos: number;
  readonly valorAtual: number;
  readonly valorSimulado: number;
}

/** O resultado consolidado por convênio, plano, destino, procedimento e tipo de atendimento (ordem estável). */
export function consolidarResultado(linhas: readonly LinhaRecalculada[]): LinhaResultado[] {
  const grupos = new Map<
    string,
    { base: LinhaRecalculada; q: number; atual: number; sim: number; atendimentos: Set<number> }
  >();
  for (const l of linhas) {
    const k = [
      l.fontePagadoraId,
      l.planoId ?? '',
      l.fonteDestinoId ?? '',
      l.planoDestinoId ?? '',
      l.itemFaturavelId,
      l.tipoAtendimento ?? '',
    ].join('|');
    const g = grupos.get(k) ?? { base: l, q: 0, atual: 0, sim: 0, atendimentos: new Set<number>() };
    g.q += l.quantidade;
    g.atual += l.valorAtual;
    g.sim += l.valorSimulado;
    g.atendimentos.add(l.atendimentoId);
    grupos.set(k, g);
  }
  const ordem = (a: LinhaRecalculada, b: LinhaRecalculada) =>
    a.fontePagadoraId - b.fontePagadoraId ||
    (a.planoId ?? 0) - (b.planoId ?? 0) ||
    a.itemFaturavelId - b.itemFaturavelId ||
    String(a.tipoAtendimento ?? '').localeCompare(String(b.tipoAtendimento ?? ''));
  return [...grupos.values()]
    .sort((a, b) => ordem(a.base, b.base))
    .map((g, i) => ({
      sequencia: i + 1,
      fontePagadoraId: g.base.fontePagadoraId,
      planoId: g.base.planoId,
      fonteDestinoId: g.base.fonteDestinoId,
      planoDestinoId: g.base.planoDestinoId,
      itemFaturavelId: g.base.itemFaturavelId,
      tipoAtendimento: g.base.tipoAtendimento,
      quantidade: r4(g.q),
      quantidadeAtendimentos: g.atendimentos.size,
      valorAtual: r2(g.atual),
      valorSimulado: r2(g.sim),
    }));
}

/** Uma ocorrência de item que não pôde ser precificado. */
export interface OcorrenciaInconsistencia {
  readonly motivo: MotivoInconsistenciaSimulacao;
  readonly itemAtualId: number;
  readonly itemDestinoId: number | null;
  readonly fatorAtual: number | null;
  readonly fatorDestino: number | null;
  readonly data: string;
  readonly fontePagadoraId: number;
  readonly detalhe: string | null;
}

export interface InconsistenciaConsolidada extends Omit<OcorrenciaInconsistencia, 'detalhe'> {
  readonly sequencia: number;
  readonly ocorrencias: number;
  readonly valorAtual: number;
  readonly detalhe: string;
}

/**
 * As inconsistências agrupadas por motivo, convênio e procedimento (uma linha por causa, com quantas vezes ocorreu, a
 * primeira data e o valor atual que ficou sem recálculo): é a lista de pendências a resolver antes de decidir.
 */
export function consolidarInconsistencias(
  ocorrencias: readonly (OcorrenciaInconsistencia & { readonly valorAtual: number })[],
): InconsistenciaConsolidada[] {
  const grupos = new Map<string, { o: OcorrenciaInconsistencia; n: number; data: string; valor: number }>();
  for (const o of ocorrencias) {
    const k = [o.motivo, o.fontePagadoraId, o.itemAtualId, o.itemDestinoId ?? ''].join('|');
    const g = grupos.get(k);
    if (g) {
      g.n += 1;
      g.valor += o.valorAtual;
      if (o.data < g.data) g.data = o.data;
    } else grupos.set(k, { o, n: 1, data: o.data, valor: o.valorAtual });
  }
  return [...grupos.values()].map((g, i) => {
    const causa =
      g.o.motivo === 'sem_preco_destino'
        ? 'Procedimento sem preço vigente na tabela de destino'
        : g.o.motivo === 'fator_invalido'
          ? 'Fator de conversão inválido'
          : 'O motor de preços recusou o item';
    return {
      sequencia: i + 1,
      motivo: g.o.motivo,
      itemAtualId: g.o.itemAtualId,
      itemDestinoId: g.o.itemDestinoId,
      fatorAtual: g.o.fatorAtual,
      fatorDestino: g.o.fatorDestino,
      data: g.data,
      fontePagadoraId: g.o.fontePagadoraId,
      ocorrencias: g.n,
      valorAtual: r2(g.valor),
      detalhe:
        `${causa}${g.o.detalhe ? `: ${g.o.detalhe}` : ''} (${g.n} ${g.n === 1 ? 'item' : 'itens'}).`.slice(
          0,
          1000,
        ),
    };
  });
}

export interface TotaisSimulacao {
  readonly quantidadeItens: number;
  readonly quantidadeAtendimentos: number;
  readonly quantidadeInconsistencias: number;
  readonly valorAtual: number;
  readonly valorSimulado: number;
  readonly diferenca: number;
  readonly percentual: number | null;
  readonly situacao: 'concluida' | 'concluida_com_inconsistencia';
}

/** Os totais da execução, com as parcelas: Σ atual, Σ simulado, a diferença e o percentual sobre o atual. */
export function totaisDaSimulacao(
  linhas: readonly LinhaRecalculada[],
  inconsistencias: readonly InconsistenciaConsolidada[],
): TotaisSimulacao {
  const atual = r2(linhas.reduce((s, l) => s + l.valorAtual, 0));
  const simulado = r2(linhas.reduce((s, l) => s + l.valorSimulado, 0));
  const diferenca = r2(simulado - atual);
  return {
    quantidadeItens: linhas.length,
    quantidadeAtendimentos: new Set(linhas.map((l) => l.atendimentoId)).size,
    quantidadeInconsistencias: inconsistencias.reduce((s, i) => s + i.ocorrencias, 0),
    valorAtual: atual,
    valorSimulado: simulado,
    diferenca,
    percentual: atual === 0 ? null : r2((diferenca / atual) * 100),
    situacao: inconsistencias.length ? 'concluida_com_inconsistencia' : 'concluida',
  };
}
