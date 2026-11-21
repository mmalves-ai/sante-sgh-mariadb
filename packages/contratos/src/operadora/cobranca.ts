// Contratos da cobrança e das mensalidades da operadora própria (M56, etapa 3 de 8, fatia F2; ficha, seções 1, 6, 7 e
// 8, regra 6): a mensalidade da competência (preço da faixa etária da RN 63 com os reajustes do contrato), a
// coparticipação avulsa (pela regra do produto), a cobrança avulsa, os acordos e parcelamentos (o tipo de cobrança
// de 1 a 4), a baixa com multa e juros de mora, o cancelamento e o estorno, o reajuste anual do contrato
// (o teto da ANS no individual ou familiar; o agrupamento dos contratos coletivos pequenos) e a inadimplência (Lei
// 9.656/1998, art. 13, II; RN ANS 593/2023: notificação até o 50º dia, mais de 60 dias em 12 meses, 10 dias de prazo
// depois da notificação). Os dados ficam em SGH_OPE_COBRANCA, SGH_OPE_COBRANCA_ITEM e SGH_OPE_REAJUSTE (scripts 0565 a
// 0567); nenhuma escrita em tabela do sistema anterior (seção 5). O pagador é o contrato: na pessoa física, o titular
// (um só por contrato); na jurídica, o contratante. A mensagem ao beneficiário só sai pela Hal-AI, com a base legal e
// em produção (regra 6): até lá, o aviso é por carta, pessoal ou edital, registrado aqui.
import { z } from 'zod';
import { esquemaDataIso } from '../preco/entradas.js';
import { normalizarTextoCp1252, textoCp1252 } from '../texto-cp1252.js';
import { DATA_MINIMA_OPERADORA } from './beneficiarios.js';

// ── Vocabulário e parâmetros ────────────────────────────────────────────────────────────────────────────────────

export const SITUACOES_COBRANCA = {
  aberta: 'Em aberto',
  paga: 'Paga',
  cancelada: 'Cancelada',
  renegociada: 'Renegociada em acordo',
} as const;
export type SituacaoCobranca = keyof typeof SITUACOES_COBRANCA;
export const CODIGOS_SITUACAO_COBRANCA = Object.keys(SITUACOES_COBRANCA) as [
  SituacaoCobranca,
  ...SituacaoCobranca[],
];

/** Tipos de cobrança (regra 6): o código do domínio. */
export const TIPO_COBRANCA = { mensalidade: 1, coparticipacao: 2, avulsa: 3, acordo: 4 } as const;

/** Meio da notificação de inadimplência (com comprovação; a mensagem pela Hal-AI só com a base legal, regra 6). */
export const MEIOS_NOTIFICACAO = {
  'carta-ar': 'Carta com aviso de recebimento',
  pessoal: 'Notificação pessoal, com a assinatura do beneficiário',
  edital: 'Edital (beneficiário não localizado)',
} as const;
export type MeioNotificacao = keyof typeof MEIOS_NOTIFICACAO;
export const CODIGOS_MEIO_NOTIFICACAO = Object.keys(MEIOS_NOTIFICACAO) as [
  MeioNotificacao,
  ...MeioNotificacao[],
];

/**
 * Situação do contrato diante da inadimplência. Só o individual ou familiar segue a lei (suspensão ou rescisão só com
 * mais de 60 dias de atraso em 12 meses, duas mensalidades e a notificação até o 50º dia, com 10 dias para pagar); o
 * coletivo segue o contrato.
 */
export const SITUACOES_INADIMPLENCIA = {
  'em-dia': 'Em dia',
  notificar: 'Notificar o beneficiário',
  'aguardando-prazo': 'Notificado, no prazo para pagar',
  'passivel-suspensao': 'Pode ser suspenso ou rescindido',
  'conforme-contrato': 'Em atraso (coletivo: segue o contrato)',
} as const;
export type SituacaoInadimplencia = keyof typeof SITUACOES_INADIMPLENCIA;

export const SITUACOES_REAJUSTE = { vigente: 'Vigente', cancelado: 'Cancelado' } as const;
export type SituacaoReajuste = keyof typeof SITUACOES_REAJUSTE;

