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
];
