// Fluxo de aprovação configurável (F8, 07-FIN linha 65). Um motor só para o título a pagar, o pedido de compra e o
// contrato com o fornecedor: o fluxo vale para um tipo de documento, numa faixa de valor (e, se quiser, num
// estabelecimento e num centro de custo), com vigência e prioridade; tem etapas em ordem, cada uma com a condição de
// entrada (faixa de valor e valores do documento, como o centro de custo ou o credor), a regra de quórum (qualquer
// um, todos ou um mínimo) e os aprovadores (nominais ou por papel, com substituto, alçada em valor, restritos a um
// agrupador de documentos e liberados ou não para decidir pelo celular). O aprovador decide escolhendo uma resposta
// padrão (aprova, reprova ou devolve para ajuste), que pode exigir justificativa. Quem pediu nunca aprova; ninguém
// decide duas vezes a mesma etapa. A alçada simples do título a pagar (alcada.ts) continua valendo quando nenhum fluxo
// configurável atende ao título.
import { type RecusaFinanceiro, recusaFin } from '@sgh/contratos/regras-financeiro';

export const DOCUMENTOS_APROVAVEIS = ['titulo_pagar', 'pedido_compra', 'contrato_fornecedor'] as const;
export type DocumentoAprovavel = (typeof DOCUMENTOS_APROVAVEIS)[number];
export const CRITERIOS_AGRUPADOR = [
  'centro_custo',
  'natureza_financeira',
  'credor',
  'conta_orcamentaria',
  'projeto',
  'tipo_documento',
  'estabelecimento',
] as const;
export type CriterioAgrupador = (typeof CRITERIOS_AGRUPADOR)[number];
export type EfeitoResposta = 'aprova' | 'reprova' | 'devolve';
export type RegraQuorum = 'qualquer' | 'todos' | 'minimo';
export type CanalDecisao = 'web' | 'celular';
export type CondicaoEtapa = Partial<Record<CriterioAgrupador, readonly number[]>>;
export type AtributosDocumento = Partial<Record<CriterioAgrupador, number | null>>;

/** Justificativa mínima (caracteres) quando a resposta a exige ou quando não aprova. */
export const JUSTIFICATIVA_MINIMA_APROVACAO = 5;

export interface DocumentoEmAprovacao {
  readonly tipo: DocumentoAprovavel;
  readonly estabelecimento: number;
  readonly valor: number;
  readonly atributos: AtributosDocumento;
  readonly solicitante: number | null;
}
export interface FluxoConfigurado {
  readonly id: number;
  readonly tipo: DocumentoAprovavel;
  readonly estabelecimento: number | null;
  readonly centroCusto: number | null;
  readonly valorMinimo: number;
  readonly valorMaximo: number | null;
  readonly prioridade: number;
  readonly vigenciaInicio: string;
  readonly vigenciaFim: string | null;
  readonly ativo: boolean;
}
export interface EtapaConfigurada {
  readonly id: number;
  readonly sequencia: number;
  readonly nome: string;
  readonly valorMinimo: number | null;
  readonly valorMaximo: number | null;
  readonly condicao: CondicaoEtapa | null;
  readonly regraQuorum: RegraQuorum;
  readonly minimo: number | null;
  readonly obrigatoria: boolean;
}
export interface AprovadorConfigurado {
  readonly id: number;
  readonly etapa: number;
  readonly usuario: number | null;
  readonly papel: number | null;
  readonly substituto: number | null;
  readonly agrupador: number | null;
  readonly valorLimite: number | null;
  readonly aprovaPeloCelular: boolean;
  readonly vigenciaInicio: string;
  readonly vigenciaFim: string | null;
  readonly ativo: boolean;
}
export interface AgrupadorConfigurado {
  readonly id: number;
  readonly criterio: CriterioAgrupador;
  readonly aceitaVazio: boolean;
  readonly ativo: boolean;
  readonly membros: readonly number[];
}
export interface RespostaPadrao {
  readonly id: number;
  readonly efeito: EfeitoResposta;
  readonly exigeJustificativa: boolean;
  readonly fluxo: number | null;
  readonly ativo: boolean;
}
export interface DecisaoTomada {
  readonly etapa: number;
  readonly usuario: number;
  readonly efeito: EfeitoResposta;
}

const vigente = (inicio: string, fim: string | null, hoje: string) =>
  inicio <= hoje && (fim === null || fim >= hoje);
const naFaixa = (v: number, min: number | null, max: number | null) =>
  (min === null || v >= min) && (max === null || v <= max);

