// Entradas das gravações do financeiro (M32; ficha, seções 5 e 6): o que as telas mandam e o executor valida (o mesmo
// Zod). A tela nunca manda ID, cabeçalho de lançamento, tipo de lançamento nem data prevista: os gatilhos do outro
// sistema fazem. Textos que vão ao banco do outro sistema passam pelo validador CP1252 (caractere fora do CP1252 é
// recusado na tela e no servidor). Dinheiro: o valor digitado (DOUBLE no outro sistema), até 99.999.999,99.
import { z } from 'zod';
import { esquemaContratoDoVinculo } from '../suprimentos/contrato.js';
import { textoCp1252 } from '../texto-cp1252.js';
import { TIPOS_CREDOR } from './regras/credor.js';
import { TIPOS_MOVIMENTO_GRAVADOS } from './regras/tipo-movimento.js';
import {
  DESTINOS_TITULO_FOLHA,
  NATUREZAS_FATO_FOLHA,
  ORIGENS_LANCAMENTO_FOLHA,
  TETO_FATOS_LANCAMENTO_FOLHA,
  TETO_TITULOS_LANCAMENTO_FOLHA,
} from '../pessoas/folha-titulos.js';
import { APURACOES_FOLHA } from '../pessoas/folha-periodicos.js';

const id = z.number().int().positive();
const DATA = /^\d{4}-\d{2}-\d{2}$/;
const data = z.string().regex(DATA, 'Use AAAA-MM-DD.');
const dinheiro = z.number().positive().max(99_999_999.99);
const dinheiroOuZero = z.number().min(0).max(99_999_999.99);
const versao = z.string().min(10).max(40);
const inteiro = (max: number) => z.number().int().min(0).max(max);

export const esquemaClassificacao = z
  .object({ grupo: inteiro(32_767), subgrupo: inteiro(32_767), item: inteiro(32_767) })
  .strict()
  .refine((c) => c.grupo > 0, { message: 'Escolha a classificação gerencial.' });

export const esquemaParcela = z
  .object({ parcela: z.number().int().min(1).max(120), vencimento: data, valor: dinheiro })
  .strict();

export const esquemaRetencao = z
  .object({
    /** Código da conta de desconto ou acréscimo (com o tipo do imposto, quando é retenção). */
    codigo: z.number().int().positive().max(2_147_483_647),
    valor: dinheiro,
  })
  .strict();

export const esquemaRateio = z
  .object({ centroCusto: z.number().int().positive(), percentual: z.number().positive().max(100) })
  .strict();

const centavos = z.number().int().min(0).max(9_999_999_999);

/**
 * M53.9 (F8): os títulos da folha de um período (cenários `origem-folha` e `origem-encargo`), todos na MESMA transação
 * do registro em SGH_PES_FOLHA_LANCAMENTO, SGH_PES_FOLHA_TITULO e SGH_PES_FOLHA_FATO (regra 10 do M53: ou tudo, ou
 * nada). Cada título é de parcela única, fornecedor (TIPO F), série DP ou IMP, sem nota, como o contas a pagar lança a folha
 * hoje (perfil dos títulos de folha e encargos de 2025 e 2026: todos de parcela 1, de fornecedor ou outros, sem nota). O
 * valor vem em centavos (a folha) e grava em reais. Esta ação não tem rota HTTP no financeiro: só a integração da folha
 * a monta, a partir da prévia conferida.
 */
export const esquemaIncluirTitulosFolha = z
  .object({
    acao: z.literal('incluir-folha'),
    empresa: inteiro(32_767),
    origem: z.enum(ORIGENS_LANCAMENTO_FOLHA),
    idOrigem: id,
    apuracao: z.enum(APURACOES_FOLHA),
    periodo: z.string().regex(/^\d{4}(-(0[1-9]|1[0-2]))?$/),
    resumo: z.string().regex(/^[0-9a-f]{64}$/),
    emissao: data,
    liquido: centavos,
    encargos: centavos,
    titulos: z
      .array(
        z
          .object({
            chave: z.string().min(3).max(40),
            destino: z.enum(DESTINOS_TITULO_FOLHA),
            rotina: z.number().int().min(1).max(99),
            credor: z.number().int().positive().max(2_147_483_647),
            documento: z.number().int().positive().max(2_147_483_647),
            vencimento: data,
            valor: z.number().int().positive().max(9_999_999_999),
            classificacao: esquemaClassificacao,
            referente: textoCp1252(60),
          })
          .strict(),
      )
      .min(1)
      .max(TETO_TITULOS_LANCAMENTO_FOLHA),
    fatos: z
      .array(
        z
          .object({
            rotina: z.number().int().min(1).max(99),
            centroCusto: z.number().int().min(0).max(2_147_483_647),
            natureza: z.enum(NATUREZAS_FATO_FOLHA),
            contabiliza: z.boolean(),
            valor: z.number().int().positive().max(9_999_999_999),
          })
          .strict(),
      )
      .max(TETO_FATOS_LANCAMENTO_FOLHA)
      .default([]),
  })
  .strict();

