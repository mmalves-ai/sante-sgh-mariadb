// Rastreio do paciente no bloco (ficha do M46, etapa 2; seção 5, `cirurgia.moverPacienteBloco`; cap-05a §5.5):
// pré-operatório → espera → sala → recuperação → saída, pelos locais e tipos de movimentação do cadastro do bloco. A
// entrada cria o código anônimo do painel para familiares; a saída desfeita (engano) volta ao local de antes. Regras
// puras: o estado pelo histórico, os movimentos que cabem agora, a conferência do novo e a etapa do painel (regra 5).
import {
  CANCELAR_SAIDA_ATE_MIN,
  ETAPAS_PAINEL_FAMILIA,
  ID_LOCAL_SALA,
  LOCAIS_BLOCO,
  type DestinoSaidaBloco,
  type EtapaPainelFamilia,
  type RecusaBlocoSeguro,
  type TipoMovimentoBloco,
} from '@sgh/contratos';
import { minutosDoInstante } from '../ficha/instante.js';

export interface MovimentoBloco {
  readonly id: number;
  readonly sequencia: number;
  readonly tipo: TipoMovimentoBloco;
  readonly local: number | null;
  readonly localAnterior: number | null;
  readonly salaCirurgica: number | null;
  readonly em: string;
  readonly destino: DestinoSaidaBloco | null;
}

export interface EstadoRastreio {
  /** O paciente está no bloco agora? */
  readonly dentro: boolean;
  readonly local: number | null;
  readonly salaCirurgica: number | null;
  /** Desde quando no local (ou desde a saída). */
  readonly desde: string | null;
  readonly saida: { readonly em: string; readonly destino: DestinoSaidaBloco | null } | null;
  readonly ultimo: MovimentoBloco | null;
  /** O local de antes da última saída (para desfazê-la). */
  readonly localAntesDaSaida: { readonly local: number; readonly salaCirurgica: number | null } | null;
}

const ordenar = (h: readonly MovimentoBloco[]) => [...h].sort((a, b) => a.sequencia - b.sequencia);

export function estadoDoRastreio(historico: readonly MovimentoBloco[]): EstadoRastreio {
  let dentro = false;
  let local: number | null = null;
  let sala: number | null = null;
  let desde: string | null = null;
  let saida: EstadoRastreio['saida'] = null;
  let antes: EstadoRastreio['localAntesDaSaida'] = null;
  const h = ordenar(historico);
  for (const m of h) {
    if (m.tipo === 'alta') {
      antes = local !== null ? { local, salaCirurgica: sala } : null;
      dentro = false;
      local = null;
      sala = null;
      saida = { em: m.em, destino: m.destino };
      desde = m.em;
    } else {
      dentro = true;
      if (local !== m.local || sala !== m.salaCirurgica || m.tipo !== 'transferencia') desde = m.em;
      local = m.local;
      sala = m.salaCirurgica;
      saida = null;
      antes = null;
    }
  }
  return {
    dentro,
    local,
    salaCirurgica: sala,
    desde,
    saida,
    ultimo: h.at(-1) ?? null,
    localAntesDaSaida: antes,
  };
}

/** Os movimentos que cabem agora (a tela mostra só estes). */
export function movimentosPermitidos(e: EstadoRastreio, agora?: string): TipoMovimentoBloco[] {
  if (!e.ultimo) return ['admissao'];
  if (e.dentro) return ['transferencia', 'alta'];
  const r: TipoMovimentoBloco[] = ['readmissao'];
  if (
    e.ultimo.tipo === 'alta' &&
    e.localAntesDaSaida &&
    (!agora || dentroDoPrazoCancelamento(e.ultimo.em, agora))
  )
    r.push('cancelamentoAlta');
  return r;
}

function dentroDoPrazoCancelamento(saida: string, agora: string): boolean {
  return minutosDoInstante(agora) - minutosDoInstante(saida) <= CANCELAR_SAIDA_ATE_MIN;
}

