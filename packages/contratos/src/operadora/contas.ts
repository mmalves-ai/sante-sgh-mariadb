// Contratos das contas médicas recebidas pela operadora própria (M56, etapa 6 de 8, fatia F5; ficha, seções 1, 4, 6, 7
// e 8; cap-07 §7.4; cap-13 §13.3.7): o lado oposto do TISS do hospital. O prestador credenciado manda o lote de guias
// em XML TISS 04.03.00 (consulta, SP/SADT, resumo de internação ou honorário); a operadora confere o XML no XSD da versão
// vigente e o hash do epílogo (regra 5; DP-47.7), dá o protocolo do lote e critica cada guia na hora (elegibilidade na
// data do atendimento, cartão de desconto, prestador na rede na data, senha da autorização, quantidade e procedimento
// autorizados, guia já apresentada, valor do item): as críticas que impedem o pagamento viram glosa automática com o
// motivo da tabela 38 da TISS. O auditor designado revê (glosa ou desfaz a glosa de cada item, com o motivo e a
// justificativa) e conclui a análise, que libera o lote para pagamento; o recurso de glosa do prestador é registrado e
// decidido pelo auditor; o pagamento ao prestador é registrado pela área financeira da operadora (empresa distinta,
// regra 3). O demonstrativo de análise da conta sai em XML TISS validado no XSD. Os dados ficam em SGH_OPE_CONTA,
// _GUIA, _ITEM e _EVT (scripts 0950 e 0951); os motivos de glosa são os da tabela 38 do banco do estabelecimento.
// Nenhuma escrita em tabela legada (seção 5).
import { z } from 'zod';
import { textoCp1252 } from '../texto-cp1252.js';

// ── Vocabulário ─────────────────────────────────────────────────────────────────────────────────

/** Tipo de guia do lote (o XSD aceita um só tipo por lote). */
export const TIPOS_GUIA_CONTA = {
  consulta: 'Consulta',
  'sp-sadt': 'SP/SADT',
  'resumo-internacao': 'Resumo de internação',
  honorario: 'Honorário individual',
} as const;
export type TipoGuiaConta = keyof typeof TIPOS_GUIA_CONTA;
export const CODIGOS_TIPO_GUIA_CONTA = Object.keys(TIPOS_GUIA_CONTA) as TipoGuiaConta[];

/** Situação do lote na operadora. */
export const SITUACOES_CONTA_MEDICA = {
  recebida: 'Em análise',
  analisada: 'Liberada para pagamento',
  paga: 'Paga',
  devolvida: 'Devolvida sem pagamento',
} as const;
export type SituacaoContaMedica = keyof typeof SITUACOES_CONTA_MEDICA;
export const CODIGOS_SITUACAO_CONTA_MEDICA = Object.keys(SITUACOES_CONTA_MEDICA) as SituacaoContaMedica[];

/** A situação do protocolo no demonstrativo TISS (dm_statusProtocolo). */
export const STATUS_PROTOCOLO_TISS: Readonly<Record<SituacaoContaMedica, string>> = {
  recebida: '2',
  analisada: '3',
  paga: '6',
  devolvida: '4',
};

export const GRUPOS_ITEM_CONTA = { procedimento: 'Procedimento', despesa: 'Outra despesa' } as const;
export type GrupoItemConta = keyof typeof GRUPOS_ITEM_CONTA;

/** Código da despesa (TISS, dm_outrasDespesas). */
export const CODIGOS_DESPESA_CONTA = {
  '01': 'Gases medicinais',
  '02': 'Medicamentos',
  '03': 'Materiais',
  '05': 'Diárias',
  '07': 'Taxas e aluguéis',
  '08': 'OPME',
} as const;

/** O recurso de glosa da guia (um por guia; D-RECURSO-56). */
export const SITUACOES_RECURSO_CONTA = {
  pendente: 'Recurso pendente',
  acatado: 'Recurso acatado',
  parcial: 'Recurso acatado em parte',
  mantido: 'Glosa mantida',
} as const;
export type SituacaoRecursoConta = keyof typeof SITUACOES_RECURSO_CONTA;
export const CODIGOS_SITUACAO_RECURSO = Object.keys(SITUACOES_RECURSO_CONTA) as SituacaoRecursoConta[];

/** O que aconteceu com o lote (SGH_OPE_CONTA_EVT, só de inclusão). */
export const EVENTOS_CONTA = [
  'recebimento',
  'glosa',
  'glosa-desfeita',
  'analise',
  'devolucao',
  'recurso',
  'recurso-decidido',
  'pagamento',
] as const;
export type EventoConta = (typeof EVENTOS_CONTA)[number];

/** Origem da glosa do item: a crítica automática do recebimento ou o auditor. */
export const ORIGENS_GLOSA = ['automatica', 'auditor'] as const;
export type OrigemGlosa = (typeof ORIGENS_GLOSA)[number];

