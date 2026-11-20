// Rotas do M16 (ficha, seção 7): painel de leitos ao vivo, divergência de cadastro de leitos, censo diário, painéis
// gerenciais, indicadores hospitalares e o BI. Cada rota exige a permissão de leitura do catálogo (M06); o servidor
// confere de novo e recusa com o motivo quando a chave de liberação do estabelecimento está desligada.
import type { RouteRecordRaw } from 'vue-router';

export const rotasInternacao: RouteRecordRaw[] = [
  {
    path: '/internacao/leitos/painel',
    name: 'internacao.leitos.painel',
    component: () => import('./telas/PainelLeitosTela.vue'),
    meta: {
      permissao: 'internacao.leitos.ler',
      menu: 'Internação e leitos > Leitos > Painel de leitos ao vivo',
    },
  },
  {
    path: '/internacao/leitos/divergencias',
    name: 'internacao.leitos.divergencias',
    component: () => import('./telas/DivergenciasLeitosTela.vue'),
    meta: { permissao: 'internacao.leitos.ler' },
  },
  {
    path: '/internacao/censo',
    name: 'internacao.censo',
    component: () => import('./telas/CensoTela.vue'),
    meta: {
      permissao: 'internacao.censo.ler',
      menu: 'Internação e leitos > Leitos > Censo hospitalar diário',
    },
  },
  {
    path: '/relatorios/paineis',
    redirect: '/relatorios/paineis/assistencial',
  },
  {
    path: '/relatorios/paineis/:painel(assistencial|operacional|financeiro)',
    name: 'relatorio.paineis',
    component: () => import('./telas/PaineisTela.vue'),
    props: true,
    meta: { permissao: 'relatorio.paineis.ler', menu: 'Relatórios e BI > Painéis gerenciais' },
  },
  {
    path: '/relatorios/indicadores',
    name: 'relatorio.indicadores',
    component: () => import('./telas/IndicadoresTela.vue'),
    meta: { permissao: 'relatorio.indicadores.ler', menu: 'Relatórios e BI > Indicadores hospitalares' },
  },
  {
    path: '/relatorios/indicadores/:indicador([a-zA-Z0-9]+)',
    name: 'relatorio.indicador',
    component: () => import('./telas/IndicadorTela.vue'),
    props: true,
    meta: { permissao: 'relatorio.indicadores.ler' },
  },
  {
    path: '/relatorios/bi',
    name: 'relatorio.bi',
    component: () => import('./telas/BiTela.vue'),
    meta: { permissao: 'relatorio.bi.acessar' },
  },
];
