// Rotas do financeiro e fiscal (M32; ficha, seção 7). Cada rota exige a permissão de leitura do catálogo (M06); o
// servidor confere de novo (e o escopo de contas bancárias) e as ações aparecem só com a permissão de agir e a
// funcionalidade liberada no estabelecimento. Os cadastros financeiros, os parâmetros e as naturezas de operação são o
// CRUD genérico dos subitens do M32 (`/cadastros/financeiro/*` leva a eles).
import type { RouteRecordRaw } from 'vue-router';

export const rotasFinanceiro: RouteRecordRaw[] = [
  {
    path: '/financeiro/pagar/titulos',
    name: 'financeiro.pagar.titulos',
    component: () => import('./telas/TitulosPagarTela.vue'),
    meta: { permissao: 'financeiro.tituloPagar.ler' },
  },
  {
    path: '/financeiro/pagar/titulos/:id(\\d+)',
    name: 'financeiro.pagar.titulo',
    component: () => import('./telas/TituloPagarTela.vue'),
    props: true,
    meta: { permissao: 'financeiro.tituloPagar.ler' },
  },
  {
    path: '/financeiro/pagar/aprovacao',
    name: 'financeiro.pagar.aprovacao',
    component: () => import('./telas/AprovacaoTela.vue'),
    meta: { permissao: 'financeiro.tituloPagar.ler' },
  },
  {
    path: '/financeiro/pagar/borderos',
    name: 'financeiro.pagar.borderos',
    component: () => import('./telas/BorderosTela.vue'),
    meta: { permissao: 'financeiro.bordero.ler' },
  },
  {
    path: '/financeiro/pagar/remessas',
    name: 'financeiro.pagar.remessas',
    component: () => import('./telas/RemessasTela.vue'),
    meta: { permissao: 'financeiro.remessa.ler' },
  },
  {
    path: '/financeiro/pagar/adiantamentos',
    name: 'financeiro.pagar.adiantamentos',
    component: () => import('./telas/AdiantamentosTela.vue'),
    meta: { permissao: 'financeiro.adiantamento.ler' },
  },
  {
    path: '/financeiro/receber/titulos',
    name: 'financeiro.receber.titulos',
    component: () => import('./telas/TitulosReceberTela.vue'),
    meta: { permissao: 'financeiro.tituloReceber.ler' },
  },
  {
    path: '/financeiro/receber/titulos/:id(\\d+)',
    name: 'financeiro.receber.titulo',
    component: () => import('./telas/TituloReceberTela.vue'),
    props: true,
    meta: { permissao: 'financeiro.tituloReceber.ler' },
  },
  {
    path: '/financeiro/receber/convenios',
    name: 'financeiro.receber.convenios',
    component: () => import('./telas/ConveniosTela.vue'),
    meta: { permissao: 'financeiro.creditoConvenio.ler' },
  },
  {
    path: '/financeiro/receber/demonstrativos',
    name: 'financeiro.receber.demonstrativos',
    component: () => import('./telas/DemonstrativosReceberTela.vue'),
    meta: { permissao: 'financeiro.tituloReceber.ler' },
  },
  {
    path: '/financeiro/receber/renegociacoes',
    name: 'financeiro.receber.renegociacoes',
    component: () => import('./telas/RenegociacoesTela.vue'),
    meta: { permissao: 'financeiro.tituloReceber.ler' },
  },
  {
    path: '/financeiro/tesouraria/movimento',
    name: 'financeiro.tesouraria.movimento',
    component: () => import('./telas/MovimentoTela.vue'),
    meta: { permissao: 'financeiro.movimento.ler' },
  },
  {
    path: '/financeiro/tesouraria/periodo',
    name: 'financeiro.tesouraria.periodo',
    component: () => import('./telas/PeriodoFinanceiroTela.vue'),
    meta: { permissao: 'financeiro.movimento.ler' },
  },
  {
    path: '/financeiro/tesouraria/conciliacao',
    name: 'financeiro.tesouraria.conciliacao',
    component: () => import('./telas/ConciliacaoTela.vue'),
    meta: { permissao: 'financeiro.conciliacao.ler' },
  },
  {
    path: '/financeiro/tesouraria/fluxo-caixa',
    name: 'financeiro.tesouraria.fluxo',
    component: () => import('./telas/FluxoCaixaTela.vue'),
    meta: { permissao: 'financeiro.fluxoCaixa.ler' },
  },
  {
    path: '/financeiro/gerencial',
    name: 'financeiro.gerencial',
    component: () => import('./telas/GerencialTela.vue'),
    meta: { permissao: 'financeiro.classificacao.ler' },
  },
  {
    path: '/financeiro/parametros',
    name: 'financeiro.parametros',
    component: () => import('./telas/ParametrosTela.vue'),
    meta: { permissao: 'financeiro.parametro.ler' },
  },
  {
    path: '/financeiro/fiscal/entradas',
    name: 'financeiro.fiscal.entradas',
    component: () => import('./telas/EntradasTela.vue'),
    meta: { permissao: 'financeiro.escrituracao.ler' },
  },
  {
    path: '/financeiro/fiscal/nfse',
    name: 'financeiro.fiscal.nfse',
    component: () => import('./telas/NfseTela.vue'),
    meta: { permissao: 'financeiro.nfse.ler' },
  },
  {
    path: '/financeiro/fiscal/dmed',
    name: 'financeiro.fiscal.dmed',
    component: () => import('./telas/DeclaracoesTela.vue'),
    props: { tipo: 'dmed' },
    meta: { permissao: 'financeiro.dmed.ler' },
  },
  {
    path: '/financeiro/fiscal/reinf',
    name: 'financeiro.fiscal.reinf',
    component: () => import('./telas/DeclaracoesTela.vue'),
    props: { tipo: 'reinf' },
    meta: { permissao: 'financeiro.reinf.ler' },
  },
  {
    path: '/financeiro/contabil/exportacao',
    name: 'financeiro.contabil.exportacao',
    component: () => import('./telas/ExportacaoContabilTela.vue'),
    meta: { permissao: 'financeiro.exportacaoContabil.ler' },
  },
  {
    path: '/inicio/financeiro',
    name: 'inicio.financeiro',
    component: () => import('./telas/WorklistFinanceiroTela.vue'),
    // D-MODULO-32: a fila abre para quem tem qualquer opção do financeiro (cada cartão segue a sua permissão).
    meta: { permissao: 'financeiro.modulo.ler' },
  },
  // Os cadastros financeiros e as naturezas de operação (CRUD genérico dos subitens do M32).
  { path: '/cadastros/financeiro', redirect: '/cadastros/dominios/grupo/financeiroCadastros' },
  { path: '/cadastros/financeiro/naturezas', redirect: '/cadastros/dominios/grupo/financeiroNaturezas' },
];
