// Contratos com fornecedores e prestadores (ficha do M55, etapa 3, `M55-F3`; seções 4 a 8; regras 5 a 8; cap-07 §7.3;
// ONA-05): as partes, o objeto, a vigência, o valor, as garantias, os anexos, os aditivos, o reajuste por índice e
// data-base, os alertas de 90, 60 e 30 dias, o saldo consumido por pedidos e títulos ligados, o gestor e o fiscal e a
// avaliação do fornecedor. Só do novo (SGH_SUP_CONTRATO, SGH_SUP_CONTRATO_EVENTO, SGH_SUP_CONTRATO_VINCULO): o pedido e
// o título continuam nascendo pelas operações de compras e de contas a pagar, sem mudança na linha gravada; o vínculo
// vai na mesma transação. Vocabulário do produto. Validadas na tela, na API e na gravação (o mesmo Zod).
import { z } from 'zod';
import { esquemaChaveAto } from '../enfermagem/entradas.js';
import { textoCp1252 } from '../texto-cp1252.js';

/** A chave de liberação por estabelecimento (ficha, seção 12). */
export const CHAVE_LIBERACAO_CONTRATOS = 'contratos';

export const TIPOS_CONTRATO = [
  { codigo: 'fornecimento', rotulo: 'Fornecimento de materiais ou medicamentos' },
  { codigo: 'servico', rotulo: 'Prestação de serviço' },
  { codigo: 'manutencao', rotulo: 'Manutenção de equipamentos ou predial' },
  { codigo: 'locacao', rotulo: 'Locação' },
  { codigo: 'comodato', rotulo: 'Comodato' },
  { codigo: 'outro', rotulo: 'Outro' },
] as const;
export type TipoContrato = (typeof TIPOS_CONTRATO)[number]['codigo'];
const CODIGOS_TIPO_CONTRATO = TIPOS_CONTRATO.map((t) => t.codigo) as [TipoContrato, ...TipoContrato[]];

export const INDICES_REAJUSTE = [
  { codigo: 'ipca', rotulo: 'IPCA (IBGE)' },
  { codigo: 'igpm', rotulo: 'IGP-M (FGV)' },
  { codigo: 'inpc', rotulo: 'INPC (IBGE)' },
  { codigo: 'incc', rotulo: 'INCC (FGV)' },
  { codigo: 'outro', rotulo: 'Outro índice previsto no contrato' },
  { codigo: 'nenhum', rotulo: 'Sem reajuste' },
] as const;
export type IndiceReajuste = (typeof INDICES_REAJUSTE)[number]['codigo'];
const CODIGOS_INDICE = INDICES_REAJUSTE.map((t) => t.codigo) as [IndiceReajuste, ...IndiceReajuste[]];

export const GARANTIAS_CONTRATO = [
  { codigo: 'nenhuma', rotulo: 'Sem garantia' },
  { codigo: 'caucao', rotulo: 'Caução em dinheiro' },
  { codigo: 'seguro', rotulo: 'Seguro-garantia' },
  { codigo: 'fianca', rotulo: 'Fiança bancária' },
] as const;
export type GarantiaContrato = (typeof GARANTIAS_CONTRATO)[number]['codigo'];
const CODIGOS_GARANTIA = GARANTIAS_CONTRATO.map((t) => t.codigo) as [GarantiaContrato, ...GarantiaContrato[]];

/** A situação gravada (a vigência é calculada pelas datas: regra 5). */
export const SITUACOES_CONTRATO_FORNECEDOR = [
  { codigo: 'ativo', rotulo: 'Ativo' },
  { codigo: 'encerrado', rotulo: 'Encerrado' },
  { codigo: 'rescindido', rotulo: 'Rescindido' },
] as const;
export type SituacaoContratoFornecedor = (typeof SITUACOES_CONTRATO_FORNECEDOR)[number]['codigo'];

