// 08-SGO L114 (C3-027): a gestão dos portais externos pela operadora e o portal do beneficiário, da contratante e do
// corretor (para quem tem a conta ativa no portal).
import type { RouteRecordRaw } from 'vue-router';

export const rotasPortaisOperadora: RouteRecordRaw[] = [
  {
    path: '/operadora/portais',
    name: 'operadora.portais',
    component: () => import('./telas/PortaisOperadoraTela.vue'),
    meta: { permissao: 'operadora.beneficiario.ler' },
  },
  {
    path: '/portal-operadora/:portal(beneficiario|contratante|corretor)',
    name: 'portal-operadora',
    component: () => import('./telas/PortalExternoOperadoraTela.vue'),
    meta: { permissao: 'operadora.portal.acessar' },
  },
];