/** O fluxo que atende ao documento: ativo, vigente, do tipo, na faixa; o de menor prioridade e mais específico vence. */
export function escolherFluxo(
  fluxos: readonly FluxoConfigurado[],
  doc: DocumentoEmAprovacao,
  hoje: string,
): FluxoConfigurado | null {
  const centro = doc.atributos.centro_custo ?? null;
  const aptos = fluxos.filter(
    (f) =>
      f.ativo &&
      f.tipo === doc.tipo &&
      vigente(f.vigenciaInicio, f.vigenciaFim, hoje) &&
      (f.estabelecimento === null || f.estabelecimento === doc.estabelecimento) &&
      (f.centroCusto === null || f.centroCusto === centro) &&
      naFaixa(doc.valor, f.valorMinimo, f.valorMaximo),
  );
  const especifico = (f: FluxoConfigurado) =>
    (f.estabelecimento === null ? 0 : 1) + (f.centroCusto === null ? 0 : 2);
  aptos.sort((a, b) => a.prioridade - b.prioridade || especifico(b) - especifico(a) || a.id - b.id);
  return aptos[0] ?? null;
}

/** O documento pertence ao agrupador: o valor do critério é membro (ou está vazio e o agrupador aceita vazio). */
export function documentoNoAgrupador(a: AgrupadorConfigurado, doc: DocumentoEmAprovacao): boolean {
  if (!a.ativo) return false;
  const v = a.criterio === 'estabelecimento' ? doc.estabelecimento : (doc.atributos[a.criterio] ?? null);
  return v === null ? a.aceitaVazio : a.membros.includes(v);
}

/** A condição de entrada da etapa: cada critério listado tem de conter o valor do documento. */
export function condicaoAtendida(c: CondicaoEtapa | null, doc: DocumentoEmAprovacao): boolean {
  if (!c) return true;
  return Object.entries(c).every(([k, lista]) => {
    if (!lista || lista.length === 0) return true;
    const v = k === 'estabelecimento' ? doc.estabelecimento : (doc.atributos[k as CriterioAgrupador] ?? null);
    return v !== null && lista.includes(v);
  });
}

/** Os aprovadores da etapa que servem ao documento: ativos, vigentes, no agrupador e com alçada para o valor. */
export function aprovadoresAptos(
  etapa: number,
  aprovadores: readonly AprovadorConfigurado[],
  agrupadores: readonly AgrupadorConfigurado[],
  doc: DocumentoEmAprovacao,
  hoje: string,
): AprovadorConfigurado[] {
  return aprovadores.filter((a) => {
    if (a.etapa !== etapa || !a.ativo || !vigente(a.vigenciaInicio, a.vigenciaFim, hoje)) return false;
    if (a.valorLimite !== null && doc.valor > a.valorLimite) return false;
    if (a.agrupador === null) return true;
    const g = agrupadores.find((x) => x.id === a.agrupador);
    return g ? documentoNoAgrupador(g, doc) : false;
  });
}

/**
 * As etapas que o documento percorre, em ordem: a faixa de valor e a condição de entrada decidem; a etapa não
 * obrigatória sem nenhum aprovador apto é pulada (a obrigatória fica, e a submissão é recusada).
 */
export function etapasExigidas(
  etapas: readonly EtapaConfigurada[],
  aprovadores: readonly AprovadorConfigurado[],
  agrupadores: readonly AgrupadorConfigurado[],
  doc: DocumentoEmAprovacao,
  hoje: string,
): EtapaConfigurada[] {
  return [...etapas]
    .sort((a, b) => a.sequencia - b.sequencia)
    .filter((e) => naFaixa(doc.valor, e.valorMinimo, e.valorMaximo) && condicaoAtendida(e.condicao, doc))
    .filter((e) => e.obrigatoria || aprovadoresAptos(e.id, aprovadores, agrupadores, doc, hoje).length > 0);
}

/** Confere que o fluxo atende ao documento antes de abrir o pedido. */
export function conferirSubmissao(
  fluxo: FluxoConfigurado | null,
  exigidas: readonly EtapaConfigurada[],
  aprovadores: readonly AprovadorConfigurado[],
  agrupadores: readonly AgrupadorConfigurado[],
  doc: DocumentoEmAprovacao,
  hoje: string,
): RecusaFinanceiro | null {
  if (!fluxo)
    return recusaFin(
      'sem-fluxo',
      doc.tipo === 'titulo_pagar'
        ? 'Nenhum fluxo configurável atende a este título: ele segue a alçada do título a pagar.'
        : 'Nenhum fluxo de aprovação atende a este documento (tipo, valor, centro de custo e vigência).',
    );
  if (exigidas.length === 0)
    return recusaFin('sem-etapa', 'Nenhuma etapa do fluxo se aplica a este documento.');
  const vazia = exigidas.find(
    (e) => aprovadoresAptos(e.id, aprovadores, agrupadores, doc, hoje).length === 0,
  );
  if (vazia)
    return recusaFin(
      'etapa-sem-aprovador',
      `A etapa "${vazia.nome}" não tem aprovador apto para este documento.`,
    );
  return null;
}

