// Rotas da notificação de incidentes (M48, etapa 1) e da análise, plano, vigilância de produto e painel (etapa 2; ficha,
// seção 7). Toda rota declara meta.permissao; o servidor é
// quem decide (as gravações recusam também com a funcionalidade desligada). O diálogo global fica na casca.
import { PERMISSOES_QUALIDADE as P } from '@sgh/contratos';
import type { RouteRecordRaw } from 'vue-router';

export const rotasQualidade: RouteRecordRaw[] = [
  {
    path: '/qualidade/notificar',
    name: 'qualidade.notificar',
    component: () => import('./telas/NotificarTela.vue'),
    meta: { permissao: P.notificacaoCriar },
  },
  {
    path: '/qualidade/nsp/notificacoes',
    name: 'qualidade.nsp.notificacoes',
    component: () => import('./telas/NotificacoesTela.vue'),
    meta: { permissao: P.notificacaoLer },
  },
  {
    path: '/qualidade/nsp/notificacoes/:id(\\d+)',
    name: 'qualidade.nsp.notificacao',
    component: () => import('./telas/NotificacaoDetalheTela.vue'),
    props: true,
    meta: { permissao: P.notificacaoLer },
  },
  {
    path: '/qualidade/nsp/prazos',
    name: 'qualidade.nsp.prazos',
    component: () => import('./telas/PrazosNotivisaTela.vue'),
    meta: { permissao: P.notivisaExportar },
  },
  // Etapa 2: análise e plano 5W2H, minhas ações, vigilância de produto e o painel do plano de segurança.
  {
    path: '/qualidade/nsp/analises',
    name: 'qualidade.nsp.analises',
    component: () => import('./telas/AnalisesTela.vue'),
    meta: { permissao: P.analiseLer },
  },
  {
    path: '/qualidade/nsp/analises/:id(\\d+)',
    name: 'qualidade.nsp.analise',
    component: () => import('./telas/AnaliseTela.vue'),
    props: true,
    meta: { permissao: P.analiseLer },
  },
  {
    path: '/qualidade/acoes',
    name: 'qualidade.acoes',
    component: () => import('./telas/MinhasAcoesTela.vue'),
    meta: { permissao: P.notificacaoCriar },
  },
  {
    path: '/qualidade/nsp/protocolos',
    name: 'qualidade.nsp.protocolos',
    component: () => import('./telas/PainelSegurancaTela.vue'),
    meta: { permissao: P.protocoloLer },
  },
  {
    path: '/qualidade/nsp/tecnovigilancia',
    name: 'qualidade.nsp.tecnovigilancia',
    component: () => import('./telas/TecnovigilanciaTela.vue'),
    meta: { permissao: P.tecnovigilanciaLer },
  },
  {
    path: '/qualidade/nsp/tecnovigilancia/:id(\\d+)',
    name: 'qualidade.nsp.tecnovigilancia.registro',
    component: () => import('./telas/TecnovigilanciaDetalheTela.vue'),
    props: true,
    meta: { permissao: P.tecnovigilanciaLer },
  },
];
