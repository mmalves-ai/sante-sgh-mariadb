// Rotas do financeiro e fiscal (M32; ficha, seção 7). Cada rota exige a permissão de leitura do catálogo (M06); o
// servidor confere de novo (e o escopo de contas bancárias) e as ações aparecem só com a permissão de agir e a
// funcionalidade liberada no estabelecimento. Os cadastros financeiros, os parâmetros e as naturezas de operação são o
// CRUD genérico dos subitens do M32 (`/cadastros/financeiro/*` leva a eles).
import type { RouteRecordRaw } from 'vue-router';

export const rotasFinanceiro: RouteRecordRaw[] = [
  {
    path: '/financeiro/pagar/titulos',
    name: 'financeiro.pagar.titulos',
    component: () => import('./telas/TitulosPagarTela.vue'),
    meta: { permissao: 'financeiro.tituloPagar.ler' },
  },
  {
    path: '/financeiro/pagar/titulos/:id(\\d+)',
    name: 'financeiro.pagar.titulo',
    component: () => import('./telas/TituloPagarTela.vue'),
    props: true,
    meta: { permissao: 'financeiro.tituloPagar.ler' },
  },
  {
    path: '/financeiro/pagar/aprovacao',
    name: 'financeiro.pagar.aprovacao',
    component: () => import('./telas/AprovacaoTela.vue'),
    meta: { permissao: 'financeiro.tituloPagar.ler' },
  },
  {
    // F8, 07-FIN linha 65: fluxo de aprovação configurável (título a pagar, pedido de compra e contrato).
    path: '/financeiro/aprovacao/fluxos',
    name: 'financeiro.aprovacao.fluxos',
    component: () => import('./telas/FluxosAprovacaoTela.vue'),
    meta: { permissao: 'financeiro.fluxoAprovacao.configurar' },
  },
  {
    // F8, 07-FIN linha 65: a fila do aprovador, responsiva para o celular.
    path: '/financeiro/aprovacoes',
    name: 'financeiro.aprovacoes',
    component: () => import('./telas/AprovacoesCelularTela.vue'),
    meta: { permissao: 'financeiro.fluxoAprovacao.decidir' },
  },
  {
    path: '/financeiro/pagar/borderos',
    name: 'financeiro.pagar.borderos',
    component: () => import('./telas/BorderosTela.vue'),
    meta: { permissao: 'financeiro.bordero.ler' },
  },
  {
    path: '/financeiro/pagar/remessas',
    name: 'financeiro.pagar.remessas',
    component: () => import('./telas/RemessasTela.vue'),
    meta: { permissao: 'financeiro.remessa.ler' },
  },
  {
    // F3.8, 07-FIN linha 66: retorno do banco, remessa por Pix e dados bancários do credor.
    path: '/financeiro/pagar/pagamento-eletronico',
    name: 'financeiro.pagar.pagamentoEletronico',
    component: () => import('./telas/PagamentoEletronicoTela.vue'),
    // C1-026: o cadastro de credores entra só na aba dos dados bancários (sem ler nem gerar remessa).
    meta: { permissao: 'financeiro.remessa.ler', permissaoOu: ['financeiro.contaCredor.manter'] },
  },
  {
    path: '/financeiro/pagar/adiantamentos',
    name: 'financeiro.pagar.adiantamentos',
    component: () => import('./telas/AdiantamentosTela.vue'),
    meta: { permissao: 'financeiro.adiantamento.ler' },
  },
  {
    // F7, 07-FIN linha 78: cobrança bancária com boleto (carteiras, emissão, remessa e retorno).
    path: '/financeiro/receber/cobranca-bancaria',
    name: 'financeiro.receber.cobrancaBancaria',
    component: () => import('./telas/CobrancaBancariaTela.vue'),
    meta: { permissao: 'financeiro.cobrancaBancaria.ler' },
  },
  {
    path: '/financeiro/receber/titulos',
    name: 'financeiro.receber.titulos',
    component: () => import('./telas/TitulosReceberTela.vue'),
    meta: { permissao: 'financeiro.tituloReceber.ler' },
  },
  {
    path: '/financeiro/receber/titulos/:id(\\d+)',
    name: 'financeiro.receber.titulo',
    component: () => import('./telas/TituloReceberTela.vue'),
    props: true,
    meta: { permissao: 'financeiro.tituloReceber.ler' },
  },
  {
    path: '/financeiro/receber/convenios',
    name: 'financeiro.receber.convenios',
    component: () => import('./telas/ConveniosTela.vue'),
    meta: { permissao: 'financeiro.creditoConvenio.ler' },
  },
  {
    path: '/financeiro/receber/demonstrativos',
    name: 'financeiro.receber.demonstrativos',
    component: () => import('./telas/DemonstrativosReceberTela.vue'),
    meta: { permissao: 'financeiro.tituloReceber.ler' },
  },
  {
    // F3.8, 07-FIN linha 89: parcelas a receber das administradoras de cartão e taxas com vigência.
    path: '/financeiro/receber/cartao',
    name: 'financeiro.receber.cartao',
    component: () => import('./telas/CartaoTela.vue'),
    meta: { permissao: 'financeiro.movimento.ler' },
  },
  {
    // F7, 07-FIN linha 90: cobrança Pix sobre o título a receber, com a baixa automática e a devolução.
    path: '/financeiro/receber/pix',
    name: 'financeiro.receber.pix',
    component: () => import('./telas/CobrancaPixTela.vue'),
    meta: { permissao: 'financeiro.cobrancaBancaria.ler' },
  },
  {
    path: '/financeiro/receber/renegociacoes',
    name: 'financeiro.receber.renegociacoes',
    component: () => import('./telas/RenegociacoesTela.vue'),
    meta: { permissao: 'financeiro.tituloReceber.ler' },
  },
  {
    path: '/financeiro/tesouraria/movimento',
    name: 'financeiro.tesouraria.movimento',
    component: () => import('./telas/MovimentoTela.vue'),
    meta: { permissao: 'financeiro.movimento.ler' },
  },
  {
    path: '/financeiro/tesouraria/periodo',
    name: 'financeiro.tesouraria.periodo',
    component: () => import('./telas/PeriodoFinanceiroTela.vue'),
    meta: { permissao: 'financeiro.movimento.ler' },
  },
  {
    path: '/financeiro/tesouraria/conciliacao',
    name: 'financeiro.tesouraria.conciliacao',
    component: () => import('./telas/ConciliacaoTela.vue'),
    meta: { permissao: 'financeiro.conciliacao.ler' },
  },
  {
    // F8, 07-FIN linha 68: previsão e provisão de pagamentos (previsto × realizado e as ações da ocorrência).
    path: '/financeiro/tesouraria/previsao',
    name: 'financeiro.tesouraria.previsao',
    component: () => import('./telas/PrevisaoProvisaoTela.vue'),
    meta: { permissao: 'financeiro.fluxoCaixa.ler' },
  },
  {
    // F8, 07-FIN linha 69: encontro de contas entre o que se paga e o que se recebe do mesmo parceiro.
    path: '/financeiro/tesouraria/encontro-contas',
    name: 'financeiro.tesouraria.encontroContas',
    component: () => import('./telas/EncontroContasTela.vue'),
    meta: { permissao: 'financeiro.tituloPagar.ler' },
  },
  {
    // F7, 07-FIN linha 114 (C2-059): NF-e de saída de mercadoria (devolução ao fornecedor, consignado, conserto, avulsa).
    path: '/financeiro/fiscal/notas-mercadoria',
    name: 'financeiro.fiscal.notasMercadoria',
    component: () => import('./telas/NotasMercadoriaTela.vue'),
    meta: { permissao: 'financeiro.notaMercadoria.ler' },
  },
  {
    // F7, 09-AREA linha 78 (C2-094): entrada de serviço tomado (nota contra o pedido, retenções e câmbio, EFD-REINF).
    path: '/financeiro/fiscal/entradas-servico',
    name: 'financeiro.fiscal.entradasServico',
    component: () => import('./telas/EntradasServicoTela.vue'),
    meta: { permissao: 'financeiro.entradaServico.ler' },
  },
  {
    // F8, 07-FIN linha 70: notas de crédito e de débito com tributos, do fornecedor e do cliente.
    path: '/financeiro/notas-credito-debito',
    name: 'financeiro.notasCreditoDebito',
    component: () => import('./telas/NotasCreditoDebitoTela.vue'),
    meta: { permissao: 'financeiro.notaCreditoDebito.ler' },
  },
  {
    // F8, 07-FIN linha 79: portador do título a receber, desconto de duplicata e cessão de recebíveis.
    path: '/financeiro/receber/cessao',
    name: 'financeiro.receber.cessao',
    component: () => import('./telas/CessaoRecebiveisTela.vue'),
    meta: { permissao: 'financeiro.cessaoRecebivel.ler' },
  },
  {
    path: '/financeiro/tesouraria/fluxo-caixa',
    name: 'financeiro.tesouraria.fluxo',
    component: () => import('./telas/FluxoCaixaTela.vue'),
    meta: { permissao: 'financeiro.fluxoCaixa.ler' },
  },
  {
    path: '/financeiro/gerencial',
    name: 'financeiro.gerencial',
    component: () => import('./telas/GerencialTela.vue'),
    meta: { permissao: 'financeiro.classificacao.ler' },
  },
  {
    // F3.8, 07-FIN linha 98: reclassificação gerencial de lançamento já gravado (?alvo=&id=).
    path: '/financeiro/gerencial/reclassificar',
    name: 'financeiro.gerencial.reclassificar',
    component: () => import('./telas/ReclassificacaoTela.vue'),
    meta: { permissao: 'financeiro.classificacao.ler' },
  },
  {
    // F3.8, 07-FIN linha 99: escopo de contas por usuário e tipos de lançamento por perfil.
    path: '/financeiro/parametros/permissoes',
    name: 'financeiro.parametros.permissoes',
    component: () => import('./telas/PermissoesFinanceiroTela.vue'),
    meta: { permissao: 'financeiro.parametro.ler' },
  },
  {
    path: '/financeiro/parametros',
    name: 'financeiro.parametros',
    component: () => import('./telas/ParametrosTela.vue'),
    meta: { permissao: 'financeiro.parametro.ler' },
  },
  {
    path: '/financeiro/fiscal/entradas',
    name: 'financeiro.fiscal.entradas',
    component: () => import('./telas/EntradasTela.vue'),
    meta: { permissao: 'financeiro.escrituracao.ler' },
  },
  {
    path: '/financeiro/fiscal/nfse',
    name: 'financeiro.fiscal.nfse',
    component: () => import('./telas/NfseTela.vue'),
    meta: { permissao: 'financeiro.nfse.ler' },
  },
  {
    path: '/financeiro/fiscal/dmed',
    name: 'financeiro.fiscal.dmed',
    component: () => import('./telas/DeclaracoesTela.vue'),
    props: { tipo: 'dmed' },
    meta: { permissao: 'financeiro.dmed.ler' },
  },
  {
    path: '/financeiro/fiscal/reinf',
    name: 'financeiro.fiscal.reinf',
    component: () => import('./telas/DeclaracoesTela.vue'),
    props: { tipo: 'reinf' },
    meta: { permissao: 'financeiro.reinf.ler' },
  },
  {
    path: '/financeiro/contabil/exportacao',
    name: 'financeiro.contabil.exportacao',
    component: () => import('./telas/ExportacaoContabilTela.vue'),
    meta: { permissao: 'financeiro.exportacaoContabil.ler' },
  },
  {
    path: '/inicio/financeiro',
    name: 'inicio.financeiro',
    component: () => import('./telas/WorklistFinanceiroTela.vue'),
    // D-MODULO-32: a fila abre para quem tem qualquer opção do financeiro (cada cartão segue a sua permissão).
    meta: { permissao: 'financeiro.modulo.ler' },
  },
  // Os cadastros financeiros e as naturezas de operação (CRUD genérico dos subitens do M32).
  { path: '/cadastros/financeiro', redirect: '/cadastros/dominios/grupo/financeiroCadastros' },
  { path: '/cadastros/financeiro/naturezas', redirect: '/cadastros/dominios/grupo/financeiroNaturezas' },
];
