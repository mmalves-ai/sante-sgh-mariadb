// Rotas da agenda de exames (M18; ficha, seção 7). Cada rota exige a permissão de leitura do catálogo (M06); o
// servidor confere de novo e as ações aparecem só com a permissão de agir e a funcionalidade liberada.
import type { RouteRecordRaw } from 'vue-router';

const id = '(\\d+)';
const M = 'Agenda > Agenda de exames';

export const rotasExames: RouteRecordRaw[] = [
  {
    path: '/agenda/exames/agendas',
    name: 'exames.agendas',
    component: () => import('./telas/AgendasExameTela.vue'),
    meta: { permissao: 'agenda.exame.ler', menu: `${M} > Cadastro de agendas de exames` },
  },
  {
    path: '/agenda/exames/escalas',
    name: 'exames.escalas',
    component: () => import('./telas/EscalasExameTela.vue'),
    meta: { permissao: 'agenda.exame.ler', menu: `${M} > Escala semanal da agenda de exames` },
  },
  {
    path: '/agenda/exames/gerar',
    name: 'exames.gerar',
    component: () => import('./telas/GerarGradeExameTela.vue'),
    meta: { permissao: 'agenda.exame.ler', menu: `${M} > Gerar agenda e grade de horários` },
  },
  {
    path: '/agenda/exames/marcar',
    name: 'exames.marcar',
    component: () => import('./telas/MarcarExameTela.vue'),
    meta: { permissao: 'agenda.exame.ler', menu: `${M} > Marcação de exames` },
  },
  {
    path: `/agenda/exames/marcacoes/:id${id}`,
    name: 'exames.marcacao',
    component: () => import('./telas/MarcacaoExameTela.vue'),
    props: true,
    meta: { permissao: 'agenda.exame.ler' },
  },
  {
    path: '/agenda/exames/dia',
    name: 'exames.dia',
    component: () => import('./telas/DiaExameTela.vue'),
    meta: { permissao: 'agenda.exame.ler' },
  },
  {
    path: '/agenda/exames/cancelamentos',
    name: 'exames.cancelamentos',
    component: () => import('./telas/CancelamentosExameTela.vue'),
    meta: { permissao: 'agenda.exame.ler', menu: `${M} > Cancelamentos de exames` },
  },
  {
    path: '/agenda/exames/residuo',
    name: 'exames.residuo',
    component: () => import('./telas/ResiduoExameTela.vue'),
    meta: { permissao: 'agenda.agendaExame.editar' },
  },
];
