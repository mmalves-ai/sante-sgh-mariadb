// Rotas do estoque, do almoxarifado e das compras (M28; ficha, seção 7). Cada rota exige a permissão de leitura do
// catálogo (M06); o servidor confere de novo e as ações aparecem só com a permissão de agir e a operação liberada.
import type { RouteRecordRaw } from 'vue-router';

export const rotasSuprimentos: RouteRecordRaw[] = [
  // M46 (etapa 3): OPME (as solicitações e as etapas, o consumo em sala com a etiqueta e a conciliação com a conta, com o
  // rastreio reverso). A escrita sob a chave suprimentos.opme; a leitura pela permissão.
  {
    path: '/suprimentos/opme',
    name: 'suprimentos.opme',
    component: () => import('./telas/OpmeSolicitacoesTela.vue'),
    meta: { permissao: 'suprimentos.opme.ler' },
  },
  {
    path: '/suprimentos/opme/conciliacao',
    name: 'suprimentos.opme.conciliacao',
    component: () => import('./telas/OpmeConciliacaoTela.vue'),
    meta: { permissao: 'suprimentos.opme.conciliar' },
  },
  {
    path: '/suprimentos/opme/rastreio',
    name: 'suprimentos.opme.rastreio',
    component: () => import('./telas/OpmeRastreioTela.vue'),
    meta: { permissao: 'suprimentos.lote.rastrear' },
  },
  {
    path: '/bloco/opme/:agenda(\\d+)?',
    name: 'bloco.opme',
    component: () => import('./telas/OpmeConsumoTela.vue'),
    props: (r) => ({ agenda: r.params['agenda'] ?? '' }),
    meta: { permissao: 'suprimentos.opme.ler' },
  },
  // M46 (etapa 4): os consignados (saldo por fornecedor, remessa, reposição, faturamento e devolução ao fornecedor) e a
  // manipulação (os itens validados, a ordem com a capela, a dupla conferência e a baixa do insumo).
  {
    path: '/suprimentos/consignados',
    name: 'suprimentos.consignados',
    component: () => import('./telas/ConsignadosTela.vue'),
    meta: { permissao: 'suprimentos.consignado.ler' },
  },
  {
    path: '/farmacia/manipulacao',
    name: 'farmacia.manipulacao',
    component: () => import('./telas/ManipulacaoTela.vue'),
    meta: { permissao: 'suprimentos.manipulacao.ler' },
  },
  // M55 (etapa 3): contratos com fornecedores (o painel, a lista, o cadastro, os eventos, a avaliação e os vínculos).
  {
    path: '/suprimentos/contratos',
    name: 'suprimentos.contratos',
    component: () => import('./telas/ContratosTela.vue'),
    meta: { permissao: 'suprimentos.contrato.ler' },
  },
  // 09-AREA linha 66: homologação de fornecedores por questionário pontuado (avaliar, ranking, exceção, questionários).
  {
    path: '/suprimentos/homologacao-fornecedores',
    name: 'suprimentos.homologacao-fornecedores',
    component: () => import('./telas/HomologacaoFornecedoresTela.vue'),
    meta: { permissao: 'suprimentos.contrato.ler' },
  },
  // M55 (etapa 4): licitação e pregão (o painel por etapa, o termo, a pesquisa, a sessão, o julgamento e a homologação).
  {
    path: '/suprimentos/licitacao',
    name: 'suprimentos.licitacao',
    component: () => import('./telas/LicitacoesTela.vue'),
    meta: { permissao: 'suprimentos.licitacao.ler' },
  },
  {
    path: '/suprimentos/itens',
    name: 'suprimentos.itens',
    component: () => import('./telas/ItensTela.vue'),
    meta: { permissao: 'suprimentos.item.ler' },
  },
  {
    path: '/suprimentos/fornecedores',
    name: 'suprimentos.fornecedores',
    component: () => import('./telas/FornecedoresTela.vue'),
    meta: { permissao: 'suprimentos.fornecedor.ler' },
  },
  {
    path: '/suprimentos/locais',
    name: 'suprimentos.locais',
    component: () => import('./telas/LocaisTela.vue'),
    meta: { permissao: 'suprimentos.local.ler' },
  },
  {
    path: '/suprimentos/usuarios-locais',
    name: 'suprimentos.usuariosLocais',
    component: () => import('./telas/UsuariosEstoqueTela.vue'),
    meta: { permissao: 'acesso.escopo.ler' },
  },
  {
    path: '/suprimentos/parametros',
    name: 'suprimentos.parametros',
    component: () => import('./telas/ParametrosTela.vue'),
    meta: { permissao: 'config.parametro.ler' },
  },
  {
    path: '/suprimentos/pedidos',
    name: 'suprimentos.pedidos',
    component: () => import('./telas/PedidosTela.vue'),
    props: { modo: 'pedidos' },
    meta: { permissao: 'suprimentos.pedido.ler' },
  },
  {
    path: '/suprimentos/cotacao',
    name: 'suprimentos.cotacao',
    component: () => import('./telas/PedidosTela.vue'),
    props: { modo: 'cotacao' },
    meta: { permissao: 'suprimentos.cotacao.ler' },
  },
  {
    path: '/suprimentos/pedidos/:ano(\\d+)/:doc(\\d+)/cotacao',
    name: 'suprimentos.mapaCotacao',
    component: () => import('./telas/CotacaoTela.vue'),
    props: true,
    meta: { permissao: 'suprimentos.cotacao.ler' },
  },
  {
    // F3.6 (05-SUP linha 20): acompanhar o pedido emitido (agenda de entregas, contatos e cancelamento).
    path: '/suprimentos/pedidos/:ano(\\d+)/:doc(\\d+)/acompanhar',
    name: 'suprimentos.pedidoGestao',
    component: () => import('./telas/PedidoGestaoTela.vue'),
    props: true,
    meta: { permissao: 'suprimentos.pedido.ler' },
  },
  {
    path: '/suprimentos/aprovacoes',
    name: 'suprimentos.aprovacoes',
    component: () => import('./telas/AprovacoesTela.vue'),
    meta: { permissao: 'suprimentos.pedido.ler' },
  },
  {
    path: '/suprimentos/historico-compras',
    name: 'suprimentos.historicoCompras',
    component: () => import('./telas/HistoricoComprasTela.vue'),
    meta: { permissao: 'suprimentos.compra.ler' },
  },
  {
    path: '/suprimentos/notas-fiscais',
    name: 'suprimentos.notas',
    component: () => import('./telas/NotasTela.vue'),
    meta: { permissao: 'suprimentos.nota.ler' },
  },
  {
    // F3.6 (05-SUP linhas 1, 3 e 6): cadastro do item e do local, escopo do usuário e lista de separação.
    path: '/suprimentos/itens/cadastro/:id(\\d+)?',
    name: 'suprimentos.itens.cadastro',
    component: () => import('./telas/ItemCadastroTela.vue'),
    meta: { permissao: 'suprimentos.item.editar' },
  },
  {
    path: '/suprimentos/locais/cadastro',
    name: 'suprimentos.locais.cadastro',
    component: () => import('./telas/LocalCadastroTela.vue'),
    meta: { permissao: 'suprimentos.local.editar' },
  },
  {
    // F3.6 (05-SUP linha 14): etiquetas de identificação do estoque (DataMatrix e código de barras).
    path: '/suprimentos/etiquetas',
    name: 'suprimentos.etiquetas',
    component: () => import('./telas/EtiquetasTela.vue'),
    meta: { permissao: 'suprimentos.nota.registrar' },
  },
  {
    // F8 (05-SUP linha 4): endereçamento do armazém (endereços em níveis e o endereço de cada item).
    path: '/suprimentos/enderecamento',
    name: 'suprimentos.enderecamento',
    component: () => import('./telas/EnderecamentoTela.vue'),
    meta: { permissao: 'suprimentos.local.ler' },
  },
  {
    path: '/suprimentos/usuarios-estoque/escopo',
    name: 'suprimentos.usuarios-estoque.escopo',
    component: () => import('./telas/EscopoUsuarioCadastroTela.vue'),
    meta: { permissao: 'acesso.escopo.editar' },
  },
  {
    path: '/suprimentos/requisicoes/:id(\\d+)/separacao',
    name: 'suprimentos.requisicoes.separacao',
    component: () => import('./telas/SeparacaoTela.vue'),
    meta: { permissao: 'suprimentos.requisicao.ler' },
  },
  {
    path: '/suprimentos/requisicoes',
    name: 'suprimentos.requisicoes',
    component: () => import('./telas/RequisicoesTela.vue'),
    meta: { permissao: 'suprimentos.requisicao.ler' },
  },
  {
    path: '/suprimentos/saidas',
    name: 'suprimentos.saidas',
    component: () => import('./telas/SaidasTela.vue'),
    meta: { permissao: 'suprimentos.saida.ler' },
  },
  {
    path: '/suprimentos/movimento-direto',
    name: 'suprimentos.movimentoDireto',
    component: () => import('./telas/MovimentoDiretoTela.vue'),
    meta: { permissao: 'suprimentos.saida.ler' },
  },
  {
    path: '/suprimentos/transferencias',
    name: 'suprimentos.transferencias',
    component: () => import('./telas/TransferenciasTela.vue'),
    meta: { permissao: 'suprimentos.transferencia.ler' },
  },
  {
    path: '/suprimentos/devolucoes',
    name: 'suprimentos.devolucoes',
    component: () => import('./telas/DevolucoesTela.vue'),
    meta: { permissao: 'suprimentos.devolucao.ler' },
  },
  {
    path: '/suprimentos/saldos',
    name: 'suprimentos.saldos',
    component: () => import('./telas/SaldosTela.vue'),
    meta: { permissao: 'suprimentos.saldo.ler' },
  },
  {
    path: '/suprimentos/lotes/rastreio',
    name: 'suprimentos.rastreio',
    component: () => import('./telas/RastreioTela.vue'),
    meta: { permissao: 'suprimentos.lote.rastrear' },
  },
  {
    path: '/suprimentos/documentos/:tipo(saida|devolucao|transferencia|nota|balanco|requisicao)/:ano(\\d+)/:mes(\\d+)/:doc(\\d+)',
    name: 'suprimentos.documento',
    component: () => import('./telas/DocumentoTela.vue'),
    meta: { permissao: 'suprimentos.saldo.ler' },
  },
  {
    path: '/suprimentos/kits',
    name: 'suprimentos.kits',
    component: () => import('./telas/KitsTela.vue'),
    meta: { permissao: 'suprimentos.kit.ler' },
  },
  {
    path: '/suprimentos/inventarios',
    name: 'suprimentos.inventarios',
    component: () => import('./telas/InventariosTela.vue'),
    meta: { permissao: 'suprimentos.inventario.ler' },
  },
  {
    path: '/suprimentos/consumo',
    name: 'suprimentos.consumo',
    component: () => import('./telas/ConsumoTela.vue'),
    meta: { permissao: 'suprimentos.consumo.ler' },
  },
  {
    path: '/suprimentos/fechamentos',
    name: 'suprimentos.fechamentos',
    component: () => import('./telas/FechamentosTela.vue'),
    meta: { permissao: 'suprimentos.fechamento.ler' },
  },
  {
    path: '/suprimentos/recalculos',
    name: 'suprimentos.recalculos',
    component: () => import('./telas/RecalculosTela.vue'),
    meta: { permissao: 'suprimentos.recalculo.ler' },
  },
  {
    path: '/suprimentos/sugestao-compra',
    name: 'suprimentos.sugestao',
    component: () => import('./telas/SugestaoCompraTela.vue'),
    meta: { permissao: 'suprimentos.sugestao.ler' },
  },
];
