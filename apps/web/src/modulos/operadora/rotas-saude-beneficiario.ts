// Rota da declaração de saúde, da doença preexistente com a CPT e da portabilidade de carências do beneficiário
// (08-SGO L95, C2-113; RN ANS 162 e 438). A rota exige a permissão de leitura; o servidor confere de novo.
import type { RouteRecordRaw } from 'vue-router';

export const rotasSaudeBeneficiario: RouteRecordRaw[] = [
  {
    path: '/operadora/beneficiarios/saude',
    name: 'operadora.beneficiarios-saude',
    component: () => import('./telas/SaudeBeneficiarioTela.vue'),
    meta: { permissao: 'operadora.beneficiario.ler' },
  },
];
