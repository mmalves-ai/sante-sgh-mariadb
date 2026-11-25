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
  // Carga e sincronismo (obra carga-painel, ADR 0010): atende a conta da plataforma (ADR 0021, papel plataforma) e o
  // administrador da plataforma. Pública para a guarda das sessões do hospital, como as telas da conta da plataforma:
  // a tela confere a sessão (sem nenhuma, vai ao login) e o servidor confere de novo em cada rota. A permissão
  // declarada (a da API, técnica) fica para o menu do painel técnico.
  {
    path: '/plataforma/carga',
    name: 'plataforma.carga',
    component: () => import('./telas/CargaSincronismoTela.vue'),
    meta: { publica: true, permissao: PERMISSAO_ONBOARDING },
  },
];