/**
 * As críticas do recebimento (D-CRITICAS-CONTA-56), com o motivo de glosa da tabela 38 da TISS que cada uma aplica. As
 * da guia glosam a guia inteira; as do item, o item (a quantidade acima da autorizada e o valor a maior, só o excesso).
 */
export const CRITICAS_CONTA = {
  'carteira-invalida': { nivel: 'guia', motivo: 1001 },
  'beneficiario-inexistente': { nivel: 'guia', motivo: 1001 },
  'atendimento-antes-da-inclusao': { nivel: 'guia', motivo: 1005 },
  'beneficiario-excluido': { nivel: 'guia', motivo: 1014 },
  'beneficiario-suspenso': { nivel: 'guia', motivo: 1016 },
  'contrato-inativo': { nivel: 'guia', motivo: 1018 },
  'contrato-fora-da-vigencia': { nivel: 'guia', motivo: 1006 },
  'produto-cancelado': { nivel: 'guia', motivo: 1024 },
  'cartao-desconto': { nivel: 'guia', motivo: 1024 },
  'atendimento-no-futuro': { nivel: 'guia', motivo: 1323 },
  'em-carencia': { nivel: 'guia', motivo: 1007 },
  'prestador-antes-do-contrato': { nivel: 'guia', motivo: 1204 },
  'prestador-fora-da-rede-na-data': { nivel: 'guia', motivo: 1205 },
  'prestador-suspenso-na-data': { nivel: 'guia', motivo: 1205 },
  'senha-ausente': { nivel: 'guia', motivo: 1403 },
  'senha-inexistente': { nivel: 'guia', motivo: 1406 },
  'senha-de-outro-beneficiario': { nivel: 'guia', motivo: 1406 },
  'autorizacao-cancelada': { nivel: 'guia', motivo: 1437 },
  'senha-vencida': { nivel: 'guia', motivo: 1405 },
  'autorizacao-de-outro-prestador': { nivel: 'guia', motivo: 1404 },
  'guia-ja-apresentada': { nivel: 'guia', motivo: 1308 },
  'procedimento-nao-autorizado': { nivel: 'item', motivo: 1402 },
  'quantidade-acima-da-autorizada': { nivel: 'item', motivo: 1408 },
  'valor-a-maior': { nivel: 'item', motivo: 1705 },
} as const satisfies Readonly<Record<string, { nivel: 'guia' | 'item'; motivo: number }>>;
export type CriticaConta = keyof typeof CRITICAS_CONTA;
export const CODIGOS_CRITICA_CONTA = Object.keys(CRITICAS_CONTA) as CriticaConta[];

/**
 * Tamanho máximo do arquivo do lote (D-TAMANHO-CONTA-56): o arquivo vai em base64 no corpo da requisição, que a API limita
 * a 1 MiB; 700 KB de XML cabem com folga. O lote TISS tem até 100 guias; o maior vai em mais de um lote.
 */
export const MAXIMO_BYTES_CONTA = 700_000;
/** Guias por lote (o XSD aceita até 100). */
export const MAXIMO_GUIAS_CONTA = 100;
/** Itens glosados por gravação. */
export const MAXIMO_ITENS_GLOSA = 300;

// ── O lote TISS lido (neutro: o leitor do XML fica com o TISS do M31, em @sgh/dominio-faturamento) ──────────────

export interface ItemTissRecebido {
  readonly sequencial: number;
  readonly grupo: GrupoItemConta;
  /** dm_outrasDespesas, só nas despesas. */
  readonly codigoDespesa: string | null;
  readonly tabela: string;
  readonly codigo: string;
  readonly descricao: string;
  /** AAAA-MM-DD */
  readonly data: string;
  readonly quantidade: number;
  /** Fator de redução ou acréscimo (1.00 sem redução). */
  readonly fator: number;
  readonly valorUnitario: number;
  readonly valorTotal: number;
}

export interface GuiaTissRecebida {
  readonly tipo: TipoGuiaConta;
  readonly registroAns: string;
  readonly numeroGuiaPrestador: string;
  readonly numeroGuiaOperadora: string | null;
  readonly senha: string | null;
  readonly carteirinha: string;
  readonly atendimentoRN: boolean;
  /** '1' eletivo, '2' urgência ou emergência (dm_caraterAtendimento); null na consulta. */
  readonly carater: '1' | '2' | null;
  /** O primeiro e o último dia do atendimento (AAAA-MM-DD). */
  readonly inicio: string;
  readonly fim: string;
  readonly itens: readonly ItemTissRecebido[];
}

export interface LoteTissRecebido {
  readonly tipoTransacao: string;
  readonly sequencialTransacao: string;
  readonly dataTransacao: string;
  readonly padrao: string | null;
  /** O prestador de origem: o código na operadora, o CPF ou o CNPJ. */
  readonly prestador: { readonly tipo: 'codigo' | 'cpf' | 'cnpj'; readonly valor: string };
  readonly registroAnsDestino: string;
  readonly numeroLote: string;
  readonly tipoGuia: TipoGuiaConta;
  readonly guias: readonly GuiaTissRecebida[];
}

