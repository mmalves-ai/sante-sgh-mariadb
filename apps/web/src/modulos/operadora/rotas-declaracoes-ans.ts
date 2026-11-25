// 08-SGO L110 (C1-036): as declarações periódicas da operadora (TPS apurada, conferência cadastral da base da ANS e
// DMED à Receita).
import type { RouteRecordRaw } from 'vue-router';

export const rotasDeclaracoesAns: RouteRecordRaw[] = [
  {
    path: '/operadora/ans/declaracoes',
    name: 'operadora.ans.declaracoes',
    component: () => import('./telas/DeclaracoesAnsTela.vue'),
    meta: { permissao: 'operadora.ans.ler' },
  },
];
