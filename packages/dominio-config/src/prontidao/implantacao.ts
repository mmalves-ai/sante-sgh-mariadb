// Kit de implantação de um hospital novo (C2-025, 01-ADM L98): o checklist padrão de cadastros mínimos por módulo,
// conferido por contagem no banco do cliente, com prazos, responsáveis e metas; e "o que falta" para operar.
// Regras puras (sem banco): a porta lê as contagens e grava; aqui se decide a situação de cada item, o resumo por
// módulo, a ordem do que falta e a situação de cada meta.
// Melhoria sobre o checklist de papel: a situação do cadastro mínimo vem da contagem real (nada de marcar "pronto" sem
// o cadastro existir), a dispensa pede o motivo e o atraso aparece sozinho pelo prazo. Nada trava a virada (ADR 0002):
// o resumo é informativo e a decisão de virar é do cliente.

export const TIPOS_VERIFICACAO = [
  'cadastro_minimo',
  'conferencia',
  'parametro',
  'integracao',
  'treinamento',
  'infraestrutura',
] as const;
export type TipoVerificacao = (typeof TIPOS_VERIFICACAO)[number];

export const SITUACOES_ITEM_PRONTIDAO = ['pendente', 'em_andamento', 'pronto', 'dispensado'] as const;
export type SituacaoItemProntidao = (typeof SITUACOES_ITEM_PRONTIDAO)[number];

export const FASES_IMPLANTACAO = [
  'inicializacao',
  'planejamento',
  'desenho_solucao',
  'construcao',
  'carga',
  'homologacao',
  'virada',
  'operacao_assistida',
  'encerrada',
] as const;
export type FaseImplantacao = (typeof FASES_IMPLANTACAO)[number];

export const INDICADORES_META = ['prazo', 'volume', 'adesao', 'qualidade', 'tempo_resposta'] as const;
export type IndicadorMeta = (typeof INDICADORES_META)[number];
export type SituacaoMeta = 'pendente' | 'atingida' | 'parcial' | 'nao_atingida' | 'cancelada';

/** Problema de validação, com o campo que a tela destaca. */
export interface ProblemaImplantacao {
  readonly campo: string;
  readonly mensagem: string;
}

/** Mínimo efetivo do cadastro: sem número no modelo, basta um registro. */
export function minimoEfetivo(quantidadeMinima: number | null): number {
  return quantidadeMinima === null || quantidadeMinima < 1 ? 1 : Math.floor(quantidadeMinima);
}

/**
 * A situação do item depois da conferência. O cadastro mínimo segue a contagem (pronto ao atingir o mínimo, em
 * andamento com algum registro, pendente sem nenhum); o dispensado fica dispensado; os demais tipos são marcados à mão.
 */
export function situacaoPelaContagem(item: {
  readonly tipo: TipoVerificacao;
  readonly quantidadeMinima: number | null;
  readonly contagem: number | null;
  readonly atual: SituacaoItemProntidao;
}): SituacaoItemProntidao {
  if (item.atual === 'dispensado') return 'dispensado';
  if (item.tipo !== 'cadastro_minimo' || item.contagem === null) return item.atual;
  if (item.contagem >= minimoEfetivo(item.quantidadeMinima)) return 'pronto';
  return item.contagem > 0 ? 'em_andamento' : 'pendente';
}

export interface ItemParaMudanca {
  readonly tipo: TipoVerificacao;
  readonly quantidadeMinima: number | null;
  readonly contagem: number | null;
  readonly situacao: SituacaoItemProntidao;
  readonly dataInicioPrevista: string | null;
}

export interface PedidoMudancaItem {
  readonly situacao?: SituacaoItemProntidao | undefined;
  readonly motivoDispensa?: string | null | undefined;
  readonly dataPrazo?: string | null | undefined;
}

