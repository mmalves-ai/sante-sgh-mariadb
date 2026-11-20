// Vocabulário da manutenção e engenharia clínica, fatia F1 (M55; ficha, seções 6 a 8; cap-07 §7.2; RDC 63/2011,
// RDC63-07): equipamento, ordem de serviço (corretiva e predial no mesmo fluxo), plano de manutenção (preventiva,
// calibração, segurança elétrica e inspeção), laudo e cobertura por contrato de manutenção. Recurso novo: as 22
// tabelas GM* e as do patrimônio (GPBENS, GPMANUT) estão vazias na cópia do pc (contagem de 24/10/2026), então não há
// código lido do outro sistema a espelhar; os dados vão para SGH_MAN_* (regra 2 da Fase 6). A tela mostra o rótulo,
// nunca o código cru nem o nome da tabela (ADR 0023).

/** Chave da funcionalidade em SGH_CFG_LIBERACAO (ficha, seção 12): entregue desligada, ligada por estabelecimento. */
export const CHAVE_LIBERACAO_MANUTENCAO = 'manutencao';

/** Teto da lista de OS por página (ficha, seção 4: "paginado 200"). */
export const TETO_LISTA_OS = 200;

/** Tipo do equipamento ou instalação (SGH_MAN_EQUIPAMENTO.TIPO). A predial entra no mesmo fluxo (ficha, F1). */
export const TIPOS_EQUIPAMENTO = {
  medico: 'Equipamento médico-hospitalar',
  infraestrutura: 'Infraestrutura (gases, energia, climatização, água)',
  predial: 'Instalação predial',
  apoio: 'Equipamento de apoio',
} as const;
export type TipoEquipamento = keyof typeof TIPOS_EQUIPAMENTO;
export const CODIGOS_TIPO_EQUIPAMENTO = Object.keys(TIPOS_EQUIPAMENTO) as TipoEquipamento[];

/**
 * Criticidade (regra 1): a crítica é a do equipamento de suporte à vida ou sem substituto no setor; parado, gera o
 * alerta ao setor e ao recurso de agenda ligado.
 */
export const CRITICIDADES_EQUIPAMENTO = {
  critica: 'Crítica (suporte à vida ou sem substituto)',
  alta: 'Alta',
  media: 'Média',
  baixa: 'Baixa',
} as const;
export type CriticidadeEquipamento = keyof typeof CRITICIDADES_EQUIPAMENTO;
export const CODIGOS_CRITICIDADE = Object.keys(CRITICIDADES_EQUIPAMENTO) as CriticidadeEquipamento[];

/** Classe de risco do registro na Anvisa (RDC 751/2022), só para equipamento médico-hospitalar. */
export const CLASSES_RISCO = {
  I: 'Classe I (baixo risco)',
  II: 'Classe II (médio risco)',
  III: 'Classe III (alto risco)',
  IV: 'Classe IV (máximo risco)',
} as const;
export type ClasseRisco = keyof typeof CLASSES_RISCO;
export const CODIGOS_CLASSE_RISCO = Object.keys(CLASSES_RISCO) as ClasseRisco[];

/** Situação cadastral do equipamento. "Parado" é derivado das OS com parada aberta e não é editável aqui. */
export const SITUACOES_EQUIPAMENTO = {
  ativo: 'Em uso',
  reserva: 'Reserva',
  desativado: 'Desativado',
} as const;
export type SituacaoEquipamento = keyof typeof SITUACOES_EQUIPAMENTO;
export const CODIGOS_SITUACAO_EQUIPAMENTO = Object.keys(SITUACOES_EQUIPAMENTO) as SituacaoEquipamento[];

/**
 * Recurso de agenda ligado ao equipamento (ficha, seção 6, "recurso de agenda ligado (sala, aparelho)"). O bloqueio
 * no outro sistema só existe por operação já provada: a agenda de consultas tem `agenda.bloquearHorarios` (M17,
 * verde no pc); a agenda de exames e a sala do centro cirúrgico não têm operação de bloqueio, e ficam só com o
 * alerta (regra 1).
 */
