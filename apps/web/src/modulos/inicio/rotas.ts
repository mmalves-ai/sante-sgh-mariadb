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
