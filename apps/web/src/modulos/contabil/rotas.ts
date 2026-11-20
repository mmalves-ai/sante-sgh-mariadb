// Rotas da contabilidade, etapa 1 (M54.1; ficha, seção 7): o plano de contas com as regras de contabilização e os
// problemas do plano (`contabil.plano.ler`; editar e publicar pedem as suas permissões) e os lançamentos automáticos dos
// módulos e razão (M54.2: `contabil.lancamento.ler`, a da ficha; a aba dos fatos lidos pede também `contabil.fato.ler`).
// O servidor confere de novo cada leitura.
import type { RouteRecordRaw } from 'vue-router';

export const rotasContabil: RouteRecordRaw[] = [
  {
    path: '/contabil/plano',
    name: 'contabil.plano',
    component: () => import('./PlanoContasTela.vue'),
    meta: { permissao: 'contabil.plano.ler' },
  },
  {
    path: '/contabil/lancamentos',
    name: 'contabil.lancamentos',
    component: () => import('./LancamentosTela.vue'),
    meta: { permissao: 'contabil.lancamento.ler' },
  },
  // M54.3 (etapa F3): as demonstrações (balancete, diário, DRE, balanço e a apuração do resultado) e o SPED contábil.
  {
    path: '/contabil/demonstracoes',
    name: 'contabil.demonstracoes',
    component: () => import('./DemonstracoesTela.vue'),
    meta: { permissao: 'contabil.demonstracao.ler' },
  },
  {
    path: '/contabil/sped',
    name: 'contabil.sped',
    component: () => import('./SpedTela.vue'),
    meta: { permissao: 'contabil.sped.ler' },
  },
];