export const TIPOS_RECURSO_AGENDA = {
  agendaConsulta: 'Agenda de consultas',
  agendaExame: 'Agenda de exames',
  salaCirurgica: 'Sala do centro cirúrgico',
} as const;
export type TipoRecursoAgenda = keyof typeof TIPOS_RECURSO_AGENDA;
export const CODIGOS_TIPO_RECURSO_AGENDA = Object.keys(TIPOS_RECURSO_AGENDA) as TipoRecursoAgenda[];

/** Operação de gravação que bloqueia o recurso, quando existe (regra 1). */
export const OPERACAO_BLOQUEIO_DO_RECURSO: Readonly<Record<TipoRecursoAgenda, string | null>> = {
  agendaConsulta: 'agenda.bloquearHorarios',
  agendaExame: null,
  salaCirurgica: null,
};

/** Natureza da ordem de serviço. Corretiva e predial são abertas por qualquer setor; as demais nascem do plano. */
export const NATUREZAS_OS = {
  corretiva: 'Corretiva',
  predial: 'Predial',
  preventiva: 'Preventiva',
  calibracao: 'Calibração',
  segurancaEletrica: 'Segurança elétrica',
  inspecao: 'Inspeção',
} as const;
export type NaturezaOs = keyof typeof NATUREZAS_OS;
export const CODIGOS_NATUREZA_OS = Object.keys(NATUREZAS_OS) as NaturezaOs[];
/** As que o solicitante abre (tela "Abrir e acompanhar OS"). */
export const NATUREZAS_ABERTURA: readonly NaturezaOs[] = ['corretiva', 'predial'];

/**
 * Prioridade da OS com o SLA padrão em horas (padrão de mercado da engenharia clínica; parâmetro por estabelecimento,
 * `manutencao.sla<Prioridade>AtendimentoHoras` e `...SolucaoHoras`). O solicitante sugere; a manutenção define na
 * triagem.
 */
export const PRIORIDADES_OS = {
  emergencia: 'Emergência',
  alta: 'Alta',
  media: 'Média',
  baixa: 'Baixa',
} as const;
export type PrioridadeOs = keyof typeof PRIORIDADES_OS;
export const CODIGOS_PRIORIDADE_OS = Object.keys(PRIORIDADES_OS) as PrioridadeOs[];

export interface SlaPrioridade {
  /** Do registro da OS até o técnico assumir. */
  readonly atendimentoHoras: number;
  /** Do registro da OS até a conclusão. */
  readonly solucaoHoras: number;
}

export const SLA_PADRAO: Readonly<Record<PrioridadeOs, SlaPrioridade>> = {
  emergencia: { atendimentoHoras: 1, solucaoHoras: 4 },
  alta: { atendimentoHoras: 4, solucaoHoras: 24 },
  media: { atendimentoHoras: 24, solucaoHoras: 72 },
  baixa: { atendimentoHoras: 72, solucaoHoras: 240 },
};

/** Situação da OS (SGH_MAN_OS.SITUACAO). */
export const SITUACOES_OS = {
  aberta: 'Aberta',
  emAtendimento: 'Em atendimento',
  aguardandoPeca: 'Aguardando peça',
  aguardandoTerceiro: 'Aguardando fornecedor',
  concluida: 'Concluída (aguarda o aceite)',
  encerrada: 'Encerrada',
  cancelada: 'Cancelada',
} as const;
export type SituacaoOs = keyof typeof SITUACOES_OS;
export const CODIGOS_SITUACAO_OS = Object.keys(SITUACOES_OS) as SituacaoOs[];
/** Situações em que a OS ainda está com a manutenção (contam no SLA e na lista de abertas). */
export const SITUACOES_OS_ABERTAS: readonly SituacaoOs[] = [
  'aberta',
  'emAtendimento',
  'aguardandoPeca',
  'aguardandoTerceiro',
];
/** Situações de pausa: o relógio do SLA de solução continua (padrão de mercado), mas a tela mostra o motivo. */
export const SITUACOES_OS_ESPERA: readonly SituacaoOs[] = ['aguardandoPeca', 'aguardandoTerceiro'];