// ── Entradas ────────────────────────────────────────────────────────────────────────────────────

const texto = (max: number, min: number, msg: string) =>
  textoCp1252(max)
    .overwrite((t) => t.replace(/\s+/g, ' ').trim())
    .pipe(z.string().min(min, msg));
const dataIso = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Data no formato AAAA-MM-DD.');
const id = z.number().int().min(1);
const comVersao = { versao: z.number().int().min(1) };
/** Dinheiro com duas casas (reais), até R$ 99.999.999,99. */
const dinheiro = z
  .number()
  .min(0)
  .max(99_999_999.99)
  .refine((v) => Math.abs(Math.round(v * 100) - v * 100) < 1e-6, 'Use no máximo duas casas decimais.');

/** O arquivo do lote em base64 (os bytes exatos: o XML TISS é ISO-8859-1 e o hash do epílogo depende deles). */
export const esquemaReceberConta = z
  .object({
    arquivo: z
      .string()
      .min(16, 'Escolha o arquivo XML do lote.')
      .max(Math.ceil((MAXIMO_BYTES_CONTA * 4) / 3) + 8, 'O arquivo passa de 700 KB.')
      .regex(/^[A-Za-z0-9+/=\s]+$/, 'O arquivo não veio inteiro: escolha de novo.'),
    nome: textoCp1252(120).nullable().default(null),
  })
  .strict();
export type ReceberContaEntrada = z.infer<typeof esquemaReceberConta>;

export const esquemaGlosaItem = z
  .object({
    item: id,
    /** 0 desfaz a glosa do item. */
    valorGlosado: dinheiro,
    /** Motivo da tabela 38 da TISS (código de 4 dígitos do banco); obrigatório com glosa. */
    motivo: z.number().int().min(1000).max(9999).nullable(),
    justificativa: texto(500, 0, '').nullable(),
  })
  .strict();
export type GlosaItemEntrada = z.infer<typeof esquemaGlosaItem>;

export const esquemaGlosarConta = z
  .object({ ...comVersao, itens: z.array(esquemaGlosaItem).min(1).max(MAXIMO_ITENS_GLOSA) })
  .strict();
export type GlosarContaEntrada = z.infer<typeof esquemaGlosarConta>;

export const esquemaConcluirAnalise = z
  .object({ ...comVersao, observacao: texto(500, 0, '').nullable().default(null) })
  .strict();
export type ConcluirAnaliseEntrada = z.infer<typeof esquemaConcluirAnalise>;

export const esquemaDevolverConta = z
  .object({
    ...comVersao,
    motivo: texto(500, 10, 'Diga por que o lote volta ao prestador (10 caracteres ou mais).'),
  })
  .strict();
export type DevolverContaEntrada = z.infer<typeof esquemaDevolverConta>;

export const esquemaRegistrarRecursoConta = z
  .object({
    ...comVersao,
    guia: id,
    valor: dinheiro.refine((v) => v > 0, 'Informe o valor do recurso.'),
    justificativa: texto(1000, 10, 'Copie a justificativa do prestador (10 caracteres ou mais).'),
  })
  .strict();
export type RegistrarRecursoContaEntrada = z.infer<typeof esquemaRegistrarRecursoConta>;

export const esquemaDecidirRecurso = z
  .object({
    ...comVersao,
    guia: id,
    /** 0 mantém a glosa; o valor do recurso inteiro acata. */
    valorAcatado: dinheiro,
    parecer: texto(1000, 10, 'Escreva o parecer do auditor (10 caracteres ou mais).'),
  })
  .strict();
export type DecidirRecursoEntrada = z.infer<typeof esquemaDecidirRecurso>;

/** W0-10 (M8): o recurso de glosa por item pelo portal do prestador (a guia inteira de uma vez, uma por guia). */
export const esquemaRegistrarRecursoItens = z
  .object({
    ...comVersao,
    guia: id,
    itens: z
      .array(
        z
          .object({
            item: id,
            valor: dinheiro.refine((v) => v > 0, 'Informe o valor recorrido do item.'),
            justificativa: texto(1000, 10, 'Justifique o recurso do item (10 caracteres ou mais).'),
          })
          .strict(),
      )
      .min(1, 'Escolha ao menos um item glosado para recorrer.')
      .max(200),
    justificativa: texto(1000, 10, 'Justifique o recurso da guia (10 caracteres ou mais).'),
  })
  .strict();
export type RegistrarRecursoItensEntrada = z.infer<typeof esquemaRegistrarRecursoItens>;

