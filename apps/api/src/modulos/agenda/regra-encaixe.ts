// Regra pura do encaixe diante de bloqueio (vale nas duas portas, memória e própria). O encaixe pode entrar no mesmo
// minuto de um horário da grade (em ordem), mas nunca passa por cima de bloqueio: nem do horário da grade bloqueado
// naquele minuto, nem de um bloqueio de período ativo (férias, ausência, congresso) que cubra o instante.
// Sem banco nem I/O: as portas leem os fatos e a regra decide. A mudança para o pacote de domínio da agenda está
// pedida na saída do lote 01-04.

export type VetoBloqueioEncaixe = 'horario-bloqueado';

export interface IntervaloBloqueio {
  /** Início do bloqueio (ms desde a época), inclusive. */
  readonly inicio: number;
  /** Fim do bloqueio (ms desde a época), exclusive. */
  readonly fim: number;
}

export interface FatosDoMinuto {
  /** O horário da grade naquele minuto está bloqueado. */
  readonly horarioBloqueado: boolean;
  /** Bloqueios de período ativos da agenda (ou do profissional dela). */
  readonly bloqueios: readonly IntervaloBloqueio[];
}

/** O veto do encaixe por bloqueio, ou null quando o instante está livre de bloqueio. */
export function vetoDeBloqueioNoEncaixe(instante: number, f: FatosDoMinuto): VetoBloqueioEncaixe | null {
  if (f.horarioBloqueado) return 'horario-bloqueado';
  return f.bloqueios.some((b) => b.inicio <= instante && instante < b.fim) ? 'horario-bloqueado' : null;
}

export const TEXTO_HORARIO_BLOQUEADO =
  'A agenda está bloqueada neste horário (bloqueio da grade ou de período): o encaixe não passa por cima do bloqueio.';
