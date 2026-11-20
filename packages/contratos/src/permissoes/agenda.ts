// Permissões do M17 (ficha, seção 7; convencoes.md §12): agenda de consultas. Quem tem a opção no legado tem a
// permissão no novo (regra 1 do M06): as opções do módulo Recepção externa › Agenda da árvore TBOPCOES (retrato
// tools/verificadores/dados/acesso-legado.pc.json): Agenda 3310, Manutenção/criação 3311 (cadastro de agendas,
// escala e geração da grade), Agendamento 3312, Consulta 3313 (por paciente 3314, por data 3315, primeiro horário
// livre 3316), Listagem 3317 e Horários cancelados 3325, Dias indisponíveis 3328, Reagendamento diário 3329,
// Gravar atendimento 3397, Excluir agendamentos 3405, Estatísticas 3406 e Utilitários › Liberar horários
// bloqueados 3270. A ação → opção é inferida (POL-1b) quando a árvore não tem item próprio (encaixe, lista de
// espera, confirmação) e é conferida na validação humana com o call center (DP-3).
// D-PERM-1 (M17): `agenda.consulta.*` da ficha virou `agenda.marcacao.*`, porque `agenda.consulta.ler` já é a
// consulta somente leitura das tabelas do módulo (M14).
import type { DeclaracaoPermissao, EscopoPermissao } from './tipos.js';

export const OPCOES_AGENDA = {
  acessar: 3310,
  manutencao: 3311,
  agendamento: 3312,
  consulta: 3313,
  consultaPaciente: 3314,
  consultaData: 3315,
  primeiroLivre: 3316,
  listagem: 3317,
  horariosCancelados: 3325,
  diasIndisponiveis: 3328,
  reagendamento: 3329,
  gravarAtendimento: 3397,
  excluirAgendamentos: 3405,
  estatisticas: 3406,
  liberarBloqueados: 3270,
} as const;

const O = OPCOES_AGENDA;
const ESCOPOS: readonly EscopoPermissao[] = ['unidade', 'tipoAgenda'];
const LER_MARCACAO = [
  O.acessar,
  O.agendamento,
  O.consulta,
  O.consultaPaciente,
  O.consultaData,
  O.primeiroLivre,
  O.listagem,
];

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
  escopos: ESCOPOS,
  ...extra,
});

export const PERMISSOES_AGENDA_M17: readonly DeclaracaoPermissao[] = [
  p('agenda.agenda.ler', 'Consultar as agendas de consulta, com convênios e especialidades aceitos', [
    O.acessar,
    O.manutencao,
    O.consulta,
  ]),
  p('agenda.agenda.editar', 'Incluir agenda e alterar duração, situação e teleatendimento', [O.manutencao]),
  p('agenda.cobertura.editar', 'Definir os convênios e as especialidades aceitos pela agenda', [
    O.manutencao,
  ]),
  p('agenda.escala.ler', 'Consultar a escala semanal do profissional e as gerações da agenda', [
    O.acessar,
    O.manutencao,
  ]),
  p('agenda.escala.editar', 'Planejar a escala semanal com a data em que passa a valer', [O.manutencao]),
  p('agenda.grade.ler', 'Consultar a grade de horários e a prévia da geração', [
    O.acessar,
    O.manutencao,
    O.consulta,
  ]),
  p('agenda.grade.gerar', 'Gerar os horários da agenda por período (com prévia)', [O.manutencao], {
    criticidade: 'sensivel',
  }),
  p(
    'agenda.grade.reverter',
    'Reverter uma geração de horários feita no novo (os horários ocupados ficam)',
    [O.manutencao],
    {
      criticidade: 'sensivel',
    },
  ),
  p(
    'agenda.marcacao.ler',
    'Consultar marcações, vagas, painel do dia e cancelamentos (contato mascarado na lista)',
    [...LER_MARCACAO, O.horariosCancelados],
  ),
  p('agenda.marcacao.agendar', 'Marcar consulta em horário vago', [O.agendamento]),
  p('agenda.marcacao.cancelar', 'Cancelar consulta com motivo padronizado', [O.excluirAgendamentos]),
  p('agenda.marcacao.remarcar', 'Remarcar consulta (também em lote, pela lista de espera)', [
    O.agendamento,
    O.reagendamento,
  ]),
  p('agenda.marcacao.confirmar', 'Confirmar a consulta e registrar a tentativa de confirmação', [
    O.agendamento,
  ]),
  p('agenda.encaixe.criar', 'Encaixar paciente fora da grade e desfazer o encaixe até o check-in', [
    O.agendamento,
  ]),
  p('agenda.falta.registrar', 'Registrar a falta no fechamento do dia', [O.gravarAtendimento, O.agendamento]),
  p('agenda.bloqueio.ler', 'Consultar bloqueios e indisponibilidades da agenda', [
    O.diasIndisponiveis,
    O.manutencao,
  ]),
  p('agenda.bloqueio.criar', 'Bloquear e desbloquear horários com motivo e período', [
    O.diasIndisponiveis,
    O.liberarBloqueados,
  ]),
  p('agenda.espera.ler', 'Consultar a lista de espera da agenda', [O.agendamento, O.reagendamento]),
  p('agenda.espera.editar', 'Incluir, ofertar e encerrar pedidos da lista de espera', [
    O.agendamento,
    O.reagendamento,
  ]),
  p(
    'agenda.indicador.ler',
    'Consultar os indicadores da agenda (ocupação, funil, cancelamento e absenteísmo)',
    [O.estatisticas, O.listagem],
  ),
];
