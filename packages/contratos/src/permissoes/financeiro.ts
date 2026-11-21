// Permissões do M32 (ficha, seção 7; convencoes.md §12): contas a pagar, aprovação por alçada, borderô e pagamento,
// pagamentos eletrônicos, adiantamentos, contas a receber, conta corrente de convênios, baixa por demonstrativo,
// tesouraria (movimento, conciliação, fluxo de caixa), apropriação gerencial, cadastros e parâmetros financeiros, fiscal
// (escrituração, NFS-e, DMED, EFD-REINF) e exportação contábil. Quem tem a opção no outro sistema tem a permissão no
// novo (regra 1 do M06). Opções da árvore do menu de origem do Controle Financeiro (módulo 14, 248 opções; retrato
// tools/verificadores/dados/acesso-legado.pc.json), levantadas na primeira hora do marco. A ficha escreve os códigos com
// sublinhado (`financeiro.titulo_pagar.ler`); o catálogo exige camelCase (FORMATO_CODIGO_PERMISSAO): D-PERM-32.
import type { DeclaracaoPermissao } from './tipos.js';

export const OPCOES_FINANCEIRO_M32 = {
  tabelas: 102,
  parametros: 103,
  usuariosCompl: 104,
  contaDescontoAcrescimo: 105,
  lancamentos: 107,
  contasPagar: 108,
  pagarManutencao: 109,
  pagarAlterar: 110,
  pagarIncluir: 111,
  pagarExcluir: 112,
  pagarConsultar: 6283,
  pagarBaixa: 113,
  pagarBaixaAlterar: 114,
  pagarBaixaIncluir: 115,
  pagarBaixaConsultar: 6284,
  pagarListagem: 117,
  bordero: 135,
  autorizacaoPagamento: 136,
  previsaoPagamentos: 4350,
  renegociacao: 4351,
  contasReceber: 141,
  receberManutencao: 142,
  receberAlterar: 143,
  receberIncluir: 144,
  receberConsultar: 6287,
  receberBaixaDocumento: 146,
  receberBaixaAlterar: 147,
  receberBaixaIncluir: 148,
  receberBaixaConsultar: 6288,
  receberListagem: 151,
  creditosNaoIdentificados: 156,
  creditosManutencao: 157,
  creditosBaixa: 158,
  creditosListagem: 4035,
  extratoBancario: 170,
  saldoBancario: 171,
  saldoExtrato: 172,
  saldoAtual: 173,
  lancamentosBancarios: 174,
  bancarioAlterar: 175,
  bancarioIncluir: 176,
  bancarioConsultar: 6290,
  bancarioListagem: 178,
  bancarioConsulta: 4011,
  adiantamentos: 190,
  adiantamentoColaborador: 191,
  adiantamentoListagem: 193,
  adiantamentoFornecedor: 196,
  adiantamentoManutencao: 197,
  adiantamentoCompensacao: 198,
  rotinas: 5135,
  fechamentoEventos: 5136,
  reinfR2000: 6492,
  reinfR4000: 6736,
  relatorios: 199,
  fluxoCaixa: 201,
  fluxoCaixaRealizado: 4015,
  fluxoCaixaPrevisto: 6291,
  acertoPrevisao: 4016,
  impostos: 219,
  impostosPagar: 220,
  impostosPagarI: 4021,
  impostosPagarII: 4022,
  balancete: 229,
  balanceteI: 4023,
  balanceteII: 4024,
  recibos: 230,
  acompanhamentoDiario: 4026,
  idadeSaldos: 4027,
  demonstracoes: 5728,
  reinfRelatorio: 6797,
  exportacoes: 5137,
  exportacaoReinf: 5138,
  exportacaoBancos: 5440,
  caixa: 250,
  caixaAbertura: 251,
  caixaFechamento: 252,
  convenioNotaFiscal: 253,
  exportacaoContabil: 256,
  acertoRateioGsi: 4038,
  acertoRateioPagar: 244,
  dirf: 4039,
  exportacaoDirf: 6292,
  vincularNfse: 4354,
} as const;

const O = OPCOES_FINANCEIRO_M32;

const p = (
  codigo: string,
  descricao: string,
  opcoesLegado: readonly number[],
  extra: Partial<DeclaracaoPermissao> = {},
): DeclaracaoPermissao => ({
  codigo,
  descricao,
  opcoesLegado,
  concessaoPorPerfil: null,
  categoria: 'financeira',
  criticidade: 'normal',
  // O escopo do módulo financeiro (a conta bancária do usuário): vale para todas, como o catálogo gerado.
  escopos: ['contaBancaria'],
  ...extra,
});

const PAGAR_LER = [
  O.contasPagar,
  O.pagarManutencao,
  O.pagarConsultar,
  O.pagarListagem,
  O.pagarBaixaConsultar,
];
const RECEBER_LER = [
  O.contasReceber,
  O.receberManutencao,
  O.receberConsultar,
  O.receberBaixaDocumento,
  O.receberBaixaConsultar,
  O.receberListagem,
];
const TESOURARIA_LER = [
  O.extratoBancario,
  O.saldoBancario,
  O.saldoExtrato,
  O.saldoAtual,
  O.lancamentosBancarios,
  O.bancarioConsultar,
  O.bancarioListagem,
  O.bancarioConsulta,
];
const CONTA = { escopos: ['contaBancaria'] as const };

