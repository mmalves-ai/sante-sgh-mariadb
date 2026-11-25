// Rotas da notificação compulsória (M48, etapa 4; ficha, seção 7). Toda rota declara meta.permissao; o servidor é quem
// decide (as gravações recusam também com a funcionalidade desligada).
import { PERMISSOES_AGRAVO as P } from '@sgh/contratos';
import type { RouteRecordRaw } from 'vue-router';

export const rotasAgravo: RouteRecordRaw[] = [
  {
    path: '/qualidade/vigilancia/agravos',
    name: 'qualidade.vigilancia.agravos',
    component: () => import('./telas/AgravosTela.vue'),
    meta: { permissao: P.ler },
  },
  {
    path: '/qualidade/vigilancia/agravos/casos/:id/ficha',
    name: 'qualidade.vigilancia.agravos.ficha',
    component: () => import('./telas/FichaAgravoTela.vue'),
    props: (r) => ({ id: Number(r.params.id) }),
    meta: { permissao: P.ler },
  },
  // F7 (09-AREA linha 83): perfil epidemiológico pela hierarquia da CID-10 (capítulo, grupo e subgrupo).
  {
    path: '/qualidade/vigilancia/perfil-cid',
    name: 'qualidade.vigilancia.perfil-cid',
    component: () => import('./telas/PerfilCidTela.vue'),
    meta: { permissao: P.ler },
  },
];
