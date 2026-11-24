// Rotas da internação, do mapa de leitos, da higienização e do SAME (M21; ficha, seção 7). Cada rota exige a permissão
// de leitura do catálogo (M06); o servidor confere de novo e as ações aparecem só com a permissão de agir e a
// funcionalidade liberada.
import { rotaDoSubitem } from '@sgh/contratos';
import type { RouteRecordRaw } from 'vue-router';

const reg = '(\\d+)';

export const rotasAdt: RouteRecordRaw[] = [
  {
    path: '/internacao',
    name: 'adt.internados',
    component: () => import('./telas/InternadosTela.vue'),
    meta: { permissao: 'internacao.internacao.ler' },
  },
  {
    path: '/internacao/pre',
    name: 'adt.pre',
    component: () => import('./telas/PreInternacaoTela.vue'),
    meta: { permissao: 'internacao.pre.ler' },
  },
  {
    path: '/internacao/admissao',
    name: 'adt.admissao',
    component: () => import('./telas/AdmissaoTela.vue'),
    meta: { permissao: 'internacao.internacao.criar' },
  },
  {
    path: `/internacao/:reg${reg}/guias`,
    name: 'adt.guias',
    component: () => import('./telas/GuiasTela.vue'),
    props: true,
    meta: { permissao: 'internacao.internacao.ler' },
  },
  {
    path: `/internacao/:reg${reg}/trocas`,
    name: 'adt.trocas',
    component: () => import('./telas/TrocasTela.vue'),
    props: true,
    meta: { permissao: 'internacao.internacao.ler' },
  },
  {
    path: `/internacao/:reg${reg}/procedimentos`,
    name: 'adt.procedimentos',
    component: () => import('./telas/ProcedimentosInternacaoTela.vue'),
    props: true,
    meta: { permissao: 'internacao.internacao.ler' },
  },
  {
    path: `/internacao/:reg${reg}/alta`,
    name: 'adt.alta',
    component: () => import('./telas/AltaTela.vue'),
    props: true,
    meta: { permissao: 'internacao.internacao.ler' },
  },
  {
    // F3.4, 04-INT L82: gases medicinais do paciente pelo atendimento.
    path: `/internacao/atendimentos/:atd${reg}/gases`,
    name: 'adt.gases',
    component: () => import('./telas/GasesTela.vue'),
    props: true,
    meta: { permissao: 'enfermagem.dispositivo.ler' },
  },
  {
    path: '/internacao/documentos',
    name: 'adt.documentos',
    component: () => import('./telas/DocumentosInternacaoTela.vue'),
    meta: { permissao: 'internacao.impresso.emitir' },
  },
  {
    path: `/internacao/:reg${reg}/impressos`,
    name: 'adt.impressos',
    component: () => import('./telas/ImpressosInternacaoTela.vue'),
    props: true,
    meta: { permissao: 'internacao.impresso.emitir' },
  },
  {
    path: '/leitos/mapa',
    name: 'adt.mapa',
    component: () => import('./telas/MapaLeitosTela.vue'),
    meta: { permissao: 'leitos.mapa.ler' },
  },
  {
    path: '/leitos/transferencias',
    name: 'adt.transferencia',
    component: () => import('./telas/TransferenciaTela.vue'),
    meta: { permissao: 'leitos.transferencia.criar' },
  },
  {
    path: '/leitos/historico',
    name: 'adt.historico',
    component: () => import('./telas/HistoricoOcupacaoTela.vue'),
    meta: { permissao: 'leitos.mapa.ler' },
  },
  {
    path: '/higienizacao/painel',
    name: 'adt.higPainel',
    component: () => import('./telas/PainelHigienizacaoTela.vue'),
    meta: { permissao: 'hotelaria.limpeza.ler' },
  },
  {
    // W0-07 (M3): indicadores de higienização e giro de leito (o item de menu fica com o W4-01).
    path: '/higienizacao/indicadores',
    name: 'adt.higIndicadores',
    component: () => import('./telas/IndicadoresHigienizacaoTela.vue'),
    meta: { permissao: 'hotelaria.limpeza.ler' },
  },
  {
    path: '/higienizacao/solicitacoes',
    name: 'adt.higSolicitacoes',
    component: () => import('./telas/SolicitacoesLimpezaTela.vue'),
    meta: { permissao: 'hotelaria.limpeza.solicitar' },
  },
  {
    path: '/higienizacao/inspecao',
    name: 'adt.higInspecao',
    component: () => import('./telas/InspecaoTela.vue'),
    meta: { permissao: 'hotelaria.limpeza.liberar' },
  },
  {
    // Os cadastros da higienização são do CRUD genérico: o índice do subitem.
    path: '/higienizacao/cadastros',
    name: 'adt.higCadastros',
    redirect: rotaDoSubitem('higienizacaoCadastros'),
    meta: { permissao: 'hotelaria.cadastro.editar' },
  },
  {
    path: '/m/higienizacao',
    name: 'adt.higApp',
    component: () => import('./telas/AppHigienizacaoTela.vue'),
    meta: { permissao: 'hotelaria.limpeza.executar' },
  },
  {
    path: '/same/guarda',
    name: 'adt.same.guarda',
    component: () => import('./telas/SameGuardaTela.vue'),
    meta: { permissao: 'same.movimento.ler' },
  },
  {
    path: '/same/movimentos',
    name: 'adt.same',
    component: () => import('./telas/SameTela.vue'),
    meta: { permissao: 'same.movimento.ler' },
  },
  // M44 (etapa 2): o NIR.
  {
    path: '/internacao/nir/fila',
    name: 'nir.fila',
    component: () => import('./telas/FilaNirTela.vue'),
    meta: { permissao: 'internacao.solicitacaoLeito.ler' },
  },
  {
    path: '/internacao/nir/reservas',
    name: 'nir.reservas',
    component: () => import('./telas/ReservasNirTela.vue'),
    meta: { permissao: 'internacao.reservaLeito.ler' },
  },
  {
    path: '/internacao/nir/altas-previstas',
    name: 'nir.altas',
    component: () => import('./telas/AltasPrevistasTela.vue'),
    meta: { permissao: 'internacao.altaPrevista.ler' },
  },
  {
    path: '/internacao/nir/permanencia',
    name: 'nir.permanencia',
    component: () => import('./telas/PermanenciaTela.vue'),
    meta: { permissao: 'internacao.permanencia.ler' },
  },
  {
    path: '/internacao/nir/situacoes',
    name: 'nir.situacoes',
    component: () => import('./telas/SituacoesRegulacaoTela.vue'),
    meta: { permissao: 'internacao.solicitacaoLeito.ler' },
  },
  {
    // M44 (etapa 3): a regulação estadual (o número à mão; o conector só com a DP-29).
    path: '/internacao/nir/regulacao',
    name: 'nir.regulacao',
    component: () => import('./telas/RegulacaoTela.vue'),
    meta: { permissao: 'internacao.regulacao.ler' },
  },
];
