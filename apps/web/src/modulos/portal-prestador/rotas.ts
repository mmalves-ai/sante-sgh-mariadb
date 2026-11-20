// Rotas do portal do prestador credenciado da operadora própria (M56, etapa 8, F7; ficha, seção 7: "portal externo, BFF
// próprio"). Ficam fora da casca e da sessão interna (meta pública e de dispositivo, como os demais portais): a sessão
// é a do portal do prestador (cookie HttpOnly próprio), conferida pelo servidor em cada pedido, que também confere as
// funções liberadas pelo credenciamento. A tela interna das contas é a `/operadora/portal-prestador`.
import type { RouteRecordRaw } from 'vue-router';

export const rotasPortalPrestador: RouteRecordRaw[] = [
  {
    path: '/prestador/entrar',
    name: 'portal.prestador.entrar',
    component: () => import('./telas/PortalPrestadorEntrarTela.vue'),
    meta: { publica: true, dispositivo: true },
  },
  {
    path: '/prestador/pedidos',
    name: 'portal.prestador.pedidos',
    component: () => import('./telas/PortalPrestadorPedidosTela.vue'),
    meta: { publica: true, dispositivo: true },
  },
  {
    path: '/prestador/protocolo',
    name: 'portal.prestador.protocolo',
    component: () => import('./telas/PortalPrestadorProtocoloTela.vue'),
    meta: { publica: true, dispositivo: true },
  },
  {
    path: '/prestador/elegibilidade',
    name: 'portal.prestador.elegibilidade',
    component: () => import('./telas/PortalPrestadorElegibilidadeTela.vue'),
    meta: { publica: true, dispositivo: true },
  },
  {
    path: '/prestador/contas',
    name: 'portal.prestador.contas',
    component: () => import('./telas/PortalPrestadorContasTela.vue'),
    meta: { publica: true, dispositivo: true },
  },
  {
    path: '/prestador/conta',
    name: 'portal.prestador.conta',
    component: () => import('./telas/PortalPrestadorContaTela.vue'),
    meta: { publica: true, dispositivo: true },
  },
];
