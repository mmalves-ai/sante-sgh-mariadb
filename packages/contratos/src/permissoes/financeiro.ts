// Permissões do M32 (ficha, seção 7; convencoes.md §12): contas a pagar, aprovação por alçada, borderô e pagamento,
// pagamentos eletrônicos, adiantamentos, contas a receber, conta corrente de convênios, baixa por demonstrativo,
// tesouraria (movimento, conciliação, fluxo de caixa), apropriação gerencial, cadastros e parâmetros financeiros, fiscal
// (escrituração, NFS-e, DMED, EFD-REINF) e exportação contábil. Quem tem a opção no outro sistema tem a permissão no
// novo (regra 1 do M06). Opções da árvore do menu de origem do Controle Financeiro (módulo 14, 248 opções; retrato
// tools/verificadores/dados/acesso-legado.pc.json), levantadas na primeira hora do marco. A ficha escreve os códigos com
// sublinhado (`financeiro.titulo_pagar.ler`); o catálogo exige camelCase (FORMATO_CODIGO_PERMISSAO): D-PERM-32.
import type { DeclaracaoPermissao } from './tipos.js';

const p = (
  codigo: string,
  descricao: string,

  extra: Partial<DeclaracaoPermissao> = {},
): DeclaracaoPermissao => ({
  codigo,
  descricao,

  concessaoPorPerfil: null,
  categoria: 'financeira',
  criticidade: 'normal',
  // O escopo do módulo financeiro (a conta bancária do usuário): vale para todas, como o catálogo gerado.
  escopos: ['contaBancaria'],
  ...extra,
});
const CONTA = { escopos: ['contaBancaria'] as const };