/** Confere a mudança pedida num item; devolve os problemas (vazio: pode gravar). */
export function conferirMudancaItem(item: ItemParaMudanca, pedido: PedidoMudancaItem): ProblemaImplantacao[] {
  const p: ProblemaImplantacao[] = [];
  const nova = pedido.situacao;
  if (nova === 'dispensado' && (pedido.motivoDispensa ?? '').trim().length < 5)
    p.push({
      campo: 'motivoDispensa',
      mensagem: 'Para dispensar o item, informe o motivo (ao menos 5 letras).',
    });
  if (
    nova === 'pronto' &&
    item.tipo === 'cadastro_minimo' &&
    (item.contagem ?? 0) < minimoEfetivo(item.quantidadeMinima)
  )
    p.push({
      campo: 'situacao',
      mensagem: `O cadastro tem ${item.contagem ?? 0} de ${minimoEfetivo(item.quantidadeMinima)} registros: ele fica pronto sozinho ao atingir o mínimo. Se não se aplica ao hospital, dispense com o motivo.`,
    });
  if (pedido.dataPrazo && item.dataInicioPrevista && pedido.dataPrazo < item.dataInicioPrevista)
    p.push({ campo: 'dataPrazo', mensagem: 'O prazo não pode ser anterior ao início previsto do item.' });
  return p;
}

/** Confere as datas do projeto de implantação. */
export function conferirDatasImplantacao(d: {
  readonly dataInicioPrevista?: string | null | undefined;
  readonly dataFimPrevista?: string | null | undefined;
  readonly dataViradaPrevista?: string | null | undefined;
}): ProblemaImplantacao[] {
  const p: ProblemaImplantacao[] = [];
  if (d.dataInicioPrevista && d.dataFimPrevista && d.dataFimPrevista < d.dataInicioPrevista)
    p.push({
      campo: 'dataFimPrevista',
      mensagem: 'O fim previsto não pode ser anterior ao início previsto.',
    });
  if (d.dataInicioPrevista && d.dataViradaPrevista && d.dataViradaPrevista < d.dataInicioPrevista)
    p.push({
      campo: 'dataViradaPrevista',
      mensagem: 'A virada prevista não pode ser anterior ao início previsto.',
    });
  return p;
}

export interface ItemDoResumo {
  readonly id: number;
  readonly modulo: string;
  readonly titulo: string;
  readonly tipo: TipoVerificacao;
  readonly situacao: SituacaoItemProntidao;
  readonly critico: boolean;
  readonly ordem: number;
  readonly dataPrazo: string | null;
}

export interface ResumoModulo {
  readonly modulo: string;
  readonly total: number;
  readonly concluidos: number;
  readonly percentual: number;
}

export interface ResumoImplantacao {
  readonly total: number;
  readonly prontos: number;
  readonly dispensados: number;
  readonly emAndamento: number;
  readonly pendentes: number;
  readonly criticosEmAberto: number;
  readonly atrasados: number;
  /** (prontos + dispensados) / total, em pontos inteiros. */
  readonly percentual: number;
  readonly porModulo: readonly ResumoModulo[];
  /** Ids dos itens em aberto, na ordem do que fazer primeiro. */
  readonly oQueFalta: readonly number[];
}

const concluido = (s: SituacaoItemProntidao) => s === 'pronto' || s === 'dispensado';
const pct = (feitos: number, total: number) => (total === 0 ? 100 : Math.floor((feitos * 100) / total));

/** O item em aberto com prazo vencido (hoje no formato AAAA-MM-DD). */
export function itemAtrasado(i: Pick<ItemDoResumo, 'situacao' | 'dataPrazo'>, hoje: string): boolean {
  return !concluido(i.situacao) && i.dataPrazo !== null && i.dataPrazo < hoje;
}

/**
 * O resumo da implantação e a ordem do que falta: primeiro o crítico, depois o atrasado, depois o prazo mais próximo
 * (sem prazo por último), e a ordem do modelo.
 */
