// Rotas do módulo da Rede (M57; ficha, seção 7): a fila de prováveis duplicados entre os estabelecimentos (etapa 1, com
// o relatório de divergência na mesma tela), o BI consolidado da Rede e o registro dos serviços compartilhados
// (etapa 3). Cada rota exige a permissão do catálogo (M06); o servidor confere de novo, e as chaves `rede.mpi` e
// `rede.bi` (Funcionalidades por estabelecimento) ligam as funcionalidades.
import type { RouteRecordRaw } from 'vue-router';

export const rotasRede: RouteRecordRaw[] = [
  {
    path: '/cadastros/pacientes/rede',
    name: 'rede.mpi',
    component: () => import('./telas/FilaRedeTela.vue'),
    meta: {
      permissao: 'rede.mpi.ler',
      menu: 'Cadastros > Pacientes (cadastro único) > MPI da Rede (paciente único entre os dois hospitais)',
    },
  },
  {
    path: '/relatorios/bi/rede',
    name: 'rede.bi',
    component: () => import('./telas/BiRedeTela.vue'),
    meta: { permissao: 'relatorio.biRede.acessar', menu: 'Relatórios e BI > BI consolidado da Rede Santé' },
  },
  {
    path: '/relatorios/bi/rede/servicos',
    name: 'rede.servicos',
    component: () => import('./telas/ServicosRedeTela.vue'),
    meta: { permissao: 'relatorio.biRede.acessar' },
  },
];
