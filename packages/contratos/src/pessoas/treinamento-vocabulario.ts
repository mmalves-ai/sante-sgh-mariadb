// Vocabulário da fatia F6 da gestão de pessoas (M52.6; ficha, seções 5, 7 e 8, regras 20 e 21): treinamentos e
// capacitações com a ciência de POP versionado, o autosserviço do colaborador ("Meu espaço") e o plantão realizado para
// o repasse. Rótulos de produto (ADR 0023).

/** Chaves de liberação da fatia (SGH_CFG_LIBERACAO; todas nascem desligadas, POL-3). */
export const CHAVES_LIBERACAO_TREINAMENTO = {
  treinamento: 'pessoas.treinamento',
  autoatendimento: 'pessoas.autoatendimento',
  plantaoRealizado: 'pessoas.plantaoRealizado',
  /**
   * O lançamento do realizado no repasse (repasse.lancarEvento, origem plantão): sem chave de liberação desde a C2-100
   * (ADR 0002); o nome fica como recurso na trilha.
   */
  repassePlantao: 'pessoas.repassePlantao',
} as const;
export const CHAVE_PESSOAS_TREINAMENTO = CHAVES_LIBERACAO_TREINAMENTO.treinamento;
export const CHAVE_PESSOAS_AUTOATENDIMENTO = CHAVES_LIBERACAO_TREINAMENTO.autoatendimento;
export const CHAVE_PESSOAS_PLANTAO_REALIZADO = CHAVES_LIBERACAO_TREINAMENTO.plantaoRealizado;
export const CHAVE_PESSOAS_REPASSE_PLANTAO = CHAVES_LIBERACAO_TREINAMENTO.repassePlantao;

/** Parâmetros da fatia (SGH_CFG_PARAMETRO). */
export const PARAMETROS_TREINAMENTO = {
  alertaTreinamento: 'pessoas.treinamento.alertaDias',
  eventoRepassePlantao: 'pessoas.repasse.eventoPlantao',
} as const;
export const PARAMETRO_ALERTA_TREINAMENTO = PARAMETROS_TREINAMENTO.alertaTreinamento;
export const PARAMETRO_EVENTO_REPASSE_PLANTAO = PARAMETROS_TREINAMENTO.eventoRepassePlantao;

export const CATEGORIAS_CURSO = {
  nr32: 'Segurança e saúde no trabalho (NR-32)',
  integracao: 'Integração de novos colaboradores',
  pop: 'Procedimento operacional padrão (POP)',
  assistencial: 'Capacitação assistencial',
  gestao: 'Gestão e administrativo',
  outro: 'Outro',
} as const;
export type CategoriaCurso = keyof typeof CATEGORIAS_CURSO;
export const CODIGOS_CATEGORIA_CURSO = Object.keys(CATEGORIAS_CURSO) as CategoriaCurso[];

export const MODALIDADES_TURMA = {
  presencial: 'Presencial',
  distancia: 'A distância',
  'em-servico': 'Em serviço',
} as const;
export type ModalidadeTurma = keyof typeof MODALIDADES_TURMA;
export const CODIGOS_MODALIDADE_TURMA = Object.keys(MODALIDADES_TURMA) as ModalidadeTurma[];

export const PRESENCAS_TREINAMENTO = {
  inscrito: 'Inscrito',
  presente: 'Presente',
  ausente: 'Ausente',
} as const;
export type PresencaTreinamentoCodigo = keyof typeof PRESENCAS_TREINAMENTO;

export const APROVEITAMENTOS_TREINAMENTO = {
  aprovado: 'Aprovado',
  reprovado: 'Reprovado',
  'sem-avaliacao': 'Concluído sem avaliação',
} as const;
export type AproveitamentoTreinamentoCodigo = keyof typeof APROVEITAMENTOS_TREINAMENTO;

export const SITUACOES_TURMA = {
  aberta: 'Aberta',
  encerrada: 'Encerrada',
  cancelada: 'Cancelada',
} as const;
export type SituacaoTurma = keyof typeof SITUACOES_TURMA;

export const SITUACOES_TREINAMENTO = {
  valido: 'Em dia',
  aVencer: 'A vencer',
  vencido: 'Vencido',
  pendente: 'Pendente',
} as const;
export type SituacaoTreinamentoCodigo = keyof typeof SITUACOES_TREINAMENTO;

export const SITUACOES_POP = {
  vigente: 'Vigente',
  substituido: 'Substituída',
  revogado: 'Revogada',
} as const;
export type SituacaoPopCodigo = keyof typeof SITUACOES_POP;

export const SITUACOES_REALIZADO = {
  informado: 'Aguardando aprovação',
  aprovado: 'Aprovado',
  recusado: 'Recusado',
  substituido: 'Substituído',
  /** W0-06: o aprovado estornado com motivo (fora do repasse; o lançado leva o lançamento negativo). */
  estornado: 'Estornado',
} as const;
export type SituacaoRealizadoCodigo = keyof typeof SITUACOES_REALIZADO;

export const ORIGENS_REALIZADO = {
  informado: 'Informado pela coordenação',
  ponto: 'Pelas marcações do ponto',
} as const;
export type OrigemRealizado = keyof typeof ORIGENS_REALIZADO;
