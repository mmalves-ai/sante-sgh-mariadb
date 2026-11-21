// Tempo de sessão (cap-08 §8.8): inatividade pelo menor valor entre o tempo máximo de inatividade da configuração de login e o
// padrão do perfil (15 min assistência, 30 administrativo), aviso antes (tempo de aviso da configuração) e duração
// máxima de 12 h. Sem perfil conhecido (o mapa de perfis é do M06), vale o mais restritivo (assistência).

export type PerfilSessao = 'assistencial' | 'administrativo';

export const PADRAO_INATIVIDADE_SEGUNDOS: Readonly<Record<PerfilSessao, number>> = {
  assistencial: 15 * 60,
  administrativo: 30 * 60,
};
export const DURACAO_MAXIMA_SEGUNDOS = 12 * 60 * 60;
/** Aviso padrão quando o legado não define TEMPO_AVISO_ENC_SESSAO (POL-1: padrão de mercado). */
export const AVISO_PADRAO_SEGUNDOS = 60;

export interface TempoSessaoLegado {
  /** TEMPO_MAX_INATIVO_ENC_SESSAO em segundos (null ou 0: não definido). */
  readonly inatividadeSegundos: number | null;
  /** TEMPO_AVISO_ENC_SESSAO em segundos (null: não definido). */
  readonly avisoSegundos: number | null;
}

export interface TempoSessao {
  readonly inatividadeSegundos: number;
  readonly avisoSegundos: number;
  readonly duracaoMaximaSegundos: number;
}

export function tempoSessao(legado: TempoSessaoLegado, perfil: PerfilSessao = 'assistencial'): TempoSessao {
  const padrao = PADRAO_INATIVIDADE_SEGUNDOS[perfil];
  const doLegado =
    legado.inatividadeSegundos && legado.inatividadeSegundos > 0 ? legado.inatividadeSegundos : null;
  const inatividade = doLegado === null ? padrao : Math.min(doLegado, padrao);
  const avisoBruto =
    legado.avisoSegundos && legado.avisoSegundos > 0 ? legado.avisoSegundos : AVISO_PADRAO_SEGUNDOS;
  // O aviso nunca passa da metade do prazo (senão apareceria logo depois de cada atividade).
  const aviso = Math.min(avisoBruto, Math.floor(inatividade / 2));
  return {
    inatividadeSegundos: inatividade,
    avisoSegundos: aviso,
    duracaoMaximaSegundos: DURACAO_MAXIMA_SEGUNDOS,
  };
}

export type SituacaoTempo = 'ativa' | 'bloqueada' | 'expirada';

/** Situação da sessão pelo relógio: expirada passa da duração máxima; bloqueada, da inatividade. */
export function situacaoPorTempo(
  criadaEmMs: number,
  ultimaAtividadeMs: number,
  agoraMs: number,
  t: TempoSessao,
): SituacaoTempo {
  if (agoraMs - criadaEmMs >= t.duracaoMaximaSegundos * 1000) return 'expirada';
  if (t.inatividadeSegundos > 0 && agoraMs - ultimaAtividadeMs >= t.inatividadeSegundos * 1000)
    return 'bloqueada';
  return 'ativa';
}
