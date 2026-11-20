// Rotas do M19 (ficha, seção 7): guichê, supervisor e indicadores da recepção; geradores, recepções, painéis de
// chamada e painéis de TV de setor (cadastros); e as telas de aparelho (totem, painel de chamada e painel de TV de
// setor), públicas para a casca porque o acesso é o token do dispositivo, conferido pelo servidor a cada leitura.
import type { RouteRecordRaw } from 'vue-router';

// M44 (etapa 1): a fila e a tela de classificar (tablet), a reclassificação, os indicadores, os protocolos de
// classificação (com o simulador e a publicação) e a tabela de cores anterior (consulta).
const reg = '(\\d+)';

export const rotasRecepcao: RouteRecordRaw[] = [
  {
    path: '/pa/classificacao',
    name: 'pa.classificacao',
    component: () => import('./telas/FilaClassificacaoTela.vue'),
    meta: { permissao: 'recepcao.classificacao.ler' },
  },
  {
    path: '/pa/classificacao/indicadores',
    name: 'pa.classificacao.indicadores',
    component: () => import('./telas/IndicadoresClassificacaoTela.vue'),
    meta: { permissao: 'recepcao.classificacao.ler' },
  },
  {
    path: `/pa/classificacao/:reg${reg}`,
    name: 'pa.classificacao.classificar',
    component: () => import('./telas/ClassificarTela.vue'),
    props: (r) => ({ reg: String(r.params['reg']), modo: 'classificar' }),
    meta: { permissao: 'recepcao.classificacao.ler' },
  },
  {
    path: `/pa/classificacao/:reg${reg}/reclassificar`,
    name: 'pa.classificacao.reclassificar',
    component: () => import('./telas/ClassificarTela.vue'),
    props: (r) => ({ reg: String(r.params['reg']), modo: 'reclassificar' }),
    meta: { permissao: 'recepcao.classificacao.ler' },
  },
  {
    // M44 (etapa 3): o relógio dos protocolos gerenciados no PA.
    path: '/pa/protocolos',
    name: 'pa.relogioProtocolos',
    component: () => import('./telas/RelogioProtocolosTela.vue'),
    meta: { permissao: 'recepcao.protocoloPaciente.ler' },
  },
  {
    path: '/administracao/pa/protocolos',
    name: 'pa.protocolos',
    component: () => import('./telas/ProtocolosClassificacaoTela.vue'),
    meta: { permissao: 'recepcao.protocolo.ler' },
  },
  {
    path: '/administracao/pa/cores-legado',
    name: 'pa.cores-legado',
    component: () => import('./telas/CoresAnterioresTela.vue'),
    meta: { permissao: 'recepcao.protocolo.ler' },
  },
  {
    path: '/recepcao/guiche',
    name: 'recepcao.guiche',
    component: () => import('./telas/GuicheTela.vue'),
    meta: { permissao: 'recepcao.senha.ler' },
  },
  {
    path: '/recepcao/supervisor',
    name: 'recepcao.supervisor',
    component: () => import('./telas/SupervisorTela.vue'),
    meta: { permissao: 'recepcao.supervisor.ler' },
  },
  {
    path: '/recepcao/indicadores',
    name: 'recepcao.indicadores',
    component: () => import('./telas/IndicadoresRecepcaoTela.vue'),
    meta: { permissao: 'recepcao.indicador.ler' },
  },
  {
    path: '/recepcao/senhas/geradores',
    name: 'recepcao.geradores',
    component: () => import('./telas/GeradoresTela.vue'),
    meta: { permissao: 'recepcao.gerador.ler' },
  },
  {
    path: '/recepcao/recepcoes',
    name: 'recepcao.recepcoes',
    component: () => import('./telas/RecepcoesTela.vue'),
    meta: { permissao: 'recepcao.recepcao.ler' },
  },
  {
    // W1-04: modelos de termo de consentimento e LGPD (versionados).
    path: '/recepcao/termos',
    name: 'recepcao.termos',
    component: () => import('./telas/TermosTela.vue'),
    meta: { permissao: 'recepcao.termo.editar' },
  },
  {
    path: '/recepcao/senhas/paineis',
    name: 'recepcao.paineis',
    component: () => import('./telas/PaineisChamadaTela.vue'),
    meta: { permissao: 'recepcao.painel.ler' },
  },
  {
    path: '/paineis',
    name: 'relatorio.paineisTv',
    component: () => import('./telas/PaineisTvTela.vue'),
    meta: { permissao: 'relatorio.painel.ler' },
  },
  // Telas de aparelho: sem casca, sem sessão de pessoa (o token do dispositivo, conferido no servidor).
  {
    path: '/totem/:dispositivo(\\d+)',
    name: 'dispositivo.totem',
    component: () => import('./telas/TotemTela.vue'),
    props: true,
    meta: { publica: true, dispositivo: true },
  },
  {
    path: '/painel/:dispositivo(\\d+)',
    name: 'dispositivo.painel',
    component: () => import('./telas/PainelChamadaTela.vue'),
    props: true,
    meta: { publica: true, dispositivo: true },
  },
  {
    path: '/paineis/:dispositivo(\\d+)',
    name: 'dispositivo.paineltv',
    component: () => import('./telas/PainelTvTela.vue'),
    props: true,
    meta: { publica: true, dispositivo: true },
  },
];
