// Rotas da página inicial por perfil e das telas do M27 (ficha, seção 7). Toda rota declara meta.permissao; o servidor
// é quem decide (as filas recusam também com a funcionalidade desligada no estabelecimento).
import { PERMISSOES_ACESSO, PERMISSOES_INICIO } from '@sgh/contratos';
import type { RouteRecordRaw } from 'vue-router';

export const rotasInicio: RouteRecordRaw[] = [
  {
    path: '/inicio',
    name: 'inicio',
    component: () => import('./telas/InicioTela.vue'),
    meta: { permissao: PERMISSOES_ACESSO.inicioLer },
    // 01-ADM L84: na primeira abertura, as preferências da conta são aplicadas e a tela inicial escolhida abre.
    beforeEnter: async () => {
      const { destinoInicialDaConta } = await import('../../casca/preferencias/preferencias-servidor.js');
      const { usarPreferencias } = await import('../../casca/preferencias/preferencias.js');
      const destino = await destinoInicialDaConta((p) => usarPreferencias().substituir(p));
      return destino ?? true;
    },
  },
  {
    path: '/inicio/medico',
    name: 'inicio.medico',
    component: () => import('./telas/WorklistMedicoTela.vue'),
    meta: { permissao: PERMISSOES_INICIO.worklistMedicoLer },
  },
  {
    path: '/inicio/recepcao',
    name: 'inicio.recepcao',
    component: () => import('./telas/WorklistRecepcaoTela.vue'),
    meta: { permissao: PERMISSOES_INICIO.worklistRecepcaoLer },
  },
  {
    // 01-ADM L114: o editor da página inicial por perfil (blocos, ordem e perfis).
    path: '/admin/pagina-inicial',
    name: 'inicio.paginaInicial',
    component: () => import('./telas/PaginaInicialModelosTela.vue'),
    meta: { permissao: 'relatorio.paginaInicial.ler' },
  },
  {
    path: '/mensagens',
    name: 'mensagens',
    component: () => import('./telas/MensagensTela.vue'),
    meta: { permissao: PERMISSOES_INICIO.mensagemLer },
  },
  {
    path: '/preferencias/dicionario',
    name: 'preferencias.dicionario',
    component: () => import('./telas/DicionarioTela.vue'),
    meta: { permissao: PERMISSOES_INICIO.dicionarioLer },
  },
];
