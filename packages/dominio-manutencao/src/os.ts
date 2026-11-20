// Regra 1 do M55 (cap-07 §7.2, linha "Equipamento parado bloqueia o recurso na agenda"; ficha, seção 7): OS com
// prioridade e SLA, aberta por qualquer setor (do seu setor), com o ciclo aberta → em atendimento (ou esperando peça ou
// fornecedor) → concluída → encerrada pelo aceite do solicitante; equipamento crítico parado gera alerta ao setor e ao
// recurso de agenda. O bloqueio do recurso no outro sistema só existe pela operação já provada (agenda de consultas,
// `agenda.bloquearHorarios`); sem ela, só o alerta. A API relê a OS dentro da transação e confere a versão.
import {
  OPERACAO_BLOQUEIO_DO_RECURSO,
  SITUACOES_OS_ABERTAS,
  type CriticidadeEquipamento,
  type NaturezaOs,
  type PrioridadeOs,
  type SituacaoEquipamento,
  type SituacaoOs,
  type SituacaoPrazoOs,
  type SlaPrioridade,
  type TipoRecursoAgenda,
} from '@sgh/contratos';
import { instanteDe, minutoDe } from './tempo.js';

export type Recusa<C extends string> = { readonly ok: false; readonly recusa: C; readonly mensagem: string };
const recusa = <C extends string>(c: C, mensagem: string): Recusa<C> => ({ ok: false, recusa: c, mensagem });

// ── Prazo (SLA) ─────────────────────────────────────────────────────────────────────────────────────────

/** Fração do prazo restante abaixo da qual a etapa está "perto de vencer" (padrão: o último quarto). */
export const FRACAO_RISCO_PADRAO = 0.25;

export interface PrazoCalculado {
  readonly limite: string;
  readonly situacao: SituacaoPrazoOs;
  /** Minutos que faltam (negativo: vencido); nulo quando a etapa já foi cumprida. */
  readonly restanteMinutos: number | null;
}

/** Prazo de uma etapa: do registro + horas do SLA; cumprida no instante `feitaEm`, se houver. */
export function prazoDaEtapa(
  registro: string,
  horas: number,
  feitaEm: string | null,
  agora: string,
  fracaoRisco = FRACAO_RISCO_PADRAO,
): PrazoCalculado {
  if (!Number.isFinite(horas) || horas <= 0) throw new Error('SLA em horas deve ser positivo.');
  const inicio = minutoDe(registro);
  const limite = inicio + horas * 60;
  if (feitaEm !== null)
    return {
      limite: instanteDe(limite),
      situacao: minutoDe(feitaEm) <= limite ? 'cumprido' : 'descumprido',
      restanteMinutos: null,
    };
  const restante = limite - minutoDe(agora);
  const situacao: SituacaoPrazoOs =
    restante < 0 ? 'vencido' : restante <= horas * 60 * fracaoRisco ? 'emRisco' : 'noPrazo';
  return { limite: instanteDe(limite), situacao, restanteMinutos: restante };
}

export interface OsParaPrazo {
  readonly registro: string;
  readonly prioridade: PrioridadeOs;
  readonly assumidaEm: string | null;
  readonly concluidaEm: string | null;
  readonly situacao: SituacaoOs;
}

/**
 * Os dois prazos da OS (atendimento e solução), pelo SLA da prioridade vigente no estabelecimento. A OS cancelada não
 * tem prazo correndo: as etapas não feitas ficam como estavam no cancelamento (`canceladaEm`).
 */
export function prazosDaOs(
  os: OsParaPrazo,
  sla: Readonly<Record<PrioridadeOs, SlaPrioridade>>,
  agora: string,
  canceladaEm: string | null = null,
): { atendimento: PrazoCalculado; solucao: PrazoCalculado } {
  const s = sla[os.prioridade];
  const relogio = os.situacao === 'cancelada' && canceladaEm !== null ? canceladaEm : agora;
  return {
    atendimento: prazoDaEtapa(os.registro, s.atendimentoHoras, os.assumidaEm, relogio),
    solucao: prazoDaEtapa(os.registro, s.solucaoHoras, os.concluidaEm, relogio),
  };
}

// ── Abertura ────────────────────────────────────────────────────────────────────────────────────────────

export interface EquipamentoParaOs {
  readonly id: number;
  readonly situacao: SituacaoEquipamento;
  readonly criticidade: CriticidadeEquipamento;
  readonly centroCusto: number;
  readonly recurso: { readonly tipo: TipoRecursoAgenda; readonly id: number } | null;
}

