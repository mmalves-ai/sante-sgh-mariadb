// Rotas da nutrição clínica, do serviço de nutrição e dietética e do serviço social (M45, etapa 5; ficha, seção 7). Toda
// rota declara meta.permissao; o servidor é quem decide (as gravações recusam também com a funcionalidade desligada).
import { PERMISSOES_NUTRICAO_CODIGOS as P } from '@sgh/contratos';
import type { RouteRecordRaw } from 'vue-router';

export const rotasNutricao: RouteRecordRaw[] = [
  {
    path: '/nutricao/triagem',
    name: 'nutricao.triagem',
    component: () => import('./telas/FilaNutricaoTela.vue'),
    meta: { permissao: P.nutricaoLer },
  },
  {
    path: '/nutricao/terapia',
    name: 'nutricao.terapia',
    component: () => import('./telas/TerapiaNutricionalTela.vue'),
    meta: { permissao: P.terapiaLer },
  },
  {
    path: '/nutricao/terapia/:reg(\\d+)',
    name: 'nutricao.terapia.paciente',
    component: () => import('./telas/TerapiaNutricionalTela.vue'),
    meta: { permissao: P.terapiaLer },
  },
  {
    path: '/nutricao/mapa',
    name: 'nutricao.mapa',
    component: () => import('./telas/MapaDietasTela.vue'),
    meta: { permissao: P.mapaLer },
  },
  {
    path: '/nutricao/cardapio',
    name: 'nutricao.cardapio',
    component: () => import('./telas/CardapioTela.vue'),
    meta: { permissao: P.mapaLer },
  },
  {
    path: '/nutricao/composicao',
    name: 'nutricao.composicao',
    component: () => import('./telas/ComposicaoAlimentosTela.vue'),
    meta: { permissao: P.mapaLer },
  },
  {
    path: '/servico-social',
    name: 'servico-social',
    component: () => import('./telas/FilaSocialTela.vue'),
    meta: { permissao: P.socialLer },
  },
  {
    path: '/servico-social/:reg(\\d+)',
    name: 'servico-social.paciente',
    component: () => import('./telas/ServicoSocialTela.vue'),
    meta: { permissao: P.socialLer },
  },
];