/** Parâmetros da cobrança (regra pura; a diretoria da operadora confirma, D-ENCARGOS-56 e D-INADIMPLENCIA-56). */
export const PARAMETROS_COBRANCA = {
  /** Multa por atraso (Código de Defesa do Consumidor, art. 52, § 1º: até 2%). */
  multaPercentual: 2,
  /** Juros de mora ao mês, pro rata dia (30 dias). */
  jurosPercentualMes: 1,
  /** A notificação da inadimplência sai até o 50º dia (Lei 9.656/1998, art. 13, II). */
  diasLimiteNotificacao: 50,
  /** Suspensão ou rescisão só com mais de 60 dias de atraso, seguidos ou não, nos últimos 12 meses. */
  diasInadimplencia: 60,
  /** Prazo para pagar depois de notificado (RN ANS 593/2023). */
  diasPrazoNotificacao: 10,
  /** Mensalidades não pagas no prazo nos últimos 12 meses (RN ANS 593/2023). */
  mensalidadesMinimas: 2,
  /** Parcelas de um acordo. */
  parcelasMaximas: 12,
  /** Contrato coletivo com menos vidas que isto entra no agrupamento do reajuste (RN ANS 565/2022). */
  vidasAgrupamento: 30,
} as const;

// ── Esquemas comuns ─────────────────────────────────────────────────────────────────────────────────────────────

const data = esquemaDataIso.refine((d) => d >= DATA_MINIMA_OPERADORA, 'Data anterior a 1900 não é aceita.');
const textoAparado = (max: number) =>
  z
    .string()
    .overwrite((t) => normalizarTextoCp1252(t).replace(/\s+/g, ' ').trim())
    .pipe(textoCp1252(max));
const textoMinimo = (max: number, min: number, msg: string) =>
  textoAparado(max).refine((t) => t.length >= min, msg);
const textoOpcional = (max: number) =>
  textoAparado(max)
    .nullable()
    .optional()
    .transform((v) => (v ? v : null));
const id = z.coerce.number().int().positive().max(9_007_199_254_740_991);
const versao = z.coerce.number().int().min(0).max(2_147_483_647);
const motivo = textoMinimo(200, 10, 'Descreva o motivo (10 caracteres ou mais).');
/** Valor em reais com centavos (até R$ 99.999.999,99); arredondado ao centavo. */
const dinheiro = z.coerce
  .number()
  .min(0.01, 'Informe um valor maior que zero.')
  .max(99_999_999.99)
  .transform((v) => Math.round(v * 100) / 100);

/** Competência mensal `AAAA-MM`. */
export const esquemaCompetencia = z
  .string()
  .trim()
  .regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'Competência no formato AAAA-MM.')
  .refine((c) => c >= '1900-01', 'Competência anterior a 1900 não é aceita.');

// ── Entradas ────────────────────────────────────────────────────────────────────────────────────────────────────

/** Gerar (ou só ver a prévia) as mensalidades da competência: todos os contratos da operadora ou um. */
export const esquemaGerarMensalidades = z
  .object({
    operadora: id,
    competencia: esquemaCompetencia,
    contrato: id
      .nullable()
      .optional()
      .transform((v) => v ?? null),
  })
  .strict();
export type GerarMensalidadesEntrada = z.infer<typeof esquemaGerarMensalidades>;

/** Coparticipação avulsa: o valor do evento e a regra do produto do beneficiário (percentual ou valor fixo). */
export const esquemaLancarCoparticipacao = z
  .object({
    beneficiario: id,
    competencia: esquemaCompetencia,
    vencimento: data,
    valorEvento: dinheiro,
    descricao: textoMinimo(200, 5, 'Descreva o evento (5 caracteres ou mais).'),
  })
  .strict();
export type LancarCoparticipacaoEntrada = z.infer<typeof esquemaLancarCoparticipacao>;

/** Cobrança avulsa ao contrato (por exemplo, a taxa de uma via da carteirinha), opcionalmente de um beneficiário. */
export const esquemaLancarAvulsa = z
  .object({
    contrato: id,
    beneficiario: id
      .nullable()
      .optional()
      .transform((v) => v ?? null),
    competencia: esquemaCompetencia,
    vencimento: data,
    valor: dinheiro,
    descricao: textoMinimo(200, 5, 'Descreva a cobrança (5 caracteres ou mais).'),
  })
  .strict();
