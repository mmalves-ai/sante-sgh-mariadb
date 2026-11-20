// Rotas da farmácia hospitalar e da farmácia clínica (M29; ficha, seção 7). Cada rota exige a permissão de leitura do
// catálogo (M06); o servidor confere de novo e as ações aparecem só com a permissão de agir e a operação liberada.
import type { RouteRecordRaw } from 'vue-router';

export const rotasFarmacia: RouteRecordRaw[] = [
  {
    path: '/farmacia/dispensacao',
    name: 'farmacia.dispensacao',
    component: () => import('./telas/DispensacaoTela.vue'),
    meta: { permissao: 'suprimentos.dispensacao.ler' },
  },
  {
    path: '/farmacia/devolucoes',
    name: 'farmacia.devolucoes',
    component: () => import('./telas/DevolucoesDoseTela.vue'),
    meta: { permissao: 'suprimentos.devolucao.ler' },
  },
  {
    path: '/farmacia/parametros',
    name: 'farmacia.parametros',
    component: () => import('./telas/ParametrosIntegracaoTela.vue'),
    meta: { permissao: 'config.parametro.ler' },
  },
  {
    path: '/farmacia/entregas',
    name: 'farmacia.entregas',
    component: () => import('./telas/EntregasTela.vue'),
    meta: { permissao: 'suprimentos.entrega.ler' },
  },
  {
    path: '/farmacia/controlados',
    name: 'farmacia.controlados',
    component: () => import('./telas/ControladosTela.vue'),
    meta: { permissao: 'suprimentos.controlado.ler' },
  },
  {
    path: '/farmacia/livro',
    name: 'farmacia.livro',
    component: () => import('./telas/LivroTela.vue'),
    meta: { permissao: 'suprimentos.livro.ler' },
  },
  {
    path: '/farmacia/avaliacao',
    name: 'farmacia.avaliacao',
    component: () => import('./telas/AvaliacaoTela.vue'),
    meta: { permissao: 'suprimentos.avaliacao.ler' },
  },
  {
    path: '/farmacia/avaliacao/tipos',
    name: 'farmacia.avaliacao.tipos',
    component: () => import('./telas/TiposEnvioTela.vue'),
    meta: { permissao: 'config.parametro.ler' },
  },
  {
    path: '/farmacia/intervencoes',
    name: 'farmacia.intervencoes',
    component: () => import('./telas/IntervencoesTela.vue'),
    meta: { permissao: 'suprimentos.intervencao.responder' },
  },
  {
    path: '/farmacia/ambulatorial',
    name: 'farmacia.ambulatorial',
    component: () => import('./telas/AmbulatorialTela.vue'),
    meta: { permissao: 'suprimentos.ambulatorial.ler' },
  },
  {
    path: '/inicio/farmacia',
    name: 'inicio.farmacia',
    component: () => import('./telas/WorklistFarmaciaTela.vue'),
    meta: { permissao: 'suprimentos.avaliacao.ler' },
  },
];
