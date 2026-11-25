// Rotas do patrimônio (M54, etapa 6; ficha, seção 7): os bens (`patrimonio.bem.ler`), a depreciação
// (`patrimonio.depreciacao.ler`), os movimentos (`patrimonio.movimento.ler`; o gestor do setor que aceita a
// transferência entra por ela), o inventário pelo celular (`patrimonio.inventario.contar`, aberto também dos
// movimentos) e os parâmetros (o CRUD genérico do M54.1, `patrimonio.parametroPatrimonio.ler`). O servidor confere de
// novo cada leitura e gravação.
import type { RouteRecordRaw } from 'vue-router';

export const rotasPatrimonio: RouteRecordRaw[] = [
  {
    path: '/patrimonio/bens',
    name: 'patrimonio.bens',
    component: () => import('./BensTela.vue'),
    meta: { permissao: 'patrimonio.bem.ler' },
  },
  {
    path: '/patrimonio/depreciacao',
    name: 'patrimonio.depreciacao',
    component: () => import('./DepreciacaoTela.vue'),
    meta: { permissao: 'patrimonio.depreciacao.ler' },
  },
  {
    path: '/patrimonio/movimentos',
    name: 'patrimonio.movimentos',
    component: () => import('./MovimentosTela.vue'),
    meta: { permissao: 'patrimonio.movimento.ler' },
  },
  {
    path: '/patrimonio/inventario',
    name: 'patrimonio.inventario',
    component: () => import('./InventarioTela.vue'),
    meta: { permissao: 'patrimonio.inventario.contar' },
  },
  {
    path: '/patrimonio/parametros',
    name: 'patrimonio.parametros',
    component: () => import('./ParametrosTela.vue'),
    meta: { permissao: 'patrimonio.parametroPatrimonio.ler' },
  },
  // C2-072 (07-FIN L149; CPC 27): obras em andamento e seguro dos bens; gravar pede patrimonio.bem.cadastrar.
  {
    path: '/patrimonio/obras',
    name: 'patrimonio.obras',
    component: () => import('./ObrasTela.vue'),
    meta: { permissao: 'patrimonio.bem.ler' },
  },
  {
    path: '/patrimonio/seguros',
    name: 'patrimonio.seguros',
    component: () => import('./SegurosTela.vue'),
    meta: { permissao: 'patrimonio.bem.ler' },
  },
];
