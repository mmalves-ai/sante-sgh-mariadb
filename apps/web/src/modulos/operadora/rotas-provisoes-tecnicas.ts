// 08-SGO L111 (C3-026): contabilidade regulatória da operadora (plano de contas padrão da ANS, mapa das contas,
// balancete no padrão da ANS e provisões técnicas).
import type { RouteRecordRaw } from 'vue-router';

export const rotasProvisoesTecnicas: RouteRecordRaw[] = [
  {
    path: '/operadora/ans/provisoes-tecnicas',
    name: 'operadora.ans.provisoes-tecnicas',
    component: () => import('./telas/ProvisoesTecnicasTela.vue'),
    meta: { permissao: 'operadora.provisaoTecnica.ler' },
  },
];
