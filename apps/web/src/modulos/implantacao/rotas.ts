// Rotas da implantação (M60, etapa 2): a conferência da instalação, aba da tela "Saúde do sistema" (o mesmo item do
// menu, sem item próprio). Permissão dos painéis de saúde (sistema.saude.ler, D-PERM-60.2); o servidor confere de novo.
import { PERMISSAO_CONFERENCIA_INSTALACAO } from '@sgh/contratos';

// Etapa 3: a fumaça do servidor, terceira aba da mesma tela, com a mesma permissão (D-PERM-60.3).
import type { RouteRecordRaw } from 'vue-router';

export const rotasImplantacao: RouteRecordRaw[] = [
  {
    path: '/administracao/saude/instalacao',
    name: 'implantacao.conferencia',
    component: () => import('./telas/ConferenciaInstalacaoTela.vue'),
    meta: { permissao: PERMISSAO_CONFERENCIA_INSTALACAO },
  },
  {
    path: '/administracao/saude/fumaca',
    name: 'implantacao.fumaca',
    component: () => import('./telas/FumacaServidorTela.vue'),
    meta: { permissao: PERMISSAO_CONFERENCIA_INSTALACAO },
  },
];