export interface NovoMovimento {
  readonly tipo: TipoMovimentoBloco;
  readonly local: number | null;
  readonly salaCirurgica: number | null;
  readonly em: string;
}

/**
 * Confere o novo movimento contra o histórico e os locais conhecidos; devolve o movimento completo (o local da saída
 * desfeita é o de antes dela) ou a recusa.
 */
export function conferirMovimento(
  historico: readonly MovimentoBloco[],
  novo: NovoMovimento,
  locaisConhecidos: readonly number[],
  agora: string,
):
  | { ok: true; local: number | null; salaCirurgica: number | null; localAnterior: number | null }
  | { ok: false; codigo: RecusaBlocoSeguro } {
  const e = estadoDoRastreio(historico);
  if (!movimentosPermitidos(e).includes(novo.tipo)) {
    if (novo.tipo === 'cancelamentoAlta' && e.ultimo?.tipo === 'alta')
      return { ok: false, codigo: 'rastreio-cancelamento-vencido' };
    return { ok: false, codigo: 'rastreio-movimento-invalido' };
  }
  if (e.ultimo && minutosDoInstante(novo.em) < minutosDoInstante(e.ultimo.em))
    return { ok: false, codigo: 'rastreio-horario-fora-de-ordem' };
  if (novo.tipo === 'alta') return { ok: true, local: null, salaCirurgica: null, localAnterior: e.local };
  if (novo.tipo === 'cancelamentoAlta') {
    if (!dentroDoPrazoCancelamento(e.ultimo!.em, agora))
      return { ok: false, codigo: 'rastreio-cancelamento-vencido' };
    const a = e.localAntesDaSaida!;
    return { ok: true, local: a.local, salaCirurgica: a.salaCirurgica, localAnterior: null };
  }
  const local = novo.local;
  if (local === null || !locaisConhecidos.includes(local))
    return { ok: false, codigo: 'rastreio-local-desconhecido' };
  const sala = local === ID_LOCAL_SALA ? novo.salaCirurgica : null;
  if (local === ID_LOCAL_SALA && sala === null) return { ok: false, codigo: 'rastreio-sala-obrigatoria' };
  if (novo.tipo === 'transferencia' && e.local === local && e.salaCirurgica === sala)
    return { ok: false, codigo: 'rastreio-mesmo-local' };
  return { ok: true, local, salaCirurgica: sala, localAnterior: e.local };
}

/** A etapa do painel para familiares (regra 5): pelo local; a saída aparece por um tempo e depois some. */
export function etapaDoPainel(e: EstadoRastreio): EtapaPainelFamilia | null {
  if (!e.ultimo) return null;
  if (!e.dentro) return e.saida ? 'saiu' : null;
  return LOCAIS_BLOCO.find((l) => l.id === e.local)?.etapa ?? 'noBloco';
}

export function rotuloEtapa(etapa: EtapaPainelFamilia): string {
  return ETAPAS_PAINEL_FAMILIA.find((x) => x.codigo === etapa)!.rotulo;
}

export function rotuloLocal(id: number | null): string | null {
  if (id === null) return null;
  return LOCAIS_BLOCO.find((l) => l.id === id)?.rotulo ?? `Local ${id}`;
}

/** O código continua no painel? (Dentro do bloco, ou até o tempo de visibilidade depois da saída.) */
export function visivelNoPainel(e: EstadoRastreio, agora: string, saidaVisivelMin: number): boolean {
  if (!e.ultimo) return false;
  if (e.dentro) return true;
  return !!e.saida && minutosDoInstante(agora) - minutosDoInstante(e.saida.em) <= saidaVisivelMin;
}

/** O estado do agendamento do M18 que a movimentação marca (no bloco, em sala), quando a transição é permitida. */
export function estadoDoAgendamentoPeloLocal(local: number | null): 'no-bloco' | 'em-sala' | null {
  if (local === null) return null;
  return local === ID_LOCAL_SALA ? 'em-sala' : 'no-bloco';
}