/** A vigência calculada no dia (regra 5): a faixa do alerta de vencimento. */
export const FAIXAS_VIGENCIA = [
  { codigo: 'a-iniciar', rotulo: 'A iniciar' },
  { codigo: 'vigente', rotulo: 'Vigente' },
  { codigo: 'vence-90', rotulo: 'Vence em até 90 dias' },
  { codigo: 'vence-60', rotulo: 'Vence em até 60 dias' },
  { codigo: 'vence-30', rotulo: 'Vence em até 30 dias' },
  { codigo: 'vencido', rotulo: 'Vencido' },
  { codigo: 'encerrado', rotulo: 'Encerrado' },
] as const;
export type FaixaVigencia = (typeof FAIXAS_VIGENCIA)[number]['codigo'];
/** Os dias de antecedência dos alertas de vencimento (regra 5). */
export const DIAS_ALERTA_VENCIMENTO = [90, 60, 30] as const;

/** Os eventos do contrato (SGH_SUP_CONTRATO_EVENTO.TIPO), só de inclusão. */
export const TIPOS_EVENTO_CONTRATO = [
  { codigo: 'aditivo', rotulo: 'Termo aditivo (valor e/ou prazo)' },
  { codigo: 'reajuste', rotulo: 'Reajuste pelo índice' },
  { codigo: 'renovacao', rotulo: 'Renovação (prorrogação da vigência)' },
  { codigo: 'ocorrencia', rotulo: 'Ocorrência na execução' },
  { codigo: 'avaliacao', rotulo: 'Avaliação do fornecedor' },
  { codigo: 'anexo', rotulo: 'Anexo (documento)' },
  { codigo: 'excecao', rotulo: 'Exceção aprovada (vínculo fora da vigência)' },
  { codigo: 'encerramento', rotulo: 'Encerramento' },
  { codigo: 'rescisao', rotulo: 'Rescisão' },
] as const;
export type TipoEventoContrato = (typeof TIPOS_EVENTO_CONTRATO)[number]['codigo'];
export const CODIGOS_EVENTO_CONTRATO = TIPOS_EVENTO_CONTRATO.map((t) => t.codigo) as [
  TipoEventoContrato,
  ...TipoEventoContrato[],
];

/** Os critérios da avaliação do fornecedor (regra 8; ONA-05), nota de 1 a 5 cada. */
export const CRITERIOS_AVALIACAO_FORNECEDOR = [
  { codigo: 'qualidade', rotulo: 'Qualidade do produto ou do serviço' },
  { codigo: 'prazo', rotulo: 'Cumprimento de prazos' },
  { codigo: 'atendimento', rotulo: 'Atendimento e comunicação' },
  { codigo: 'documentacao', rotulo: 'Documentação e regularidade' },
] as const;
export type CriterioAvaliacao = (typeof CRITERIOS_AVALIACAO_FORNECEDOR)[number]['codigo'];

export const RESULTADOS_AVALIACAO = [
  { codigo: 'qualificado', rotulo: 'Qualificado' },
  { codigo: 'condicional', rotulo: 'Qualificado com ressalvas' },
  { codigo: 'desqualificado', rotulo: 'Desqualificado' },
] as const;
export type ResultadoAvaliacao = (typeof RESULTADOS_AVALIACAO)[number]['codigo'];

/** A periodicidade da avaliação (regra 8): o fornecedor crítico a cada 6 meses, os demais a cada 12. */
export const MESES_AVALIACAO_CRITICO = 6;
export const MESES_AVALIACAO_COMUM = 12;
/** Os dias em que a exceção aprovada vale para um vínculo (regra 7). */
export const DIAS_VALIDADE_EXCECAO = 30;
/** O acréscimo acumulado por aditivo acima do qual a tela avisa (Lei 14.133/2021, art. 125: 25% do valor inicial). */
export const LIMITE_ACRESCIMO_PERCENTUAL = 25;
/** O intervalo mínimo entre reajustes (Lei 14.133/2021, art. 25 §7: um ano da data-base). */
export const MESES_INTERVALO_REAJUSTE = 12;
/** O teto da lista paginada de contratos. */
export const TETO_LISTA_CONTRATOS = 200;

export const TIPOS_VINCULO_CONTRATO = [
  { codigo: 'pedido', rotulo: 'Pedido de compra' },
  { codigo: 'titulo', rotulo: 'Título a pagar' },
] as const;
export type TipoVinculoContrato = (typeof TIPOS_VINCULO_CONTRATO)[number]['codigo'];

