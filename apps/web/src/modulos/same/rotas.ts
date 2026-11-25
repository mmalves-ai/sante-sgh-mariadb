// Rotas da digitalização certificada (M50, etapa 6; ficha, seção 7). Toda rota declara meta.permissao; o servidor é quem
// decide (as gravações recusam também com a funcionalidade desligada).
import { PERMISSOES_DIGITALIZACAO as P } from '@sgh/contratos';
import type { RouteRecordRaw } from 'vue-router';

export const rotasSame: RouteRecordRaw[] = [
  {
    path: '/same/digitalizacao',
    name: 'same.digitalizacao',
    component: () => import('./telas/DigitalizacaoTela.vue'),
    meta: { permissao: P.ler },
  },
  // F3.9 (04-HOT L127 e L128): protocolo em lote entre setores e empréstimo de prontuário.
  {
    path: '/same/tramite',
    name: 'same.tramite',
    component: () => import('./telas/TramiteTela.vue'),
    meta: { permissao: 'same.movimento.ler' },
  },
];
