// Produção do repasse a partir da conta do paciente (F3, motores). O item da conta com profissional executor (ou com a
// equipe registrada como participantes) vira produção do repasse: uma linha por profissional e função, com a base
// faturada que a apuração usa. Quando nasce é regra configurável (repasse.momentoProducao): no lançamento do item ou no
// fechamento da conta. O estorno nunca apaga: o item estornado ou glosado leva a produção ainda não apurada a
// "estornado" (ou reduz a base pela glosa parcial) e, na produção já apurada ou paga, gera o débito no período seguinte
// (estorno de repasse ligado à produção, proporcional à parte glosada, nunca acima do repassado).
// Fontes de "o que": docs/analise/06-* (repasse por produção do item faturado, estorno por glosa no período seguinte),
// TISS (grau de participação da equipe e honorário por participante). Tudo puro: a leitura e a gravação são da API.
import { centavos, competenciaSeguinte, dividirArredondando } from './dinheiro.js';

export type MomentoProducao = 'lancamento' | 'fechamento';
export const MOMENTOS_PRODUCAO: readonly MomentoProducao[] = ['lancamento', 'fechamento'];

/** O que disparou a sincronização: o lançamento do item, o fechamento da conta ou a mudança do item (estorno, glosa). */
export type EventoProducao = 'lancamento' | 'fechamento' | 'mudanca-item';

export type FormaPagamentoParticipante =
  'via_hospital' | 'direto_fonte_pagadora' | 'paciente' | 'sem_cobranca';

export interface ParticipanteItemConta {
  readonly profissional: number;
  readonly funcao: number;
  /** Pessoa jurídica que recebe pelo profissional (prestador terceiro); null: o próprio profissional. */
  readonly recebedor: number | null;
  readonly forma: FormaPagamentoParticipante;
  /** Base de repasse informada para o participante (reais); null: usa o valor do ato. */
  readonly valorBaseRepasse: number | null;
  readonly valorAto: number;
}

export interface ItemContaProducao {
  readonly id: number;
  readonly situacao: string;
  readonly excluido: boolean;
  readonly quantidade: number;
  /** Reais. */
  readonly valorTotal: number;
  readonly valorHonorario: number;
  readonly valorGlosado: number;
  readonly pertencePacote: boolean;
  readonly executante: number | null;
  /** Função do executante no item (grau de participação); null: a função titular do cadastro. */
  readonly funcao: number | null;
  readonly participantes: readonly ParticipanteItemConta[];
}

export interface FuncaoCobranca {
  readonly id: number;
  readonly tipo: string;
  readonly ativo: boolean;
  readonly ordem: number | null;
}

/** Uma linha de produção a gravar (chave: item, profissional, prestador e função). */
export interface ProducaoPlanejada {
  readonly profissional: number;
  readonly prestador: number | null;
  readonly funcao: number;
  readonly quantidade: number;
  readonly baseCentavos: number;
}

export type PendenciaProducao = 'sem-executante' | 'sem-funcao-titular';

/** Situações do item da conta que deixam de gerar repasse (o item não é mais cobrado). */
const SITUACOES_SEM_COBRANCA: ReadonlySet<string> = new Set(['estornado', 'sem_cobranca', 'transferido']);

/** A produção nasce agora? No lançamento só se a regra é "lancamento"; no fechamento vale para as duas (o fechamento
 * completa o que faltou). A mudança do item (equipe, executor, glosa revertida) completa o que o item passou a gerar
 * quando a regra é "lancamento" ou a conta já foi fechada; antes do fechamento, na regra "fechamento", só estorna. */
export function geraNoEvento(
  momento: MomentoProducao,
  evento: EventoProducao,
  contaFechada = false,
): boolean {
  if (evento === 'fechamento') return true;
  if (evento === 'mudanca-item') return momento === 'lancamento' || contaFechada;
  return momento === 'lancamento';
}

/**
 * A competência do débito (estorno depois da apuração): o primeiro período ainda aberto a partir do seguinte ao da
 * conta e do mês do evento (glosa ou estorno). Período com apuração já conferida (ou aprovada, liberada, paga) é
 * fechado e passa adiante: o débito nunca fica preso numa apuração que não se recalcula mais.
 */
export function competenciaDoDebito(
  competenciaConta: string,
  competenciaEvento: string,
  fechadas: ReadonlySet<string>,
): string {
  const seguinte = competenciaSeguinte(competenciaConta);
  let c = seguinte > competenciaEvento ? seguinte : competenciaEvento;
  for (let i = 0; i <= fechadas.size && fechadas.has(c); i++) c = competenciaSeguinte(c);
  return c;
}

