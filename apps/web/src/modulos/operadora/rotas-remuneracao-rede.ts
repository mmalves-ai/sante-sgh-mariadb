// Rota da remuneração e do pagamento do prestador da rede (08-SGO L102, C2-120): tabela negociada, regra de valoração,
// reajuste do contrato, calendário, lote com tributos e adiantamento com título no contas a pagar. A rota exige a
// permissão de leitura; o servidor confere de novo, e a gravação pede operadora.prestador.editar ou operadora.conta.pagar.
import type { RouteRecordRaw } from 'vue-router';

export const rotasRemuneracaoRede: RouteRecordRaw[] = [
  {
    path: '/operadora/remuneracao-rede',
    name: 'operadora.remuneracao-rede',
    component: () => import('./telas/RemuneracaoRedeTela.vue'),
    meta: { permissao: 'operadora.prestador.ler' },
  },
];