/** W0-10 (M8): a decisão do recurso por item (todos os itens recorridos da guia de uma vez; outra pessoa decide). */
export const esquemaDecidirRecursoItens = z
  .object({
    ...comVersao,
    decisoes: z
      .array(
        z
          .object({
            item: id,
            /** 0 mantém a glosa do item; o valor recorrido inteiro acata. */
            valorAcatado: dinheiro,
            parecer: texto(1000, 10, 'Escreva o parecer de cada item (10 caracteres ou mais).'),
          })
          .strict(),
      )
      .min(1)
      .max(200),
    parecer: texto(1000, 10, 'Escreva o parecer do auditor (10 caracteres ou mais).'),
  })
  .strict();
export type DecidirRecursoItensEntrada = z.infer<typeof esquemaDecidirRecursoItens>;

export const esquemaRegistrarPagamento = z
  .object({
    ...comVersao,
    valor: dinheiro.refine((v) => v > 0, 'Informe o valor pago.'),
    data: dataIso,
    documento: texto(40, 1, 'Informe o documento do pagamento (número da transferência ou do título).'),
  })
  .strict();
export type RegistrarPagamentoEntrada = z.infer<typeof esquemaRegistrarPagamento>;

export const esquemaFiltroContas = z.object({
  /** Protocolo do lote (12 dígitos) ou número do lote do prestador. */
  busca: z.string().trim().min(1).max(20).optional(),
  prestador: z.coerce.number().int().min(1).optional(),
  competencia: z
    .string()
    .regex(/^\d{4}-(0[1-9]|1[0-2])$/)
    .optional(),
  situacao: z
    .enum(CODIGOS_SITUACAO_CONTA_MEDICA as [SituacaoContaMedica, ...SituacaoContaMedica[]])
    .optional(),
  /** Só os lotes com o prazo de pagamento vencido sem pagar. */
  vencidas: z
    .enum(['sim'])
    .transform(() => true)
    .optional(),
  /** Só os com recurso de glosa pendente. */
  recursos: z
    .enum(['sim'])
    .transform(() => true)
    .optional(),
  apos: z.coerce.number().int().min(1).optional(),
});
export type FiltroContas = z.infer<typeof esquemaFiltroContas>;

export const esquemaFiltroPagamentos = z.object({
  prestador: z.coerce.number().int().min(1).optional(),
  competencia: z
    .string()
    .regex(/^\d{4}-(0[1-9]|1[0-2])$/)
    .optional(),
  /** `a-pagar` (liberadas com saldo), `pagas` ou `todas`. */
  estado: z.enum(['a-pagar', 'pagas', 'todas']).default('a-pagar'),
  apos: z.coerce.number().int().min(1).optional(),
});
export type FiltroPagamentos = z.infer<typeof esquemaFiltroPagamentos>;

// ── Respostas ───────────────────────────────────────────────────────────────────────────────────

export const esquemaMotivoGlosaOpe = z.object({
  codigo: z.number().int(),
  rotulo: z.string(),
  grupo: z.string(),
});
export type MotivoGlosaOperadora = z.infer<typeof esquemaMotivoGlosaOpe>;

export const esquemaApoioContas = z.object({
  operadoras: z.array(z.object({ id: z.number().int(), nome: z.string(), registroAns: z.string() })),
  prestadores: z.array(z.object({ id: z.number().int(), nome: z.string() })),
  /** Motivos de glosa da tabela 38 da TISS (os de 4 dígitos do banco do estabelecimento). */
  motivos: z.array(esquemaMotivoGlosaOpe),
  /** Quem está na tela é auditor designado e vigente (e de qual operadora). */
  auditor: z
    .object({ id: z.number().int(), operadora: z.number().int(), nome: z.string(), categoria: z.string() })
    .nullable(),
  ligada: z.boolean(),
  motivo: z.string().nullable(),
  podeLer: z.boolean(),
  podeReceber: z.boolean(),
  podeAnalisar: z.boolean(),
  podePagar: z.boolean(),
  hoje: dataIso,
  parametros: z.object({ diasPagamento: z.number().int(), maximoKilobytes: z.number().int() }),
});
export type ApoioContas = z.infer<typeof esquemaApoioContas>;

const valores = {
  apresentado: z.number(),
  glosado: z.number(),
  acatado: z.number(),
  liberado: z.number(),
  pago: z.number(),
  saldo: z.number(),
};

export const esquemaContaMedicaResumo = z.object({
  id: z.number().int(),
  protocolo: z.string(),
  operadora: z.number().int(),
  prestador: z.number().int(),
  prestadorNome: z.string(),
  numeroLote: z.string(),
  tipoGuia: z.enum(CODIGOS_TIPO_GUIA_CONTA as [TipoGuiaConta, ...TipoGuiaConta[]]),
  competencia: z.string(),
  guias: z.number().int(),
  recebidaEm: z.string(),
  prazoPagamento: dataIso,
  /** Liberada com saldo e o prazo de pagamento vencido (relógio do banco). */
  vencida: z.boolean(),
  situacao: z.enum(CODIGOS_SITUACAO_CONTA_MEDICA as [SituacaoContaMedica, ...SituacaoContaMedica[]]),
  recursosPendentes: z.number().int(),
  ...valores,
  versao: z.number().int(),
});
export type ContaMedicaResumo = z.infer<typeof esquemaContaMedicaResumo>;

