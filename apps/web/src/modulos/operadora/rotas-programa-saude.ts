// Rota da promoção da saúde e gestão de crônicos da operadora (08-SGO L115, C2-102; RN ANS 264 e 265/2011), aberta pelo
// atalho da tela de beneficiários. A rota exige a permissão de leitura; o servidor confere de novo.
import type { RouteRecordRaw } from 'vue-router';

export const rotasProgramaSaude: RouteRecordRaw[] = [
  {
    path: '/operadora/programas-saude',
    name: 'operadora.programas-saude',
    component: () => import('./telas/ProgramasSaudeTela.vue'),
    meta: { permissao: 'operadora.promocao.ler' },
  },
];