export type LancarAvulsaEntrada = z.infer<typeof esquemaLancarAvulsa>;

export const esquemaBaixarCobranca = z
  .object({
    versao,
    pagoEm: data,
    valorPago: dinheiro,
    /** Baixa sem a multa e os juros (precisa do motivo). */
    dispensarEncargos: z.boolean().default(false),
    motivoDispensa: textoOpcional(200),
  })
  .strict();
export type BaixarCobrancaEntrada = z.infer<typeof esquemaBaixarCobranca>;

export const esquemaMotivoCobranca = z.object({ versao, motivo }).strict();
export type MotivoCobrancaEntrada = z.infer<typeof esquemaMotivoCobranca>;

/** Acordo: as cobranças em aberto do mesmo contrato, em até 12 parcelas mensais a partir do primeiro vencimento. */
export const esquemaAcordo = z
  .object({
    contrato: id,
    cobrancas: z.array(z.object({ id, versao }).strict()).min(1, 'Escolha as cobranças do acordo.').max(60),
    parcelas: z.coerce.number().int().min(1).max(PARAMETROS_COBRANCA.parcelasMaximas),
    primeiroVencimento: data,
    dispensarEncargos: z.boolean().default(false),
    motivoDispensa: textoOpcional(200),
  })
  .strict();
export type AcordoEntrada = z.infer<typeof esquemaAcordo>;

/** Notificação da inadimplência do contrato (marca as cobranças vencidas em aberto). */
export const esquemaNotificacao = z
  .object({
    contrato: id,
    em: data,
    meio: z.enum(CODIGOS_MEIO_NOTIFICACAO),
    /** O código de rastreio da carta, o nome de quem assinou ou o número do edital. */
    referencia: textoMinimo(60, 3, 'Informe a referência da notificação (3 caracteres ou mais).'),
  })
  .strict();
export type NotificacaoEntrada = z.infer<typeof esquemaNotificacao>;

/** Reajuste anual do contrato, aplicado na competência do aniversário. */
export const esquemaReajuste = z
  .object({
    contrato: id,
    competencia: esquemaCompetencia,
    /** Percentual (ex.: 6,91); negativo é redução. */
    percentual: z.coerce
      .number()
      .gt(-100)
      .max(100)
      .transform((v) => Math.round(v * 10_000) / 10_000),
    /** No individual ou familiar: o percentual máximo autorizado pela ANS no ciclo. */
    tetoAns: z.coerce
      .number()
      .gt(-100)
      .max(100)
      .nullable()
      .optional()
      .transform((v) => (v === null || v === undefined ? null : Math.round(v * 10_000) / 10_000)),
    /** O número do ofício ou da resolução da ANS (individual ou familiar). */
    oficioAns: textoOpcional(40),
    motivo: textoMinimo(200, 5, 'Descreva o reajuste (5 caracteres ou mais).'),
  })
  .strict();
export type ReajusteEntrada = z.infer<typeof esquemaReajuste>;

export const esquemaCancelarReajuste = z.object({ motivo }).strict();

export const esquemaFiltroCobrancas = z.object({
  operadora: id.optional(),
  competencia: esquemaCompetencia.optional(),
  situacao: z.enum(CODIGOS_SITUACAO_COBRANCA).optional(),
  tipo: z.coerce.number().int().min(1).max(4).optional(),
  contrato: id.optional(),
  /** Só as vencidas em aberto. */
  vencidas: z
    .enum(['1', 'true', '0', 'false'])
    .optional()
    .transform((v) => v === '1' || v === 'true'),
  /** Número do contrato (início). */
  busca: z.string().trim().min(1).max(20).optional(),
  apos: id.optional(),
});
export type FiltroCobrancas = z.infer<typeof esquemaFiltroCobrancas>;

export const esquemaFiltroInadimplencia = z.object({ operadora: id.optional(), apos: id.optional() });
export const esquemaFiltroReajustes = z.object({
  operadora: id.optional(),
  contrato: id.optional(),
  apos: id.optional(),
});

// ── Respostas ───────────────────────────────────────────────────────────────────────────────────────────────────

const esquemaEncargos = z.object({ multa: z.number(), juros: z.number(), total: z.number() });
export type EncargosCobranca = z.infer<typeof esquemaEncargos>;

