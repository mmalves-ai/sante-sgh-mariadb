// Rotas do repasse médico (M33; ficha, seção 7). Cada rota exige a permissão de leitura do catálogo (M06); o servidor
// confere de novo e as ações aparecem só com a permissão de agir e a funcionalidade liberada no estabelecimento. A
// integração contábil, as configurações e as cooperativas são o CRUD genérico dos subitens do repasse.
import type { RouteRecordRaw } from 'vue-router';

export const rotasRepasse: RouteRecordRaw[] = [
  {
    path: '/repasse/regras',
    name: 'repasse.regras',
    component: () => import('./telas/RegrasTela.vue'),
    meta: { permissao: 'repasse.regra.ler' },
  },
  {
    path: '/repasse/apuracao',
    name: 'repasse.apuracao',
    component: () => import('./telas/ApuracaoTela.vue'),
    meta: { permissao: 'repasse.apuracao.ler' },
  },
  {
    path: '/repasse/apuracao/:apuracao(\\d+)/:beneficiario(\\d+)',
    name: 'repasse.demonstrativo',
    component: () => import('./telas/DemonstrativoTela.vue'),
    props: true,
    meta: { permissao: 'repasse.apuracao.ler' },
  },
  {
    path: '/repasse/lancamentos',
    name: 'repasse.lancamentos',
    component: () => import('./telas/LancamentosTela.vue'),
    meta: { permissao: 'repasse.lancamento.ler' },
  },
  {
    path: '/repasse/rpa',
    name: 'repasse.rpa',
    component: () => import('./telas/RpaTela.vue'),
    meta: { permissao: 'repasse.rpa.ler' },
  },
  {
    path: '/repasse/meu-extrato',
    name: 'repasse.extrato',
    component: () => import('./telas/MeuExtratoTela.vue'),
    meta: { permissao: 'repasse.extrato.ler' },
  },
  {
    path: '/repasse/favorecidos',
    name: 'repasse.favorecidos',
    component: () => import('./telas/FavorecidosTela.vue'),
    meta: { permissao: 'repasse.cooperativa.ler' },
  },
  { path: '/repasse/integracao-contabil', redirect: '/cadastros/dominios/grupo/repasseIntegracao' },
  { path: '/repasse/configuracoes', redirect: '/cadastros/dominios/grupo/repasseConfiguracoes' },
  { path: '/repasse/cooperativas', redirect: '/cadastros/dominios/grupo/repasseCooperativas' },
];
