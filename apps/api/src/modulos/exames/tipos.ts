// Tipos de negócio da agenda de exames (M18): o que a porta entrega ao serviço, sem forma de tabela nem código do
// sistema de origem. Agenda, horário e marcação são identificados por id; situação vira booleano ou estado nomeado.
// Horas do dia e durações em "HH:MM" (o formato neutro de @sgh/contratos, o mesmo do motor da agenda em
// @sgh/dominio-agenda); instantes no fuso do estabelecimento (relogio.ts).
// Melhoria: agenda por id (não mais pelo par nome + registro do médico); "ativa", "atendido" e "senha" booleanos;
// o estado do horário já vem nomeado (vago, marcado, confirmado…), sem letra de situação.
import type { EstadoHorarioExame } from '@sgh/dominio-agenda';

/** Relógio do estabelecimento: data ISO e a hora corrente "HH:MM". */
export interface RelogioEstabelecimento {
  readonly hoje: string;
  readonly hora: string;
}

export interface AgendaExame {
  readonly id: number;
  readonly nome: string;
  /** Registro no conselho do profissional da agenda (0 quando a agenda é de recurso ou setor). */
  readonly crm: number;
  /** Modalidade da agenda no vocabulário da tela (TIPOS_HORARIO_EXAME). */
  readonly exame: string;
  /** Categoria da agenda (id). */
  readonly categoria: number;
  /** Duração padrão do horário ("HH:MM"). */
  readonly duracao: string;
  readonly ativa: boolean;
  /** Unidade assistencial (0 = sem unidade: vale para todos os escopos). */
  readonly unidade: number;
  /** Primeiro e último dia com horário gerado (null sem grade). */
  readonly inicio: string | null;
  readonly fim: string | null;
  /** Quantas fontes pagadoras a agenda aceita (0 = aceita todas). */
  readonly convenios: number;
}

export interface LinhaEscalaExame {
  /** 1 = domingo … 7 = sábado. */
  readonly semana: number;
  readonly duracao: string;
  readonly horaInicio: string;
  readonly horaFim: string;
  readonly exame: string;
  /** Pausa dentro da faixa ("HH:MM"), sem horários; null = sem pausa. */
  readonly intervaloInicio: string | null;
  readonly intervaloFim: string | null;
  /** Vagas de cada horário gerado pela faixa (≥ 1). */
  readonly vagas: number;
  /** A faixa também vale nos feriados. */
  readonly atendeFeriado: boolean;
  /** Vigência da faixa (datas ISO; fim null = sem fim). */
  readonly vigenciaInicio: string;
  readonly vigenciaFim: string | null;
}

export type SituacaoGeracao = 'gerada' | 'revertida' | 'pendente' | 'falhou';

export interface GeracaoGrade {
  readonly situacao: SituacaoGeracao;
  readonly inicio: string;
  readonly fim: string;
  /** Data e hora ("HH:MM") do pedido. */
  readonly em: string;
  readonly hora: string;
  readonly duracao: string;
  /** Dias da semana gerados (1 = domingo … 7 = sábado). */
  readonly dias: readonly number[];
  readonly usuario: string;
}

export interface HorarioExame {
  readonly data: string;
  readonly hora: string;
  /** Modalidade do horário no vocabulário da tela (TIPOS_HORARIO_EXAME). */
  readonly exame: string;
  readonly estado: EstadoHorarioExame;
  /** Nome do paciente marcado (o serviço o mascara nas listas); null quando vago. */
  readonly paciente: string | null;
  readonly convenio: number | null;
  /** A marcação do horário, quando houver. */
  readonly marcacao: number | null;
}

export interface VagaExame {
  readonly agenda: number;
  readonly nomeAgenda: string;
  readonly categoria: number;
  readonly data: string;
  readonly hora: string;
  readonly exame: string;
}

export interface MarcacaoExame {
  readonly id: number;
  readonly agenda: number | null;
  readonly nomeAgenda: string;
  readonly categoriaAgenda: number;
  readonly data: string;
  readonly hora: string;
  readonly paciente: string;
  readonly idPaciente: number | null;
  /** Número do prontuário (0 = sem prontuário: pré-cadastro). */
  readonly prontuario: number;
  readonly convenio: number;
  /** Estado do horário da marcação ("outro" quando o horário não existe mais). */
  readonly estado: EstadoHorarioExame;
  /** Situação da marcação no vocabulário do cadastro (aguardando, confirmada, realizada…). */
  readonly situacao: string;
  readonly atendido: boolean;
  readonly usuario: string;
  readonly marcadaEm: string;
  readonly temSenha: boolean;
}

export interface ContatoMarcacaoExame {
  readonly telefone: string;
  readonly celular: string;
  readonly email: string;
  readonly observacao: string | null;
}

export interface CancelamentoExame {
  readonly nomeAgenda: string;
  readonly data: string;
  readonly hora: string;
  readonly paciente: string;
  readonly motivo: string;
  readonly canceladoEm: string;
  readonly horaCancelamento: string;
  readonly canceladoPor: string;
  readonly marcadoPor: string;
  readonly convenio: number;
}

export interface ResiduoExame {
  readonly porAgenda: {
    agenda: number;
    nomeAgenda: string;
    confirmadosSemPaciente: number;
    ocupadosSemMarcacao: number;
  }[];
  readonly horarios: {
    nomeAgenda: string;
    data: string;
    hora: string;
    tipo: 'confirmado-sem-paciente' | 'sem-marcacao';
  }[];
  readonly truncado: boolean;
}

export interface OpcoesDaAgendaExame {
  readonly convenios: { codigo: number; nome: string; ativo: boolean }[];
  readonly exames: { id: number; nome: string; categoria: number }[];
}

export interface ExtensaoExame {
  readonly marcacao: number;
  readonly idExame: number | null;
  readonly exameNome: string | null;
  readonly solicitante: { crm: number; uf: string; nome: string } | null;
  readonly retorno: boolean;
  readonly canal: string;
}

export interface CoberturaExame {
  readonly id: number;
  readonly agenda: number;
  readonly exame: number;
  readonly exameNome: string;
  readonly convenio: number | null;
  readonly convenioNome: string | null;
}

export const TETO_HORARIOS_EXAME = 3_000;
export const TETO_VAGAS_EXAME = 500;
export const TETO_MARCACOES_EXAME = 1_000;