export const esquemaTelaCobranca = z.object({
  liberacao: z.object({ ligada: z.boolean(), motivo: z.string().nullable() }),
  acoes: z.object({ gerar: z.boolean(), motivo: z.string().nullable() }),
  operadoras: z.array(z.object({ id: z.number().int(), razaoSocial: z.string(), registroAns: z.string() })),
  /** Hoje no relógio do banco (AAAA-MM-DD). */
  hoje: z.string(),
  /** A mensagem ao beneficiário pela Hal-AI (regra 6): sai? Senão, o motivo. */
  mensagens: z.object({ enviar: z.boolean(), motivo: z.string().nullable() }),
  parametros: z.object({
    multaPercentual: z.number(),
    jurosPercentualMes: z.number(),
    diasLimiteNotificacao: z.number().int(),
    diasInadimplencia: z.number().int(),
    diasPrazoNotificacao: z.number().int(),
    parcelasMaximas: z.number().int(),
  }),
});
export type TelaCobranca = z.infer<typeof esquemaTelaCobranca>;

export const esquemaCobrancaResumo = z.object({
  id: z.number().int(),
  operadora: z.number().int(),
  contrato: z.number().int(),
  contratoNumero: z.string(),
  /** 1 pessoa física, 2 pessoa jurídica. */
  tipoContrato: z.number().int(),
  /** O titular (pessoa física) ou o contratante (jurídica). */
  pagadorNome: z.string(),
  /** Mascarado (CPF do titular ou do contratante; o CNPJ por inteiro). */
  pagadorDocumento: z.string(),
  tipo: z.number().int(),
  competencia: z.string(),
  descricao: z.string(),
  valor: z.number(),
  vencimento: z.string(),
  situacao: z.enum(CODIGOS_SITUACAO_COBRANCA),
  situacaoEm: z.string(),
  /** Em aberto e vencida (hoje no relógio do banco). */
  vencida: z.boolean(),
  diasAtraso: z.number().int(),
  /** Multa e juros se pagar hoje (zero sem atraso). */
  encargosHoje: esquemaEncargos,
  acordoOrigem: z.number().int().nullable(),
  parcela: z.number().int().nullable(),
  parcelas: z.number().int().nullable(),
  notificadoEm: z.string().nullable(),
  versao: z.number().int(),
});
export type CobrancaResumo = z.infer<typeof esquemaCobrancaResumo>;

export const esquemaCobrancas = z.object({
  itens: z.array(esquemaCobrancaResumo),
  proxima: z.number().int().nullable(),
  totais: z.object({
    abertas: z.number().int(),
    valorAberto: z.number(),
    vencidas: z.number().int(),
    valorVencido: z.number(),
    pagasNoMes: z.number().int(),
    valorPagoNoMes: z.number(),
  }),
});
export type Cobrancas = z.infer<typeof esquemaCobrancas>;

export const esquemaItemCobranca = z.object({
  beneficiario: z.number().int().nullable(),
  beneficiarioNome: z.string().nullable(),
  descricao: z.string(),
  /** Faixa etária da RN 63 (0 a 9) e a idade usada (só na mensalidade). */
  faixa: z.number().int().nullable(),
  idade: z.number().int().nullable(),
  /** Preço da tabela na mensalidade; valor do evento na coparticipação. */
  valorBase: z.number().nullable(),
  valor: z.number(),
});
export type ItemCobranca = z.infer<typeof esquemaItemCobranca>;

export const esquemaCobrancaDetalhe = esquemaCobrancaResumo.extend({
  itens: z.array(esquemaItemCobranca),
  pagoEm: z.string().nullable(),
  valorPago: z.number().nullable(),
  multa: z.number().nullable(),
  juros: z.number().nullable(),
  dispensaMotivo: z.string().nullable(),
  motivo: z.string().nullable(),
  acordoDestino: z.number().int().nullable(),
  notificacaoMeio: z.enum(CODIGOS_MEIO_NOTIFICACAO).nullable(),
  notificacaoReferencia: z.string().nullable(),
  /** Na parcela de acordo: as cobranças que o acordo renegociou. */
  renegociadas: z.array(
    z.object({
      id: z.number().int(),
      tipo: z.number().int(),
      competencia: z.string(),
      valor: z.number(),
      vencimento: z.string(),
    }),
  ),
  criadoEm: z.string(),
  criadoPor: z.string(),
  alteradoEm: z.string(),
  alteradoPor: z.string(),
});
export type CobrancaDetalhe = z.infer<typeof esquemaCobrancaDetalhe>;

