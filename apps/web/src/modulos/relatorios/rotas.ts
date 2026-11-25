// Rotas do catálogo de relatórios, da triagem, dos pedidos e do envio agendado (M34; ficha, seção 7). Cada rota exige a
// permissão de leitura do catálogo (M06); o servidor confere de novo (emitir e exportar, pela permissão de cada
// relatório) e as ações aparecem só com a permissão de agir e a funcionalidade liberada.
import type { RouteRecordRaw } from 'vue-router';

export const rotasRelatorios: RouteRecordRaw[] = [
  {
    path: '/relatorios',
    name: 'relatorios.catalogo',
    component: () => import('./telas/CatalogoRelatoriosTela.vue'),
    meta: { permissao: 'relatorio.catalogo.ler' },
  },
  {
    path: '/relatorios/triagem',
    name: 'relatorios.triagem',
    component: () => import('./telas/TriagemRelatoriosTela.vue'),
    meta: { permissao: 'relatorio.triagem.ler' },
  },
  {
    path: '/relatorios/pedidos',
    name: 'relatorios.pedidos',
    component: () => import('./telas/PedidosRelatorioTela.vue'),
    meta: { permissao: 'relatorio.pedido.criar' },
  },
  {
    path: '/relatorios/agendamentos',
    name: 'relatorios.agendamentos',
    component: () => import('./telas/AgendamentosRelatorioTela.vue'),
    meta: { permissao: 'relatorio.agendamento.ler' },
  },
  {
    // 01-REL L113: o controle da carga do data mart na administração.
    path: '/relatorios/datamart/cargas',
    name: 'relatorios.datamart.cargas',
    component: () => import('./telas/CargasDataMartTela.vue'),
    meta: { permissao: 'relatorio.datamart.ler' },
  },
  {
    // 01-REL L112: os painéis gerenciais montados pelo hospital (abrir e, com a permissão, montar).
    path: '/relatorios/paineis-gerenciais',
    name: 'relatorios.paineisGerenciais',
    component: () => import('./telas/PaineisGerenciaisTela.vue'),
    meta: { permissao: 'relatorio.painelGerencial.ler' },
  },
  {
    // 01-REL L116: painéis de TV operacionais (cadastro, blocos e televisores).
    path: '/relatorios/paineis-tv',
    name: 'relatorios.paineisTv',
    component: () => import('./telas/PaineisTvOperacionaisTela.vue'),
    meta: { permissao: 'relatorio.painelTv.editar' },
  },
  {
    path: '/relatorios/paineis-tv/:id(\\d+)/tela',
    name: 'relatorios.paineisTv.tela',
    component: () => import('./telas/TvOperacionalTela.vue'),
    props: true,
    meta: { permissao: 'relatorio.painelTv.editar' },
  },
  {
    // O televisor pareado (sessão da conta da TV com relatorio.painelTv.exibir).
    path: '/tv/operacional',
    name: 'relatorios.tvOperacional',
    component: () => import('./telas/TvOperacionalTela.vue'),
    meta: { permissao: 'relatorio.painelTv.exibir' },
  },
];
