// Operações de gravação da agenda de consultas: nome, entrada (Zod do contrato), evento auditável e recurso. As duas
// portas (própria e memória) validam a mesma entrada; a própria grava cada uma pelo Executor do @sgh/nucleo.
import {
  EVENTOS_AUDITAVEIS,
  esquemaAgendarConsulta,
  esquemaAlterarAgenda,
  esquemaBloquearHorarios,
  esquemaCancelarConsulta,
  esquemaConfirmarConsulta,
  esquemaDefinirCobertura,
  esquemaDefinirEspecialidade,
  esquemaDesfazerEncaixe,
  esquemaEncaixar,
  esquemaGerarGrade,
  esquemaIncluirAgenda,
  esquemaRegistrarFalta,
  esquemaRemarcarConsulta,
  esquemaReverterGrade,
} from '@sgh/contratos';
import { recusa } from '@sgh/nucleo';
import type { ZodType } from 'zod';

export interface OperacaoAgenda {
  readonly entrada: ZodType<unknown>;
  readonly evento: string;
  readonly recurso: string;
}

const E = EVENTOS_AUDITAVEIS;

export const OPERACOES_AGENDA: Readonly<Record<string, OperacaoAgenda>> = Object.freeze({
  'agenda.gerarGrade': {
    entrada: esquemaGerarGrade,
    evento: E.agendaGradeGerada.codigo,
    recurso: 'agenda.grade',
  },
  'agenda.reverterGrade': {
    entrada: esquemaReverterGrade,
    evento: E.agendaGradeRevertida.codigo,
    recurso: 'agenda.grade',
  },
  'agenda.agendarConsulta': {
    entrada: esquemaAgendarConsulta,
    evento: E.agendaConsultaMarcada.codigo,
    recurso: 'agenda.consulta',
  },
  'agenda.encaixar': {
    entrada: esquemaEncaixar,
    evento: E.agendaEncaixeCriado.codigo,
    recurso: 'agenda.consulta',
  },
  'agenda.desfazerEncaixe': {
    entrada: esquemaDesfazerEncaixe,
    evento: E.agendaEncaixeDesfeito.codigo,
    recurso: 'agenda.consulta',
  },
  'agenda.cancelarConsulta': {
    entrada: esquemaCancelarConsulta,
    evento: E.agendaConsultaCancelada.codigo,
    recurso: 'agenda.consulta',
  },
  'agenda.remarcarConsulta': {
    entrada: esquemaRemarcarConsulta,
    evento: E.agendaConsultaRemarcada.codigo,
    recurso: 'agenda.consulta',
  },
  'agenda.confirmarConsulta': {
    entrada: esquemaConfirmarConsulta,
    evento: E.agendaConsultaConfirmada.codigo,
    recurso: 'agenda.consulta',
  },
  'agenda.registrarFalta': {
    entrada: esquemaRegistrarFalta,
    evento: E.agendaFaltaRegistrada.codigo,
    recurso: 'agenda.consulta',
  },
  'agenda.bloquearHorarios': {
    entrada: esquemaBloquearHorarios,
    evento: E.agendaHorariosBloqueados.codigo,
    recurso: 'agenda.bloqueio',
  },
  'agenda.definirCobertura': {
    entrada: esquemaDefinirCobertura,
    evento: E.agendaCoberturaDefinida.codigo,
    recurso: 'agenda.agenda',
  },
  'agenda.definirEspecialidade': {
    entrada: esquemaDefinirEspecialidade,
    evento: E.agendaCoberturaDefinida.codigo,
    recurso: 'agenda.agenda',
  },
  'agenda.incluirAgenda': {
    entrada: esquemaIncluirAgenda,
    evento: E.agendaCadastrada.codigo,
    recurso: 'agenda.agenda',
  },
  'agenda.alterarAgenda': {
    entrada: esquemaAlterarAgenda,
    evento: E.agendaCadastrada.codigo,
    recurso: 'agenda.agenda',
  },
});

/** A operação pelo nome; nome desconhecido é recusa (nunca grava). */
export function operacaoAgenda(nome: string): OperacaoAgenda {
  const o = Object.hasOwn(OPERACOES_AGENDA, nome) ? OPERACOES_AGENDA[nome] : undefined;
  if (!o) throw recusa('operacao-desconhecida', 'Operação da agenda desconhecida.');
  return o;
}
