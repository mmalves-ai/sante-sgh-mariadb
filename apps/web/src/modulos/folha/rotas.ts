// Rotas da folha de pagamento (M53). Etapa 1 (F0, M53.1): a folha da competência com a interface com a folha externa e
// os afastamentos. A rota abre para quem tem qualquer parte da área (`pessoas.folha.abrir`, D-ABRIR-532, como o item do
// menu); a tela leva às rubricas quem não consulta a folha da competência. O servidor confere de novo cada leitura e
// gravação.
import type { RouteRecordRaw } from 'vue-router';

export const rotasFolha: RouteRecordRaw[] = [
  {
    path: '/pessoas/folha',
    name: 'pessoas.folha',
    component: () => import('./telas/FolhaCompetenciaTela.vue'),
    meta: { permissao: 'pessoas.folha.abrir' },
  },
  // M53.6: o eSocial (eventos, lotes, retornos, conciliação, parâmetros do empregador e a ficha do colaborador).
  {
    path: '/pessoas/esocial',
    name: 'pessoas.esocial',
    component: () => import('./esocial/EsocialTela.vue'),
    meta: { permissao: 'pessoas.esocial.ler' },
  },
  // M53.8: FGTS Digital e obrigações legais (SEFIP, CAGED e RAIS onde ainda exigidas), parâmetros e histórico.
  {
    path: '/pessoas/obrigacoes',
    name: 'pessoas.obrigacoes',
    component: () => import('./obrigacoes/ObrigacoesTela.vue'),
    meta: { permissao: 'pessoas.obrigacao.ler' },
  },
  // M53.9: a integração da folha com o financeiro e o contábil (de-para, títulos, lançamentos e custo de pessoal).
  {
    path: '/pessoas/folha/integracao',
    name: 'pessoas.folha.integracao',
    component: () => import('./integracao/IntegracaoFolhaTela.vue'),
    meta: { permissao: 'pessoas.integracao.ler' },
  },
  // M53.3: o holerite do próprio colaborador (autosserviço; o servidor confere que o vínculo é do login).
  {
    path: '/pessoas/meu/holerite',
    name: 'pessoas.meu.holerite',
    component: () => import('./calculo/MeuHoleriteTela.vue'),
    meta: { permissao: 'pessoas.autoatendimento.ler' },
  },
  // M53.4: as férias do próprio colaborador (autosserviço; o servidor confere que o vínculo é do login).
  {
    path: '/pessoas/meu/ferias',
    name: 'pessoas.meu.ferias',
    component: () => import('./ferias/MinhasFeriasTela.vue'),
    meta: { permissao: 'pessoas.autoatendimento.ler' },
  },
];
