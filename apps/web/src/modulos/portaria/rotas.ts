// Rotas da portaria e dos visitantes (M50, etapa 5; ficha, seção 7): a portaria, as regras e os bloqueios, o bloqueio
// clínico da enfermagem, o relatório de contatos, os acompanhantes com direito legal e os terminais. Cada rota exige a permissão de leitura do
// catálogo (M06); o servidor confere de novo e recusa com o motivo quando a liberação está desligada.
import type { RouteRecordRaw } from 'vue-router';

export const rotasPortaria: RouteRecordRaw[] = [
  {
    path: '/portaria',
    name: 'portaria.portaria',
    component: () => import('./telas/PortariaTela.vue'),
    meta: { permissao: 'hotelaria.visita.ler' },
  },
  {
    path: '/portaria/regras',
    name: 'portaria.regras',
    component: () => import('./telas/RegrasTela.vue'),
    meta: { permissao: 'hotelaria.visita.regrar' },
  },
  {
    path: '/portaria/bloqueio-clinico',
    name: 'portaria.bloqueioClinico',
    component: () => import('./telas/BloqueioClinicoTela.vue'),
    meta: { permissao: 'hotelaria.visita.bloquearClinico' },
  },
  {
    path: '/portaria/contatos',
    name: 'portaria.contatos',
    component: () => import('./telas/ContatosTela.vue'),
    meta: { permissao: 'hotelaria.visita.contatos' },
  },
  {
    path: '/portaria/acompanhantes',
    name: 'portaria.acompanhantes',
    component: () => import('./telas/AcompanhantesTela.vue'),
    meta: { permissao: 'hotelaria.acompanhante.registrar' },
  },
  {
    path: '/portaria/terminais',
    name: 'portaria.terminais',
    component: () => import('./telas/TerminaisTela.vue'),
    meta: { permissao: 'hotelaria.terminal.ler' },
  },
];