export interface PedidoAbertura {
  readonly natureza: NaturezaOs;
  /** Setor informado na abertura. */
  readonly centroCusto: number;
  /** Centros de custo do usuário (escopo lido do outro sistema). Lista vazia = sem restrição (cap-08 §8.4). */
  readonly centrosDoUsuario: readonly number[];
  /** Centros de custo ativos do estabelecimento. */
  readonly centrosAtivos: readonly number[];
  readonly equipamento: EquipamentoParaOs | null;
  readonly equipamentoParado: boolean;
  /** OS ainda abertas do mesmo equipamento (aviso de duplicidade, não recusa). */
  readonly abertasDoEquipamento: readonly number[];
}

export type RecusaAbertura =
  | 'natureza-nao-abre'
  | 'setor-inativo'
  | 'setor-nao-permitido'
  | 'sem-equipamento'
  | 'equipamento-desativado';

export type PlanoAbertura =
  | {
      readonly ok: true;
      /** Instante em que a parada começa (o registro), quando o equipamento foi dado como parado. */
      readonly registraParada: boolean;
      readonly alerta: AlertaDeParada | null;
      /** OS abertas do mesmo equipamento, para a tela avisar antes de gravar. */
      readonly possiveisDuplicadas: readonly number[];
    }
  | Recusa<RecusaAbertura>;

export function planejarAbertura(p: PedidoAbertura): PlanoAbertura {
  if (p.natureza !== 'corretiva' && p.natureza !== 'predial')
    return recusa('natureza-nao-abre', 'Preventiva, calibração e inspeção nascem do plano de manutenção.');
  if (!p.centrosAtivos.includes(p.centroCusto))
    return recusa('setor-inativo', 'Este setor não está ativo no estabelecimento.');
  if (p.centrosDoUsuario.length > 0 && !p.centrosDoUsuario.includes(p.centroCusto))
    return recusa('setor-nao-permitido', 'Você só abre ordem de serviço para os seus setores.');
  if (p.natureza === 'corretiva' && p.equipamento === null)
    return recusa('sem-equipamento', 'Escolha o equipamento com defeito.');
  if (p.equipamento?.situacao === 'desativado')
    return recusa('equipamento-desativado', 'Este equipamento está desativado. Fale com a manutenção.');
  const registraParada = p.equipamentoParado && p.equipamento !== null;
  return {
    ok: true,
    registraParada,
    alerta: registraParada && p.equipamento ? alertaDeParada(p.equipamento) : null,
    possiveisDuplicadas: [...p.abertasDoEquipamento].sort((a, b) => a - b),
  };
}

// ── Equipamento crítico parado (regra 1) ───────────────────────────────────────────────────────────────

export interface AlertaDeParada {
  readonly equipamento: number;
  /** Setor do equipamento (recebe o alerta). */
  readonly centroCusto: number;
  readonly recurso: { readonly tipo: TipoRecursoAgenda; readonly id: number } | null;
  /** Operação já provada que bloqueia o recurso; nula: só o alerta. */
  readonly operacaoBloqueio: string | null;
}

/** Só o equipamento de criticidade "crítica" gera o alerta; o bloqueio é proposto, nunca automático. */
export function alertaDeParada(e: EquipamentoParaOs): AlertaDeParada | null {
  if (e.criticidade !== 'critica') return null;
  return {
    equipamento: e.id,
    centroCusto: e.centroCusto,
    recurso: e.recurso,
    operacaoBloqueio: e.recurso ? OPERACAO_BLOQUEIO_DO_RECURSO[e.recurso.tipo] : null,
  };
}

// ── Ciclo da OS ─────────────────────────────────────────────────────────────────────────────────────────

export type AcaoOs = 'assumir' | 'andamento' | 'concluir' | 'encerrar' | 'reabrir' | 'cancelar';

/** Transições permitidas (de → ações). Encerrada e cancelada são finais. */
export const TRANSICOES_OS: Readonly<Record<SituacaoOs, readonly AcaoOs[]>> = {
  aberta: ['assumir', 'cancelar'],
  emAtendimento: ['andamento', 'concluir', 'cancelar'],
  aguardandoPeca: ['andamento', 'concluir', 'cancelar'],
  aguardandoTerceiro: ['andamento', 'concluir', 'cancelar'],
  concluida: ['encerrar', 'reabrir'],
  encerrada: [],
  cancelada: [],
};

export interface OsParaAcao {
  readonly situacao: SituacaoOs;
  readonly solicitante: string;
  readonly tecnico: string | null;
  readonly concluidaEm: string | null;
  readonly temParadaAberta: boolean;
}

export interface QuemAge {
  readonly login: string;
  readonly podeAtender: boolean;
  readonly podeEncerrar: boolean;
}

export type RecusaAcao =
  | 'situacao-nao-permite'
  | 'sem-permissao'
  | 'so-o-solicitante'
  | 'aceite-ainda-no-prazo'
  | 'sem-volta-ao-uso'
  | 'mesma-situacao';

