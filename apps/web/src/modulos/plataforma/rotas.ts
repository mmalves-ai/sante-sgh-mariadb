// Rotas do painel de onboarding de clientes (F4 L3). A permissão declarada é a da rota da API; quem decide é o
// servidor, que só atende o administrador da plataforma (o usuário de um cliente recebe 403).
import type { RouteRecordRaw } from 'vue-router';

export const PERMISSAO_ONBOARDING = 'config.conexao.ler';

export const rotasPlataformaOnboarding: RouteRecordRaw[] = [
  {
    path: '/plataforma/clientes',
    name: 'plataforma.clientes',
    component: () => import('./telas/ClientesPlataformaTela.vue'),
    meta: { permissao: PERMISSAO_ONBOARDING },
  },
  // Carga e sincronismo (obra carga-painel, ADR 0010): mesma permissão declarada da API (`config.conexao.ler`,
  // técnica); o servidor só atende o administrador da plataforma.
  {
    path: '/plataforma/carga',
    name: 'plataforma.carga',
    component: () => import('./telas/CargaSincronismoTela.vue'),
    meta: { permissao: PERMISSAO_ONBOARDING },
  },
];