const id = z.number().int().positive().max(2_147_483_647);
const idSgh = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);
const dataIso = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Data no formato AAAA-MM-DD.');
const livre = (max: number) => textoCp1252(max).overwrite((t) => t.replace(/\s+/g, ' ').trim());
const opcional = (max: number) =>
  livre(max)
    .nullable()
    .default(null)
    .transform((t) => (t ? t : null));
const dinheiro = z
  .number()
  .nonnegative()
  .max(9_999_999_999_999)
  .refine((n) => Math.abs(n * 100 - Math.round(n * 100)) < 1e-6, { message: 'No máximo 2 casas decimais.' });
const dinheiroComSinal = z
  .number()
  .min(-9_999_999_999_999)
  .max(9_999_999_999_999)
  .refine((n) => Math.abs(n * 100 - Math.round(n * 100)) < 1e-6, { message: 'No máximo 2 casas decimais.' });
const login = z
  .string()
  .trim()
  .min(1, 'Escolha o usuário.')
  .max(31)
  .regex(/^[^\s'"]+$/, 'Usuário inválido.');
const versao = z.number().int().nonnegative();
const nota = z.number().int().min(1, 'Nota de 1 a 5.').max(5, 'Nota de 1 a 5.');

// ── suprimentos.criarContrato / alterarContrato ─────────────────────────────────────────────────────────────────

const camposContrato = {
  /** O número do contrato (único por estabelecimento). */
  numero: livre(30).refine((t) => t.length >= 1, 'Informe o número do contrato.'),
  /** O fornecedor ou prestador (cadastro de fornecedores, pelo código). */
  fornecedor: id,
  tipo: z.enum(CODIGOS_TIPO_CONTRATO),
  objeto: livre(400).refine((t) => t.length >= 10, 'Descreva o objeto (10 letras ou mais).'),
  /** Fornecedor crítico (ONA-05): avaliação a cada 6 meses. */
  critico: z.boolean().default(false),
  inicio: dataIso,
  fim: dataIso,
  /** O valor global inicial do contrato. */
  valor: dinheiro.refine((n) => n > 0, 'Informe o valor do contrato.'),
  indiceReajuste: z.enum(CODIGOS_INDICE).default('nenhum'),
  /** A data-base do reajuste (a data da proposta ou do orçamento). */
  dataBase: dataIso.nullable().default(null),
  garantia: z.enum(CODIGOS_GARANTIA).default('nenhuma'),
  garantiaValor: dinheiro.nullable().default(null),
  garantiaValidade: dataIso.nullable().default(null),
  /** O gestor e o fiscal do contrato (usuários do sistema, pelo login; pessoas diferentes). */
  gestor: login,
  fiscal: login,
  /** O centro de custo que consome o contrato (opcional). */
  centroCusto: id.nullable().default(null),
  observacao: opcional(1000),
};

interface CamposRefinados {
  inicio: string;
  fim: string;
  gestor: string;
  fiscal: string;
  indiceReajuste: IndiceReajuste;
  dataBase: string | null;
  garantia: GarantiaContrato;
  garantiaValor: number | null;
}
const refinarContrato = <T extends z.ZodType<CamposRefinados>>(s: T) =>
  s
    .refine((c) => c.fim >= c.inicio, { message: 'O fim da vigência é depois do início.', path: ['fim'] })
    .refine((c) => c.gestor.toUpperCase() !== c.fiscal.toUpperCase(), {
      message: 'O gestor e o fiscal do contrato são pessoas diferentes.',
      path: ['fiscal'],
    })
    .refine((c) => c.indiceReajuste === 'nenhum' || c.dataBase !== null, {
      message: 'Informe a data-base do reajuste.',
      path: ['dataBase'],
    })
    .refine((c) => c.garantia === 'nenhuma' || (c.garantiaValor !== null && c.garantiaValor > 0), {
      message: 'Informe o valor da garantia.',
      path: ['garantiaValor'],
    });

export const esquemaCriarContrato = refinarContrato(
  z.object({ chave: esquemaChaveAto, ...camposContrato }).strict(),
);
export type CriarContratoEntrada = z.infer<typeof esquemaCriarContrato>;

/** A alteração do cadastro: o valor e a vigência só mudam por aditivo, reajuste ou renovação (eventos). */
export const esquemaAlterarContrato = z
  .object({
    versao,
    objeto: camposContrato.objeto,
    critico: z.boolean(),
    indiceReajuste: camposContrato.indiceReajuste,
    dataBase: camposContrato.dataBase,
    garantia: camposContrato.garantia,
    garantiaValor: camposContrato.garantiaValor,
    garantiaValidade: camposContrato.garantiaValidade,
    gestor: login,
    fiscal: login,
    centroCusto: camposContrato.centroCusto,
    observacao: camposContrato.observacao,
  })
  .strict()
  .refine((c) => c.gestor.toUpperCase() !== c.fiscal.toUpperCase(), {
    message: 'O gestor e o fiscal do contrato são pessoas diferentes.',
    path: ['fiscal'],
  })
  .refine((c) => c.indiceReajuste === 'nenhum' || c.dataBase !== null, {
    message: 'Informe a data-base do reajuste.',
    path: ['dataBase'],
  })
  .refine((c) => c.garantia === 'nenhuma' || (c.garantiaValor !== null && c.garantiaValor > 0), {
    message: 'Informe o valor da garantia.',
    path: ['garantiaValor'],
  });
export type AlterarContratoEntrada = z.infer<typeof esquemaAlterarContrato>;

// ── suprimentos.registrarEventoContrato ─────────────────────────────────────────────────────────────────────────

const descricao = (min: number, msg: string) => livre(1000).refine((t) => t.length >= min, msg);
const base = { chave: esquemaChaveAto, versao };

export const esquemaRegistrarEventoContrato = z.discriminatedUnion('tipo', [
  z
    .object({
      ...base,
      tipo: z.literal('aditivo'),
      /** O acréscimo (positivo) ou a supressão (negativo) do valor; 0 no aditivo só de prazo. */
      valor: dinheiroComSinal.default(0),
      /** O novo fim da vigência (nulo no aditivo só de valor). */
      novoFim: dataIso.nullable().default(null),
      numeroTermo: livre(30).refine((t) => t.length >= 1, 'Informe o número do termo aditivo.'),
      descricao: descricao(10, 'Descreva o aditivo (10 letras ou mais).'),
      documento: idSgh.nullable().default(null),
    })
    .strict()
    .refine((a) => a.valor !== 0 || a.novoFim !== null, {
      message: 'O aditivo muda o valor, o prazo ou os dois.',
      path: ['valor'],
    }),
  z
    .object({
      ...base,
      tipo: z.literal('reajuste'),
      /** O percentual do índice acumulado no período (ex.: 4,62). */
      percentual: z
        .number()
        .min(-50)
        .max(100)
        .refine((n) => n !== 0, 'Informe o percentual do índice.'),
      /** A data a partir da qual o reajuste vale (o aniversário da data-base). */
      data: dataIso,
      descricao: livre(1000).default(''),
    })
    .strict(),
  z
    .object({
      ...base,
      tipo: z.literal('renovacao'),
      novoFim: dataIso,
      /** O valor do novo período somado ao contrato (0 se só prorroga). */
      valor: dinheiro.default(0),
      numeroTermo: livre(30).refine((t) => t.length >= 1, 'Informe o número do termo de renovação.'),
      descricao: livre(1000).default(''),
      documento: idSgh.nullable().default(null),
    })
    .strict(),
  z
    .object({
      ...base,
      tipo: z.literal('ocorrencia'),
      data: dataIso,
      descricao: descricao(10, 'Descreva a ocorrência (10 letras ou mais).'),
      documento: idSgh.nullable().default(null),
    })
    .strict(),
  z
    .object({
      ...base,
      tipo: z.literal('avaliacao'),
      /** O período avaliado (fim). */
      data: dataIso,
      notas: z.object({ qualidade: nota, prazo: nota, atendimento: nota, documentacao: nota }).strict(),
      descricao: livre(1000).default(''),
    })
    .strict(),
  z
    .object({
      ...base,
      tipo: z.literal('anexo'),
      /** O documento guardado (M09). */
      documento: idSgh,
      descricao: descricao(3, 'Descreva o anexo (3 letras ou mais).'),
    })
    .strict(),
  z
    .object({
      ...base,
      tipo: z.literal('excecao'),
      /** A justificativa aprovada pela alçada (regra 7): vale para um vínculo, por 30 dias. */
      descricao: descricao(20, 'Escreva a justificativa da exceção (20 letras ou mais).'),
    })
    .strict(),
  z
    .object({
      ...base,
      tipo: z.literal('encerramento'),
      data: dataIso,
      descricao: livre(1000).default(''),
    })
    .strict(),
  z
    .object({
      ...base,
      tipo: z.literal('rescisao'),
      data: dataIso,
      descricao: descricao(10, 'Escreva o motivo da rescisão (10 letras ou mais).'),
      documento: idSgh.nullable().default(null),
    })
    .strict(),
]);
export type RegistrarEventoContratoEntrada = z.infer<typeof esquemaRegistrarEventoContrato>;

// ── O vínculo de pedido e título (regras 6 e 7) ─────────────────────────────────────────────────────────────────

/**
 * O contrato a que o pedido ou o título fica ligado, na mesma transação da operação de compras ou de contas a pagar
 * (o vínculo é só do novo; a linha gravada do pedido ou do título não muda).
 */
export const esquemaContratoDoVinculo = z
  .object({
    contrato: idSgh,
    /** A exceção aprovada (evento `excecao` do mesmo contrato) que permite o vínculo fora da vigência. */
    excecao: idSgh.nullable().default(null),
    /** No título: o vínculo do pedido de origem (o título paga o pedido já ligado e não abate o saldo de novo). */
    pedidoDeOrigem: idSgh.nullable().default(null),
  })
  .strict();
export type ContratoDoVinculo = z.infer<typeof esquemaContratoDoVinculo>;

/** suprimentos.vincularContrato: liga ao contrato um pedido ou os títulos de um documento que já existem. */
export const esquemaVincularContrato = z
  .object({
    chave: esquemaChaveAto,
    tipo: z.enum(['pedido', 'titulo']),
    /** O pedido (ID do cabeçalho mestre) ou as parcelas do título (IDs). */
    ids: z.array(id).min(1).max(120),
    excecao: idSgh.nullable().default(null),
    pedidoDeOrigem: idSgh.nullable().default(null),
  })
  .strict()
  .refine((v) => v.tipo === 'titulo' || v.ids.length === 1, {
    message: 'Ligue um pedido por vez.',
    path: ['ids'],
  })
  .refine((v) => v.tipo === 'titulo' || v.pedidoDeOrigem === null, {
    message: 'O pedido de origem é só do título.',
    path: ['pedidoDeOrigem'],
  });
export type VincularContratoEntrada = z.infer<typeof esquemaVincularContrato>;

export const esquemaFiltroContratosFornecedor = z
  .object({
    situacao: z.enum(['ativo', 'encerrado', 'rescindido', 'todos']).default('ativo'),
    faixa: z
      .enum(['a-iniciar', 'vigente', 'vence-90', 'vence-60', 'vence-30', 'vencido', 'encerrado'])
      .nullable()
      .default(null),
    fornecedor: id.nullable().default(null),
    termo: opcional(60),
    pagina: z.number().int().min(1).max(10_000).default(1),
  })
  .strict();
export type FiltroContratosFornecedor = z.infer<typeof esquemaFiltroContratosFornecedor>;

// ── Respostas ───────────────────────────────────────────────────────────────────────────────────────────────────

/** O contrato como está gravado (SGH_SUP_CONTRATO): o fim e o valor originais; o vigente vem dos eventos. */
export interface ContratoGravado {
  readonly id: number;
  readonly numero: string;
  readonly fornecedor: number;
  readonly tipo: TipoContrato;
  readonly objeto: string;
  readonly critico: boolean;
  readonly inicio: string;
  readonly fimOriginal: string;
  readonly valorInicial: number;
  readonly indiceReajuste: IndiceReajuste;
  readonly dataBase: string | null;
  readonly garantia: GarantiaContrato;
  readonly garantiaValor: number | null;
  readonly garantiaValidade: string | null;
  readonly gestor: string;
  readonly fiscal: string;
  readonly centroCusto: number | null;
  readonly observacao: string | null;
  readonly situacao: SituacaoContratoFornecedor;
  readonly versao: number;
  readonly usuario: string;
  readonly criadoEm: string;
}

export interface ContratoResumo {
  readonly id: number;
  readonly numero: string;
  readonly fornecedor: number;
  readonly fornecedorNome: string;
  readonly tipo: TipoContrato;
  readonly objeto: string;
  readonly critico: boolean;
  readonly inicio: string;
  /** O fim vigente (o original ou o do último aditivo de prazo ou renovação). */
  readonly fim: string;
  readonly situacao: SituacaoContratoFornecedor;
  readonly faixa: FaixaVigencia;
  readonly diasParaVencer: number | null;
  readonly valorTotal: number;
  readonly saldo: number;
  readonly gestor: string;
  readonly fiscal: string;
  readonly versao: number;
}

export interface EventoContrato {
  readonly id: number;
  readonly tipo: TipoEventoContrato;
  readonly data: string | null;
  readonly valor: number | null;
  readonly percentual: number | null;
  readonly novoFim: string | null;
  readonly numeroTermo: string | null;
  readonly notas: Readonly<Record<CriterioAvaliacao, number>> | null;
  readonly resultado: ResultadoAvaliacao | null;
  readonly descricao: string | null;
  readonly documento: number | null;
  readonly usado: boolean;
  readonly usuario: string;
  readonly criadoEm: string;
}

export interface VinculoContrato {
  readonly id: number;
  readonly tipo: TipoVinculoContrato;
  readonly legado: number;
  readonly chaveNatural: string;
  /** O valor que abate o saldo (pedido: os itens vencedores do fornecedor; título: a parcela). */
  readonly valor: number;
  /** O título que paga um pedido já ligado: informativo, não abate de novo. */
  readonly pedidoDeOrigem: number | null;
  /** O pedido ou o título não existe mais (excluído) ou foi cancelado: não abate. */
  readonly ativo: boolean;
  readonly excecao: number | null;
  readonly usuario: string;
  readonly criadoEm: string;
}

/** Regra 6: o saldo com as parcelas impressas. */
export interface SaldoContrato {
  readonly valorInicial: number;
  readonly aditivos: number;
  readonly reajustes: number;
  readonly renovacoes: number;
  readonly valorTotal: number;
  readonly pedidos: number;
  readonly titulosAvulsos: number;
  /** Títulos que pagam pedidos já ligados (informativo; não abate). */
  readonly titulosDePedidos: number;
  readonly consumido: number;
  readonly saldo: number;
  readonly percentualConsumido: number;
  readonly conta: string;
}

export interface AvisoContrato {
  readonly codigo: string;
  readonly mensagem: string;
}

export interface ContratoDetalhe extends ContratoResumo {
  readonly indiceReajuste: IndiceReajuste;
  readonly dataBase: string | null;
  readonly proximoReajuste: string | null;
  readonly garantia: GarantiaContrato;
  readonly garantiaValor: number | null;
  readonly garantiaValidade: string | null;
  readonly centroCusto: number | null;
  readonly centroCustoNome: string | null;
  readonly observacao: string | null;
  readonly valorInicial: number;
  readonly fimOriginal: string;
  readonly saldoDetalhe: SaldoContrato;
  readonly ultimaAvaliacao: { data: string; resultado: ResultadoAvaliacao; media: number } | null;
  readonly proximaAvaliacao: string;
  readonly avisos: readonly AvisoContrato[];
  readonly eventos: readonly EventoContrato[];
  readonly vinculos: readonly VinculoContrato[];
  readonly criadoPor: string;
  readonly criadoEm: string;
}

export interface CandidatoVinculo {
  readonly tipo: TipoVinculoContrato;
  readonly ids: readonly number[];
  readonly chaveNatural: string;
  readonly data: string | null;
  readonly valor: number;
  readonly descricao: string;
}

export interface PainelContratos {
  readonly hoje: string;
  readonly ativos: number;
  readonly porFaixa: Readonly<Record<FaixaVigencia, number>>;
  readonly avaliacaoVencida: number;
  readonly saldoExcedido: number;
}
