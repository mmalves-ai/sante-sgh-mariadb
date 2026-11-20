// Vocabulário da fatia F3 da gestão de pessoas (M52.3; ficha do M52, seções 6 a 8, regras 8 a 10; cap-07 §7.1.2): a
// troca de plantão entre colegas (pedido → aceite do colega → aprovação da coordenação), "quem está de plantão agora"
// com o sobreaviso e o acionamento, e o dimensionamento de enfermagem pela Resolução COFEN 543/2017. Recurso novo: as
// tabelas de troca e de plantão do outro sistema estão vazias e não se usam (ficha, seção 6). A tela mostra o rótulo,
// nunca o código cru nem o nome da tabela (ADR 0023).

// ── Troca de plantão (regra 8, segunda parte) ─────────────────────────────────────────────────────────────────

/**
 * Tipo da troca (D-TROCA-52.3): na troca, os dois colegas trocam um plantão por outro; na cessão, o colega assume o
 * plantão sem devolver outro.
 */
export const TIPOS_TROCA = {
  troca: 'Troca (um plantão por outro)',
  cessao: 'Cessão (o colega assume o plantão)',
} as const;
export type TipoTroca = keyof typeof TIPOS_TROCA;
export const CODIGOS_TIPO_TROCA = Object.keys(TIPOS_TROCA) as TipoTroca[];

/** Estado do pedido de troca (SGH_PES_TROCA.ESTADO): a trilha fica nas colunas de cada passo e na SGH_TRILHA. */
export const ESTADOS_TROCA = {
  pedida: 'Aguardando o aceite do colega',
  aceita: 'Aceita pelo colega, aguardando a coordenação',
  aprovada: 'Aprovada pela coordenação',
  recusada: 'Recusada pelo colega',
  reprovada: 'Reprovada pela coordenação',
  cancelada: 'Cancelada por quem pediu',
} as const;
export type EstadoTroca = keyof typeof ESTADOS_TROCA;
export const CODIGOS_ESTADO_TROCA = Object.keys(ESTADOS_TROCA) as EstadoTroca[];
/** Os estados em que a troca ainda prende os plantões (um plantão só entra em uma troca aberta por vez). */
export const ESTADOS_TROCA_ABERTA: readonly EstadoTroca[] = ['pedida', 'aceita'];

/** Eventos do outbox da troca (a escala também recebe PESSOAS_ESCALA_ALTERADA na aprovação). */
export const EVENTO_TROCA_PEDIDA = 'PESSOAS_TROCA_PEDIDA';
export const EVENTO_TROCA_APROVADA = 'PESSOAS_TROCA_APROVADA';

// ── Sobreaviso (regra 10) ────────────────────────────────────────────────────────────────────────────────────

/** Situação do acionamento do sobreaviso (SGH_PES_ACIONAMENTO.SITUACAO). */
export const SITUACOES_ACIONAMENTO = {
  acionado: 'Acionado, a caminho',
  chegou: 'Chegou',
  cancelado: 'Acionamento cancelado',
} as const;
export type SituacaoAcionamento = keyof typeof SITUACOES_ACIONAMENTO;
export const CODIGOS_SITUACAO_ACIONAMENTO = Object.keys(SITUACOES_ACIONAMENTO) as SituacaoAcionamento[];

/** Evento do outbox do acionamento (o aviso ao profissional e o realizado do ponto, F4, consomem). */
export const EVENTO_SOBREAVISO_ACIONADO = 'PESSOAS_SOBREAVISO_ACIONADO';

/** Teto da consulta "quem está de plantão agora" (ficha, seção 4: 50 linhas). */
export const TETO_PLANTAO_AGORA = 50;

// ── Dimensionamento de enfermagem (regra 9; Resolução COFEN 543/2017) ─────────────────────────────────────────

/**
 * Categorias do Sistema de Classificação de Pacientes (SCP) e as horas de enfermagem por paciente em 24 h (COFEN
 * 543/2017, art. 3º): cuidado mínimo 4 h, intermediário 6 h, alta dependência 10 h, semi-intensivo 10 h e intensivo
 * 18 h. Os códigos são os do Fugulin do M45 (classificação de pacientes).
 */
export const CATEGORIAS_SCP = {
  minimos: { rotulo: 'Cuidados mínimos', horas: 4 },
  intermediarios: { rotulo: 'Cuidados intermediários', horas: 6 },
  altaDependencia: { rotulo: 'Alta dependência', horas: 10 },
  semiIntensivos: { rotulo: 'Cuidados semi-intensivos', horas: 10 },
  intensivos: { rotulo: 'Cuidados intensivos', horas: 18 },
} as const;
export type CategoriaScp = keyof typeof CATEGORIAS_SCP;
export const CODIGOS_CATEGORIA_SCP = Object.keys(CATEGORIAS_SCP) as CategoriaScp[];

/**
 * Percentual mínimo de enfermeiros no total da equipe pela categoria de maior prevalência (COFEN 543/2017, art. 5º):
 * mínimo e intermediário 33%; alta dependência 36%; semi-intensivo 42%; intensivo 52%. O resto são técnicos e
 * auxiliares de enfermagem.
 */
export const PERCENTUAL_ENFERMEIROS_SCP: Readonly<Record<CategoriaScp, number>> = {
  minimos: 0.33,
  intermediarios: 0.33,
  altaDependencia: 0.36,
  semiIntensivos: 0.42,
  intensivos: 0.52,
};

/** Índice de segurança técnica mínimo (COFEN 543/2017: ao menos 15% para férias e ausências). */
export const IST_MINIMO = 0.15;
/** Dias da semana da unidade que funciona todos os dias (a constante de Marinho usa DS = 7). */
export const DIAS_SEMANA_UNIDADE = 7;
/** Jornadas semanais aceitas no cálculo (20 h a 44 h; a constante de Marinho é calculada para a escolhida). */
export const JORNADA_SEMANAL_MINIMA = 20;
export const JORNADA_SEMANAL_MAXIMA = 44;
/**
 * Mínimo de enfermeiros quando a categoria prevalente é cuidado mínimo ou intermediário (COFEN 543/2017, art. 5º, I:
 * "33% são enfermeiros (mínimo de seis)"). Parâmetro `pessoas.dimensionamento.minimoEnfermeiros` em SGH_CFG_PARAMETRO;
 * a coordenação de enfermagem confirma (D-DIM-MIN-52.3).
 */
export const MINIMO_ENFERMEIROS_MINIMO_INTERMEDIARIO = 6;

/** De onde vieram os pacientes por categoria. */
export const FONTES_DIMENSIONAMENTO = {
  informada: 'Informada pela coordenação',
  classificacao: 'Classificação de pacientes do turno',
} as const;
export type FonteDimensionamento = keyof typeof FONTES_DIMENSIONAMENTO;
export const CODIGOS_FONTE_DIMENSIONAMENTO = Object.keys(FONTES_DIMENSIONAMENTO) as FonteDimensionamento[];

/**
 * O turno da classificação de pacientes (12 h) que contém o turno da escala (D-DIM-TURNO-52.3): manhã e tarde no
 * diurno; a noite no noturno.
 */
export const TURNO_CLASSIFICACAO_DA_ESCALA = {
  manha: 'diurno',
  tarde: 'diurno',
  noite: 'noturno',
} as const;
