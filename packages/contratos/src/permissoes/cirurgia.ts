// Permissões do M18 (ficha, seção 7; convencoes.md §12): agenda de exames (módulo SADT) e centro cirúrgico (módulo
// Bloco Cirúrgico). Quem tem a opção no legado tem a permissão no novo (regra 1 do M06). Opções da árvore TBOPCOES
// (retrato tools/verificadores/dados/acesso-legado.pc.json):
//   - SADT › Agenda: Agenda 2759, Manutenção 2760 (cadastro, escala e criação das agendas), Agendamento 2761 e os
//     agendamentos por área 2762 a 2769, Consulta 2770 (por paciente 2771, por data 2772, primeira hora livre 2773),
//     Listagem 2774 (horários 2775, controle de criação 2778, horários cancelados 2779, pacientes agendados 2782,
//     exames agendados 2783), Dias indisponíveis 2785, Reagendamento diário 2786;
//   - Bloco Cirúrgico: o módulo 2227, Parâmetros do bloco 2229 e 2230, Salas 2233, Salas por usuário 4506,
//     Movimentos › Cirurgias 2236 a 2239 (paciente interno e externo), Agendamento 2263, Manutenção 2264, Pesquisa
//     por paciente 2265, Horários agendados 2266, Reagendamento diário 2283, Cirurgias realizadas 2285, Mapa
//     cirúrgico 2293, Agendamento cirúrgico web 6930.
// D-PERM-18: os códigos do exame são próprios (agenda.exame.*, agenda.gradeExame.*; os cadastros agenda.agendaExame.*,
// agenda.escalaExame.* e cirurgia.sala.* saem das declarações do CRUD genérico) porque as opções do SADT não são as da agenda de consultas (Recepção externa). A exceção de
// sobreposição (urgência em sala ocupada) é de quem administra o bloco (Parâmetros, inferido: POL-1b).
// A permissão por SALA (usuários permitidos da sala, a mesma do outro sistema) é conferida no servidor, além destas.
import type { DeclaracaoPermissao, EscopoPermissao } from './tipos.js';

export const OPCOES_AGENDA_EXAME = {
  agenda: 2759,
  manutencao: 2760,
  agendamento: 2761,
  agendamentoAreas: [2762, 2763, 2764, 2765, 2766, 2767, 2768, 2769],
  consulta: 2770,
  consultaPaciente: 2771,
  consultaData: 2772,
  primeiraLivre: 2773,
  listagem: 2774,
  horarios: 2775,
  controleCriacao: 2778,
  horariosCancelados: 2779,
  pacientesAgendados: 2782,
  examesAgendados: 2783,
  diasIndisponiveis: 2785,
  reagendamento: 2786,
} as const;

export const OPCOES_BLOCO = {
  modulo: 2227,
  parametros: 2229,
  parametrosBloco: 2230,
  salas: 2233,
  salasPorUsuario: 4506,
  movimentos: 2236,
  cirurgias: 2237,
  cirurgiaInterno: 2238,
  cirurgiaExterno: 2239,
  agendamento: 2263,
  manutencao: 2264,
  pesquisaPaciente: 2265,
  horariosAgendados: 2266,
  reagendamento: 2283,
  realizadas: 2285,
  mapa: 2293,
  agendamentoWeb: 6930,
} as const;

const E = OPCOES_AGENDA_EXAME;
const B = OPCOES_BLOCO;
// Os escopos do módulo agenda (unidade e tipo de agenda); a agenda de exames não tem tipo (SIAGENDA sem TIPO): o
// servidor filtra só pela unidade.
const ESCOPO_EXAME: readonly EscopoPermissao[] = ['unidade', 'tipoAgenda'];

const p = (
  codigo: string,
  descricao: string,
  opcoesLegado: readonly number[],
  extra: Partial<DeclaracaoPermissao> = {},
): DeclaracaoPermissao => ({
  codigo,
  descricao,
  opcoesLegado,
  concessaoPorPerfil: null,
  categoria: 'administrativa',
  ...extra,
});

const LER_EXAME = [
  E.agenda,
  E.agendamento,
  E.consulta,
  E.consultaPaciente,
  E.consultaData,
  E.primeiraLivre,
  E.listagem,
  E.horarios,
  E.pacientesAgendados,
  E.examesAgendados,
];

export const PERMISSOES_AGENDA_EXAME_M18: readonly DeclaracaoPermissao[] = [
  p(
    'agenda.exame.ler',
    'Consultar agendas, vagas, marcações e cancelamentos de exame',
    [...LER_EXAME, E.manutencao, E.horariosCancelados],
    { escopos: ESCOPO_EXAME },
  ),
  p(
    'agenda.exame.agendar',
    'Marcar exame em horário vago (com e sem prontuário)',
    [E.agendamento, ...E.agendamentoAreas],
    { escopos: ESCOPO_EXAME },
  ),
  p(
    'agenda.exame.remarcar',
    'Remarcar exame (transferência ou liberação do horário)',
    [E.agendamento, E.reagendamento],
    { escopos: ESCOPO_EXAME },
  ),
  p('agenda.exame.cancelar', 'Cancelar exame marcado com motivo padronizado', [E.agendamento], {
    escopos: ESCOPO_EXAME,
  }),
  p(
    'agenda.gradeExame.gerar',
    'Gerar os horários da agenda de exames por período (com prévia)',
    [E.manutencao, E.controleCriacao],
    { escopos: ESCOPO_EXAME, criticidade: 'sensivel' },
  ),
];

export const PERMISSOES_CIRURGIA_M18: readonly DeclaracaoPermissao[] = [
  p('cirurgia.agenda.ler', 'Consultar o mapa cirúrgico, os agendamentos, o histórico e os cancelamentos', [
    B.modulo,
    B.agendamento,
    B.manutencao,
    B.pesquisaPaciente,
    B.horariosAgendados,
    B.mapa,
  ]),
  p('cirurgia.agenda.solicitar', 'Pedir sala para uma cirurgia (solicitação, sem ocupar a sala)', [
    B.agendamento,
    B.manutencao,
    B.agendamentoWeb,
  ]),
  p('cirurgia.agenda.agendar', 'Confirmar a cirurgia na sala (agendamento) e marcar o andamento', [
    B.manutencao,
  ]),
  p('cirurgia.agenda.remarcar', 'Mover a cirurgia de sala ou de horário', [B.manutencao, B.reagendamento]),
  p('cirurgia.agenda.cancelar', 'Cancelar ou suspender a cirurgia com motivo codificado', [B.manutencao]),
  p(
    'cirurgia.agenda.excecao',
    'Autorizar a urgência em sala ocupada (exceção de sobreposição, registrada)',
    [B.parametros, B.parametrosBloco],
    { criticidade: 'sensivel' },
  ),
  p('cirurgia.pendencia.editar', 'Registrar as pendências pré-operatórias do agendamento', [
    B.agendamento,
    B.manutencao,
  ]),
  p('cirurgia.registro.ler', 'Consultar as cirurgias realizadas (procedimentos, equipe e tempos)', [
    B.movimentos,
    B.cirurgias,
    B.cirurgiaInterno,
    B.cirurgiaExterno,
    B.realizadas,
  ]),
  p('cirurgia.registro.criar', 'Registrar o ato cirúrgico (procedimentos, equipe por função e tempos)', [
    B.cirurgias,
    B.cirurgiaInterno,
    B.cirurgiaExterno,
  ]),
  p('cirurgia.ligacao.revisar', 'Revisar a ligação entre a cirurgia realizada e o agendamento', [
    B.cirurgias,
    B.manutencao,
  ]),
];
