// Rotas da fatia F6 da gestão de pessoas (M52.6; ficha, seção 7): treinamentos e capacitações, "Meu espaço"
// (autosserviço, leve para o celular) e o plantão realizado da escala com o relatório ao repasse. A rota exige a
// permissão de leitura; o servidor confere de novo.
import type { RouteRecordRaw } from 'vue-router';

export const rotasF6: RouteRecordRaw[] = [
  {
    path: '/pessoas/treinamentos',
    name: 'pessoas.treinamentos',
    component: () => import('./TreinamentosTela.vue'),
    meta: { permissao: 'pessoas.treinamento.ler' },
  },
  {
    path: '/pessoas/meu',
    name: 'pessoas.meu',
    component: () => import('./MeuEspacoTela.vue'),
    meta: { permissao: 'pessoas.autoatendimento.ler' },
  },
  {
    path: '/pessoas/escala/realizado',
    name: 'pessoas.realizado',
    component: () => import('./RealizadoTela.vue'),
    meta: { permissao: 'pessoas.realizado.ler' },
  },
  // W0-06, parte 6d-2: a fila das solicitações do autoatendimento (aprovar ou recusar com motivo; atestado restrito).
  {
    path: '/pessoas/solicitacoes',
    name: 'pessoas.solicitacoes',
    component: () => import('../autoatendimento/FilaSolicitacoesTela.vue'),
    meta: { permissao: 'pessoas.autoatendimento.aprovar' },
  },
];
