// Vocabulário da escala de plantão, fatia F2 (M52.2; ficha do M52, seções 6 a 8, regras 3 e 5 a 8; cap-07 §7.1.2):
// modelos de regime e jornada, montagem e publicação da escala por setor e competência, com a cobertura mínima por
// turno. Recurso novo: as tabelas de escala do outro sistema estão vazias e não se usam (ficha, seção 6); os domínios de
// jornada, tempo parcial e trabalho/folga são lidos onde estão, pelo código. A tela mostra o rótulo, nunca o código cru
// nem o nome da tabela (ADR 0023).

/** Tipo do plantão (SGH_PES_PLANTAO.TIPO; ficha, seção 6: "presencial, sobreaviso (tempo de chegada) ou diarista"). */
export const TIPOS_PLANTAO = {
  presencial: 'Plantão presencial',
  sobreaviso: 'Sobreaviso',
  diarista: 'Diarista',
} as const;
export type TipoPlantao = keyof typeof TIPOS_PLANTAO;
export const CODIGOS_TIPO_PLANTAO = Object.keys(TIPOS_PLANTAO) as TipoPlantao[];

/**
 * Plantões que contam como jornada (interjornada, limite semanal e cobertura). O sobreaviso não é tempo de trabalho
 * enquanto não houver acionamento (o acionamento é da F3); entra só na conferência de sobreposição (D-SOBRE-52).
 */
export const PLANTOES_DE_JORNADA: readonly TipoPlantao[] = ['presencial', 'diarista'];

/** Tipo da escala (SGH_PES_ESCALA.TIPO): define o conselho exigido de quem entra (regra 3). */
export const TIPOS_ESCALA = {
  medica: 'Escala médica',
  enfermagem: 'Escala de enfermagem',
  multiprofissional: 'Escala multiprofissional',
  apoio: 'Escala de apoio (sem conselho)',
} as const;
export type TipoEscala = keyof typeof TIPOS_ESCALA;
export const CODIGOS_TIPO_ESCALA = Object.keys(TIPOS_ESCALA) as TipoEscala[];

/**
 * Conselho exigido por tipo de escala (regra 3; D-ESC-52): médica pede CRM, enfermagem pede COREN, multiprofissional
 * aceita qualquer registro ativo e a de apoio (maqueiro, higienização, recepção) não confere conselho.
 */
export const CONSELHO_DA_ESCALA: Readonly<Record<TipoEscala, string | null | 'qualquer'>> = {
  medica: 'CRM',
  enfermagem: 'COREN',
  multiprofissional: 'qualquer',
  apoio: null,
};

/** Estado da escala (ficha, seção 6: "estado (rascunho, publicada)"). */
export const ESTADOS_ESCALA = {
  rascunho: 'Rascunho',
  publicada: 'Publicada',
  /** W0-06: a publicada cancelada com motivo (nunca apagada; os plantões previstos ficam cancelados). */
  cancelada: 'Cancelada',
} as const;
export type EstadoEscala = keyof typeof ESTADOS_ESCALA;
export const CODIGOS_ESTADO_ESCALA = Object.keys(ESTADOS_ESCALA) as EstadoEscala[];

/** Situação do plantão: o cancelado nunca é apagado (fica na grade riscado e na trilha). */
export const SITUACOES_PLANTAO = {
  previsto: 'Previsto',
  cancelado: 'Cancelado',
} as const;
export type SituacaoPlantao = keyof typeof SITUACOES_PLANTAO;

/**
 * Turnos da cobertura mínima (ficha, seção 6: "cobertura mínima por turno"; D-TURNO-52). Um plantão cobre o turno
 * quando vai do começo ao fim dele; a noite vai das 19 h às 7 h do dia seguinte.
 */
export const TURNOS_ESCALA = {
  manha: { rotulo: 'Manhã (7 h às 13 h)', inicio: '07:00', fim: '13:00', viraODia: false },
  tarde: { rotulo: 'Tarde (13 h às 19 h)', inicio: '13:00', fim: '19:00', viraODia: false },
  noite: { rotulo: 'Noite (19 h às 7 h)', inicio: '19:00', fim: '07:00', viraODia: true },
} as const;
export type TurnoEscala = keyof typeof TURNOS_ESCALA;
export const CODIGOS_TURNO_ESCALA = Object.keys(TURNOS_ESCALA) as TurnoEscala[];

/**
 * Contrato em tempo parcial (domínio de tempo parcial do ramo; ref 02): 0 = não é tempo parcial; 1 = 25 h; 2 = 30 h;
 * 3 = 26 h semanais (regra 6). O limite lido no domínio vale; esta tabela é o padrão quando a coluna vier vazia.
 */
export const LIMITES_TEMPO_PARCIAL: Readonly<Record<number, number | null>> = {
  0: null,
  1: 25,
  2: 30,
  3: 26,
};

/** Interjornada mínima da CLT (regra 5: 11 h), em minutos; a exceção só por acordo registrado no regime. */
export const INTERJORNADA_MINIMA_MIN = 11 * 60;

/** Duração máxima de um plantão (24 h) e mínima (1 h), em minutos (D-DUR-52). */
export const DURACAO_MAXIMA_PLANTAO_MIN = 24 * 60;
export const DURACAO_MINIMA_PLANTAO_MIN = 60;

/** O que a trilha da escala registra (SGH_PES_ESCALA_EVENTO; só inclusão). */
export const ACOES_EVENTO_ESCALA = {
  criada: 'Escala criada',
  cobertura: 'Cobertura mínima alterada',
  incluido: 'Plantão incluído',
  alterado: 'Plantão alterado',
  cancelado: 'Plantão cancelado',
  publicada: 'Escala publicada',
  cancelada: 'Escala cancelada',
} as const;
export type AcaoEventoEscala = keyof typeof ACOES_EVENTO_ESCALA;

/** Evento do outbox da publicação (a F3 consome para "quem está de plantão agora" e o aviso aos escalados). */
export const EVENTO_ESCALA_PUBLICADA = 'PESSOAS_ESCALA_PUBLICADA';
/** Evento do outbox da mudança de escala publicada (regra 8: só com motivo). */
export const EVENTO_ESCALA_ALTERADA = 'PESSOAS_ESCALA_ALTERADA';