export const esquemaPreviaMensalidades = z.object({
  competencia: z.string(),
  /** Até 100 cobranças para a conferência (a quantidade e o total são de todas). */
  cobrancas: z.array(
    z.object({
      contrato: z.number().int(),
      contratoNumero: z.string(),
      pagadorNome: z.string(),
      vencimento: z.string(),
      valor: z.number(),
      itens: z.array(
        z.object({
          beneficiario: z.number().int(),
          nome: z.string(),
          faixa: z.number().int(),
          idade: z.number().int(),
          valorTabela: z.number(),
          valor: z.number(),
        }),
      ),
    }),
  ),
  quantidade: z.number().int(),
  valorTotal: z.number(),
  /** Contratos que ficam de fora, com o código do motivo (texto em MENSAGENS_COBRANCA). */
  ignorados: z.array(
    z.object({ contrato: z.number().int(), contratoNumero: z.string(), motivo: z.string() }),
  ),
  jaGeradas: z.number().int(),
});
export type PreviaMensalidades = z.infer<typeof esquemaPreviaMensalidades>;

export const esquemaResultadoGeracao = z.object({
  ok: z.literal(true),
  competencia: z.string(),
  geradas: z.number().int(),
  valorTotal: z.number(),
  jaGeradas: z.number().int(),
  ignorados: z.number().int(),
  mensagem: z.string(),
});
export type ResultadoGeracao = z.infer<typeof esquemaResultadoGeracao>;

export const esquemaResultadoCobranca = z.object({
  ok: z.literal(true),
  id: z.number().int(),
  versao: z.number().int(),
  mensagem: z.string(),
  avisos: z.array(z.string()),
});
export type ResultadoCobranca = z.infer<typeof esquemaResultadoCobranca>;

export const esquemaPreviaAcordo = z.object({
  contrato: z.number().int(),
  data: z.string(),
  principal: z.number(),
  encargos: z.number(),
  total: z.number(),
  cobrancas: z.array(
    z.object({
      id: z.number().int(),
      valor: z.number(),
      encargos: esquemaEncargos,
      diasAtraso: z.number().int(),
    }),
  ),
  parcelas: z.array(z.object({ numero: z.number().int(), vencimento: z.string(), valor: z.number() })),
});
export type PreviaAcordo = z.infer<typeof esquemaPreviaAcordo>;

export const esquemaResultadoAcordo = z.object({
  ok: z.literal(true),
  acordo: z.number().int(),
  parcelas: z.array(z.number().int()),
  total: z.number(),
  mensagem: z.string(),
});
export type ResultadoAcordo = z.infer<typeof esquemaResultadoAcordo>;

export const esquemaInadimplente = z.object({
  contrato: z.number().int(),
  contratoNumero: z.string(),
  tipoContratacao: z.number().int(),
  pagadorNome: z.string(),
  pagadorDocumento: z.string(),
  vencidas: z.number().int(),
  valorVencido: z.number(),
  vencimentoMaisAntigo: z.string(),
  diasAtrasoAtual: z.number().int(),
  diasAcumulados12m: z.number().int(),
  mensalidadesEmAtraso12m: z.number().int(),
  situacao: z.enum(
    Object.keys(SITUACOES_INADIMPLENCIA) as [SituacaoInadimplencia, ...SituacaoInadimplencia[]],
  ),
  notificadoEm: z.string().nullable(),
  notificacaoMeio: z.enum(CODIGOS_MEIO_NOTIFICACAO).nullable(),
  /** Até quando notificar (o dia em que o atraso chega ao 50º dia). */
  prazoNotificacao: z.string().nullable(),
  /** Até quando o notificado pode pagar (10 dias depois da notificação). */
  prazoPagamento: z.string().nullable(),
});
export type Inadimplente = z.infer<typeof esquemaInadimplente>;

export const esquemaInadimplencia = z.object({
  itens: z.array(esquemaInadimplente),
  proxima: z.number().int().nullable(),
});
export type InadimplenciaOperadora = z.infer<typeof esquemaInadimplencia>;