/** Lê o parâmetro (texto) como momento; valor fora da lista volta ao padrão, o lançamento. */
export function momentoDoParametro(v: string | null | undefined): MomentoProducao {
  const t = (v ?? '').trim();
  return (MOMENTOS_PRODUCAO as readonly string[]).includes(t) ? (t as MomentoProducao) : 'lancamento';
}

/** A função titular: a ativa de tipo cirurgião ou clínico de menor ordem (desempate pelo id). */
export function funcaoTitular(funcoes: readonly FuncaoCobranca[]): number | null {
  const titulares = funcoes
    .filter((f) => f.ativo && (f.tipo === 'cirurgiao' || f.tipo === 'clinico'))
    .sort(
      (a, b) => (a.ordem ?? Number.MAX_SAFE_INTEGER) - (b.ordem ?? Number.MAX_SAFE_INTEGER) || a.id - b.id,
    );
  return titulares[0]?.id ?? null;
}

/** A base do executor: o honorário do item quando a tabela o separa; senão o valor total do item. */
export function baseDoExecutor(item: ItemContaProducao): number {
  return centavos(item.valorHonorario > 0 ? item.valorHonorario : item.valorTotal);
}

/**
 * As produções que o item gera. Com participantes, uma por participante pago pelo hospital (o pago direto pela fonte
 * pagadora, pelo paciente ou sem cobrança não passa pelo repasse); sem participantes, a do executor na função do item
 * ou na titular. Item estornado, sem cobrança, transferido ou excluído não gera nada.
 */
export function producoesDoItem(
  item: ItemContaProducao,
  titular: number | null,
): { readonly producoes: readonly ProducaoPlanejada[]; readonly pendencia: PendenciaProducao | null } {
  if (item.excluido || SITUACOES_SEM_COBRANCA.has(item.situacao)) return { producoes: [], pendencia: null };
  if (item.participantes.length > 0) {
    const producoes = item.participantes
      .filter((p) => p.forma === 'via_hospital')
      .map((p) => ({
        profissional: p.profissional,
        prestador: p.recebedor,
        funcao: p.funcao,
        quantidade: item.quantidade,
        baseCentavos: centavos(p.valorBaseRepasse ?? p.valorAto),
      }));
    return { producoes, pendencia: null };
  }
  if (item.executante === null) return { producoes: [], pendencia: 'sem-executante' };
  const funcao = item.funcao ?? titular;
  if (funcao === null) return { producoes: [], pendencia: 'sem-funcao-titular' };
  return {
    producoes: [
      {
        profissional: item.executante,
        prestador: null,
        funcao,
        quantidade: item.quantidade,
        baseCentavos: baseDoExecutor(item),
      },
    ],
    pendencia: null,
  };
}

/** A produção já gravada, como a sincronização a vê. */
export interface ProducaoGravada {
  readonly situacao: string;
  /** Entrou numa apuração já conferida (ou está apurada ou paga): o estorno vira débito no período seguinte. */
  readonly integrada: boolean;
  /** A chave da produção (profissional, prestador, função) ainda está entre as que o item gera hoje. Falso: o
   * participante saiu, passou a ser pago fora do hospital, trocou de função ou de recebedor, ou o executor mudou. */
  readonly vigente: boolean;
  readonly baseCentavos: number;
  /** Base que o item dá hoje sem glosa (a da produção planejada); a redução pela glosa parte dela. */
  readonly baseOriginalCentavos: number;
  readonly repassadoCentavos: number;
  /** Débitos (estorno_repasse) da produção ainda não cancelados. */
  readonly jaEstornadoCentavos: number;
  /** Competência (AAAA-MM) em que cai o débito ou o seu ajuste: competenciaDoDebito. */
  readonly competenciaDebito: string;
}

export type AcaoEstornoProducao =
  | { readonly acao: 'nada' }
  /** Produção ainda não apurada: sai da apuração (situação estornado), sem débito. */
  | { readonly acao: 'estornar' }
  /** Antes da apuração: a base passa a ser a que o item dá hoje (glosa parcial, glosa revertida, base mudada). */
  | { readonly acao: 'reduzir'; readonly baseCentavos: number }
  /** Produção estornada e não apurada que o item volta a gerar (glosa revertida, participante de volta): pendente. */
  | { readonly acao: 'reativar'; readonly baseCentavos: number }
  /** Produção já apurada ou paga: débito (positivo) no período seguinte; `encerrar` leva a produção a estornado. */
  | {
      readonly acao: 'debitar';
      readonly valorCentavos: number;
      readonly competencia: string;
      readonly motivo: 'glosa' | 'ajuste';
      readonly encerrar: boolean;
    }
  /** Produção já apurada com débito acima do devido (glosa revertida no recurso): o excesso de débito é desfeito
   * (cancela o débito ainda pendente); `reabrir` volta a produção estornada a apurado. */
  | {
      readonly acao: 'creditar';
      readonly valorCentavos: number;
      readonly competencia: string;
      readonly reabrir: boolean;
    };

