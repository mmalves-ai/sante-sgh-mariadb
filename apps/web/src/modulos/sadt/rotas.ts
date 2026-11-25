// Rotas do SADT, dos laudos e do portal de resultados (M26; ficha, seção 7). Cada rota interna exige a permissão de
// leitura do catálogo (M06); o servidor confere de novo e as ações aparecem só com a permissão de agir e a
// funcionalidade liberada. O portal é outro domínio de identidade: fora da casca e da sessão interna.
import type { RouteRecordRaw } from 'vue-router';

export const rotasSadt: RouteRecordRaw[] = [
  // M47 (etapa 1): a agência transfusional (requisições e amostras; reações e hemovigilância).
  {
    path: '/sadt/agencia/requisicoes',
    name: 'sadt.agencia.requisicoes',
    component: () => import('./telas/RequisicoesTransfusaoTela.vue'),
    meta: { permissao: 'sadt.transfusao.ler' },
  },
  {
    path: '/sadt/agencia/hemovigilancia',
    name: 'sadt.agencia.hemovigilancia',
    component: () => import('./telas/HemovigilanciaTela.vue'),
    meta: { permissao: 'sadt.reacao.ler' },
  },
  // M47 (etapa 2): a imuno-hematologia e a prova cruzada; o estoque de hemocomponentes (agência própria, DP-21).
  {
    path: '/sadt/agencia/imuno',
    name: 'sadt.agencia.imuno',
    component: () => import('./telas/ImunoHematologiaTela.vue'),
    meta: { permissao: 'sadt.imuno.ler' },
  },
  {
    path: '/sadt/agencia/estoque',
    name: 'sadt.agencia.estoque',
    component: () => import('./telas/EstoqueBolsasTela.vue'),
    meta: { permissao: 'sadt.bolsa.ler' },
  },
  // F3.5: pedido de exames com restrições na hora e a recoleta com as alíquotas.
  {
    path: '/sadt/pedido',
    name: 'sadt.pedido',
    component: () => import('./telas/PedidoExamesTela.vue'),
    meta: { permissao: 'sadt.requisicao.criar' },
  },
  {
    path: '/sadt/recoletas',
    name: 'sadt.recoletas',
    component: () => import('./telas/RecoletasTela.vue'),
    meta: { permissao: 'sadt.amostra.ler' },
  },
  // F3.5 (05-SADT linha 7): o cadastro próprio do posto de coleta, aberto pela tela de recoletas.
  {
    path: '/sadt/postos-coleta',
    name: 'sadt.postos-coleta',
    component: () => import('./telas/PostosColetaTela.vue'),
    meta: { permissao: 'sadt.amostra.ler' },
  },
  // F7 (05-SADT linha 12): painéis de antibiograma e pontos de corte (a cultura fica na digitação do resultado).
  {
    path: '/sadt/microbiologia/cadastro',
    name: 'sadt.microbiologia.cadastro',
    component: () => import('./telas/AntibiogramaCadastroTela.vue'),
    meta: { permissao: 'sadt.catalogo.ler' },
  },
  // F3.5 (05-SADT linha 19): a escala de execução por setor (grade da semana) e a fila do setor.
  {
    path: '/sadt/escala-execucao',
    name: 'sadt.escala-execucao',
    component: () => import('./telas/EscalaExecucaoTela.vue'),
    meta: { permissao: 'sadt.catalogo.ler' },
  },
  {
    path: '/sadt/atendimentos',
    name: 'sadt.atendimentos',
    component: () => import('./telas/AtendimentosSadtTela.vue'),
    meta: { permissao: 'sadt.requisicao.ler' },
  },
  {
    path: '/sadt/exames',
    name: 'sadt.exames',
    component: () => import('./telas/ExamesSadtTela.vue'),
    meta: { permissao: 'sadt.lancamento.ler' },
  },
  {
    path: '/sadt/catalogo',
    name: 'sadt.catalogo',
    component: () => import('./telas/CatalogoExamesTela.vue'),
    meta: { permissao: 'sadt.catalogo.ler' },
  },
  // F3.5 (05-SADT linha 21): a entrega de resultados no balcão e o cadastro do prazo e da publicação no portal.
  {
    path: '/sadt/entregas',
    name: 'sadt.entregas',
    component: () => import('./telas/EntregaResultadosTela.vue'),
    meta: { permissao: 'sadt.laudo.ler' },
  },
  {
    path: '/sadt/entregas/cadastro',
    name: 'sadt.entregas.cadastro',
    component: () => import('./telas/EntregaCadastroTela.vue'),
    meta: { permissao: 'sadt.catalogo.ler' },
  },
  {
    path: '/sadt/limites',
    name: 'sadt.limites',
    component: () => import('./telas/LimitesExameTela.vue'),
    meta: { permissao: 'sadt.catalogo.ler' },
  },
  {
    path: '/sadt/autoliberacao',
    name: 'sadt.autoliberacao',
    component: () => import('./telas/AutoliberacaoTela.vue'),
    meta: { permissao: 'sadt.resultado.ler' },
  },
  {
    path: '/sadt/orcamentos',
    name: 'sadt.orcamentos',
    component: () => import('./telas/OrcamentosTela.vue'),
    meta: { permissao: 'sadt.orcamento.ler' },
  },
  {
    path: '/sadt/coleta',
    name: 'sadt.coleta',
    component: () => import('./telas/ColetaTela.vue'),
    meta: { permissao: 'sadt.amostra.ler' },
  },
  {
    path: '/sadt/mapa-trabalho',
    name: 'sadt.mapa',
    component: () => import('./telas/ColetaTela.vue'),
    meta: { permissao: 'sadt.amostra.ler' },
  },
  {
    path: '/sadt/amostras',
    name: 'sadt.amostras',
    component: () => import('./telas/AmostrasTela.vue'),
    meta: { permissao: 'sadt.amostra.ler' },
  },
  {
    path: '/sadt/resultados/digitacao',
    name: 'sadt.digitacao',
    component: () => import('./telas/DigitacaoTela.vue'),
    meta: { permissao: 'sadt.resultado.ler' },
  },
  {
    path: '/sadt/resultados/liberacao',
    name: 'sadt.liberacao',
    component: () => import('./telas/LiberacaoTela.vue'),
    meta: { permissao: 'sadt.resultado.ler' },
  },
  // M47 (etapa 3): a lista de trabalho DICOM e a integração com o PACS/RIS.
  {
    path: '/sadt/imagem/worklist',
    name: 'sadt.imagem.worklist',
    component: () => import('./telas/WorklistDicomTela.vue'),
    meta: { permissao: 'sadt.pacs.ler' },
  },
  {
    path: '/sadt/valores-criticos',
    name: 'sadt.criticos',
    component: () => import('./telas/CriticosTela.vue'),
    meta: { permissao: 'sadt.valorCritico.ler' },
  },
  {
    path: '/sadt/laudos/emissao',
    name: 'sadt.laudos.emissao',
    component: () => import('./telas/LaudosEmissaoTela.vue'),
    meta: { permissao: 'sadt.laudo.ler' },
  },
  // Manutenção dos modelos de laudo (05-SADT linha 16): os do estabelecimento e os pessoais do médico.
  {
    path: '/sadt/laudos/modelos',
    name: 'sadt.laudos.modelos',
    component: () => import('./telas/LaudoModelosTela.vue'),
    meta: { permissao: 'sadt.laudo.ler' },
  },
  // Redação do laudo e laudo estruturado (05-SADT linhas 16 e 17): ?item=<exame_item>.
  {
    path: '/sadt/laudos/redacao',
    name: 'sadt.laudos.redacao',
    component: () => import('./telas/LaudoRedacaoTela.vue'),
    meta: { permissao: 'sadt.laudo.ler' },
  },
  // C2-027 (04-CC linha 107): o registro estruturado do exame de hemodinâmica (atalho na tela de métodos gráficos).
  {
    path: '/sadt/hemodinamica',
    name: 'sadt.hemodinamica',
    component: () => import('./telas/HemodinamicaTela.vue'),
    meta: { permissao: 'sadt.laudo.ler' },
  },
  // C2-071 (05-SADT linha 18): laudos estruturados de mamografia e de anatomia patológica, peças da cirurgia e SISCAN.
  {
    path: '/sadt/laudos/especializados',
    name: 'sadt.laudos.especializados',
    component: () => import('./telas/LaudoMamaPatologiaTela.vue'),
    meta: { permissao: 'sadt.laudo.ler' },
  },
  {
    path: '/sadt/laudos',
    name: 'sadt.laudos',
    component: () => import('./telas/LaudoRedacaoTela.vue'),
    meta: { permissao: 'sadt.laudo.ler' },
  },
  {
    path: '/sadt/indicadores',
    name: 'sadt.indicadores',
    component: () => import('./telas/IndicadoresSadtTela.vue'),
    meta: { permissao: 'sadt.indicador.ler' },
  },
  {
    path: '/sadt/solicitantes/autocadastro',
    name: 'sadt.autocadastro',
    component: () => import('./telas/AutocadastroTela.vue'),
    meta: { permissao: 'sadt.solicitanteWeb.ler' },
  },
  // Portal de resultados (paciente e médico externo): sem casca e sem a sessão interna.
  {
    path: '/resultados/:estabelecimento([a-z0-9]{1,10})?',
    name: 'portal.resultados',
    component: () => import('./telas/PortalResultadosTela.vue'),
    meta: { publica: true, dispositivo: true },
  },
  {
    path: '/resultados/validar/:codigo',
    name: 'portal.validar',
    component: () => import('./telas/PortalMedicoCadastroTela.vue'),
    meta: { publica: true, dispositivo: true },
  },
  {
    path: '/medico/cadastro',
    name: 'portal.medico',
    component: () => import('./telas/PortalMedicoCadastroTela.vue'),
    meta: { publica: true, dispositivo: true },
  },
];