/**
 * W0-10 (M8): os lotes do prestador no portal (só os dele, na operadora da conta), do mais novo, com os valores da
 * análise, do recurso e do pagamento; `demonstrativo` diz se o demonstrativo de análise já pode ser baixado.
 */
export const esquemaContasPortal = z.object({
  itens: z.array(
    esquemaContaMedicaResumo.extend({ demonstrativo: z.boolean(), demonstrativoPagamento: z.boolean() }),
  ),
  proxima: z.number().int().nullable(),
});
export type ContasPortal = z.infer<typeof esquemaContasPortal>;
/** W0-10 (M8): a decisão da operadora sobre um item recorrido (registro novo, ligado ao recurso do item). */
export const esquemaDecisaoRecursoItem = z.object({
  decisao: z.enum(['acatado', 'parcial', 'mantido']),
  valorAcatado: z.number(),
  parecer: z.string(),
  em: z.string(),
  por: z.string(),
});

/** W0-10 (M8): o recurso de glosa de um item da guia, enviado pelo prestador no portal (só inclusão). */
export const esquemaRecursoItemConta = z.object({
  id: z.number().int(),
  item: z.number().int(),
  valor: z.number(),
  justificativa: z.string(),
  em: z.string(),
  por: z.string(),
  decisao: esquemaDecisaoRecursoItem.nullable(),
});
export type RecursoItemConta = z.infer<typeof esquemaRecursoItemConta>;

/**
 * W0-10 (M8): as glosas de um lote do prestador no portal (para o recurso por item): as guias com glosa, os itens
 * glosados com o motivo e a justificativa do auditor, e o recurso de cada item com a decisão. `podeRecorrer` diz se o
 * lote aceita recurso (analisado ou pago); a guia aceita quando `recorrivel` (com glosa e ainda sem recurso).
 */
export const esquemaGlosasContaPortal = z.object({
  id: z.number().int(),
  versao: z.number().int(),
  protocolo: z.string(),
  numeroLote: z.string(),
  situacao: z.enum(CODIGOS_SITUACAO_CONTA_MEDICA as [SituacaoContaMedica, ...SituacaoContaMedica[]]),
  podeRecorrer: z.boolean(),
  guias: z.array(
    z.object({
      id: z.number().int(),
      numeroGuiaPrestador: z.string(),
      apresentado: z.number(),
      glosado: z.number(),
      acatado: z.number(),
      recurso: z
        .object({
          situacao: z.enum(CODIGOS_SITUACAO_RECURSO as [SituacaoRecursoConta, ...SituacaoRecursoConta[]]),
          valor: z.number(),
          justificativa: z.string(),
          parecer: z.string().nullable(),
        })
        .nullable(),
      recorrivel: z.boolean(),
      itens: z.array(
        z.object({
          id: z.number().int(),
          codigo: z.string(),
          descricao: z.string(),
          apresentado: z.number(),
          glosado: z.number(),
          motivo: z.number().int().nullable(),
          motivoNome: z.string().nullable(),
          justificativa: z.string().nullable(),
          recurso: esquemaRecursoItemConta.nullable(),
        }),
      ),
    }),
  ),
});
export type GlosasContaPortal = z.infer<typeof esquemaGlosasContaPortal>;

export const esquemaFiltroContasPortal = z.object({
  apos: z.coerce.number().int().min(1).optional(),
});

export const esquemaContas = z.object({
  itens: z.array(esquemaContaMedicaResumo),
  proxima: z.number().int().nullable(),
  totais: z.object({
    emAnalise: z.number().int(),
    aPagar: z.number().int(),
    vencidas: z.number().int(),
    recursosPendentes: z.number().int(),
    valorEmAnalise: z.number(),
    valorAPagar: z.number(),
  }),
});
export type Contas = z.infer<typeof esquemaContas>;

export const esquemaItemContaMedica = z.object({
  id: z.number().int(),
  sequencial: z.number().int(),
  grupo: z.enum(['procedimento', 'despesa']),
  codigoDespesa: z.string().nullable(),
  tabela: z.string(),
  codigo: z.string(),
  descricao: z.string(),
  data: z.string(),
  quantidade: z.number(),
  valorUnitario: z.number(),
  apresentado: z.number(),
  glosado: z.number(),
  motivo: z.number().int().nullable(),
  motivoNome: z.string().nullable(),
  justificativa: z.string().nullable(),
  origem: z.enum(ORIGENS_GLOSA).nullable(),
  critica: z.string().nullable(),
});
export type ItemContaMedica = z.infer<typeof esquemaItemContaMedica>;

export const esquemaCriticaGuiaConta = z.object({
  codigo: z.string(),
  motivo: z.number().int(),
  texto: z.string(),
});