const FINAIS: ReadonlySet<string> = new Set(['estornado', 'cancelado']);

/**
 * O que fazer com a produção quando o item muda. A produção espelha o item: item estornado (ou sem cobrança,
 * transferido, excluído), ou chave que o item não gera mais, estorna por inteiro; a glosa (repasse.estornoEmGlosa
 * ligado) estorna a parte glosada: antes da apuração reduz a base (ou estorna, se a glosa é total), depois da apuração
 * vira débito proporcional no período seguinte, nunca acima do repassado. A glosa revertida desfaz o que fez: antes da
 * apuração restaura a base ou reativa a produção; depois, desfaz o débito a mais. Idempotente: o débito é sempre o
 * devido menos o já debitado.
 */
export function estornoDaProducao(
  item: ItemContaProducao,
  p: ProducaoGravada,
  estornoEmGlosa: boolean,
): AcaoEstornoProducao {
  if (p.situacao === 'cancelado') return { acao: 'nada' };
  const estornada = p.situacao === 'estornado';
  const semCobranca = !p.vigente || item.excluido || SITUACOES_SEM_COBRANCA.has(item.situacao);
  if (semCobranca) {
    if (!p.integrada) return estornada ? { acao: 'nada' } : { acao: 'estornar' };
    const restante = p.repassadoCentavos - p.jaEstornadoCentavos;
    if (restante <= 0) return { acao: 'nada' };
    return {
      acao: 'debitar',
      valorCentavos: restante,
      competencia: p.competenciaDebito,
      motivo: 'ajuste',
      encerrar: !estornada,
    };
  }
  const totalItem = centavos(item.valorTotal);
  const glosa =
    estornoEmGlosa && totalItem > 0 ? Math.max(0, Math.min(centavos(item.valorGlosado), totalItem)) : 0;
  const total = glosa > 0 && glosa >= totalItem;
  if (!p.integrada) {
    if (total) return estornada ? { acao: 'nada' } : { acao: 'estornar' };
    const base =
      glosa > 0
        ? Number(
            dividirArredondando(
              BigInt(p.baseOriginalCentavos) * BigInt(totalItem - glosa),
              BigInt(totalItem),
            ),
          )
        : p.baseOriginalCentavos;
    if (estornada) return { acao: 'reativar', baseCentavos: base };
    return base === p.baseCentavos ? { acao: 'nada' } : { acao: 'reduzir', baseCentavos: base };
  }
  // Com a regra desligada, a produção apurada não ganha nem perde débito por glosa.
  if (!estornoEmGlosa) return { acao: 'nada' };
  // A parte glosada do item aplicada ao repassado (mesma proporção), nunca acima dele.
  const devido =
    glosa > 0
      ? Math.min(
          p.repassadoCentavos,
          Number(dividirArredondando(BigInt(p.repassadoCentavos) * BigInt(glosa), BigInt(totalItem))),
        )
      : 0;
  const valor = devido - p.jaEstornadoCentavos;
  if (valor > 0)
    return {
      acao: 'debitar',
      valorCentavos: valor,
      competencia: p.competenciaDebito,
      motivo: 'glosa',
      encerrar: total && !estornada,
    };
  if (valor < 0)
    return {
      acao: 'creditar',
      valorCentavos: -valor,
      competencia: p.competenciaDebito,
      reabrir: estornada && !total,
    };
  return { acao: 'nada' };
}

/** Soma da apuração do período: base e repasse das produções que valem (parcelas e total, em centavos). */
export function somarProducao(
  linhas: readonly {
    readonly baseCentavos: number;
    readonly repasseCentavos: number;
    readonly situacao: string;
  }[],
): { readonly itens: number; readonly baseCentavos: number; readonly repasseCentavos: number } {
  let itens = 0;
  let base = 0;
  let repasse = 0;
  for (const l of linhas) {
    if (FINAIS.has(l.situacao)) continue;
    itens += 1;
    base += l.baseCentavos;
    repasse += l.repasseCentavos;
  }
  return { itens, baseCentavos: base, repasseCentavos: repasse };
}