/** Situação do prazo (SLA) mostrada na lista e no painel. */
export const SITUACOES_PRAZO_OS = {
  noPrazo: 'No prazo',
  emRisco: 'Perto de vencer',
  vencido: 'Prazo vencido',
  cumprido: 'Cumprido no prazo',
  descumprido: 'Cumprido fora do prazo',
} as const;
export type SituacaoPrazoOs = keyof typeof SITUACOES_PRAZO_OS;

/** Atividade do plano de manutenção (SGH_MAN_PREVENTIVA.ATIVIDADE; regra 2). */
export const ATIVIDADES_PLANO = {
  preventiva: 'Manutenção preventiva',
  calibracao: 'Calibração',
  segurancaEletrica: 'Teste de segurança elétrica',
  inspecao: 'Inspeção',
} as const;
export type AtividadePlano = keyof typeof ATIVIDADES_PLANO;
export const CODIGOS_ATIVIDADE_PLANO = Object.keys(ATIVIDADES_PLANO) as AtividadePlano[];
/** Atividades que exigem laudo anexado para dar a execução como feita (regra 2; RDC63-07). */
export const ATIVIDADES_COM_LAUDO: readonly AtividadePlano[] = ['calibracao', 'segurancaEletrica'];

export const UNIDADES_PERIODICIDADE = { dias: 'dias', meses: 'meses' } as const;
export type UnidadePeriodicidade = keyof typeof UNIDADES_PERIODICIDADE;

/** Resultado da execução do plano (laudo). Reprovado deixa o equipamento parado e abre a corretiva. */
export const RESULTADOS_EXECUCAO = {
  aprovado: 'Aprovado',
  aprovadoComRestricao: 'Aprovado com restrição',
  reprovado: 'Reprovado',
} as const;
export type ResultadoExecucao = keyof typeof RESULTADOS_EXECUCAO;
export const CODIGOS_RESULTADO_EXECUCAO = Object.keys(RESULTADOS_EXECUCAO) as ResultadoExecucao[];

/** Situação do item do plano no painel (regra 2: a vencida aparece no painel). */
export const SITUACOES_PLANO = {
  emDia: 'Em dia',
  aVencer: 'A vencer',
  vencida: 'Vencida',
} as const;
export type SituacaoPlano = keyof typeof SITUACOES_PLANO;

/** Cobertura do contrato de manutenção sobre o equipamento (F1; o contrato em si é o da F3 quando chegar). */
export const COBERTURAS_CONTRATO = {
  integral: 'Integral (peças e mão de obra)',
  maoDeObra: 'Só mão de obra',
  preventiva: 'Preventiva e calibração',
  sobDemanda: 'Sob demanda (por chamado)',
} as const;
export type CoberturaContrato = keyof typeof COBERTURAS_CONTRATO;
export const CODIGOS_COBERTURA_CONTRATO = Object.keys(COBERTURAS_CONTRATO) as CoberturaContrato[];

/** Quem executa a OS ou o plano. */
export const EXECUTORES = { interno: 'Equipe própria', contrato: 'Empresa contratada' } as const;
export type Executor = keyof typeof EXECUTORES;

/** Causa da falha registrada na conclusão (base do MTBF por causa; padrão de mercado). */
export const CAUSAS_FALHA = {
  desgaste: 'Desgaste natural',
  usoInadequado: 'Uso inadequado',
  acidente: 'Acidente ou queda',
  energia: 'Falha de energia ou rede',
  acessorio: 'Acessório ou consumível',
  software: 'Software ou configuração',
  semDefeito: 'Sem defeito constatado',
  outra: 'Outra',
} as const;
export type CausaFalha = keyof typeof CAUSAS_FALHA;
export const CODIGOS_CAUSA_FALHA = Object.keys(CAUSAS_FALHA) as CausaFalha[];
/** Causas que não contam como falha no MTBF (regra 3: o número de falhas impresso exclui estas). */
export const CAUSAS_SEM_FALHA: readonly CausaFalha[] = ['semDefeito'];