export const esquemaRecursoConta = z.object({
  situacao: z.enum(CODIGOS_SITUACAO_RECURSO as [SituacaoRecursoConta, ...SituacaoRecursoConta[]]),
  valor: z.number(),
  justificativa: z.string(),
  registradoEm: z.string(),
  registradoPor: z.string(),
  valorAcatado: z.number().nullable(),
  parecer: z.string().nullable(),
  decididoEm: z.string().nullable(),
  decididoPor: z.string().nullable(),
});
export type RecursoConta = z.infer<typeof esquemaRecursoConta>;

export const esquemaGuiaConta = z.object({
  id: z.number().int(),
  ordem: z.number().int(),
  numeroGuiaPrestador: z.string(),
  numeroGuiaOperadora: z.string().nullable(),
  senha: z.string().nullable(),
  carteirinha: z.string(),
  beneficiario: z.object({ id: z.number().int(), nome: z.string() }).nullable(),
  autorizacao: z.object({ id: z.number().int(), protocolo: z.string() }).nullable(),
  carater: z.string().nullable(),
  inicio: z.string(),
  fim: z.string(),
  apresentado: z.number(),
  glosado: z.number(),
  acatado: z.number(),
  criticas: z.array(esquemaCriticaGuiaConta),
  recurso: esquemaRecursoConta.nullable(),
  /** W0-10 (M8): o recurso por item (vazio quando o recurso foi registrado pela guia inteira). */
  recursosItens: z.array(esquemaRecursoItemConta),
  itens: z.array(esquemaItemContaMedica),
});
export type GuiaConta = z.infer<typeof esquemaGuiaConta>;

export const esquemaEventoConta = z.object({
  id: z.number().int(),
  evento: z.enum(EVENTOS_CONTA),
  situacao: z.enum(CODIGOS_SITUACAO_CONTA_MEDICA as [SituacaoContaMedica, ...SituacaoContaMedica[]]),
  guia: z.number().int().nullable(),
  valor: z.number().nullable(),
  texto: z.string().nullable(),
  documento: z.string().nullable(),
  em: z.string(),
  por: z.string(),
});
export type EventoContaLido = z.infer<typeof esquemaEventoConta>;

export const ACOES_CONTA = ['glosar', 'concluir', 'devolver', 'recurso', 'decidir-recurso', 'pagar'] as const;
export type AcaoConta = (typeof ACOES_CONTA)[number];

export const esquemaContaMedicaDetalhe = esquemaContaMedicaResumo.extend({
  operadoraNome: z.string(),
  registroAns: z.string(),
  arquivo: z.object({
    nome: z.string().nullable(),
    bytes: z.number().int(),
    sha256: z.string(),
    hashEpilogo: z.string(),
    versaoTiss: z.string(),
  }),
  analisadaEm: z.string().nullable(),
  analisadaPor: z.string().nullable(),
  observacao: z.string().nullable(),
  motivoDevolucao: z.string().nullable(),
  guiasDetalhe: z.array(esquemaGuiaConta),
  eventos: z.array(esquemaEventoConta),
  /** As ações que a situação e quem está na tela permitem. */
  acoes: z.array(z.enum(ACOES_CONTA)),
});
export type ContaMedicaDetalhe = z.infer<typeof esquemaContaMedicaDetalhe>;

export const esquemaResultadoConta = z.object({
  ok: z.literal(true),
  id: z.number().int(),
  versao: z.number().int(),
  situacao: z.enum(CODIGOS_SITUACAO_CONTA_MEDICA as [SituacaoContaMedica, ...SituacaoContaMedica[]]),
  protocolo: z.string(),
  mensagem: z.string(),
  avisos: z.array(z.string()),
});
export type ResultadoConta = z.infer<typeof esquemaResultadoConta>;

export const esquemaPagamentoPrestador = z.object({
  id: z.number().int(),
  protocolo: z.string(),
  prestador: z.number().int(),
  prestadorNome: z.string(),
  competencia: z.string(),
  numeroLote: z.string(),
  prazoPagamento: dataIso,
  vencida: z.boolean(),
  situacao: z.enum(CODIGOS_SITUACAO_CONTA_MEDICA as [SituacaoContaMedica, ...SituacaoContaMedica[]]),
  liberado: z.number(),
  pago: z.number(),
  saldo: z.number(),
  versao: z.number().int(),
});
export type PagamentoPrestador = z.infer<typeof esquemaPagamentoPrestador>;

export const esquemaPagamentos = z.object({
  itens: z.array(esquemaPagamentoPrestador),
  proxima: z.number().int().nullable(),
  totais: z.object({ aPagar: z.number().int(), valorAPagar: z.number(), vencidas: z.number().int() }),
});
export type PagamentosPrestadores = z.infer<typeof esquemaPagamentos>;

export const esquemaDemonstrativoConta = z.object({
  nome: z.string(),
  /** O XML TISS em ISO-8859-1, em base64 (os bytes exatos). */
  xmlBase64: z.string(),
  hash: z.string(),
});
export type DemonstrativoConta = z.infer<typeof esquemaDemonstrativoConta>;

