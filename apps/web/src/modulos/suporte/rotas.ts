// Rotas da conta da plataforma (ADR 0021). São públicas para a guarda das sessões do SPDATA: cada tela confere
// a sessão PRÓPRIA da conta da plataforma (GET /api/plataforma/eu) e o servidor confere de novo em cada rota.
import type { RouteRecordRaw } from 'vue-router';

export const rotasSuporte: RouteRecordRaw[] = [
  {
    // Uma entrada só: a conta da plataforma (e-mail, com o segundo fator) e o administrador da plataforma
    // (POST /api/sessao/plataforma) entram pela tela principal; o endereço antigo leva a ela.
    path: '/plataforma/entrar',
    name: 'plataforma.entrar',
    redirect: '/entrar',
    meta: { publica: true },
  },
  {
    path: '/plataforma',
    name: 'plataforma',
    component: () => import('./telas/PlataformaInicioTela.vue'),
    meta: { publica: true },
  },
  {
    path: '/plataforma/suporte',
    name: 'plataforma.suporte',
    component: () => import('./telas/SuporteTecnicoTela.vue'),
    meta: { publica: true },
  },
  {
    path: '/plataforma/convite',
    name: 'plataforma.convite',
    component: () => import('./telas/ConviteTela.vue'),
    meta: { publica: true },
  },
];
