// ADR 0009: o preço PARTICULAR definido pelo médico ou pela agenda (regra estruturada) e a resolução do preço de um
// item. No particular, a regra mais específica vence ANTES da tabela do particular; no convênio, o preço vem só da
// tabela (conta > plano > convênio): não existe preço por médico em convênio (decisão 24). Funções puras, sem banco:
// a porta (@sgh/persistencia) traz as candidatas e o preço de tabela; aqui se escolhe e se explica.
import type {
  OrigemPreco,
  RegraPrecoParticular,
  ResultadoCalculoPreco,
  VerificacaoCredenciamento,
} from '@sgh/contratos';

/** O que se está precificando: o item faturável, o grupo dele e se é uma consulta do dono. */
export interface AlvoPreco {
  readonly itemFaturavelId: number | null;
  readonly grupoFaturamentoId: number | null;
  /** O item é a consulta do profissional ou da agenda (a regra de alvo "consulta" vale para ele). */
  readonly consulta: boolean;
}

export interface PedidoRegraParticular {
  readonly profissionalId: number | null;
  readonly agendaId: number | null;
  readonly estabelecimentoId: number;
  readonly fontePagadoraId: number;
  /** Data do atendimento, AAAA-MM-DD. */
  readonly data: string;
  readonly alvo: AlvoPreco;
}

const PESO_ALVO = { item: 3, grupo: 2, consulta: 1 } as const;

function vigente(r: RegraPrecoParticular, data: string): boolean {
  return r.vigenciaInicio <= data && (r.vigenciaFim === null || r.vigenciaFim >= data);
}

function alvoCasa(r: RegraPrecoParticular, a: AlvoPreco): boolean {
  if (r.alvo.tipo === 'item')
    return a.itemFaturavelId !== null && r.alvo.itemFaturavelId === a.itemFaturavelId;
  if (r.alvo.tipo === 'grupo')
    return a.grupoFaturamentoId !== null && r.alvo.grupoFaturamentoId === a.grupoFaturamentoId;
  return a.consulta;
}

function donoCasa(r: RegraPrecoParticular, p: PedidoRegraParticular): boolean {
  return r.dono.tipo === 'agenda'
    ? p.agendaId !== null && r.dono.agendaId === p.agendaId
    : p.profissionalId !== null && r.dono.profissionalId === p.profissionalId;
}

/** As regras que valem para o pedido: ativas, não recusadas, vigentes, do dono, do alvo, do estabelecimento ou rede. */
export function regrasAplicaveis(
  candidatas: readonly RegraPrecoParticular[],
  p: PedidoRegraParticular,
): RegraPrecoParticular[] {
  return candidatas.filter(
    (r) =>
      r.ativo &&
      r.situacaoRevisao !== 'recusada' &&
      r.fontePagadoraId === p.fontePagadoraId &&
      (r.estabelecimentoId === null || r.estabelecimentoId === p.estabelecimentoId) &&
      vigente(r, p.data) &&
      donoCasa(r, p) &&
      alvoCasa(r, p.alvo),
  );
}

/**
 * Ordem de especificidade (a primeira diferença decide): alvo (item > grupo > consulta); dono (agenda > profissional,
 * pois a agenda é um recorte do profissional); estabelecimento > rede; prioridade (menor vence); confirmada >
 * estimada; vigência que começou mais tarde; maior id (a mais recente).
 */
export function compararEspecificidade(a: RegraPrecoParticular, b: RegraPrecoParticular): number {
  const criterios: number[] = [
    PESO_ALVO[b.alvo.tipo] - PESO_ALVO[a.alvo.tipo],
    (b.dono.tipo === 'agenda' ? 1 : 0) - (a.dono.tipo === 'agenda' ? 1 : 0),
    (b.estabelecimentoId !== null ? 1 : 0) - (a.estabelecimentoId !== null ? 1 : 0),
    a.prioridade - b.prioridade,
    (b.situacaoRevisao === 'confirmada' ? 1 : 0) - (a.situacaoRevisao === 'confirmada' ? 1 : 0),
    b.vigenciaInicio.localeCompare(a.vigenciaInicio),
    b.id - a.id,
  ];
  return criterios.find((c) => c !== 0) ?? 0;
}

/** A regra particular que vence para o pedido, ou nulo. */
export function escolherRegraPrecoParticular(
  candidatas: readonly RegraPrecoParticular[],
  p: PedidoRegraParticular,
): RegraPrecoParticular | null {
  return [...regrasAplicaveis(candidatas, p)].sort(compararEspecificidade)[0] ?? null;
}

