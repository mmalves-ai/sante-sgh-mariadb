// Cadastros e parâmetros do M32 no CRUD genérico (M08; ficha, seção 5, "Receita genérica do CRUD nos cadastros e
// parâmetros financeiros"): bancos, agências e contas (sem as colunas de credencial), classificação gerencial (grupo e
// item), contas de desconto e acréscimo (retenções), formas de pagamento, tipos de cobrança, clientes, naturezas de
// operação e órgãos arrecadadores, o de-para contábil e de impostos, os parâmetros financeiros da empresa, o período por
// usuário, o escopo de conta bancária (que vale nos dois sistemas), os tipos de lançamento por opção e por
// empresa, o período da escrituração e as retenções da NFS-e por usuário. Os de dado de sistema (o gatilho *_BIUD do
// outro sistema recusa gravar: tipos de lançamento, de contribuição e de apuração, ocorrências bancárias) ficam em
// consulta. Opções do outro sistema (menu de origem do Controle Financeiro, módulo 14): Tabelas 102, Parâmetros 103,
// Usuários compl 104, Conta Desconto/Acréscimo 105, Exportação Contábil 256, Vincular RPS/NFS-e 4354, Impostos 219 e
// Exportações › Bancos 5440 (as inferidas: a árvore não tem item da tabela). Conferir na validação.
import type { DominioPublico } from './tipos.js';

const SISTEMA = 'o banco de dados recusa inclusão, alteração e exclusão: dado de sistema do fornecedor';
const CIEI = ['ler', 'criar', 'editar', 'inativar', 'exportar'] as const;
const CIE = ['ler', 'criar', 'editar', 'exportar'] as const;
const IE = ['ler', 'editar', 'exportar'] as const;
const VINCULO = ['ler', 'criar', 'exportar'] as const;
const LER = ['ler', 'exportar'] as const;

const TABELAS = [102];
const PARAMETROS = [103];
const USUARIOS = [104];
const DESCONTO = [105];
const CONTABIL = [256];
const NFSE = [4354];
const IMPOSTOS = [219];
const BANCOS = [5440, 102];

const todas = (ids: readonly number[], acoes: DominioPublico['acoes']) =>
  Object.fromEntries(acoes.map((a) => [a, ids])) as DominioPublico['opcoesLegado'];

const M32 = (
  d: Omit<DominioPublico, 'opcoesLegado' | 'origemOpcoes' | 'marco' | 'modulo'>,
  opcoes: readonly number[],
  origem: DominioPublico['origemOpcoes'] = 'inferida',
): DominioPublico => ({
  ...d,
  modulo: 'financeiro',
  opcoesLegado: todas(opcoes, d.acoes),
  origemOpcoes: origem,
  marco: 'M32',
});

const ed = (
  recurso: string,
  singular: string,
  plural: string,
  subitem: DominioPublico['subitem'],
  acoes: DominioPublico['acoes'],
  opcoes: readonly number[],
  origem: DominioPublico['origemOpcoes'] = 'inferida',
  extra: Partial<DominioPublico> = {},
) =>
  M32(
    { recurso, rotulo: { singular, plural }, subitem, natureza: 'editavel', acoes, ...extra },
    opcoes,
    origem,
  );

const sis = (recurso: string, singular: string, plural: string, subitem: DominioPublico['subitem']) =>
  M32(
    {
      recurso,
      rotulo: { singular, plural },
      subitem,
      natureza: 'sistema',
      acoes: LER,
      motivoSomenteLeitura: SISTEMA,
    },
    TABELAS,
  );

