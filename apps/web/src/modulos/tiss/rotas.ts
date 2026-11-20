// Rotas do pós-fechamento (M31; ficha, seção 7). Cada rota exige a permissão de leitura do catálogo (M06); o servidor
// confere de novo (e o escopo por convênio) e as ações aparecem só com a permissão de agir e a funcionalidade liberada.
import type { RouteRecordRaw } from 'vue-router';

export const rotasTiss: RouteRecordRaw[] = [
  {
    path: '/faturamento/guias',
    name: 'tiss.guias',
    component: () => import('./telas/GuiasTela.vue'),
    meta: { permissao: 'faturamento.guia.ler' },
  },
  {
    path: '/faturamento/lotes',
    name: 'tiss.lotes',
    component: () => import('./telas/LotesTela.vue'),
    meta: { permissao: 'faturamento.lote.ler' },
  },
  {
    path: '/faturamento/lotes/:id(\\d+)',
    name: 'tiss.lote',
    component: () => import('./telas/LoteTela.vue'),
    props: true,
    meta: { permissao: 'faturamento.lote.ler' },
  },
  {
    path: '/faturamento/lotes/:id(\\d+)/protocolo',
    name: 'tiss.protocolo',
    component: () => import('./telas/ProtocoloTela.vue'),
    props: true,
    meta: { permissao: 'faturamento.protocolo.registrar' },
  },
  {
    path: '/faturamento/prazos',
    name: 'tiss.prazos',
    component: () => import('./telas/PrazosTela.vue'),
    meta: { permissao: 'faturamento.lote.ler' },
  },
  {
    path: '/integracao/tiss',
    name: 'tiss.webservices',
    component: () => import('./telas/WebservicesTela.vue'),
    meta: { permissao: 'integracao.tiss.ler' },
  },
  {
    path: '/faturamento/competencias',
    name: 'tiss.competencias',
    component: () => import('./telas/CompetenciasTela.vue'),
    meta: { permissao: 'faturamento.competencia.ler' },
  },
  {
    path: '/faturamento/demonstrativos',
    name: 'tiss.demonstrativos',
    component: () => import('./telas/DemonstrativosTela.vue'),
    meta: { permissao: 'faturamento.demonstrativo.ler' },
  },
  {
    path: '/faturamento/glosas',
    name: 'tiss.glosas',
    component: () => import('./telas/GlosasTela.vue'),
    meta: { permissao: 'faturamento.glosa.ler' },
  },
  {
    path: '/relatorios/glosas',
    name: 'tiss.painel',
    component: () => import('./telas/PainelGlosasTela.vue'),
    meta: { permissao: 'relatorio.glosa.ler' },
  },
];
