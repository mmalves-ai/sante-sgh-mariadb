// Rotas da gestão da qualidade (ONA) e dos envios regulatórios (M48, etapa 5; ficha, seção 7). Toda rota declara
// meta.permissao; o servidor é quem decide (as gravações recusam também com a funcionalidade desligada).
import { PERMISSOES_GESTAO_QUALIDADE as P, PERMISSOES_QUALIDADE as Q } from '@sgh/contratos';
import type { RouteRecordRaw } from 'vue-router';

export const rotasGestaoQualidade: RouteRecordRaw[] = [
  {
    path: '/qualidade/documentos',
    name: 'qualidade.documentos',
    component: () => import('./telas/DocumentosTela.vue'),
    meta: { permissao: P.documentoLer },
  },
  {
    path: '/qualidade/indicadores',
    name: 'qualidade.indicadores',
    component: () => import('./telas/IndicadoresTela.vue'),
    meta: { permissao: P.indicadorLer },
  },
  {
    path: '/qualidade/gestao/auditorias',
    name: 'qualidade.gestao.auditorias',
    component: () => import('./telas/AuditoriasTela.vue'),
    meta: { permissao: P.gestaoLer },
  },
  {
    path: '/qualidade/gestao/comissoes',
    name: 'qualidade.gestao.comissoes',
    component: () => import('./telas/ComissoesTela.vue'),
    meta: { permissao: P.gestaoLer },
  },
  {
    path: '/qualidade/gestao/riscos',
    name: 'qualidade.gestao.riscos',
    component: () => import('./telas/RiscosTela.vue'),
    meta: { permissao: P.gestaoLer },
  },
  {
    path: '/qualidade/gestao/estrategia',
    name: 'qualidade.gestao.estrategia',
    component: () => import('./telas/EstrategiaTela.vue'),
    meta: { permissao: P.gestaoLer },
  },
  {
    path: '/qualidade/ouvidoria',
    name: 'qualidade.ouvidoria',
    component: () => import('./telas/OuvidoriaTela.vue'),
    meta: { permissao: P.ouvidoriaLer },
  },
  // W0-04 (M5): a comissão de revisão de prontuários e as pendências do profissional.
  {
    path: '/qualidade/gestao/revisao-prontuarios',
    name: 'qualidade.gestao.revisao-prontuarios',
    component: () => import('./telas/RevisaoProntuariosTela.vue'),
    meta: { permissao: Q.revisaoProntuarioLer },
  },
  {
    path: '/qualidade/revisao-prontuarios/minhas-pendencias',
    name: 'qualidade.revisao-prontuarios.minhas-pendencias',
    component: () => import('./telas/MinhasPendenciasProntuarioTela.vue'),
    meta: { permissao: Q.revisaoPendenciaResponder },
  },
  {
    path: '/relatorios/envios-regulatorios',
    name: 'relatorios.envios-regulatorios',
    component: () => import('./telas/EnviosRegulatoriosTela.vue'),
    meta: { permissao: P.envioGerar },
  },
];