const PERMISSOES_DO_MODULO: readonly DeclaracaoPermissao[] = [
  p('financeiro.tituloPagar.ler', 'Consultar os títulos a pagar (situação derivada, retenções, aprovações)'),
  p(
    'financeiro.tituloPagar.criar',
    'Lançar o título a pagar (parcelas, classificação, retenções) e excluir o título em aberto',

    { criticidade: 'sensivel' },
  ),
  p(
    'financeiro.tituloPagar.prorrogar',
    'Prorrogar o vencimento da parcela a pagar (motivo da lista; título já aprovado pede também a permissão de aprovar e outra pessoa que não quem lançou)',

    // Recurso novo, sem opção correspondente no menu de origem: concedido ao administrador do sistema.
    { criticidade: 'sensivel', concessaoPorPerfil: 'por-perfil', perfis: ['administrador-sistema'] },
  ),
  p(
    'financeiro.tituloPagar.aprovar',
    'Aprovar o pagamento na alçada (quem lança não aprova; dupla aprovação acima do limite)',

    { criticidade: 'sensivel' },
  ),
  p(
    'financeiro.tituloPagar.aprovarDiretoria',
    'Aprovar o pagamento na alçada da diretoria (faixas acima do limite)',

    { criticidade: 'sensivel' },
  ),
  p(
    'financeiro.tituloPagar.baixar',
    'Pagar o título aprovado (sem borderô ou por borderô; quem aprova não paga)',

    { criticidade: 'sensivel', ...CONTA },
  ),
  p('financeiro.bordero.ler', 'Consultar os borderôs de pagamento'),
  p(
    'financeiro.remessa.ler',
    'Consultar remessas e retornos bancários',

    CONTA,
  ),
  p(
    'financeiro.remessa.gerar',
    'Gerar a remessa bancária (fora de produção, só o simulador)',

    { criticidade: 'sensivel', ...CONTA },
  ),
  p(
    'financeiro.contaCredor.manter',
    'Manter os dados bancários e a chave Pix do credor (fornecedor, profissional ou prestador terceiro)',

    // C1-026: segregação de funções: quem mantém o destino do dinheiro não é quem gera a remessa. Recurso sem opção
    // correspondente no menu de origem: concedido pelo perfil do cadastro de credores (e ao administrador do sistema).
    {
      criticidade: 'sensivel',
      concessaoPorPerfil: 'por-perfil',
      perfis: ['cadastro-credor', 'administrador-sistema'],
      escopos: [],
    },
  ),
  p('financeiro.adiantamento.ler', 'Consultar adiantamentos a fornecedores e médicos e as compensações'),
  p(
    'financeiro.adiantamento.conceder',
    'Pedir o adiantamento a fornecedor ou médico (o pedido não tira dinheiro da conta)',

    { criticidade: 'sensivel', ...CONTA },
  ),
  p(
    'financeiro.adiantamento.aprovar',
    'Aprovar o pedido de adiantamento na alçada (a faixa do título a pagar; quem pediu não aprova)',

    { criticidade: 'sensivel', ...CONTA },
  ),
  p(
    'financeiro.adiantamento.pagar',
    'Pagar o adiantamento aprovado (a saída na conta; quem pediu ou aprovou não paga)',

    { criticidade: 'sensivel', ...CONTA },
  ),
  p(
    'financeiro.adiantamento.compensar',
    'Compensar o adiantamento na baixa de título aprovado do mesmo credor (quem lançou ou aprovou não compensa)',

    { criticidade: 'sensivel', ...CONTA },
  ),
  p(
    'financeiro.adiantamento.devolver',
    'Registrar a devolução do saldo do adiantamento pelo credor (a entrada na conta)',

    { criticidade: 'sensivel', ...CONTA },
  ),
  p(
    'financeiro.tituloReceber.ler',
    'Consultar os títulos a receber, a glosa no título e as contas sem título',
  ),
  p(
    'financeiro.tituloReceber.criar',
    'Criar o título a receber da conta (convênio pela competência, particular)',

    { criticidade: 'sensivel' },
  ),
  p(
    'financeiro.tituloReceber.baixar',
    'Baixar por demonstrativo, com a glosa no título',

    { criticidade: 'sensivel', ...CONTA },
  ),
  p(
    'financeiro.tituloReceber.baixarManual',
    'Baixa manual do título a receber (exceção, com motivo)',

    { criticidade: 'sensivel', ...CONTA },
  ),
  p(
    'financeiro.creditoConvenio.ler',
    'Consultar a conta corrente de convênios e os créditos não identificados',
  ),
  p(
    'financeiro.movimento.ler',
    'Consultar o movimento bancário e os saldos das contas do escopo',

    CONTA,
  ),
  p(
    'financeiro.movimento.criar',
    'Lançar movimento bancário (tarifa, fechamento de caixa, transferência, crédito e débito avulsos)',

    { criticidade: 'sensivel', ...CONTA },
  ),
  p(
    'financeiro.conciliacao.ler',
    'Consultar o extrato importado e as sugestões de conciliação',

    CONTA,
  ),
  p(
    'financeiro.conciliacao.conciliar',
    'Importar o extrato e confirmar a conciliação (quem pagou não concilia)',

    { criticidade: 'sensivel', ...CONTA },
  ),
  p('financeiro.fluxoCaixa.ler', 'Consultar o fluxo de caixa realizado e projetado'),
  p('financeiro.fluxoCaixa.exportar', 'Exportar o fluxo de caixa'),
  p('financeiro.classificacao.ler', 'Consultar a classificação gerencial e a DRE gerencial (duas réguas)'),
  p('financeiro.classificacao.editar', 'Ratear o documento por centro de custo (no novo)'),
  p(
    'financeiro.indicador.ler',
    'Indicadores do financeiro (pagos sem aprovação, contas sem título, credor órfão)',
  ),
  p(
    'financeiro.cadastro.ler',
    'Consultar os cadastros financeiros (bancos, contas, formas de pagamento, naturezas)',
  ),
  p(
    'financeiro.cadastro.editar',
    'Incluir e alterar os cadastros financeiros (sem credencial bancária)',

    { criticidade: 'sensivel' },
  ),
  p('financeiro.parametro.ler', 'Consultar os parâmetros financeiros, as alçadas e o escopo por conta'),
  p(
    'financeiro.parametro.editar',
    'Editar os parâmetros financeiros, as faixas de alçada e o escopo por conta bancária do usuário',

    { criticidade: 'sensivel' },
  ),
  p('financeiro.escrituracao.ler', 'Consultar a escrituração de entradas (SPED, CFOP por item)'),
  p('financeiro.nfse.ler', 'Consultar as NFS-e de saída'),
  p(
    'financeiro.nfse.emitir',
    'Emitir NFS-e (fora de produção, o simulador; emissão real depois da DP-38)',

    { criticidade: 'sensivel' },
  ),
  // C2-059 (07-FIN linha 114): NF-e de saída de mercadoria. Recurso novo, sem opção correspondente no menu de origem:
  // concedido pelo perfil do emissor de nota fiscal (e ao administrador do sistema).
  p(
    'financeiro.notaMercadoria.ler',
    'Consultar as NF-e de saída de mercadoria, o histórico de eventos e o DANFE',
    {
      concessaoPorPerfil: 'por-perfil',
      perfis: ['emissor-nota-fiscal', 'administrador-sistema'],
      escopos: [],
    },
  ),
  p(
    'financeiro.notaMercadoria.emitir',
    'Emitir, cancelar e corrigir (carta de correção) a NF-e de saída de mercadoria',
    {
      criticidade: 'sensivel',
      concessaoPorPerfil: 'por-perfil',
      perfis: ['emissor-nota-fiscal', 'administrador-sistema'],
      escopos: [],
    },
  ),
  // C2-094 (09-AREA linha 78): entrada de serviço tomado. Recurso novo, sem opção correspondente no menu de origem:
  // concedido pelo perfil do emissor de nota fiscal (a área fiscal) e ao administrador do sistema.
  p(
    'financeiro.entradaServico.ler',
    'Consultar as entradas de serviço tomado, os itens, o câmbio e as retenções',
    {
      concessaoPorPerfil: 'por-perfil',
      perfis: ['emissor-nota-fiscal', 'administrador-sistema'],
      escopos: [],
    },
  ),
  p(
    'financeiro.entradaServico.lancar',
    'Registrar, concluir e cancelar a entrada de serviço tomado contra o pedido, com as retenções na fonte',
    {
      criticidade: 'sensivel',
      concessaoPorPerfil: 'por-perfil',
      perfis: ['emissor-nota-fiscal', 'administrador-sistema'],
      escopos: [],
    },
  ),
  p('financeiro.dmed.ler', 'Consultar as DMED geradas'),
  p('financeiro.dmed.gerar', 'Gerar a DMED (arquivo, não enviado até a DP-38)', {
    criticidade: 'sensivel',
  }),
  p('financeiro.reinf.ler', 'Consultar as EFD-REINF geradas (R-2000 e R-4000)'),
  p(
    'financeiro.reinf.gerar',
    'Gerar a EFD-REINF (arquivo, não enviado até a DP-38)',

    { criticidade: 'sensivel' },
  ),
  p('financeiro.exportacaoContabil.ler', 'Consultar os lotes contábeis exportados e o de-para'),
  p(
    'financeiro.exportacaoContabil.exportar',
    'Exportar o lote contábil (contagem e soma conferíveis)',

    { criticidade: 'sensivel' },
  ),
  // F8, 07-FIN linhas 70 e 79: recursos novos, sem opção correspondente no menu de origem: concedidos ao administrador
  // do sistema e dados pelo cargo.
  p(
    'financeiro.notaCreditoDebito.ler',
    'Consultar as notas de crédito e de débito (fornecedor e cliente) e as parcelas que elas podem ajustar',
    { concessaoPorPerfil: 'por-perfil', perfis: ['administrador-sistema'] },
  ),
  p(
    'financeiro.notaCreditoDebito.emitir',
    'Emitir a nota de crédito ou de débito com tributos e aplicá-la à parcela (abate ou acresce)',
    { criticidade: 'sensivel', concessaoPorPerfil: 'por-perfil', perfis: ['administrador-sistema'] },
  ),
  p('financeiro.notaCreditoDebito.cancelar', 'Cancelar a nota com motivo, desfazendo o ajuste na parcela', {
    criticidade: 'sensivel',
    concessaoPorPerfil: 'por-perfil',
    perfis: ['administrador-sistema'],
  }),
  // F8, 07-FIN linha 65: fluxo de aprovação configurável; recurso novo, concedido ao administrador do sistema e dado
  // pelo cargo.
  p(
    'financeiro.fluxoAprovacao.configurar',
    'Configurar os fluxos de aprovação (etapas, aprovadores, agrupadores e respostas padrão) do título, da compra e do contrato',
    { criticidade: 'sensivel', concessaoPorPerfil: 'por-perfil', perfis: ['administrador-sistema'] },
  ),
  p(
    'financeiro.fluxoAprovacao.submeter',
    'Enviar o título a pagar, o pedido de compra ou o contrato para o fluxo de aprovação',
    { concessaoPorPerfil: 'por-perfil', perfis: ['administrador-sistema'] },
  ),
  p(
    'financeiro.fluxoAprovacao.decidir',
    'Decidir na etapa em que é aprovador (aprova, reprova ou devolve), também pelo celular quando liberado',
    { criticidade: 'sensivel', concessaoPorPerfil: 'por-perfil', perfis: ['administrador-sistema'] },
  ),
  // F7, 07-FIN linha 78: cobrança bancária com boleto; recurso novo, concedido ao administrador do sistema e dado pelo
  // cargo. O retorno baixa o título com a permissão de baixa do contas a receber.
  p(
    'financeiro.cobrancaBancaria.ler',
    'Consultar as carteiras de cobrança, os boletos, as remessas e os retornos',
    {
      concessaoPorPerfil: 'por-perfil',
      perfis: ['administrador-sistema'],
      ...CONTA,
    },
  ),
  p(
    'financeiro.cobrancaBancaria.configurar',
    'Cadastrar e desativar as carteiras de cobrança (faixa do nosso número, leiaute do banco e tarifa)',
    {
      criticidade: 'sensivel',
      concessaoPorPerfil: 'por-perfil',
      perfis: ['administrador-sistema'],
      ...CONTA,
    },
  ),
  p(
    'financeiro.cobrancaBancaria.emitir',
    'Emitir e cancelar boletos e gerar a remessa de cobrança ao banco',
    {
      criticidade: 'sensivel',
      concessaoPorPerfil: 'por-perfil',
      perfis: ['administrador-sistema'],
      ...CONTA,
    },
  ),
  p(
    'financeiro.cessaoRecebivel.ler',
    'Consultar os portadores e as operações de desconto e cessão de recebíveis',
    { concessaoPorPerfil: 'por-perfil', perfis: ['administrador-sistema'] },
  ),
  p(
    'financeiro.cessaoRecebivel.contratar',
    'Contratar o desconto ou a cessão de recebíveis (crédito da face e despesas na conta)',
    {
      criticidade: 'sensivel',
      concessaoPorPerfil: 'por-perfil',
      perfis: ['administrador-sistema'],
      ...CONTA,
    },
  ),
  p(
    'financeiro.cessaoRecebivel.desfecho',
    'Registrar a liquidação pelo sacado, a recompra ou o cancelamento da operação de desconto ou cessão',
    {
      criticidade: 'sensivel',
      concessaoPorPerfil: 'por-perfil',
      perfis: ['administrador-sistema'],
      ...CONTA,
    },
  ),
  p(
    'financeiro.dado.mostrar',
    'Mostrar CPF, CNPJ e dados bancários sem máscara (contas a pagar, repasse e tesouraria; auditado)',

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
  ),
  ...PERMISSOES_DO_MODULO,
];