export const esquemaReajusteLido = z.object({
  id: z.number().int(),
  contrato: z.number().int(),
  contratoNumero: z.string(),
  tipoContratacao: z.number().int(),
  competencia: z.string(),
  percentual: z.number(),
  tetoAns: z.number().nullable(),
  oficioAns: z.string().nullable(),
  vidas: z.number().int(),
  motivo: z.string(),
  situacao: z.enum(['vigente', 'cancelado']),
  canceladoMotivo: z.string().nullable(),
  registradoEm: z.string(),
  registradoPor: z.string(),
});
export type ReajusteLido = z.infer<typeof esquemaReajusteLido>;
export const esquemaReajustes = z.object({
  itens: z.array(esquemaReajusteLido),
  proxima: z.number().int().nullable(),
});
export type ReajustesOperadora = z.infer<typeof esquemaReajustes>;

/** Rotas e permissões da fatia F2 (a chave `operadora.cobranca`, que só vale com a do módulo, em todas menos a tela). */
export const ROTAS_OPERADORA_F2 = {
  tela: { caminho: 'operadora/cobranca/tela', permissao: 'operadora.cobranca.ler' },
  cobrancas: { caminho: 'operadora/cobrancas', permissao: 'operadora.cobranca.ler' },
  cobranca: { caminho: 'operadora/cobrancas/:id', permissao: 'operadora.cobranca.ler' },
  previaMensalidades: {
    caminho: 'operadora/cobrancas/mensalidades/previa',
    permissao: 'operadora.cobranca.gerar',
  },
  gerarMensalidades: { caminho: 'operadora/cobrancas/mensalidades', permissao: 'operadora.cobranca.gerar' },
  coparticipacao: { caminho: 'operadora/cobrancas/coparticipacao', permissao: 'operadora.cobranca.gerar' },
  avulsa: { caminho: 'operadora/cobrancas/avulsa', permissao: 'operadora.cobranca.gerar' },
  baixar: { caminho: 'operadora/cobrancas/:id/baixa', permissao: 'operadora.cobranca.gerar' },
  cancelar: { caminho: 'operadora/cobrancas/:id/cancelamento', permissao: 'operadora.cobranca.gerar' },
  estornar: { caminho: 'operadora/cobrancas/:id/estorno', permissao: 'operadora.cobranca.gerar' },
  previaAcordo: { caminho: 'operadora/cobrancas/acordo/previa', permissao: 'operadora.cobranca.gerar' },
  acordo: { caminho: 'operadora/cobrancas/acordo', permissao: 'operadora.cobranca.gerar' },
  inadimplencia: { caminho: 'operadora/cobranca/inadimplencia', permissao: 'operadora.cobranca.ler' },
  notificar: {
    caminho: 'operadora/cobranca/inadimplencia/notificacao',
    permissao: 'operadora.cobranca.gerar',
  },
  reajustes: { caminho: 'operadora/reajustes', permissao: 'operadora.cobranca.ler' },
  reajustar: { caminho: 'operadora/reajustes', permissao: 'operadora.cobranca.gerar' },
  cancelarReajuste: {
    caminho: 'operadora/reajustes/:id/cancelamento',
    permissao: 'operadora.cobranca.gerar',
  },
} as const;

/** Chave de liberação da fatia (CHAVES_FATIA_OPERADORA, recurso `cobranca`). */
export const CHAVE_OPERADORA_COBRANCA = 'operadora.cobranca' as const;
/** Chave das mensagens ao beneficiário (com a base legal da DP-44 a como pré-requisito). */
export const CHAVE_OPERADORA_MENSAGENS = 'operadora.mensagens' as const;

