// Rotas da agenda de consultas (M17; ficha, seção 7). Cada rota exige a permissão de leitura do catálogo (M06);
// o servidor confere de novo e as ações aparecem só com a permissão de agir e a funcionalidade liberada.
import type { RouteRecordRaw } from 'vue-router';

const id = '(\\d+)';
const M = 'Agenda > Agenda ambulatorial (consultas)';

export const rotasAgenda: RouteRecordRaw[] = [
  {
    path: '/agenda/consultas/agendas',
    name: 'agenda.agendas',
    component: () => import('./telas/AgendasTela.vue'),
    meta: { permissao: 'agenda.agenda.ler', menu: `${M} > Cadastro de agendas` },
  },
  {
    path: `/agenda/consultas/agendas/:id${id}`,
    name: 'agenda.agenda',
    component: () => import('./telas/AgendaDetalheTela.vue'),
    props: true,
    meta: { permissao: 'agenda.agenda.ler' },
  },
  {
    path: '/agenda/consultas/escalas',
    name: 'agenda.escalas',
    component: () => import('./telas/EscalasTela.vue'),
    meta: { permissao: 'agenda.escala.ler', menu: `${M} > Escala semanal do profissional` },
  },
  {
    path: '/agenda/consultas/gerar',
    name: 'agenda.gerar',
    component: () => import('./telas/GerarGradeTela.vue'),
    meta: { permissao: 'agenda.grade.ler', menu: `${M} > Gerar/abrir agenda por período` },
  },
  {
    path: '/agenda/consultas/grade',
    name: 'agenda.grade',
    component: () => import('./telas/GradeTela.vue'),
    meta: { permissao: 'agenda.grade.ler', menu: `${M} > Grade de horários e vagas` },
  },
  {
    path: '/agenda/consultas/marcar',
    name: 'agenda.marcar',
    component: () => import('./telas/MarcarTela.vue'),
    meta: { permissao: 'agenda.marcacao.ler', menu: `${M} > Marcação, encaixe, remarcação e confirmação` },
  },
  {
    path: `/agenda/consultas/marcacoes/:id${id}`,
    name: 'agenda.marcacao',
    component: () => import('./telas/MarcacaoTela.vue'),
    props: true,
    meta: { permissao: 'agenda.marcacao.ler' },
  },
  {
    path: '/agenda/consultas/dia',
    name: 'agenda.dia',
    component: () => import('./telas/PainelDiaTela.vue'),
    meta: { permissao: 'agenda.marcacao.ler' },
  },
  {
    path: '/agenda/consultas/bloqueios',
    name: 'agenda.bloqueios',
    component: () => import('./telas/BloqueiosTela.vue'),
    meta: { permissao: 'agenda.bloqueio.ler', menu: `${M} > Bloqueios e indisponibilidades` },
  },
  {
    path: '/agenda/consultas/cancelamentos',
    name: 'agenda.cancelamentos',
    component: () => import('./telas/CancelamentosTela.vue'),
    meta: { permissao: 'agenda.marcacao.ler', menu: `${M} > Cancelamentos` },
  },
  {
    path: '/agenda/espera',
    name: 'agenda.espera',
    component: () => import('./telas/EsperaTela.vue'),
    meta: { permissao: 'agenda.espera.ler', menu: `${M} > Lista de espera e remarcação em lote` },
  },
  {
    path: '/agenda/consultas/perfis-marcacao',
    name: 'agenda.perfisMarcacao',
    component: () => import('./telas/PerfisMarcacaoTela.vue'),
    meta: { permissao: 'agenda.agenda.ler', menu: `${M} > Perfis de marcação` },
  },
  {
    path: '/agenda/consultas/itens-agendaveis',
    name: 'agenda.itensAgendaveis',
    component: () => import('./telas/ItensAgendaveisTela.vue'),
    meta: { permissao: 'agenda.agenda.ler', menu: `${M} > Itens agendáveis` },
  },
  {
    path: '/agenda/consultas/cotas-prazos',
    name: 'agenda.cotasPrazos',
    component: () => import('./telas/CotasPrazosTela.vue'),
    meta: { permissao: 'agenda.agenda.ler', menu: `${M} > Cotas e prazos de marcação` },
  },
  {
    path: '/agenda/turmas',
    name: 'agenda.turmas',
    component: () => import('./telas/TurmasTela.vue'),
    meta: { permissao: 'agenda.agenda.ler', menu: `${M} > Grupos e turmas` },
  },
  {
    path: '/agenda/consultas/contato-ativo',
    name: 'agenda.contatoAtivo',
    component: () => import('./telas/ContatoAtivoTela.vue'),
    meta: { permissao: 'agenda.marcacao.ler', menu: `${M} > Contato ativo antes da consulta` },
  },
  {
    path: '/agenda/consultas/indicadores',
    name: 'agenda.indicadores',
    component: () => import('./telas/IndicadoresTela.vue'),
    meta: { permissao: 'agenda.indicador.ler' },
  },
];
