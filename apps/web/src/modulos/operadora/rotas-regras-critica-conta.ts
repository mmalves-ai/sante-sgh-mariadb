// Rota das regras de crítica das contas recebidas (08-SGO L105, C1-100): as regras próprias da operadora aplicadas no
// recebimento do lote (sair de uso, nunca apagar). A rota exige a leitura das contas; o servidor confere de novo, e a
// gravação pede operadora.conta.analisar.
import type { RouteRecordRaw } from 'vue-router';

export const rotasRegrasCriticaConta: RouteRecordRaw[] = [
  {
    path: '/operadora/regras-critica-conta',
    name: 'operadora.regras-critica-conta',
    component: () => import('./telas/RegrasCriticaContaTela.vue'),
    meta: { permissao: 'operadora.conta.ler' },
  },
];