const mesmoLogin = (a: string, b: string | null): boolean =>
  b !== null && a.trim().toUpperCase() === b.trim().toUpperCase();

export interface PedidoAcao {
  readonly os: OsParaAcao;
  readonly acao: AcaoOs;
  readonly quem: QuemAge;
  readonly agora: string;
  /** Andamento: a situação pedida. */
  readonly para?: SituacaoOs;
  /** Conclusão: a volta ao uso informada (obrigatória se há parada aberta). */
  readonly voltaAoUso?: string | null;
  /** Horas do aceite automático (parâmetro `manutencao.aceiteAutomaticoHoras`). */
  readonly horasAceite: number;
}

export type PlanoAcao = { readonly ok: true; readonly para: SituacaoOs } | Recusa<RecusaAcao>;

/** Decide a próxima situação da OS para a ação pedida (o servidor grava evento e versão). */
export function planejarAcao(p: PedidoAcao): PlanoAcao {
  const { os, acao, quem } = p;
  if (!TRANSICOES_OS[os.situacao].includes(acao))
    return recusa('situacao-nao-permite', 'A situação atual da ordem de serviço não permite esta ação.');
  switch (acao) {
    case 'assumir':
      return quem.podeAtender ? { ok: true, para: 'emAtendimento' } : semPermissao();
    case 'andamento': {
      if (!quem.podeAtender) return semPermissao();
      const para = p.para ?? 'emAtendimento';
      if (para === os.situacao) return recusa('mesma-situacao', 'A ordem de serviço já está nesta situação.');
      if (!['emAtendimento', 'aguardandoPeca', 'aguardandoTerceiro'].includes(para))
        return recusa('situacao-nao-permite', 'Use concluir, encerrar ou cancelar para esta mudança.');
      return { ok: true, para };
    }
    case 'concluir':
      if (!quem.podeEncerrar) return semPermissao();
      if (os.temParadaAberta && !p.voltaAoUso)
        return recusa('sem-volta-ao-uso', 'Informe quando o equipamento voltou ao uso.');
      return { ok: true, para: 'concluida' };
    case 'encerrar':
    case 'reabrir': {
      if (mesmoLogin(quem.login, os.solicitante))
        return { ok: true, para: acao === 'encerrar' ? 'encerrada' : 'emAtendimento' };
      if (acao === 'reabrir')
        return recusa('so-o-solicitante', 'Só quem abriu a ordem de serviço recusa o serviço.');
      if (!quem.podeEncerrar) return semPermissao();
      if (!aceiteVencido(os.concluidaEm, p.agora, p.horasAceite))
        return recusa('aceite-ainda-no-prazo', 'Aguarde o aceite de quem abriu a ordem de serviço.');
      return { ok: true, para: 'encerrada' };
    }
    case 'cancelar':
      if (quem.podeEncerrar) return { ok: true, para: 'cancelada' };
      if (os.situacao === 'aberta' && mesmoLogin(quem.login, os.solicitante))
        return { ok: true, para: 'cancelada' };
      return semPermissao();
  }
}

function semPermissao(): Recusa<RecusaAcao> {
  return recusa('sem-permissao', 'Você não tem permissão para esta ação na ordem de serviço.');
}

/** A manutenção encerra sem o aceite depois de `horas` da conclusão sem resposta. */
export function aceiteVencido(concluidaEm: string | null, agora: string, horas: number): boolean {
  if (concluidaEm === null) return false;
  return minutoDe(agora) - minutoDe(concluidaEm) >= horas * 60;
}

/** Ações que a tela mostra para quem está vendo (o servidor decide de novo ao gravar). */
export function acoesDisponiveis(
  os: OsParaAcao,
  quem: QuemAge,
  agora: string,
  horasAceite: number,
): AcaoOs[] {
  return TRANSICOES_OS[os.situacao].filter(
    (acao) =>
      planejarAcao({ os, acao, quem, agora, horasAceite, voltaAoUso: agora, para: proximaPara(os.situacao) })
        .ok,
  );
}

const proximaPara = (s: SituacaoOs): SituacaoOs =>
  s === 'emAtendimento' ? 'aguardandoPeca' : 'emAtendimento';

/** OS ainda com a manutenção (contam no SLA e na lista de abertas). */
export function osAberta(s: SituacaoOs): boolean {
  return SITUACOES_OS_ABERTAS.includes(s);
}

/** Custo total da OS com as parcelas (vai ao custeio do M54 por equipamento). */
export function custoDaOs(c: { pecas: number; maoDeObra: number; terceiros: number }): {
  pecas: number;
  maoDeObra: number;
  terceiros: number;
  total: number;
} {
  const total = Math.round((c.pecas + c.maoDeObra + c.terceiros) * 100) / 100;
  return { ...c, total };
}

