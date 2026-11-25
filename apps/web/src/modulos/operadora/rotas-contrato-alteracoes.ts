// 08-SGO L94 (C2-108): aditivos e cancelamento do contrato de plano (os planos ofertados, a troca e o preço por aditivo,
// a efetivação com a baixa dos beneficiários e o crédito ao contratante).
import type { RouteRecordRaw } from 'vue-router';

export const rotasContratoAlteracoes: RouteRecordRaw[] = [
  {
    path: '/operadora/contratos',
    name: 'operadora.contratos',
    component: () => import('./telas/ContratoAlteracoesTela.vue'),
    meta: { permissao: 'operadora.beneficiario.ler' },
  },
];
