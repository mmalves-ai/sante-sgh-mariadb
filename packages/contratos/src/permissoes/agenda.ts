// Permissões do M17 (ficha, seção 7; convencoes.md §12): agenda de consultas. Quem tem a opção no legado tem a
// permissão no novo (regra 1 do M06): as opções do módulo Recepção externa › Agenda da árvore do menu de origem (retrato
// tools/verificadores/dados/acesso-legado.pc.json): Agenda 3310, Manutenção/criação 3311 (cadastro de agendas,
// escala e geração da grade), Agendamento 3312, Consulta 3313 (por paciente 3314, por data 3315, primeiro horário
// livre 3316), Listagem 3317 e Horários cancelados 3325, Dias indisponíveis 3328, Reagendamento diário 3329,
// Gravar atendimento 3397, Excluir agendamentos 3405, Estatísticas 3406 e Utilitários › Liberar horários
// bloqueados 3270. A ação → opção é inferida (POL-1b) quando a árvore não tem item próprio (encaixe, lista de
// espera, confirmação) e é conferida na validação humana com o call center (DP-3).
// D-PERM-1 (M17): `agenda.consulta.*` da ficha virou `agenda.marcacao.*`, porque `agenda.consulta.ler` já é a
// consulta somente leitura das tabelas do módulo (M14).
import type { DeclaracaoPermissao, EscopoPermissao } from './tipos.js';
const ESCOPOS: readonly EscopoPermissao[] = ['unidade', 'tipoAgenda'];

const p = (
  codigo: string,
  descricao: string,

  extra: Partial<DeclaracaoPermissao> = {},
): DeclaracaoPermissao => ({
  codigo,
  descricao,

  concessaoPorPerfil: null,
  categoria: 'administrativa',
  escopos: ESCOPOS,
  ...extra,
});

export const PERMISSOES_AGENDA_M17: readonly DeclaracaoPermissao[] = [
  p('agenda.agenda.ler', 'Consultar as agendas de consulta, com convênios e especialidades aceitos'),
  p('agenda.agenda.editar', 'Incluir agenda e alterar duração, situação e teleatendimento'),
  p('agenda.cobertura.editar', 'Definir os convênios e as especialidades aceitos pela agenda'),
  p('agenda.escala.ler', 'Consultar a escala semanal do profissional e as gerações da agenda'),
  p('agenda.escala.editar', 'Planejar a escala semanal com a data em que passa a valer'),
  p('agenda.grade.ler', 'Consultar a grade de horários e a prévia da geração'),
  p('agenda.grade.gerar', 'Gerar os horários da agenda por período (com prévia)', {
    criticidade: 'sensivel',
  }),
  p(
    'agenda.grade.reverter',
    'Reverter uma geração de horários feita no novo (os horários ocupados ficam)',

    {
      criticidade: 'sensivel',
    },
  ),
  p(
    'agenda.marcacao.ler',
    'Consultar marcações, vagas, painel do dia e cancelamentos (contato mascarado na lista)',
  ),
  p('agenda.marcacao.agendar', 'Marcar consulta em horário vago'),
  p('agenda.marcacao.cancelar', 'Cancelar consulta com motivo padronizado'),
  p('agenda.marcacao.remarcar', 'Remarcar consulta (também em lote, pela lista de espera)'),
  p('agenda.marcacao.confirmar', 'Confirmar a consulta e registrar a tentativa de confirmação'),
  p('agenda.encaixe.criar', 'Encaixar paciente fora da grade e desfazer o encaixe até o check-in'),
  p('agenda.falta.registrar', 'Registrar a falta no fechamento do dia'),
  p('agenda.bloqueio.ler', 'Consultar bloqueios e indisponibilidades da agenda'),
  p('agenda.bloqueio.criar', 'Bloquear e desbloquear horários com motivo e período'),
  p('agenda.espera.ler', 'Consultar a lista de espera da agenda'),
  p('agenda.espera.editar', 'Incluir, ofertar e encerrar pedidos da lista de espera'),
  p(
    'agenda.indicador.ler',
    'Consultar os indicadores da agenda (ocupação, funil, cancelamento e absenteísmo)',
  ),
];