export function resumoImplantacao(itens: readonly ItemDoResumo[], hoje: string): ResumoImplantacao {
  const conta = (s: SituacaoItemProntidao) => itens.filter((i) => i.situacao === s).length;
  const abertos = itens.filter((i) => !concluido(i.situacao));
  const modulos = new Map<string, { total: number; concluidos: number }>();
  for (const i of itens) {
    const m = modulos.get(i.modulo) ?? { total: 0, concluidos: 0 };
    m.total += 1;
    if (concluido(i.situacao)) m.concluidos += 1;
    modulos.set(i.modulo, m);
  }
  const ordenados = [...abertos].sort((a, b) => {
    if (a.critico !== b.critico) return a.critico ? -1 : 1;
    const aa = itemAtrasado(a, hoje);
    const ab = itemAtrasado(b, hoje);
    if (aa !== ab) return aa ? -1 : 1;
    const pa = a.dataPrazo ?? '9999-12-31';
    const pb = b.dataPrazo ?? '9999-12-31';
    if (pa !== pb) return pa < pb ? -1 : 1;
    return a.ordem - b.ordem || a.id - b.id;
  });
  const feitos = conta('pronto') + conta('dispensado');
  return {
    total: itens.length,
    prontos: conta('pronto'),
    dispensados: conta('dispensado'),
    emAndamento: conta('em_andamento'),
    pendentes: conta('pendente'),
    criticosEmAberto: abertos.filter((i) => i.critico).length,
    atrasados: abertos.filter((i) => itemAtrasado(i, hoje)).length,
    percentual: pct(feitos, itens.length),
    porModulo: [...modulos].map(([modulo, m]) => ({
      modulo,
      total: m.total,
      concluidos: m.concluidos,
      percentual: pct(m.concluidos, m.total),
    })),
    oQueFalta: ordenados.map((i) => i.id),
  };
}

/** No prazo e no tempo de resposta, menor é melhor; em volume, adesão e qualidade, maior é melhor. */
export function menorEMelhor(indicador: IndicadorMeta): boolean {
  return indicador === 'prazo' || indicador === 'tempo_resposta';
}

/**
 * A situação da meta pela medição: sem medição, pendente; atingiu, atingida; não atingiu com a data limite vencida,
 * não atingida; não atingiu ainda no prazo, parcial. A cancelada fica cancelada.
 */
export function situacaoMeta(m: {
  readonly indicador: IndicadorMeta;
  readonly valorMeta: number;
  readonly valorMedido: number | null;
  readonly dataLimite: string | null;
  readonly atual: SituacaoMeta;
  readonly hoje: string;
}): SituacaoMeta {
  if (m.atual === 'cancelada') return 'cancelada';
  if (m.valorMedido === null) return 'pendente';
  const atingiu = menorEMelhor(m.indicador) ? m.valorMedido <= m.valorMeta : m.valorMedido >= m.valorMeta;
  if (atingiu) return 'atingida';
  return m.dataLimite !== null && m.dataLimite < m.hoje ? 'nao_atingida' : 'parcial';
}

/** Confere a meta nova: processo, valor e unidade coerentes com o indicador. */
export function conferirMeta(m: {
  readonly processo: string;
  readonly indicador: IndicadorMeta;
  readonly valorMeta: number;
}): ProblemaImplantacao[] {
  const p: ProblemaImplantacao[] = [];
  if (m.processo.trim().length < 3)
    p.push({
      campo: 'processo',
      mensagem: 'Informe o processo medido (ex.: admissão, faturamento da conta).',
    });
  if (!Number.isFinite(m.valorMeta) || m.valorMeta < 0)
    p.push({ campo: 'valorMeta', mensagem: 'O valor da meta precisa ser um número maior ou igual a zero.' });
  if ((m.indicador === 'adesao' || m.indicador === 'qualidade') && m.valorMeta > 100)
    p.push({ campo: 'valorMeta', mensagem: 'Adesão e qualidade são percentuais: no máximo 100.' });
  return p;
}