/** Rotas e permissões da fatia F5 (a chave `operadora.contas`, que só vale com a do módulo, em todas menos o apoio). */
export const ROTAS_OPERADORA_F5 = {
  apoio: { caminho: 'operadora/contas/apoio', permissao: 'operadora.dominio.ler' },
  lista: { caminho: 'operadora/contas', permissao: 'operadora.conta.ler' },
  ficha: { caminho: 'operadora/contas/:id', permissao: 'operadora.conta.ler' },
  demonstrativo: { caminho: 'operadora/contas/:id/demonstrativo', permissao: 'operadora.conta.ler' },
  /** W0-10 (M8): o demonstrativo de pagamento do lote quitado (XML TISS). */
  demonstrativoPagamento: {
    caminho: 'operadora/contas/:id/demonstrativo-pagamento',
    permissao: 'operadora.conta.ler',
  },
  receber: { caminho: 'operadora/contas/xml', permissao: 'operadora.conta.receber' },
  glosar: { caminho: 'operadora/contas/:id/glosas', permissao: 'operadora.conta.analisar' },
  concluir: { caminho: 'operadora/contas/:id/analise', permissao: 'operadora.conta.analisar' },
  devolver: { caminho: 'operadora/contas/:id/devolver', permissao: 'operadora.conta.analisar' },
  recurso: { caminho: 'operadora/contas/:id/recurso', permissao: 'operadora.conta.receber' },
  decidirRecurso: { caminho: 'operadora/contas/:id/recurso/decisao', permissao: 'operadora.conta.analisar' },
  /** W0-10 (M8): a decisão do recurso por item de uma guia (todos os itens de uma vez). */
  decidirRecursoItens: {
    caminho: 'operadora/contas/:id/guias/:guia/recurso-itens/decisao',
    permissao: 'operadora.conta.analisar',
  },
  pagamentos: { caminho: 'operadora/pagamentos-prestadores', permissao: 'operadora.conta.pagar' },
  pagar: { caminho: 'operadora/contas/:id/pagamento', permissao: 'operadora.conta.pagar' },
} as const;

/** Chave de liberação da fatia (CHAVES_FATIA_OPERADORA, recurso `contas`). */
export const CHAVE_OPERADORA_CONTAS = 'operadora.contas' as const;