// ── Correção da OS antes de assumida (W0-08, programa CRUD) ────────────────────────────────────────────────────────
// A OS é um rascunho operacional editável até ser assumida; depois, só anotação e transição (matriz de governança,
// linha OS). Corrige-se a descrição, a prioridade sugerida, o setor e o equipamento (e o local do serviço predial),
// sempre com motivo; o evento guarda o motivo e os valores anteriores.

export interface OsParaCorrecao {
  readonly situacao: SituacaoOs;
  readonly natureza: NaturezaOs;
  readonly solicitante: string;
  readonly tecnico: string | null;
  readonly assumidaEm: string | null;
  readonly equipamento: number | null;
  readonly centroCusto: number;
  readonly local: string | null;
  readonly descricao: string;
  readonly prioridadeSugerida: PrioridadeOs;
  readonly temParada: boolean;
}

export interface CamposCorrigiveisOs {
  readonly equipamento: number | null;
  readonly centroCusto: number;
  readonly local: string | null;
  readonly descricao: string;
  readonly prioridadeSugerida: PrioridadeOs;
}

export interface PedidoCorrecao {
  readonly os: OsParaCorrecao;
  readonly novo: CamposCorrigiveisOs;
  readonly quem: QuemAge;
  readonly centrosDoUsuario: readonly number[];
  readonly centrosAtivos: readonly number[];
  /** O equipamento novo, quando muda (lido pelo servidor). */
  readonly equipamentoNovo: EquipamentoParaOs | null;
}

export type RecusaCorrecao =
  | 'os-assumida'
  | 'sem-permissao'
  | 'sem-mudanca'
  | 'setor-inativo'
  | 'setor-nao-permitido'
  | 'sem-equipamento'
  | 'equipamento-desativado'
  | 'sem-local'
  | 'parada-sem-equipamento';

export type PlanoCorrecao =
  | {
      readonly ok: true;
      /** Só os campos que mudam, com o valor anterior de cada um (vai para o evento e a trilha). */
      readonly mudancas: readonly {
        readonly campo: keyof CamposCorrigiveisOs;
        readonly antes: string | number | null;
        readonly depois: string | number | null;
      }[];
    }
  | Recusa<RecusaCorrecao>;

/** Pode corrigir: quem abriu (sempre) ou quem atende a manutenção. */
export function planejarCorrecao(p: PedidoCorrecao): PlanoCorrecao {
  const { os, novo, quem } = p;
  if (os.situacao !== 'aberta' || os.tecnico !== null || os.assumidaEm !== null)
    return recusa(
      'os-assumida',
      'A ordem de serviço já foi assumida pela manutenção: agora só se anota no histórico ou se cancela.',
    );
  if (!mesmoLogin(quem.login, os.solicitante) && !quem.podeAtender) return semPermissaoCorrecao();
  const mudancas = (Object.keys(novo) as (keyof CamposCorrigiveisOs)[])
    .filter((k) => (os[k] ?? null) !== (novo[k] ?? null))
    .map((k) => ({ campo: k, antes: os[k] ?? null, depois: novo[k] ?? null }));
  if (mudancas.length === 0) return recusa('sem-mudanca', 'Nada mudou em relação ao que está gravado.');
  if (novo.centroCusto !== os.centroCusto) {
    if (!p.centrosAtivos.includes(novo.centroCusto))
      return recusa('setor-inativo', 'Este setor não está ativo no estabelecimento.');
    if (!quem.podeAtender && p.centrosDoUsuario.length > 0 && !p.centrosDoUsuario.includes(novo.centroCusto))
      return recusa('setor-nao-permitido', 'Você só abre ordem de serviço para os seus setores.');
  }
  if (os.natureza !== 'predial' && novo.equipamento === null)
    return recusa('sem-equipamento', 'Escolha o equipamento com defeito.');
  if (novo.equipamento === null && (novo.local ?? '').trim() === '')
    return recusa('sem-local', 'Sem equipamento, informe o local do serviço.');
  if (os.temParada && novo.equipamento === null)
    return recusa(
      'parada-sem-equipamento',
      'A parada registrada é de um equipamento: escolha o equipamento.',
    );
  if (novo.equipamento !== null && novo.equipamento !== os.equipamento) {
    if (p.equipamentoNovo?.situacao === 'desativado')
      return recusa('equipamento-desativado', 'Este equipamento está desativado. Fale com a manutenção.');
  }
  return { ok: true, mudancas };
}

function semPermissaoCorrecao(): Recusa<RecusaCorrecao> {
  return recusa('sem-permissao', 'Só quem abriu a ordem de serviço ou a manutenção corrigem a abertura.');
}
