// Rotas da CCIH (M48, etapa 3; ficha, seção 7). Toda rota declara meta.permissao; o servidor é quem decide (as gravações
// recusam também com a funcionalidade desligada).
import { PERMISSOES_CCIH as P } from '@sgh/contratos';
import type { RouteRecordRaw } from 'vue-router';

export const rotasCcih: RouteRecordRaw[] = [
  {
    path: '/qualidade/ccih/vigilancia',
    name: 'qualidade.ccih.vigilancia',
    component: () => import('./telas/VigilanciaTela.vue'),
    meta: { permissao: P.ccihLer },
  },
  {
    path: '/qualidade/ccih/iras',
    name: 'qualidade.ccih.iras',
    component: () => import('./telas/IrasTela.vue'),
    meta: { permissao: P.irasLer },
  },
  {
    path: '/qualidade/ccih/antimicrobianos',
    name: 'qualidade.ccih.antimicrobianos',
    component: () => import('./telas/AntimicrobianosTela.vue'),
    meta: { permissao: P.antimicrobianoLer },
  },
  {
    path: '/qualidade/ccih/precaucoes',
    name: 'qualidade.ccih.precaucoes',
    component: () => import('./telas/PrecaucoesTela.vue'),
    meta: { permissao: P.precaucaoLer },
  },
  {
    path: '/qualidade/ccih/culturas',
    name: 'qualidade.ccih.culturas',
    component: () => import('./telas/CulturasTela.vue'),
    meta: { permissao: P.irasLer },
  },
  {
    path: '/qualidade/ccih/maos-surtos',
    name: 'qualidade.ccih.maos-surtos',
    component: () => import('./telas/MaosSurtosTela.vue'),
    meta: { permissao: P.ccihRegistrar },
  },
];
