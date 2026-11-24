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
  p('financeiro.adiantamento.ler', 'Consultar adiantamentos a fornecedores e médicos e as compensações'),
  p(
    'financeiro.adiantamento.conceder',
    'Conceder o adiantamento a fornecedor ou médico, compensá-lo no título e devolver o saldo',

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