/** Textos das recusas, das críticas e dos avisos das contas médicas: o mesmo texto na API e na tela. */
export const MENSAGENS_CONTAS: Readonly<Record<string, string>> = {
  'arquivo-invalido': 'O arquivo não é um XML TISS legível. Confira se escolheu o lote certo.',
  'arquivo-grande': 'O arquivo passa de 700 KB: peça ao prestador o lote dividido.',
  'xsd-invalido':
    'O XML não passa no XSD da TISS 04.03.00 (veja os erros). Peça ao prestador o lote corrigido.',
  'versao-recusada': 'Só a versão 04.03.00 da TISS é aceita.',
  'hash-nao-confere': 'O hash do epílogo não confere: o arquivo foi alterado depois de gerado.',
  'transacao-nao-e-lote': 'O arquivo não é um lote de guias (ENVIO_LOTE_GUIAS).',
  'operadora-destino-desconhecida':
    'O registro na ANS do destino do lote não é de uma operadora ativa deste estabelecimento.',
  'registro-da-guia-divergente': 'Há guia com o registro na ANS diferente do destino do lote.',
  'prestador-desconhecido': 'O prestador do lote não está na rede da operadora (código, CPF ou CNPJ).',
  'lote-de-outro-prestador':
    'O lote é de outro prestador ou de outra operadora: pelo portal, envie só os lotes do seu credenciamento.',
  'lote-ja-recebido': 'Este lote do prestador já foi recebido (o mesmo número ou o mesmo arquivo).',
  'guias-demais': 'O lote passa de 100 guias.',
  'guia-repetida-no-lote': 'O mesmo número de guia do prestador aparece duas vezes no lote.',
  'conta-inexistente': 'O lote não existe neste estabelecimento.',
  'conta-desatualizada':
    'O lote mudou depois que você abriu (outra pessoa gravou). Abra de novo e confira antes de gravar.',
  'conta-em-edicao': 'Outra pessoa está gravando este lote agora. Abra de novo e confira antes de gravar.',
  'situacao-nao-permite': 'Esta ação não vale na situação atual do lote.',
  'auditor-nao-designado':
    'Você não está designado como auditor desta operadora. A diretoria da operadora designa os auditores.',
  'item-inexistente': 'Há item que não é deste lote.',
  'item-repetido': 'O mesmo item aparece duas vezes na gravação.',
  'glosa-acima-do-apresentado': 'A glosa não pode passar do valor apresentado do item.',
  'motivo-obrigatorio': 'Escolha o motivo da glosa (tabela 38 da TISS).',
  'motivo-inexistente': 'O motivo de glosa não está na tabela 38 do estabelecimento.',
  'justificativa-obrigatoria': 'Escreva a justificativa da glosa (5 caracteres ou mais).',
  'motivo-sem-glosa': 'Sem glosa no item, não informe o motivo nem a justificativa.',
  'guia-inexistente': 'A guia não é deste lote.',
  'sem-glosa-na-guia': 'A guia não tem glosa para recorrer.',
  'recurso-ja-registrado': 'A guia já tem recurso de glosa (um por guia).',
  'recurso-acima-da-glosa': 'O recurso não pode passar do valor glosado na guia.',
  'sem-recurso-pendente': 'A guia não tem recurso pendente.',
  'recurso-por-item':
    'O recurso desta guia foi feito por item: decida item a item (cada item recorrido com o valor acatado e o parecer).',
  'sem-recurso-por-item': 'O recurso desta guia não foi feito por item: decida pela guia.',
  'item-nao-encontrado': 'Há item que não é desta guia.',
  'guia-nao-encontrada': 'A guia não é deste lote.',
  'item-sem-glosa': 'Há item sem glosa: só o item glosado aceita recurso.',
  'recurso-acima-da-glosa-do-item': 'O valor recorrido do item vai de um centavo até o valor glosado nele.',
  'decisao-incompleta': 'Decida cada item recorrido, uma vez cada.',
  'acatado-acima-do-recurso-do-item': 'O valor acatado do item vai de zero até o valor recorrido nele.',
  'recurso-do-proprio-auditor':
    'Quem registrou o recurso de glosa não o decide: outro auditor designado da operadora decide.',
  'acatado-acima-do-recurso': 'O valor acatado não pode passar do valor do recurso.',
  'pagamento-acima-do-saldo': 'O valor pago não pode passar do saldo a pagar do lote.',
  'pagamento-no-futuro': 'A data do pagamento é de hoje ou antes.',
  'pagamento-antes-da-analise': 'O pagamento é de depois da liberação do lote.',
  'nada-a-pagar': 'O lote não tem saldo a pagar.',
  'numero-em-uso': 'O número gerado já existe: tente de novo.',
  'demonstrativo-antes-da-analise': 'O demonstrativo sai depois que a análise do lote é concluída.',
  'demonstrativo-da-devolvida':
    'O lote devolvido não tem demonstrativo de análise: o motivo da devolução é o que vai ao prestador.',
  'demonstrativo-pagamento-antes-da-quitacao':
    'O demonstrativo de pagamento sai quando o lote está pago por inteiro.',
  // Críticas do recebimento.
  'carteira-invalida': 'A carteirinha não confere (16 dígitos com o verificador).',
  'beneficiario-inexistente': 'Nenhum beneficiário da operadora com esta carteirinha.',
  'atendimento-antes-da-inclusao': 'O atendimento é anterior à inclusão do beneficiário no plano.',
  'beneficiario-excluido': 'O beneficiário está excluído do plano.',
  'beneficiario-suspenso': 'O beneficiário está com o atendimento suspenso.',
  'contrato-inativo': 'O contrato do beneficiário não está ativo.',
  'contrato-fora-da-vigencia': 'O atendimento é de fora da vigência do contrato do beneficiário.',
  'produto-cancelado': 'O plano do beneficiário está cancelado.',
  'cartao-desconto':
    'O produto do beneficiário é cartão de desconto: não é plano de saúde e a operadora não paga conta médica dele.',
  'atendimento-no-futuro': 'A data do atendimento é de depois do recebimento.',
  'em-carencia': 'O atendimento sem autorização caiu na carência do plano do beneficiário.',
  'prestador-antes-do-contrato': 'O atendimento é anterior ao contrato do prestador com a operadora.',
  'prestador-fora-da-rede-na-data': 'O prestador não estava credenciado na data do atendimento.',
  'prestador-suspenso-na-data': 'O prestador estava suspenso na rede na data do atendimento.',
  'senha-ausente': 'A guia exige a senha da autorização e veio sem ela.',
  'senha-inexistente': 'A senha informada não é de uma autorização da operadora.',
  'senha-de-outro-beneficiario': 'A senha informada é de autorização de outro beneficiário.',
  'autorizacao-cancelada': 'A autorização da senha está cancelada.',
  'senha-vencida': 'A validade da senha é anterior ao atendimento.',
  'autorizacao-de-outro-prestador': 'A autorização da senha é de outro prestador.',
  'guia-ja-apresentada': 'Esta guia do prestador já foi apresentada em outro lote.',
  'procedimento-nao-autorizado': 'O procedimento não está na autorização da senha.',
  'quantidade-acima-da-autorizada': 'A quantidade passa da autorizada (só o excesso é glosado).',
  'valor-a-maior':
    'O valor total do item passa da quantidade vezes o valor unitário com o fator (só a diferença é glosada).',
};
