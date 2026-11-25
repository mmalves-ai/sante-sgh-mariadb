// Rotas da conta do paciente, dos lançamentos e da auditoria de contas (M30; ficha, seção 7). Cada rota exige a permissão
// de leitura do catálogo (M06); o servidor confere de novo (e o escopo por convênio) e as ações aparecem só com a
// permissão de agir e a funcionalidade liberada.
import type { RouteRecordRaw } from 'vue-router';

export const rotasFaturamento: RouteRecordRaw[] = [
  {
    path: '/faturamento/contas',
    name: 'faturamento.contas',
    component: () => import('./telas/ContasTela.vue'),
    props: { destino: 'conta' },
    meta: { permissao: 'faturamento.conta.ler' },
  },
  {
    path: '/faturamento/lancamentos',
    name: 'faturamento.lancamentos',
    component: () => import('./telas/ContasTela.vue'),
    props: { destino: 'lancamentos' },
    meta: { permissao: 'faturamento.item.ler' },
  },
  {
    path: '/faturamento/auditoria',
    name: 'faturamento.auditoria',
    component: () => import('./telas/ContasTela.vue'),
    props: { destino: 'auditoria' },
    meta: { permissao: 'faturamento.auditoria.ler' },
  },
  {
    path: '/faturamento/contas-sus',
    name: 'faturamento.contasSus',
    component: () => import('./telas/ContasTela.vue'),
    props: { destino: 'sigtap' },
    meta: { permissao: 'faturamento.item.ler' },
  },
  // F3.7 (06-FAT linhas 10 e 12): período da conta parcial e segurado; campo adicional da operadora (cadastro e guia).
  {
    path: '/faturamento/contas/:id(\\d+)/complementos',
    name: 'faturamento.contaComplementos',
    component: () => import('./telas/ComplementosContaTela.vue'),
    props: true,
    meta: { permissao: 'faturamento.conta.ler' },
  },
  // F3.7 (06-FAT linhas 17, 18 e 20): horário especial, acréscimo e desconto com alçada e pacote na conta.
  {
    path: '/faturamento/contas/:id(\\d+)/ajustes',
    name: 'faturamento.contaAjustes',
    component: () => import('./telas/AjustesContaTela.vue'),
    props: true,
    meta: { permissao: 'faturamento.conta.ler' },
  },
  {
    path: '/faturamento/fontes/:fonte(\\d+)/atributos-guia',
    name: 'faturamento.atributosFonte',
    component: () => import('./telas/AtributosGuiaTela.vue'),
    props: true,
    meta: { permissao: 'faturamento.conta.ler' },
  },
  {
    path: '/faturamento/guias/:guia(\\d+)/atributos',
    name: 'faturamento.atributosGuia',
    component: () => import('./telas/AtributosGuiaTela.vue'),
    props: true,
    meta: { permissao: 'faturamento.guia.ler' },
  },
  // F3.7 (06-FAT linha 36): a nota fiscal de serviço que documenta a fatura do convênio ou a conta do particular.
  {
    path: '/faturamento/faturas',
    name: 'faturamento.faturas',
    component: () => import('./telas/FaturasNotaTela.vue'),
    meta: { permissao: 'faturamento.conta.ler' },
  },
  {
    path: '/faturamento/faturas/:id(\\d+)/notas-fiscais',
    name: 'faturamento.faturaNotasFiscais',
    component: () => import('./telas/NotaFiscalAlvoTela.vue'),
    props: (r) => ({ id: String(r.params['id']), tipo: 'fatura' }),
    meta: { permissao: 'faturamento.conta.ler' },
  },
  {
    path: '/faturamento/contas/:id(\\d+)/notas-fiscais',
    name: 'faturamento.contaNotasFiscais',
    component: () => import('./telas/NotaFiscalAlvoTela.vue'),
    props: (r) => ({ id: String(r.params['id']), tipo: 'conta' }),
    meta: { permissao: 'faturamento.conta.ler' },
  },
  {
    path: '/faturamento/contas/:id(\\d+)',
    name: 'faturamento.conta',
    component: () => import('./telas/ContaTela.vue'),
    props: true,
    meta: { permissao: 'faturamento.conta.ler' },
  },
  {
    path: '/faturamento/contas/:id(\\d+)/lancamentos',
    name: 'faturamento.contaLancamentos',
    component: () => import('./telas/LancamentosTela.vue'),
    props: true,
    meta: { permissao: 'faturamento.item.ler' },
  },
  // F3.7, 06-FAT linhas 21, 22 e 24: auditoria item a item, protocolo entre setores e guias do convênio.
  {
    path: '/faturamento/contas/:id(\\d+)/auditoria-itens',
    name: 'faturamento.contaAuditoriaItens',
    component: () => import('./telas/AuditoriaItensTela.vue'),
    props: true,
    meta: { permissao: 'faturamento.auditoria.ler' },
  },
  {
    path: '/faturamento/protocolos',
    name: 'faturamento.protocolosTramite',
    component: () => import('./telas/ProtocolosTramiteTela.vue'),
    meta: { permissao: 'faturamento.tramite.ler' },
  },
  {
    path: '/faturamento/guias-convenio',
    name: 'faturamento.guiasConvenio',
    component: () => import('./telas/GuiasConvenioTela.vue'),
    meta: { permissao: 'faturamento.guia.ler' },
  },
  {
    path: '/faturamento/contas/:id(\\d+)/movimentos',
    name: 'faturamento.contaMovimentos',
    component: () => import('./telas/MovimentosContaTela.vue'),
    props: true,
    meta: { permissao: 'faturamento.conta.ler' },
  },
  {
    path: '/faturamento/contas/:id(\\d+)/auditoria',
    name: 'faturamento.contaAuditoria',
    component: () => import('./telas/AuditoriaTela.vue'),
    props: true,
    meta: { permissao: 'faturamento.auditoria.ler' },
  },
  {
    path: '/faturamento/contas/:id(\\d+)/sigtap',
    name: 'faturamento.contaSigtap',
    component: () => import('./telas/SigtapTela.vue'),
    props: true,
    meta: { permissao: 'faturamento.item.ler' },
  },
  {
    path: '/faturamento/lancamento-automatico',
    name: 'faturamento.lancamentoAutomatico',
    component: () => import('./telas/LancamentoAutomaticoTela.vue'),
    meta: { permissao: 'faturamento.lancamento.ler' },
  },
  {
    path: '/faturamento/pendencias-tipos',
    name: 'faturamento.pendenciasTipos',
    component: () => import('./telas/PendenciasTiposTela.vue'),
    meta: { permissao: 'faturamento.pendencia.ler' },
  },
  {
    path: '/faturamento/pacotes',
    name: 'faturamento.pacotes',
    component: () => import('./telas/PacotesTela.vue'),
    meta: { permissao: 'faturamento.pacote.ler' },
  },
  // F8 (06-FAT linha 23): ambulância, ligação tarifada, layout e importação do arquivo do tarifador, lançamento na conta.
  {
    path: '/faturamento/servicos-acessorios',
    name: 'faturamento.servicosAcessorios',
    component: () => import('./telas/ServicosAcessoriosTela.vue'),
    meta: { permissao: 'faturamento.regra.ler' },
  },
  {
    path: '/faturamento/regras-faturabilidade',
    name: 'faturamento.regras',
    component: () => import('./telas/RegrasTela.vue'),
    meta: { permissao: 'faturamento.regra.ler' },
  },
  {
    path: '/faturamento/simulador',
    name: 'faturamento.simulador',
    component: () => import('./telas/SimuladorTela.vue'),
    meta: { permissao: 'faturamento.preco.simular' },
  },
  {
    path: '/faturamento/particular/orcamentos',
    name: 'faturamento.orcamentos',
    component: () => import('./telas/OrcamentosTela.vue'),
    meta: { permissao: 'faturamento.orcamento.ler' },
  },
  {
    path: '/faturamento/particular/caixa',
    name: 'faturamento.caixa',
    component: () => import('./telas/CaixaTela.vue'),
    meta: { permissao: 'faturamento.recibo.ler' },
  },
  {
    path: '/faturamento/particular/pagamentos',
    name: 'faturamento.pagamentos',
    component: () => import('./telas/PagamentosTela.vue'),
    meta: { permissao: 'faturamento.pagamento.ler' },
  },
  {
    path: '/cirurgia/notas-sala',
    name: 'cirurgia.notasSala',
    component: () => import('./telas/NotasSalaTela.vue'),
    meta: { permissao: 'cirurgia.nota.ler' },
  },
  {
    path: '/cirurgia/cirurgias/:id(\\d+)/nota-sala',
    name: 'cirurgia.notaSala',
    component: () => import('./telas/NotaSalaTela.vue'),
    props: true,
    meta: { permissao: 'cirurgia.nota.ler' },
  },
  // M51 (etapa 1): competência SUS e críticas (todos os instrumentos; BPA, APAC e AIH desligados, DP-35) e a CIHA.
  {
    path: '/faturamento/sus/competencias',
    name: 'faturamento.susCompetencias',
    component: () => import('./telas/CompetenciasSusTela.vue'),
    meta: { permissao: 'faturamento.sus.ler' },
  },
  {
    path: '/faturamento/sus/ciha',
    name: 'faturamento.susCiha',
    component: () => import('./telas/CihaTela.vue'),
    meta: {
      permissao: 'faturamento.sus.ler',
      menu: 'Faturamento > Faturamento SUS > CIHA (comunicação de informação hospitalar)',
    },
  },
  // M51 (etapa 2): o BPA (desligado por estabelecimento até haver contrato SUS, DP-35) e os médicos solicitantes SUS.
  {
    path: '/faturamento/sus/bpa',
    name: 'faturamento.susBpa',
    component: () => import('./telas/BpaTela.vue'),
    meta: {
      permissao: 'faturamento.sus.ler',
      menu: 'Faturamento > Faturamento SUS > BPA (produção ambulatorial)',
    },
  },
  // M51 (etapa 3): a APAC (desligada por estabelecimento até haver contrato SUS, DP-35).
  {
    path: '/faturamento/sus/apac',
    name: 'faturamento.susApac',
    component: () => import('./telas/ApacTela.vue'),
    meta: {
      permissao: 'faturamento.sus.ler',
      menu: 'Faturamento > Faturamento SUS > APAC (laudos e autorizações)',
    },
  },
  {
    path: '/faturamento/sus/solicitantes',
    name: 'faturamento.susSolicitantes',
    component: () => import('./telas/SolicitantesSusTela.vue'),
    meta: {
      permissao: 'faturamento.susSolicitante.ler',
      menu: 'Faturamento > Faturamento SUS > Médicos solicitantes SUS',
    },
  },
  // M51 (etapa 4): a AIH, o retorno do gestor e os leitos de UTI habilitados (desligados por estabelecimento até haver
  // contrato SUS, DP-35).
  {
    path: '/faturamento/sus/aih',
    name: 'faturamento.susAih',
    component: () => import('./telas/AihTela.vue'),
    meta: {
      permissao: 'faturamento.sus.ler',
      menu: 'Faturamento > Faturamento SUS > AIH (internação, SIH)',
    },
  },
  // M55 (etapa 5): a contratualização SUS (contratos com o gestor, incentivos, metas, apuração e o painel produção ×
  // meta com o repasse estimado; desligada por estabelecimento até haver contrato SUS, DP-13 e DP-35).
  {
    path: '/faturamento/sus/contratualizacao',
    name: 'faturamento.susContratualizacao',
    component: () => import('./telas/ContratualizacaoTela.vue'),
    meta: {
      permissao: 'faturamento.contratualizacao.ler',
      menu: 'Faturamento > Faturamento SUS > Contratualização SUS (metas e incentivos)',
    },
  },
  {
    path: '/faturamento/sus/retorno',
    name: 'faturamento.susRetorno',
    component: () => import('./telas/RetornoSusTela.vue'),
    meta: { permissao: 'faturamento.sus.ler' },
  },
  {
    path: '/faturamento/sus/cadastros/leitos-uti',
    name: 'faturamento.susLeitosUti',
    component: () => import('./telas/LeitosUtiSusTela.vue'),
    meta: { permissao: 'faturamento.susLeitoUti.ler' },
  },
  {
    path: '/inicio/faturamento',
    name: 'inicio.faturamento',
    component: () => import('./telas/WorklistFaturamentoTela.vue'),
    meta: { permissao: 'faturamento.conta.ler' },
  },
  // F3.7 (06-FAT linha 39): conta corrente do paciente particular (busca pelo menu ou direto pelo paciente).
  {
    path: '/faturamento/conta-corrente',
    name: 'faturamento.contaCorrenteBusca',
    component: () => import('./telas/ContaCorrentePacienteTela.vue'),
    meta: {
      permissao: 'faturamento.pagamento.ler',
      menu: 'Faturamento > Particular > Conta corrente do paciente',
    },
  },
  {
    path: '/faturamento/pacientes/:id(\\d+)/conta-corrente',
    name: 'faturamento.contaCorrente',
    component: () => import('./telas/ContaCorrentePacienteTela.vue'),
    props: true,
    meta: { permissao: 'faturamento.pagamento.ler' },
  },
  // F3.7 (06-FAT linha 40): modelos de orçamento padrão por procedimento e acomodação.
  {
    path: '/faturamento/modelos-orcamento',
    name: 'faturamento.modelosOrcamento',
    component: () => import('./telas/ModelosOrcamentoTela.vue'),
    meta: { permissao: 'faturamento.orcamento.ler', menu: 'Faturamento > Particular > Modelos de orçamento' },
  },
];
