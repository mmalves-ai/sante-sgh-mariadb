// Rota do orçamento empresarial (M54, etapa 7; item `Financeiro > Orçamento empresarial`): versões, valores por mês,
// aprovação e orçado × realizado numa tela só. Abre com `financeiro.orcamento.ler` (como o item do menu); o servidor
// confere de novo cada leitura e gravação (editar e aprovar).
import type { RouteRecordRaw } from 'vue-router';

export const rotasOrcamento: RouteRecordRaw[] = [
  {
    path: '/financeiro/orcamento',
    name: 'financeiro.orcamento',
    component: () => import('./OrcamentoTela.vue'),
    meta: { permissao: 'financeiro.orcamento.ler' },
  },
  // C2-107 (07-FIN linha 128): projetos como centro de resultado, aberta pelo orçamento empresarial.
  {
    path: '/financeiro/orcamento/projetos',
    name: 'financeiro.orcamento.projetos',
    component: () => import('./ProjetosResultadoTela.vue'),
    meta: { permissao: 'financeiro.orcamento.ler' },
  },
];