/** Quantas aprovações a etapa pede, dado o número de aprovadores aptos. */
export function aprovacoesNecessarias(e: EtapaConfigurada, aptos: number): number {
  if (e.regraQuorum === 'todos') return Math.max(1, aptos);
  if (e.regraQuorum === 'minimo') return Math.max(1, e.minimo ?? 1);
  return 1;
}

/** O aprovador configurado que dá ao usuário o direito de decidir (nominal, substituto ou pelo papel). */
export function aprovadorDoUsuario(
  aptos: readonly AprovadorConfigurado[],
  usuario: number,
  papeis: readonly number[],
): AprovadorConfigurado | null {
  return (
    aptos.find((a) => a.usuario === usuario) ??
    aptos.find((a) => a.substituto === usuario) ??
    aptos.find((a) => a.papel !== null && papeis.includes(a.papel)) ??
    null
  );
}

export interface PedidoDecisao {
  readonly situacao: string;
  readonly fluxo: number;
  readonly etapa: EtapaConfigurada;
  readonly aptos: readonly AprovadorConfigurado[];
  readonly decisoes: readonly DecisaoTomada[];
  readonly solicitante: number | null;
  readonly usuario: number;
  readonly papeis: readonly number[];
  readonly resposta: RespostaPadrao | null;
  readonly justificativa: string;
  readonly canal: CanalDecisao;
}

/** Confere a decisão do aprovador na etapa atual do pedido. */
export function conferirDecisao(p: PedidoDecisao): RecusaFinanceiro | null {
  if (p.situacao !== 'em_aprovacao')
    return recusaFin('pedido-concluido', 'Este pedido de aprovação já foi concluído.');
  if (p.solicitante !== null && p.solicitante === p.usuario)
    return recusaFin('aprovador-solicitante', 'Quem pediu a aprovação não decide sobre ela.');
  if (p.decisoes.some((d) => d.etapa === p.etapa.id && d.usuario === p.usuario))
    return recusaFin('decisao-repetida', 'Você já decidiu esta etapa.');
  const ap = aprovadorDoUsuario(p.aptos, p.usuario, p.papeis);
  if (!ap)
    return recusaFin('sem-alcada', `Você não é aprovador da etapa "${p.etapa.nome}" para este documento.`);
  if (p.canal === 'celular' && !ap.aprovaPeloCelular)
    return recusaFin('celular-nao-liberado', 'A sua aprovação nesta etapa não está liberada pelo celular.');
  const r = p.resposta;
  if (!r || !r.ativo || (r.fluxo !== null && r.fluxo !== p.fluxo))
    return recusaFin('resposta-invalida', 'Escolha uma das respostas deste fluxo.', ['resposta']);
  if (
    (r.exigeJustificativa || r.efeito !== 'aprova') &&
    p.justificativa.trim().length < JUSTIFICATIVA_MINIMA_APROVACAO
  )
    return recusaFin(
      'justificativa-obrigatoria',
      `Esta resposta pede justificativa (${JUSTIFICATIVA_MINIMA_APROVACAO} caracteres ou mais).`,
      ['justificativa'],
    );
  return null;
}

export interface Andamento {
  readonly situacao: 'em_aprovacao' | 'aprovado' | 'reprovado' | 'devolvido';
  /** Etapa em que o pedido fica (a mesma, a próxima, ou null quando concluído). */
  readonly etapa: number | null;
  /** Posição (1..n) da etapa em que o pedido fica, entre as exigidas. */
  readonly nivel: number;
  /** Aprovações que ainda faltam na etapa em que o pedido fica. */
  readonly faltam: number;
}

/** O andamento depois da decisão: reprovar ou devolver encerra; aprovar fecha a etapa no quórum e passa à próxima. */
export function andamentoDepois(
  exigidas: readonly EtapaConfigurada[],
  atual: number,
  aptosPorEtapa: ReadonlyMap<number, number>,
  decisoes: readonly DecisaoTomada[],
): Andamento {
  const i = exigidas.findIndex((e) => e.id === atual);
  const etapa = exigidas[i];
  if (!etapa) throw new Error('Etapa atual fora do fluxo.');
  const daEtapa = decisoes.filter((d) => d.etapa === atual);
  const ultima = daEtapa[daEtapa.length - 1];
  if (ultima?.efeito === 'reprova') return { situacao: 'reprovado', etapa: null, nivel: i + 1, faltam: 0 };
  if (ultima?.efeito === 'devolve') return { situacao: 'devolvido', etapa: null, nivel: i + 1, faltam: 0 };
  const aprovadas = new Set(daEtapa.filter((d) => d.efeito === 'aprova').map((d) => d.usuario)).size;
  const precisa = aprovacoesNecessarias(etapa, aptosPorEtapa.get(atual) ?? 1);
  if (aprovadas < precisa)
    return { situacao: 'em_aprovacao', etapa: atual, nivel: i + 1, faltam: precisa - aprovadas };
  const prox = exigidas[i + 1];
  if (!prox) return { situacao: 'aprovado', etapa: null, nivel: i + 1, faltam: 0 };
  return {
    situacao: 'em_aprovacao',
    etapa: prox.id,
    nivel: i + 2,
    faltam: aprovacoesNecessarias(prox, aptosPorEtapa.get(prox.id) ?? 1),
  };
}