const PERMISSOES_DO_MODULO: readonly DeclaracaoPermissao[] = [
  p(
    'financeiro.tituloPagar.ler',
    'Consultar os títulos a pagar (situação derivada, retenções, aprovações)',
    PAGAR_LER,
  ),
  p(
    'financeiro.tituloPagar.criar',
    'Lançar o título a pagar (parcelas, classificação, retenções) e excluir o título em aberto',
    [O.pagarIncluir, O.pagarAlterar, O.pagarExcluir],
    { criticidade: 'sensivel' },
  ),
  p(
    'financeiro.tituloPagar.aprovar',
    'Aprovar o pagamento na alçada (quem lança não aprova; dupla aprovação acima do limite)',
    [O.autorizacaoPagamento],
    { criticidade: 'sensivel' },
  ),
  p(
    'financeiro.tituloPagar.aprovarDiretoria',
    'Aprovar o pagamento na alçada da diretoria (faixas acima do limite)',
    [O.autorizacaoPagamento],
    { criticidade: 'sensivel' },
  ),
  p(
    'financeiro.tituloPagar.baixar',
    'Pagar o título aprovado (sem borderô ou por borderô; quem aprova não paga)',
    [O.pagarBaixaIncluir, O.pagarBaixaAlterar, O.bordero],
    { criticidade: 'sensivel', ...CONTA },
  ),
  p('financeiro.bordero.ler', 'Consultar os borderôs de pagamento', [O.bordero, O.pagarListagem]),
  p(
    'financeiro.remessa.ler',
    'Consultar remessas e retornos bancários',
    [O.exportacaoBancos, O.bordero],
    CONTA,
  ),
  p(
    'financeiro.remessa.gerar',
    'Gerar a remessa bancária (fora de produção, só o simulador)',
    [O.exportacaoBancos],
    { criticidade: 'sensivel', ...CONTA },
  ),
  p('financeiro.adiantamento.ler', 'Consultar adiantamentos a fornecedores e médicos e as compensações', [
    O.adiantamentos,
    O.adiantamentoColaborador,
    O.adiantamentoFornecedor,
    O.adiantamentoManutencao,
    O.adiantamentoCompensacao,
    O.adiantamentoListagem,
  ]),
  p(
    'financeiro.tituloReceber.ler',
    'Consultar os títulos a receber, a glosa no título e as contas sem título',
    RECEBER_LER,
  ),
  p(
    'financeiro.tituloReceber.criar',
    'Criar o título a receber da conta (convênio pela competência, particular)',
    [O.receberIncluir, O.receberAlterar],
    { criticidade: 'sensivel' },
  ),
  p(
    'financeiro.tituloReceber.baixar',
    'Baixar por demonstrativo, com a glosa no título',
    [O.receberBaixaIncluir, O.receberBaixaAlterar],
    { criticidade: 'sensivel', ...CONTA },
  ),
  p(
    'financeiro.tituloReceber.baixarManual',
    'Baixa manual do título a receber (exceção, com motivo)',
    [O.receberBaixaIncluir],
    { criticidade: 'sensivel', ...CONTA },
  ),
  p(
    'financeiro.creditoConvenio.ler',
    'Consultar a conta corrente de convênios e os créditos não identificados',
    [O.creditosNaoIdentificados, O.creditosManutencao, O.creditosListagem],
  ),
  p(
    'financeiro.movimento.ler',
    'Consultar o movimento bancário e os saldos das contas do escopo',
    TESOURARIA_LER,
    CONTA,
  ),
  p(
    'financeiro.movimento.criar',
    'Lançar movimento bancário (tarifa, fechamento de caixa, transferência, crédito e débito avulsos)',
    [O.bancarioIncluir, O.bancarioAlterar, O.caixa, O.caixaAbertura, O.caixaFechamento],
    { criticidade: 'sensivel', ...CONTA },
  ),
  p(
    'financeiro.conciliacao.ler',
    'Consultar o extrato importado e as sugestões de conciliação',
    [O.extratoBancario, O.saldoExtrato, O.creditosNaoIdentificados],
    CONTA,
  ),
  p(
    'financeiro.conciliacao.conciliar',
    'Importar o extrato e confirmar a conciliação (quem pagou não concilia)',
    [O.creditosBaixa, O.bancarioIncluir],
    { criticidade: 'sensivel', ...CONTA },
  ),
  p('financeiro.fluxoCaixa.ler', 'Consultar o fluxo de caixa realizado e projetado', [
    O.fluxoCaixa,
    O.fluxoCaixaRealizado,
    O.fluxoCaixaPrevisto,
    O.acertoPrevisao,
  ]),
  p('financeiro.fluxoCaixa.exportar', 'Exportar o fluxo de caixa', [
    O.fluxoCaixaRealizado,
    O.fluxoCaixaPrevisto,
  ]),
  p('financeiro.classificacao.ler', 'Consultar a classificação gerencial e a DRE gerencial (duas réguas)', [
    O.balancete,
    O.balanceteI,
    O.balanceteII,
    O.acertoRateioGsi,
    O.demonstracoes,
  ]),
  p('financeiro.classificacao.editar', 'Ratear o documento por centro de custo (no novo)', [
    O.acertoRateioGsi,
    O.acertoRateioPagar,
  ]),
  p(
    'financeiro.indicador.ler',
    'Indicadores do financeiro (pagos sem aprovação, contas sem título, credor órfão)',
    [O.relatorios, O.acompanhamentoDiario, O.idadeSaldos, O.demonstracoes],
  ),
  p(
    'financeiro.cadastro.ler',
    'Consultar os cadastros financeiros (bancos, contas, formas de pagamento, naturezas)',
    [O.tabelas, O.contaDescontoAcrescimo, O.parametros],
  ),
  p(
    'financeiro.cadastro.editar',
    'Incluir e alterar os cadastros financeiros (sem credencial bancária)',
    [O.contaDescontoAcrescimo, O.parametros],
    { criticidade: 'sensivel' },
  ),
  p('financeiro.parametro.ler', 'Consultar os parâmetros financeiros, as alçadas e o escopo por conta', [
    O.parametros,
    O.usuariosCompl,
  ]),
  p(
    'financeiro.parametro.editar',
    'Editar os parâmetros financeiros, as faixas de alçada e o escopo por conta bancária do usuário',
    [O.parametros, O.usuariosCompl],
    { criticidade: 'sensivel' },
  ),
  p('financeiro.escrituracao.ler', 'Consultar a escrituração de entradas (SPED, CFOP por item)', [
    O.impostos,
    O.impostosPagar,
    O.impostosPagarI,
    O.impostosPagarII,
  ]),
  p('financeiro.nfse.ler', 'Consultar as NFS-e de saída', [O.vincularNfse, O.convenioNotaFiscal]),
  p(
    'financeiro.nfse.emitir',
    'Emitir NFS-e (fora de produção, o simulador; emissão real depois da DP-38)',
    [O.vincularNfse],
    { criticidade: 'sensivel' },
  ),
  p('financeiro.dmed.ler', 'Consultar as DMED geradas', [O.dirf, O.exportacaoDirf, O.recibos]),
  p('financeiro.dmed.gerar', 'Gerar a DMED (arquivo, não enviado até a DP-38)', [O.dirf, O.exportacaoDirf], {
    criticidade: 'sensivel',
  }),
  p('financeiro.reinf.ler', 'Consultar as EFD-REINF geradas (R-2000 e R-4000)', [
    O.reinfRelatorio,
    O.exportacaoReinf,
    O.fechamentoEventos,
    O.reinfR2000,
    O.reinfR4000,
  ]),
  p(
    'financeiro.reinf.gerar',
    'Gerar a EFD-REINF (arquivo, não enviado até a DP-38)',
    [O.reinfR2000, O.reinfR4000, O.exportacaoReinf],
    { criticidade: 'sensivel' },
  ),
  p('financeiro.exportacaoContabil.ler', 'Consultar os lotes contábeis exportados e o de-para', [
    O.exportacaoContabil,
  ]),
  p(
    'financeiro.exportacaoContabil.exportar',
    'Exportar o lote contábil (contagem e soma conferíveis)',
    [O.exportacaoContabil],
    { criticidade: 'sensivel' },
  ),
  p(
    'financeiro.dado.mostrar',
    'Mostrar CPF, CNPJ e dados bancários sem máscara (contas a pagar, repasse e tesouraria; auditado)',
    [O.pagarManutencao, O.pagarBaixa, O.lancamentosBancarios],
    { criticidade: 'sensivel' },
  ),
];

/**
 * A entrada do módulo (D-MODULO-32): o estado da gravação, o apoio (as contas do escopo, a classificação, as retenções)
 * e a fila de trabalho servem a TODAS as telas do financeiro e fiscal. Quem tem qualquer opção do módulo no outro sistema
 * tem esta permissão (a união das opções das permissões acima): o usuário só da tesouraria ou só do fiscal abre as suas
 * telas sem precisar da leitura de contas a pagar. Não dá acesso a nenhum dado de título, movimento ou declaração (cada
 * leitura tem a sua permissão).
 */
export const PERMISSAO_MODULO_FINANCEIRO = 'financeiro.modulo.ler';

export const PERMISSOES_FINANCEIRO_M32: readonly DeclaracaoPermissao[] = [
  p(
    PERMISSAO_MODULO_FINANCEIRO,
    'Abrir o financeiro e fiscal: a situação das gravações, as contas do escopo, os cadastros de apoio e a fila de trabalho',
    [...new Set(PERMISSOES_DO_MODULO.flatMap((x) => x.opcoesLegado))].sort((a, b) => a - b),
  ),
  ...PERMISSOES_DO_MODULO,
];
