// Rotas da gestão de pessoas (M52; ficha, seção 7). Fatia F1 (M52.1): colaboradores e admissão (a lista com os alertas
// do conselho, a admissão e a ficha); fatia F2 (M52.2): a escala de plantão e os regimes; fatia F3 (M52.3): trocas, plantão agora e dimensionamento. As telas das fatias F4 a F6
// chegam depois desta; até lá, os itens abrem a consulta com os domínios embutidos. A rota exige a permissão de leitura; o servidor confere de novo.
import type { RouteRecordRaw } from 'vue-router';

export const rotasPessoas: RouteRecordRaw[] = [
  {
    path: '/pessoas/colaboradores',
    name: 'pessoas.colaboradores',
    component: () => import('./telas/ColaboradoresTela.vue'),
    meta: { permissao: 'pessoas.colaborador.ler' },
  },
  {
    path: '/pessoas/colaboradores/admitir',
    name: 'pessoas.admitir',
    component: () => import('./telas/AdmissaoTela.vue'),
    meta: { permissao: 'pessoas.colaborador.admitir' },
  },
  {
    path: '/pessoas/colaboradores/:vinculo(\\d+)',
    name: 'pessoas.ficha',
    component: () => import('./telas/FichaColaboradorTela.vue'),
    meta: { permissao: 'pessoas.colaborador.ler' },
  },
  // M52.2 (fatia F2): a escala de plantão (lista e grade do mês) e os regimes.
  {
    path: '/pessoas/escala',
    name: 'pessoas.escala',
    component: () => import('./telas/EscalasTela.vue'),
    meta: { permissao: 'pessoas.escala.ler' },
  },
  // M52.3 (fatia F3): as trocas de plantão, quem está de plantão agora (também como painel) e o dimensionamento.
  {
    path: '/pessoas/escala/trocas',
    name: 'pessoas.trocas',
    component: () => import('./telas/TrocasTela.vue'),
    meta: { permissao: 'pessoas.troca.pedir' },
  },
  {
    path: '/pessoas/plantao-agora',
    name: 'pessoas.plantaoAgora',
    component: () => import('./telas/PlantaoAgoraTela.vue'),
    meta: { permissao: 'pessoas.plantao.ler' },
  },
  {
    path: '/pessoas/dimensionamento',
    name: 'pessoas.dimensionamento',
    component: () => import('./telas/DimensionamentoTela.vue'),
    meta: { permissao: 'pessoas.dimensionamento.ler' },
  },
  {
    path: '/pessoas/escala/:escala(\\d+)',
    name: 'pessoas.escala.grade',
    component: () => import('./telas/GradeEscalaTela.vue'),
    meta: { permissao: 'pessoas.escala.ler' },
  },
  {
    path: '/pessoas/regimes',
    name: 'pessoas.regimes',
    component: () => import('./telas/RegimesTela.vue'),
    meta: { permissao: 'pessoas.regime.ler' },
  },
  // M52.4 (fatia F4): o ponto (importação e tratamento), o espelho do colaborador e o próprio espelho com a ciência.
  {
    path: '/pessoas/ponto',
    name: 'pessoas.ponto',
    component: () => import('./ponto/PontoTela.vue'),
    meta: { permissao: 'pessoas.ponto.ler' },
  },
  {
    path: '/pessoas/ponto/meu',
    name: 'pessoas.ponto.meu',
    component: () => import('./ponto/MeuEspelhoTela.vue'),
    meta: { permissao: 'pessoas.ponto.ciencia' },
  },
  {
    path: '/pessoas/ponto/:vinculo(\\d+)/:competencia(\\d{4}-\\d{2})',
    name: 'pessoas.ponto.espelho',
    component: () => import('./ponto/EspelhoPontoTela.vue'),
    meta: { permissao: 'pessoas.ponto.ler' },
  },
  // W0-06, parte 4b (M1 de mercado): cargos (CBO, requisitos, conselho), tabela salarial e quadro de vagas.
  {
    path: '/pessoas/cargos',
    name: 'pessoas.cargos',
    component: () => import('./cargos/CargosTela.vue'),
    meta: { permissao: 'pessoas.cargos.ler' },
  },
  // W0-06, parte 5d (M2 de mercado): competências por cargo, ciclos e avaliações com ciência, alertas e PDI.
  {
    path: '/pessoas/avaliacoes',
    name: 'pessoas.avaliacoes',
    component: () => import('./avaliacao/AvaliacaoTela.vue'),
    meta: { permissao: 'pessoas.avaliacao.ler' },
  },
  // W0-06, parte 5d-3-2: as próprias avaliações e a ciência do colaborador (toda pessoa, só o próprio vínculo).
  {
    path: '/pessoas/avaliacoes/minhas',
    name: 'pessoas.avaliacoes.minhas',
    component: () => import('./avaliacao/MinhasAvaliacoesTela.vue'),
    meta: { permissao: 'pessoas.avaliacao.ciencia' },
  },
  // W0-06, parte 7d (M4 de mercado): painel de indicadores de pessoas por unidade e setor, com ficha técnica e parcelas.
  {
    path: '/pessoas/indicadores',
    name: 'pessoas.indicadores',
    component: () => import('./indicadores/IndicadoresPessoasTela.vue'),
    meta: { permissao: 'pessoas.indicadores.ler' },
  },
];