// ── Configuração ────────────────────────────────────────────────────────────────────────────────────────────────

export interface NovoAprovador {
  readonly usuario: number | null;
  readonly papel: number | null;
  readonly substituto: number | null;
  readonly valorLimite: number | null;
  readonly vigenciaInicio: string;
  readonly vigenciaFim: string | null;
}
export interface NovaEtapa {
  readonly sequencia: number;
  readonly nome: string;
  readonly valorMinimo: number | null;
  readonly valorMaximo: number | null;
  readonly regraQuorum: RegraQuorum;
  readonly minimo: number | null;
  readonly obrigatoria: boolean;
  readonly aprovadores: readonly NovoAprovador[];
}
export interface NovoFluxo {
  readonly valorMinimo: number;
  readonly valorMaximo: number | null;
  readonly vigenciaInicio: string;
  readonly vigenciaFim: string | null;
  readonly etapas: readonly NovaEtapa[];
}

/** Confere o fluxo novo inteiro antes de gravar (a mesma regra na tela, enquanto se monta). */
export function conferirFluxo(f: NovoFluxo): RecusaFinanceiro | null {
  if (f.valorMinimo < 0 || (f.valorMaximo !== null && f.valorMaximo < f.valorMinimo))
    return recusaFin('faixa-invalida', 'O valor até não pode ser menor que o valor de.', ['valorMaximo']);
  if (f.vigenciaFim !== null && f.vigenciaFim < f.vigenciaInicio)
    return recusaFin('vigencia-invalida', 'O fim da vigência é antes do início.', ['vigenciaFim']);
  if (f.etapas.length === 0)
    return recusaFin('sem-etapa', 'O fluxo precisa de ao menos uma etapa.', ['etapas']);
  const seqs = new Set(f.etapas.map((e) => e.sequencia));
  if (seqs.size !== f.etapas.length)
    return recusaFin('etapa-repetida', 'Duas etapas com a mesma ordem.', ['etapas']);
  for (const e of f.etapas) {
    if (!e.nome.trim()) return recusaFin('etapa-sem-nome', 'Dê um nome a cada etapa.', ['etapas']);
    if (e.valorMinimo !== null && e.valorMaximo !== null && e.valorMaximo < e.valorMinimo)
      return recusaFin('faixa-invalida', `A faixa de valor da etapa "${e.nome}" está invertida.`, ['etapas']);
    if (e.aprovadores.length === 0)
      return recusaFin('etapa-sem-aprovador', `A etapa "${e.nome}" precisa de ao menos um aprovador.`, [
        'etapas',
      ]);
    if (e.regraQuorum === 'minimo' && (e.minimo ?? 0) < 1)
      return recusaFin('quorum-invalido', `Diga o mínimo de aprovações da etapa "${e.nome}".`, ['etapas']);
    if (
      e.regraQuorum === 'minimo' &&
      e.aprovadores.every((a) => a.papel === null) &&
      (e.minimo ?? 0) > e.aprovadores.length
    )
      return recusaFin(
        'quorum-invalido',
        `A etapa "${e.nome}" pede mais aprovações do que tem aprovadores.`,
        ['etapas'],
      );
    for (const a of e.aprovadores) {
      if ((a.usuario === null) === (a.papel === null))
        return recusaFin('aprovador-invalido', 'Cada aprovador é uma pessoa ou um papel, não os dois.', [
          'etapas',
        ]);
      if (a.substituto !== null && a.substituto === a.usuario)
        return recusaFin('substituto-invalido', 'O substituto não pode ser o próprio aprovador.', ['etapas']);
      if (a.valorLimite !== null && a.valorLimite < 0)
        return recusaFin('limite-invalido', 'A alçada do aprovador não pode ser negativa.', ['etapas']);
      if (a.vigenciaFim !== null && a.vigenciaFim < a.vigenciaInicio)
        return recusaFin('vigencia-invalida', 'A vigência do aprovador termina antes de começar.', [
          'etapas',
        ]);
    }
    const nominais = e.aprovadores.filter((a) => a.usuario !== null).map((a) => a.usuario);
    if (new Set(nominais).size !== nominais.length)
      return recusaFin('aprovador-repetido', `A mesma pessoa aparece duas vezes na etapa "${e.nome}".`, [
        'etapas',
      ]);
  }
  return null;
}