/** Textos das recusas e dos avisos da cobrança (códigos das regras de @sgh/dominio-operadora e das gravações). */
export const MENSAGENS_COBRANCA: Readonly<Record<string, string>> = {
  'competencia-invalida': 'A competência vai no formato AAAA-MM.',
  'contrato-inativo': 'O contrato não está ativo na competência.',
  'contrato-fora-da-vigencia': 'A competência fica fora da vigência do contrato.',
  'contrato-sem-dia-vencimento':
    'O contrato não tem dia de vencimento: informe-o no contrato antes de gerar.',
  'produto-sem-precos': 'O produto do contrato não tem a tabela de preços por faixa etária.',
  'sem-beneficiarios': 'O contrato não tem beneficiário a cobrar na competência.',
  'ja-gerada': 'A mensalidade desta competência já foi gerada para o contrato.',
  'mensalidade-ja-gerada':
    'A mensalidade desta competência já foi gerada para o contrato (outra pessoa gerou agora).',
  'vencimento-antes-da-competencia': 'O vencimento não pode ser antes do mês anterior à competência.',
  'beneficiario-inexistente': 'O beneficiário não existe nesta operadora.',
  'beneficiario-de-outro-contrato': 'O beneficiário não é deste contrato.',
  'beneficiario-excluido': 'O beneficiário está excluído desde antes da competência.',
  'produto-sem-coparticipacao': 'O produto do beneficiário não tem coparticipação.',
  'coparticipacao-zero': 'A coparticipação deste evento dá zero.',
  'nao-aberta': 'Só a cobrança em aberto aceita esta ação.',
  'nao-paga': 'Só a cobrança paga pode ter a baixa estornada.',
  'pagamento-futuro': 'A data do pagamento não pode ser depois de hoje.',
  'pagamento-antes-da-emissao': 'A data do pagamento não pode ser antes da emissão da cobrança.',
  'valor-divergente':
    'O valor pago não confere com o devido na data (o valor com a multa e os juros). Pagamento parcial vira acordo.',
  'dispensa-sem-motivo': 'Informe o motivo da dispensa da multa e dos juros.',
  'acordo-de-outro-contrato': 'Todas as cobranças do acordo têm de ser do mesmo contrato.',
  'acordo-cobranca-nao-aberta': 'Só cobranças em aberto entram no acordo.',
  'acordo-cobranca-repetida': 'A mesma cobrança aparece duas vezes no acordo.',
  'acordo-vencimento-passado': 'O primeiro vencimento do acordo é de hoje em diante.',
  'acordo-parcela-zero':
    'O valor não divide no número de parcelas (cada parcela precisa de ao menos R$ 0,01).',
  'cobranca-inexistente': 'A cobrança não existe nesta operadora.',
  'cobranca-desatualizada':
    'A cobrança mudou depois que você abriu (outra pessoa gravou). Abra de novo e confira antes de gravar.',
  'notificacao-sem-atraso': 'O contrato não tem cobrança vencida em aberto para notificar.',
  'notificacao-futura': 'A data da notificação não pode ser depois de hoje.',
  'notificacao-antes-do-vencimento':
    'A notificação é depois do vencimento da cobrança mais antiga em aberto.',
  'reajuste-fora-do-aniversario':
    'O reajuste anual vale no mês de aniversário do contrato (o mês do reajuste).',
  'reajuste-antes-de-12-meses': 'O primeiro reajuste só vale 12 meses depois do início do contrato.',
  'reajuste-intervalo-menor': 'Já houve reajuste neste contrato há menos de 12 meses.',
  'reajuste-percentual-zero': 'Informe um percentual diferente de zero.',
  'reajuste-sem-teto-ans':
    'Plano individual ou familiar: informe o percentual máximo autorizado pela ANS e o número do ofício.',
  'reajuste-acima-do-teto':
    'O percentual passa do máximo autorizado pela ANS para o plano individual ou familiar.',
  'reajuste-teto-so-individual': 'O teto da ANS só vale para o plano individual ou familiar.',
  'reajuste-competencia-cobrada':
    'A mensalidade desta competência (ou de uma posterior) já foi gerada: cancele-a antes de reajustar.',
  'reajuste-ja-registrado': 'Já existe reajuste vigente nesta competência do contrato.',
  'reajuste-cancelado': 'O reajuste já está cancelado.',
  'reajuste-ja-cobrado':
    'A mensalidade com este reajuste já foi gerada: cancele-a antes de cancelar o reajuste.',
  'reajuste-mudou':
    'Os reajustes do contrato mudaram durante a geração (outra pessoa registrou ou cancelou). Gere de novo.',
  'reajuste-agrupamento':
    'Contrato coletivo com menos de 30 vidas: o percentual tem de ser o do agrupamento dos contratos pequenos da operadora.',
  'contrato-inexistente': 'O contrato não existe nesta operadora.',
  'contrato-encerrado': 'O contrato está encerrado.',
};
