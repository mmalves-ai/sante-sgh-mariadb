// Rotas dos custos hospitalares (M54). Etapa 4: a estrutura de custos (classificação, ordem e critério do rateio), as
// estatísticas do mês e os cadastros do custeio, numa tela só. Etapa 5: a apuração do custo do mês (custo por
// procedimento e por paciente) e o resultado e a margem. Cada rota abre com a permissão do item do menu; o servidor
// confere de novo cada leitura e gravação.
import type { RouteRecordRaw } from 'vue-router';

export const rotasCustos: RouteRecordRaw[] = [
  {
    path: '/custos/centros',
    name: 'custos.centros',
    component: () => import('./CentrosCustoTela.vue'),
    meta: { permissao: 'custos.centro.ler' },
  },
  {
    path: '/custos/apuracao',
    name: 'custos.apuracao',
    component: () => import('./ApuracaoCustosTela.vue'),
    meta: { permissao: 'custos.apuracao.ler' },
  },
  {
    path: '/custos/resultado',
    name: 'custos.resultado',
    component: () => import('./ResultadoCustosTela.vue'),
    meta: { permissao: 'custos.resultado.ler' },
  },
  {
    // C2-115 (07-FIN L140): custo-padrão por procedimento (ficha técnica e comparação com o apurado).
    path: '/custos/custo-padrao',
    name: 'custos.custo-padrao',
    component: () => import('./CustoPadraoTela.vue'),
    meta: { permissao: 'custos.apuracao.ler' },
  },
];
