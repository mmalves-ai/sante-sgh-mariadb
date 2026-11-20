// Rotas das consultas somente leitura (M14). A permissão de cada consulta (`<modulo>.consulta.ler`; clínica:
// `pep.consultaClinica.ler`) é conferida pela API; a rota exige o índice (todos os perfis de pessoa) e o item
// da árvore, a permissão do menu.
import type { RouteRecordRaw } from 'vue-router';

export const rotasConsultas: RouteRecordRaw[] = [
  {
    path: '/consultas',
    name: 'consultas',
    component: () => import('./telas/ConsultasIndiceTela.vue'),
    meta: { permissao: 'config.consulta.ler' },
  },
  {
    path: '/consultas/item/:item',
    name: 'consultas.item',
    component: () => import('./telas/ItemConsultaTela.vue'),
    props: true,
    meta: { permissao: 'config.consulta.ler' },
  },
  {
    path: '/consultas/:modulo/:recurso',
    name: 'consultas.tabela',
    component: () => import('./telas/ConsultaTela.vue'),
    props: true,
    meta: { permissao: 'config.consulta.ler' },
  },
  // M14: painel da matriz de cobertura (Administração > Coexistência).
  {
    path: '/administracao/coexistencia/matriz',
    name: 'config.matriz',
    component: () => import('./telas/MatrizTela.vue'),
    meta: { permissao: 'config.matriz.ler' },
  },
];
