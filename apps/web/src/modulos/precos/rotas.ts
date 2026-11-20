// Rotas do M12 (convênios, contratos, tabelas de preço, importação e motor de preços), com a permissão de
// leitura de cada tela (a API confere de novo; as ações aparecem só com a permissão de agir).
import type { RouteRecordRaw } from 'vue-router';

export const rotasPrecos: RouteRecordRaw[] = [
  {
    path: '/cadastros/convenios',
    name: 'precos.convenios',
    component: () => import('./telas/ConveniosTela.vue'),
    meta: { permissao: 'convenio.operadora.ler' },
  },
  {
    path: '/cadastros/convenios/codigos-prestador',
    name: 'precos.codigos-prestador',
    component: () => import('./telas/MotorTela.vue'),
    props: { consulta: 'codigos' },
    meta: { permissao: 'convenio.codigoPrestador.ler' },
  },
  {
    // Classificações oncológicas de operadora: o CRUD genérico do M08, filtrado pelo subitem.
    path: '/cadastros/convenios/classificacoes-oncologicas',
    name: 'precos.classificacoes-oncologicas',
    component: () => import('../config/telas/DominiosIndiceTela.vue'),
    props: { subitem: 'oncologia' },
    meta: { permissao: 'convenio.dominio.ler' },
  },
  {
    path: '/cadastros/convenios/:cod(\\d+)',
    name: 'precos.contrato',
    component: () => import('./telas/ContratoTela.vue'),
    props: true,
    meta: { permissao: 'convenio.contrato.ler' },
  },
  {
    path: '/precos/honorarios',
    name: 'precos.honorarios',
    component: () => import('./telas/HonorariosTela.vue'),
    meta: { permissao: 'preco.tabela.ler' },
  },
  {
    path: '/precos/diarias-taxas',
    name: 'precos.diarias',
    component: () => import('./telas/TabelaConsultaTela.vue'),
    props: { tipo: 'diarias' },
    meta: { permissao: 'preco.tabela.ler' },
  },
  {
    path: '/precos/matmed',
    name: 'precos.matmed',
    component: () => import('./telas/TabelaConsultaTela.vue'),
    props: { tipo: 'matmed' },
    meta: { permissao: 'preco.tabela.ler' },
  },
  {
    path: '/precos/importacoes',
    name: 'precos.importacoes',
    component: () => import('./telas/ImportacoesTela.vue'),
    meta: { permissao: 'preco.importacao.ler' },
  },
  {
    path: '/precos/consulta',
    name: 'precos.consulta',
    component: () => import('./telas/ConsultaValorTela.vue'),
    meta: { permissao: 'preco.tabela.ler' },
  },
  {
    path: '/precos/saneamento',
    name: 'precos.saneamento',
    component: () => import('./telas/SaneamentoTela.vue'),
    meta: { permissao: 'preco.tabela.ler' },
  },
  {
    path: '/faturamento/credenciamento',
    name: 'precos.credenciamento',
    component: () => import('./telas/MotorTela.vue'),
    props: { consulta: 'credenciamento' },
    meta: { permissao: 'convenio.credenciamento.ler' },
  },
  {
    path: '/faturamento/de-para-exames',
    name: 'precos.de-para',
    component: () => import('./telas/MotorTela.vue'),
    props: { consulta: 'dePara' },
    meta: { permissao: 'preco.dePara.ler' },
  },
  {
    path: '/faturamento/portes-terceiros',
    name: 'precos.portes',
    component: () => import('./telas/MotorTela.vue'),
    props: { consulta: 'portes' },
    meta: { permissao: 'preco.porte.ler' },
  },
];