/** O preço de tabela que a conta acharia (já pela ordem conta > plano > convênio). */
export interface PrecoDeTabela {
  readonly valor: number;
  readonly tabelaPrecoId: number;
  readonly origem: Extract<OrigemPreco, 'tabela_conta' | 'tabela_plano' | 'tabela_convenio'>;
  readonly vigencia: string | null;
}

export interface EntradaResolverPreco {
  /** A fonte pagadora é de tipo particular (só então a regra do médico ou da agenda vale). */
  readonly particular: boolean;
  readonly pedido: PedidoRegraParticular;
  readonly candidatas: readonly RegraPrecoParticular[];
  readonly tabela: PrecoDeTabela | null;
  /** Verificação de credenciamento (nula no particular ou quando não há profissional). */
  readonly credenciamento: VerificacaoCredenciamento | null;
}

const reais = (v: number) => `R$ ${v.toFixed(2).replace('.', ',')}`;

/**
 * Resolve o preço unitário de um item. Particular: a regra estruturada mais específica, antes da tabela. Convênio: só a
 * tabela (as regras particulares nunca entram, mesmo que venham na lista). Credenciamento com efeito "bloqueio" recusa;
 * "alerta" segue com o aviso na explicação.
 */
export function resolverPreco(e: EntradaResolverPreco): ResultadoCalculoPreco {
  const cred = e.credenciamento;
  const vazio = {
    regraPrecoParticularId: null,
    tabelaPrecoId: null,
    textoOrigemId: null,
    estimada: false,
    credenciamento: cred,
  };
  if (cred?.efeito === 'bloqueio')
    return {
      ...vazio,
      valor: null,
      origem: null,
      explicacao:
        cred.motivo ?? 'O profissional não é credenciado neste convênio, que bloqueia o atendimento.',
      recusa: 'profissional-nao-credenciado',
    };
  const aviso =
    cred?.efeito === 'alerta' ? ` Alerta: ${cred.motivo ?? 'profissional sem credenciamento.'}` : '';
  if (e.particular) {
    const r = escolherRegraPrecoParticular(e.candidatas, e.pedido);
    if (r) {
      const dono = r.dono.tipo === 'agenda' ? 'da agenda' : 'do profissional';
      const alvo =
        r.alvo.tipo === 'item' ? 'do procedimento' : r.alvo.tipo === 'grupo' ? 'do grupo' : 'da consulta';
      return {
        ...vazio,
        valor: r.valor,
        origem: r.dono.tipo === 'agenda' ? 'regra_particular_agenda' : 'regra_particular_profissional',
        regraPrecoParticularId: r.id,
        textoOrigemId: r.textoOrigemId,
        estimada: r.situacaoRevisao === 'estimada',
        explicacao:
          `Preço particular ${alvo} definido ${dono} (regra ${r.id}): ${reais(r.valor)}, vigente desde ${r.vigenciaInicio}` +
          (r.situacaoRevisao === 'estimada'
            ? ', estimado do texto da agenda (confira o texto original).'
            : '.') +
          aviso,
        recusa: null,
      };
    }
  }
  if (e.tabela)
    return {
      ...vazio,
      valor: e.tabela.valor,
      origem: e.tabela.origem,
      tabelaPrecoId: e.tabela.tabelaPrecoId,
      explicacao:
        `Preço da tabela ${e.tabela.tabelaPrecoId} (${e.tabela.origem.replace('tabela_', 'da ')}): ${reais(e.tabela.valor)}` +
        (e.tabela.vigencia ? `, vigente desde ${e.tabela.vigencia}.` : '.') +
        aviso,
      recusa: null,
    };
  return {
    ...vazio,
    valor: null,
    origem: null,
    explicacao:
      (e.particular
        ? 'Sem regra particular do profissional ou da agenda e sem preço na tabela do particular: informe o preço manual.'
        : 'O item não tem preço vigente na tabela da conta, do plano ou do convênio: informe o preço manual.') +
      aviso,
    recusa: 'item-sem-preco',
  };
}

/** Origem da tabela pela posição dela na lista da conta (conta, plano, convênio). */
export function origemDaTabela(
  tabela: number,
  daConta: number | null,
  doPlano: number | null,
): PrecoDeTabela['origem'] {
  if (daConta !== null && tabela === daConta) return 'tabela_conta';
  if (doPlano !== null && tabela === doPlano) return 'tabela_plano';
  return 'tabela_convenio';
}
