// Rotas da "Migração gradual dos usuários" (M37; ficha, seção 7): setores (o item da árvore), pessoas, treinamento,
// indicadores, condução opcional e chamados, cada uma com a sua permissão de leitura (o servidor confere de novo).
import type { RouteRecordRaw } from 'vue-router';

export const rotasCoexistencia: RouteRecordRaw[] = [
  {
    path: '/administracao/coexistencia/migracao',
    name: 'coexistencia.setores',
    component: () => import('./telas/MigracaoSetoresTela.vue'),
    meta: { permissao: 'config.coexistencia.ler' },
  },
  {
    path: '/administracao/coexistencia/migracao/pessoas',
    name: 'coexistencia.pessoas',
    component: () => import('./telas/MigracaoPessoasTela.vue'),
    meta: { permissao: 'config.coexistenciaPessoas.ler' },
  },
  {
    path: '/administracao/coexistencia/migracao/treinamento',
    name: 'coexistencia.treinamento',
    component: () => import('./telas/MigracaoTreinoTela.vue'),
    meta: { permissao: 'config.coexistenciaTreino.ler' },
  },
  {
    path: '/administracao/coexistencia/migracao/indicadores',
    name: 'coexistencia.indicadores',
    component: () => import('./telas/MigracaoIndicadoresTela.vue'),
    meta: { permissao: 'config.coexistencia.ler' },
  },
  {
    // M39: a onda 1 (a lista para ligar cada setor, regra 1, e os indicadores de disputa do dia).
    path: '/administracao/coexistencia/migracao/onda1',
    name: 'coexistencia.onda1',
    component: () => import('./telas/MigracaoOnda1Tela.vue'),
    meta: { permissao: 'config.coexistencia.ler' },
  },
  {
    // M40: a onda 2 (o critério de liberação de cada setor, regra 1, e o acompanhamento, campo 4).
    path: '/administracao/coexistencia/migracao/onda2',
    name: 'coexistencia.onda2',
    component: () => import('./telas/MigracaoOnda2Tela.vue'),
    meta: { permissao: 'config.coexistencia.ler' },
  },
  {
    // M41: a onda 3 (o critério de cada setor da farmácia, do almoxarifado e das compras; regra 1 da farmácia).
    path: '/administracao/coexistencia/migracao/onda3',
    name: 'coexistencia.onda3',
    component: () => import('./telas/MigracaoOnda3Tela.vue'),
    meta: { permissao: 'config.coexistencia.ler' },
  },
  {
    // M42: a onda 4 (o critério de cada setor do faturamento, do financeiro e do repasse; início na abertura).
    path: '/administracao/coexistencia/migracao/onda4',
    name: 'coexistencia.onda4',
    component: () => import('./telas/MigracaoOnda4Tela.vue'),
    meta: { permissao: 'config.coexistencia.ler' },
  },
  {
    // M43: o fim da coexistência por hospital (o critério do cap-15, o conjunto do cap-14 ao lado, o registro).
    path: '/administracao/coexistencia/migracao/fim',
    name: 'coexistencia.fim',
    component: () => import('./telas/MigracaoFimTela.vue'),
    meta: { permissao: 'config.coexistencia.ler' },
  },
  {
    // M59 (etapa 5): o termo das concessões da coexistência (cartão da migração gradual).
    path: '/administracao/coexistencia/concessoes',
    name: 'coexistencia.concessoes',
    component: () => import('./telas/ConcessoesTela.vue'),
    meta: { permissao: 'config.coexistencia.ler' },
  },
  {
    // M59 (etapa 6): a retrocompatibilidade do banco (condições, decisão, plano de evolução; só leitura; ADR 0033).
    path: '/administracao/coexistencia/retrocompatibilidade',
    name: 'coexistencia.retrocompatibilidade',
    component: () => import('./telas/MigracaoRetrocompatibilidadeTela.vue'),
    meta: { permissao: 'config.coexistencia.ler' },
  },
  {
    // M58 (etapa 1): a prontidão do desligamento por hospital (sessões, inventário com a checklist, contas, passos).
    path: '/administracao/coexistencia/desligamento',
    name: 'coexistencia.desligamento',
    component: () => import('./telas/MigracaoDesligamentoTela.vue'),
    meta: { permissao: 'config.coexistencia.ler' },
  },
  {
    // M58 (etapa 2): o ensaio da versão 5 do motor na cópia (as 13 etapas reavaliadas, a janela, as funções externas).
    path: '/administracao/coexistencia/desligamento/ensaio-firebird5',
    name: 'coexistencia.ensaioFirebird5',
    component: () => import('./telas/MigracaoEnsaioFirebird5Tela.vue'),
    meta: { permissao: 'config.schema.ler' },
  },
  {
    // M58 (etapa 3): o ensaio da conversão do texto para UTF-8 (as 16 etapas, a janela, a página e os índices).
    path: '/administracao/coexistencia/desligamento/ensaio-utf8',
    name: 'coexistencia.ensaioUtf8',
    component: () => import('./telas/MigracaoEnsaioUtf8Tela.vue'),
    meta: { permissao: 'config.schema.ler' },
  },
  {
    // M58 (etapa 5): a janela em produção de cada passo (roteiro, verificação depois da janela, restrição de entrada).
    path: '/administracao/coexistencia/desligamento/janela',
    name: 'coexistencia.janela',
    component: () => import('./telas/MigracaoJanelaTela.vue'),
    meta: { permissao: 'config.coexistencia.ler' },
  },
  {
    path: '/administracao/coexistencia/migracao/conducao',
    name: 'coexistencia.conducao',
    component: () => import('./telas/MigracaoConducaoTela.vue'),
    meta: { permissao: 'acesso.opcao.revogar' },
  },
  {
    path: '/administracao/coexistencia/migracao/chamados',
    name: 'coexistencia.chamados',
    component: () => import('./telas/MigracaoChamadosTela.vue'),
    meta: { permissao: 'config.chamado.ler' },
  },
];