/** financeiro.criarTituloPagar: incluir (uma linha por parcela) ou excluir o título em aberto. */
export const esquemaCriarTituloPagar = z.discriminatedUnion('acao', [
  z
    .object({
      acao: z.literal('incluir'),
      tipo: z.enum(TIPOS_CREDOR),
      /** Código do fornecedor (no médico, o código do profissional). */
      credor: z.number().int().positive().max(2_147_483_647),
      /** Id do profissional, quando o credor é médico (tipo M). */
      profissional: id.nullable().default(null),
      documento: z.number().int().positive().max(2_147_483_647),
      serie: textoCp1252(3).default(''),
      emissao: data,
      entrada: data.nullable().default(null),
      nf: inteiro(2_147_483_647).default(0),
      valorDocumento: dinheiro,
      referente: textoCp1252(60).default(''),
      observacao: textoCp1252(100).default(''),
      parcelas: z.array(esquemaParcela).min(1).max(120),
      classificacao: esquemaClassificacao,
      retencoes: z.array(esquemaRetencao).max(12).default([]),
      /** Centro de custo do documento (alçada e rateio; a classificação gerencial grava o centro 0). */
      centroCusto: z.number().int().positive().nullable().default(null),
      rateio: z.array(esquemaRateio).max(30).default([]),
      /** M55 (etapa 3): o contrato com o fornecedor que o título consome (o vínculo na mesma transação, só no novo). */
      contrato: esquemaContratoDoVinculo.optional(),
    })
    .strict(),
  z.object({ acao: z.literal('excluir'), titulo: id, versao: versao.nullable().default(null) }).strict(),
  esquemaIncluirTitulosFolha,
]);
export type CriarTituloPagarEntrada = z.infer<typeof esquemaCriarTituloPagar>;
export type IncluirTituloPagarEntrada = Extract<CriarTituloPagarEntrada, { acao: 'incluir' }>;
export type IncluirTitulosFolhaEntrada = z.infer<typeof esquemaIncluirTitulosFolha>;

/** financeiro.baixarTitulo: pagar (sem borderô ou por borderô) ou receber (baixa manual). */
export const esquemaBaixarTitulo = z.discriminatedUnion('cenario', [
  z
    .object({
      cenario: z.literal('pagar'),
      titulos: z
        .array(z.object({ titulo: id, versao: versao.nullable().default(null) }).strict())
        .min(1)
        .max(200),
      /** Id da conta bancária que paga (no escopo de contas do usuário). */
      conta: id,
      dataPagamento: data,
      /** Forma de pagamento do título (só valores já vistos, DP-46.3). */
      formaPagamento: z.number().int().min(0).max(99),
      /** Pagar por borderô (um borderô para os títulos) ou sem borderô. */
      porBordero: z.boolean(),
    })
    .strict(),
  z
    .object({
      cenario: z.literal('receber'),
      titulo: id,
      versao: versao.nullable().default(null),
      conta: id,
      dataRecebimento: data,
      valorRecebido: dinheiro,
      formaPagamento: z.number().int().min(0).max(99),
      motivo: textoCp1252(100),
    })
    .strict(),
]);
export type BaixarTituloEntrada = z.infer<typeof esquemaBaixarTitulo>;

/** financeiro.criarTituloReceber: da conta (convênio pela competência ou particular externo). */
export const esquemaCriarTituloReceber = z
  .object({
    /** Id da conta hospitalar (ou das contas do mesmo convênio e competência, num título só). */
    contas: z
      .array(z.object({ conta: id, versao: versao.nullable().default(null) }).strict())
      .min(1)
      .max(500),
    vencimento: data,
    /** Número do documento (o da fatura; 0 = o número da primeira conta). */
    documento: inteiro(2_147_483_647).default(0),
    referente: textoCp1252(50).default(''),
  })
  .strict();
export type CriarTituloReceberEntrada = z.infer<typeof esquemaCriarTituloReceber>;

/** financeiro.lancarMovimento: tarifa, fechamento de caixa, transferência, crédito e débito avulsos. */
export const esquemaLancarMovimento = z
  .object({
    tipo: z.enum(TIPOS_MOVIMENTO_GRAVADOS),
    data,
    /** Id da conta bancária que recebe (crédito) e da debitada (débito), no escopo de contas do usuário. */
    contaCredito: id.nullable().default(null),
    contaDebito: id.nullable().default(null),
    valor: dinheiro,
    historico: textoCp1252(100),
    classificacao: esquemaClassificacao,
  })
  .strict();
export type LancarMovimentoEntrada = z.infer<typeof esquemaLancarMovimento>;

// ── Gravações só do novo (SGH_) ────────────────────────────────────────────────────────────────────────────────

export const esquemaFaixaAlcada = z
  .object({
    id: id.nullable().default(null),
    centroCusto: z.number().int().positive().nullable().default(null),
    tipoCredor: z.enum(TIPOS_CREDOR).nullable().default(null),
    valorDe: dinheiroOuZero,
    valorAte: dinheiro.nullable().default(null),
    aprovacoes: z.union([z.literal(1), z.literal(2)]),
    permissao: z.string().regex(/^financeiro\.[a-zA-Z_]+\.[a-zA-Z_]+$/),
    vigenciaInicio: data,
    vigenciaFim: data.nullable().default(null),
    ativa: z.boolean().default(true),
  })
  .strict();
