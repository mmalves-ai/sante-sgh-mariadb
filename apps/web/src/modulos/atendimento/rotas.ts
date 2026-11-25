// Rotas do atendimento ambulatorial e do pronto atendimento (M20; ficha, seção 7). Cada rota exige a permissão de
// leitura do catálogo (M06); o servidor confere de novo e as ações aparecem só com a permissão de agir e a
// funcionalidade liberada.
import type { RouteRecordRaw } from 'vue-router';

const reg = '(\\d+)';

export const rotasAtendimento: RouteRecordRaw[] = [
  {
    path: '/recepcao/atendimento',
    name: 'atendimento.dia',
    component: () => import('./telas/AtendimentosDiaTela.vue'),
    meta: { permissao: 'atendimento.atendimento.ler' },
  },
  {
    path: '/recepcao/atendimento/novo',
    name: 'atendimento.abrir',
    component: () => import('./telas/AbrirAtendimentoTela.vue'),
    meta: { permissao: 'atendimento.atendimento.ler' },
  },
  {
    path: '/recepcao/atendimento/indicadores',
    name: 'atendimento.indicadores',
    component: () => import('./telas/IndicadoresAtendimentoTela.vue'),
    meta: { permissao: 'atendimento.indicador.ler' },
  },
  {
    path: '/recepcao/atendimento/heranca',
    name: 'atendimento.heranca',
    component: () => import('./telas/HerancaTela.vue'),
    meta: { permissao: 'atendimento.atendimento.ler' },
  },
  {
    // 02-REC linha 35: modelos de ficha e regras de impressão por fonte pagadora, especialidade, grupo e unidade.
    path: '/recepcao/atendimento/regras-impressao',
    name: 'atendimento.regrasImpressao',
    component: () => import('./telas/RegrasImpressaoTela.vue'),
    meta: { permissao: 'documento.cadastro.editar' },
  },
  {
    // 02-CAD linha 24: regra própria do plano da fonte pagadora (exigências, teto e pendência) e a prévia da crítica.
    path: '/recepcao/atendimento/regras-plano',
    name: 'atendimento.regrasPlano',
    component: () => import('./telas/RegrasPlanoTela.vue'),
    meta: { permissao: 'convenio.contrato.ler' },
  },
  {
    path: `/recepcao/atendimento/:reg${reg}/segurado`,
    name: 'atendimento.segurado',
    component: () => import('./telas/SeguradoTela.vue'),
    props: true,
    meta: { permissao: 'atendimento.atendimento.ler' },
  },
  {
    path: `/recepcao/atendimento/:reg${reg}/corrigir`,
    name: 'atendimento.corrigir',
    component: () => import('./telas/CorrigirFichaTela.vue'),
    props: true,
    meta: { permissao: 'atendimento.atendimento.ler' },
  },
  {
    path: `/recepcao/atendimento/:reg${reg}/procedimentos`,
    name: 'atendimento.procedimentos',
    component: () => import('./telas/ProcedimentosTela.vue'),
    props: true,
    meta: { permissao: 'atendimento.atendimento.ler' },
  },
  {
    path: `/recepcao/atendimento/:reg${reg}/encerrar`,
    name: 'atendimento.encerrar',
    component: () => import('./telas/EncerrarTela.vue'),
    props: true,
    meta: { permissao: 'atendimento.atendimento.ler' },
  },
  {
    path: `/recepcao/atendimento/:reg${reg}/impressos`,
    name: 'atendimento.impressos',
    component: () => import('./telas/ImpressosTela.vue'),
    props: true,
    meta: { permissao: 'atendimento.impresso.emitir' },
  },
  {
    path: '/consultorio/fila',
    name: 'atendimento.fila',
    component: () => import('./telas/FilaConsultorioTela.vue'),
    meta: { permissao: 'atendimento.fila.ler' },
  },
  {
    path: '/pa/quadro',
    name: 'pa.quadro',
    component: () => import('./telas/QuadroPaTela.vue'),
    meta: { permissao: 'pa.quadro.ler' },
  },
  {
    path: '/pa/observacao',
    name: 'pa.observacao',
    component: () => import('./telas/ObservacaoPaTela.vue'),
    meta: { permissao: 'pa.observacao.ler' },
  },
  {
    path: `/pa/desfecho/:reg${reg}`,
    name: 'pa.desfecho',
    component: () => import('./telas/DesfechoPaTela.vue'),
    props: true,
    meta: { permissao: 'pa.desfecho.registrar' },
  },
];
