// Rotas da rouparia e lavanderia (M55, fatia F2; ficha, seção 7). Toda rota declara meta.permissao; o servidor é quem
// decide (as gravações recusam também com a funcionalidade desligada). O item do menu abre o painel do dia; as outras
// partes ficam na barra da própria tela.
import { PERMISSOES_ROUPARIA_CODIGOS as P } from '@sgh/contratos';
import type { RouteRecordRaw } from 'vue-router';

export const rotasRouparia: RouteRecordRaw[] = [
  {
    path: '/hotelaria/rouparia',
    name: 'rouparia.painel',
    component: () => import('./telas/RoupariaTela.vue'),
    meta: { permissao: P.ler },
  },
  {
    path: '/hotelaria/rouparia/movimentos',
    name: 'rouparia.movimentos',
    component: () => import('./telas/MovimentosRoupaTela.vue'),
    meta: { permissao: P.ler },
  },
  {
    path: '/hotelaria/rouparia/enxoval',
    name: 'rouparia.enxoval',
    component: () => import('./telas/EnxovalRoupaTela.vue'),
    meta: { permissao: P.ler },
  },
  {
    path: '/hotelaria/rouparia/cotas',
    name: 'rouparia.cotas',
    component: () => import('./telas/CotasRoupaTela.vue'),
    meta: { permissao: P.ler },
  },
  {
    path: '/hotelaria/rouparia/indicadores',
    name: 'rouparia.indicadores',
    component: () => import('./telas/IndicadoresRoupaTela.vue'),
    meta: { permissao: P.ler },
  },
  {
    path: '/m/rouparia',
    name: 'rouparia.celular',
    component: () => import('./telas/AppRoupariaTela.vue'),
    meta: { permissao: P.registrar },
  },
];