export type FaixaAlcadaEntrada = z.infer<typeof esquemaFaixaAlcada>;

export const esquemaAprovarTitulo = z
  .object({ titulo: id, observacao: z.string().trim().max(200).default('') })
  .strict();
export type AprovarTituloEntrada = z.infer<typeof esquemaAprovarTitulo>;

export const esquemaRegistrarGlosaTitulo = z
  .object({
    tituloReceber: id,
    /** Id do item da conta hospitalar glosado (nulo: a glosa do título inteiro, com o valor somado dos itens). */
    item: id.nullable().default(null),
    situacao: z.enum(['aceita', 'recurso-deferido', 'recurso-indeferido']),
    valor: dinheiro,
    motivo: z.string().trim().min(10).max(200),
  })
  .strict();
export type RegistrarGlosaTituloEntrada = z.infer<typeof esquemaRegistrarGlosaTitulo>;

export const esquemaLinhaExtrato = z
  .object({
    data,
    valor: z.number().min(-99_999_999.99).max(99_999_999.99),
    historico: z.string().max(200),
    documento: z.string().max(40).default(''),
  })
  .strict();

export const esquemaImportarExtrato = z
  .object({
    conta: id,
    origem: z.enum(['ofx', 'csv', 'api']),
    /** Conteúdo do arquivo (OFX ou CSV) em texto; o hash e a guarda no S3 são do servidor. */
    conteudo: z.string().min(1).max(5_000_000),
  })
  .strict();
export type ImportarExtratoEntrada = z.infer<typeof esquemaImportarExtrato>;

export const esquemaConciliar = z
  .object({
    linha: id,
    alvo: z.discriminatedUnion('tipo', [
      z.object({ tipo: z.literal('movimento'), id }).strict(),
      z.object({ tipo: z.literal('titulo-pagar'), id }).strict(),
      z.object({ tipo: z.literal('titulo-receber'), id }).strict(),
      z.object({ tipo: z.literal('credito-pendente') }).strict(),
    ]),
    regra: z.enum(['valor-data', 'valor-janela', 'documento', 'manual']),
  })
  .strict();
export type ConciliarEntrada = z.infer<typeof esquemaConciliar>;

export const esquemaAtribuirCredito = z
  .object({ credito: id, tituloReceber: id, observacao: z.string().trim().max(200).default('') })
  .strict();
export type AtribuirCreditoEntrada = z.infer<typeof esquemaAtribuirCredito>;

export const esquemaGerarRemessa = z
  .object({ conta: id, titulos: z.array(id).min(1).max(500), leiaute: z.enum(['cnab240', 'api']) })
  .strict();
export type GerarRemessaEntrada = z.infer<typeof esquemaGerarRemessa>;

export const esquemaEmitirNfse = z
  .object({
    tituloReceber: id.nullable().default(null),
    conta: id.nullable().default(null),
    momento: z.enum(['apresentacao', 'recebimento']),
    /** Classificação tributária e o item da lista de serviços da NFS-e. */
    classificacao: z.string().max(20),
    itemServico: z.string().max(20),
    valorServicos: dinheiro,
    aliquotaIss: z.number().min(0).max(5),
    issRetido: z.boolean(),
    retencoes: z
      .object({
        ir: dinheiroOuZero.default(0),
        pis: dinheiroOuZero.default(0),
        cofins: dinheiroOuZero.default(0),
        csll: dinheiroOuZero.default(0),
        inss: dinheiroOuZero.default(0),
      })
      .strict()
      .default({ ir: 0, pis: 0, cofins: 0, csll: 0, inss: 0 }),
  })
  .strict()
  .refine((e) => e.tituloReceber !== null || e.conta !== null, { message: 'Informe o título ou a conta.' });
export type EmitirNfseEntrada = z.infer<typeof esquemaEmitirNfse>;

export const esquemaGerarDeclaracao = z
  .object({
    tipo: z.enum(['dmed', 'reinf-r2000', 'reinf-r4000']),
    /** Ano (DMED) ou competência AAAA-MM (REINF). */
    periodo: z.string().regex(/^\d{4}(-\d{2})?$/),
  })
  .strict();
export type GerarDeclaracaoEntrada = z.infer<typeof esquemaGerarDeclaracao>;

export const esquemaExportarLoteContabil = z
  .object({ periodo: z.string().regex(/^\d{4}-\d{2}$/), regua: z.enum(['competencia', 'caixa']) })
  .strict();
export type ExportarLoteContabilEntrada = z.infer<typeof esquemaExportarLoteContabil>;

export const esquemaMostrarDado = z
  .object({
    tipo: z.enum(['documento-credor', 'documento-devedor', 'dados-bancarios']),
    titulo: id,
    finalidade: z.string().trim().min(5).max(120),
  })
  .strict();
export type MostrarDadoEntrada = z.infer<typeof esquemaMostrarDado>;