export const DOMINIOS_M32: readonly DominioPublico[] = [
  ed('contaBancaria', 'Conta bancária', 'Contas bancárias', 'financeiroCadastros', CIEI, BANCOS),
  ed('agenciaBancaria', 'Agência bancária', 'Agências bancárias', 'financeiroCadastros', CIE, BANCOS),
  ed('banco', 'Banco', 'Bancos', 'financeiroCadastros', CIEI, BANCOS),
  ed(
    'itemGerencial',
    'Item da classificação gerencial',
    'Itens da classificação gerencial',
    'financeiroCadastros',
    CIEI,
    TABELAS,
  ),
  ed(
    'grupoGerencial',
    'Grupo da classificação gerencial',
    'Grupos da classificação gerencial',
    'financeiroCadastros',
    CIEI,
    TABELAS,
  ),
  ed(
    'contaDescontoAcrescimo',
    'Conta de desconto e acréscimo',
    'Contas de desconto e acréscimo (retenções)',
    'financeiroCadastros',
    CIEI,
    DESCONTO,
    'tbopcoes',
  ),
  ed('formaPagamento', 'Forma de pagamento', 'Formas de pagamento', 'financeiroCadastros', CIE, TABELAS),
  ed(
    'formaPagamentoFornecedor',
    'Forma de pagamento do fornecedor',
    'Formas de pagamento por fornecedor',
    'financeiroCadastros',
    VINCULO,
    TABELAS,
  ),
  sis('tipoLancamento', 'Tipo de lançamento', 'Tipos de lançamento', 'financeiroCadastros'),
  ed(
    'tipoCobranca',
    'Tipo de cobrança',
    'Tipos de cobrança',
    'financeiroCadastros',
    IE,
    TABELAS,
    'inferida',
    {
      semInclusao: 'os tipos de cobrança seguem os leiautes bancários: aqui se altera o nome',
    },
  ),
  sis('tipoContribuicao', 'Tipo de contribuição', 'Tipos de contribuição', 'financeiroCadastros'),
  sis('tipoApuracao', 'Tipo de apuração', 'Tipos de apuração', 'financeiroCadastros'),
  ed('cliente', 'Cliente', 'Clientes', 'financeiroCadastros', CIE, TABELAS),
  sis(
    'ocorrenciaBancaria',
    'Ocorrência bancária',
    'Ocorrências bancárias (remessa e retorno)',
    'financeiroRemessa',
  ),
  ed(
    'naturezaOperacao',
    'Natureza de operação',
    'Naturezas de operação',
    'financeiroNaturezas',
    CIEI,
    IMPOSTOS,
  ),
  ed('orgaoArrecadador', 'Órgão arrecadador', 'Órgãos arrecadadores', 'financeiroNaturezas', CIEI, IMPOSTOS),
  ed(
    'tipoNaturezaNota',
    'Tipo de natureza da nota',
    'Tipos de natureza da nota',
    'financeiroNaturezas',
    CIE,
    IMPOSTOS,
  ),
  ed(
    'deParaContabil',
    'De-para contábil',
    'De-para contábil (eventos → contas)',
    'financeiroContabil',
    CIE,
    CONTABIL,
    'tbopcoes',
  ),
  ed(
    'deParaImposto',
    'De-para de imposto',
    'De-para de impostos',
    'financeiroContabil',
    CIE,
    CONTABIL,
    'tbopcoes',
  ),
  ed(
    'parametroFinanceiro',
    'Parâmetro financeiro',
    'Parâmetros financeiros da empresa',
    'financeiroParametros',
    IE,
    PARAMETROS,
    'tbopcoes',
    {
      semInclusao:
        'os parâmetros nascem com a empresa: aqui se altera o período de processamento e os avisos',
    },
  ),
  ed(
    'tipoLancamentoEmpresa',
    'Tipo de lançamento da empresa',
    'Tipos de lançamento habilitados na empresa',
    'financeiroParametros',
    VINCULO,
    PARAMETROS,
    'tbopcoes',
  ),
  ed(
    'periodoUsuario',
    'Período do usuário',
    'Período de processamento por usuário',
    'financeiroParametros',
    CIE,
    USUARIOS,
    'tbopcoes',
  ),
  ed(
    'contaUsuario',
    'Conta bancária do usuário',
    'Escopo de contas bancárias por usuário',
    'financeiroParametros',
    VINCULO,
    USUARIOS,
    'tbopcoes',
  ),
  ed(
    'tipoLancamentoOpcao',
    'Tipo de lançamento da opção',
    'Tipos de lançamento por opção de menu',
    'financeiroParametros',
    VINCULO,
    PARAMETROS,
    'tbopcoes',
  ),
  ed(
    'periodoEscrituracao',
    'Período da escrituração',
    'Períodos da escrituração fiscal',
    'financeiroEscrituracao',
    VINCULO,
    IMPOSTOS,
  ),
  ed(
    'retencaoNfseUsuario',
    'Retenção da NFS-e do usuário',
    'Retenções da NFS-e por usuário',
    'financeiroNfse',
    CIE,
    NFSE,
    'tbopcoes',
  ),
];
