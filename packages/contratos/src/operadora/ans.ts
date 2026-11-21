// Contratos das obrigações da operadora própria com a ANS (M56, etapa 7 de 8, fatia F6; ficha, seções 1, 4, 6, 7 e 8,
// regra 7; cap-07 §7.4). A operadora gera, na competência de cada obrigação, o arquivo a partir dos dados das fatias
// anteriores e guarda o arquivo, o SHA-256 e o recibo em SGH_OPE_ENVIO_ANS (scripts 0952 e 0953):
//   - SIB (mensal): os movimentos do cadastro de beneficiários (inclusão, retificação, mudança contratual, cancelamento e
//     reativação), derivados do cadastro atual contra o último aceito pela ANS (SGH_OPE_BENEF_SIB); o retorno da ANS
//     dá o código de controle operacional (CCO) de cada beneficiário;
//   - SIP (trimestral): eventos e despesas assistenciais por grupo do SIP, pela
//     segmentação e pela UF, com os beneficiários expostos, a partir das contas médicas recebidas (F5);
//   - DIOPS (trimestral): as contraprestações emitidas e recebidas (F2), os eventos avisados, glosados e pagos (F5), os
//     beneficiários e o balancete informado pela contabilidade da operadora, com o ativo igual ao passivo mais o
//     patrimônio líquido;
//   - TPS (trimestral): a taxa de saúde suplementar pela média de beneficiários de cada plano no trimestre e o valor
//     trimestral vigente, com o desconto de cada plano, e a GRU do recolhimento;
//   - monitoramento TISS (mensal): as guias das contas médicas analisadas na competência, com os valores informados,
//     glosados e pagos;
//   - ressarcimento ao SUS (sob demanda): o aviso de beneficiário identificado (ABI) com os atendimentos no SUS, a
//     análise de cada um (a sugestão de impugnação pela elegibilidade e pela cobertura na data), a decisão, o dossiê da
//     impugnação, o resultado e a GRU do pagamento.
// Nada vai à ANS fora de `producao` (o simulador responde, sem recibo); o envio real pede o recibo que a ANS devolveu.
// Os leiautes são os do Sante na versão `LEIAUTE_ANS`: o envio real fica desligado até a conferência no validador
// oficial da ANS, pré-requisito da chave `operadora.ans` (POL-3; D-LEIAUTE-ANS-567). Nenhuma escrita em tabela legada
// (seção 5): os domínios (motivos e campos do SIB, valores da TPS, grupos do SIP) são só lidos.
import { z } from 'zod';
import { textoCp1252 } from '../texto-cp1252.js';
import { CODIGOS_OBRIGACAO_ANS, type ObrigacaoAns } from './vocabulario.js';

// ── Vocabulário ─────────────────────────────────────────────────────────────────────────────────

/** Versão dos leiautes gerados (vai no cabeçalho de cada arquivo; muda quando a conferência oficial pedir). */
export const LEIAUTE_ANS = 'sante-1.0' as const;

/** Situação do envio. */
export const SITUACOES_ENVIO_ANS = {
  gerado: 'Gerado (não enviado)',
  enviado: 'Enviado, aguardando o retorno',
  aceito: 'Aceito',
  aceitoParcial: 'Aceito em parte',
  rejeitado: 'Rejeitado',
  substituido: 'Substituído por outro arquivo',
} as const;
export type SituacaoEnvioAns = keyof typeof SITUACOES_ENVIO_ANS;
export const CODIGOS_SITUACAO_ENVIO_ANS = Object.keys(SITUACOES_ENVIO_ANS) as SituacaoEnvioAns[];

/** Movimento do SIB (o código vai no arquivo). */
export const MOVIMENTOS_SIB = {
  inclusao: { codigo: 1, rotulo: 'Inclusão' },
  retificacao: { codigo: 2, rotulo: 'Retificação' },
  mudancaContratual: { codigo: 3, rotulo: 'Mudança contratual' },
  cancelamento: { codigo: 4, rotulo: 'Cancelamento' },
  reativacao: { codigo: 5, rotulo: 'Reativação' },
} as const;
export type MovimentoSib = keyof typeof MOVIMENTOS_SIB;
export const CODIGOS_MOVIMENTO_SIB = Object.keys(MOVIMENTOS_SIB) as MovimentoSib[];

/**
 * Motivos de movimentação cadastral (12 linhas, conferidas na cópia em 26/10/2026). O grupo é o
 * movimento cadastral: 1 inclusão, 2 alteração, 3 cancelamento, 4 reativação.
 */
export const MOTIVOS_CANCELAMENTO_SIB = [5, 6, 7, 8, 9, 10] as const;
export const MOTIVO_INCLUSAO_SIB = 1;
export const MOTIVO_MUDANCA_SIB = 4;
export const MOTIVO_RETIFICACAO_SIB = 3;
export const MOTIVO_REATIVACAO_SIB = 11;
export const GRUPO_MOTIVO_SIB: Readonly<Record<MovimentoSib, number>> = {
  inclusao: 1,
  retificacao: 2,
  mudancaContratual: 2,
  cancelamento: 3,
  reativacao: 4,
};

/**
 * Campos do beneficiário que a retificação do SIB declara (19 linhas, conferidas na cópia em
 * 26/10/2026; o código é o ID da tabela).
 */
export const CAMPOS_SIB = {
  matricula: 1,
  nome: 2,
  nascimento: 3,
  sexo: 4,
  cpf: 5,
  nomeMae: 6,
  dnv: 7,
  cns: 8,
  titular: 9,
  logradouro: 10,
  numero: 11,
  complemento: 12,
  bairro: 13,
  municipio: 14,
  cep: 15,
  resideExterior: 16,
  adesao: 17,
  vinculo: 18,
  caepf: 19,
} as const;
export type CampoSib = keyof typeof CAMPOS_SIB;
export const ROTULOS_CAMPO_SIB: Readonly<Record<CampoSib, string>> = {
  matricula: 'Carteirinha',
  nome: 'Nome',
  nascimento: 'Data de nascimento',
  sexo: 'Sexo',
  cpf: 'CPF',
  nomeMae: 'Nome da mãe',
  dnv: 'Declaração de nascido vivo',
  cns: 'Cartão Nacional de Saúde',
  titular: 'Titular',
  logradouro: 'Logradouro',
  numero: 'Número',
  complemento: 'Complemento',
  bairro: 'Bairro',
  municipio: 'Município',
  cep: 'CEP',
  resideExterior: 'Reside no exterior',
  adesao: 'Data de adesão',
  vinculo: 'Relação de dependência',
  caepf: 'CAEPF do contratante',
};

/** Tipo do atendimento no SUS do aviso de ressarcimento: internação (AIH) ou procedimento de alta complexidade (APAC). */
export const TIPOS_ATENDIMENTO_SUS = { AIH: 'Internação (AIH)', APAC: 'Alta complexidade (APAC)' } as const;
export type TipoAtendimentoSus = keyof typeof TIPOS_ATENDIMENTO_SUS;

/** Motivos de impugnação do atendimento no SUS (técnicos e administrativos). */
export const MOTIVOS_IMPUGNACAO_SUS = {
  naoBeneficiario: 'Não é beneficiário da operadora na data do atendimento',
  foraDaVigencia: 'Contrato fora da vigência ou beneficiário excluído na data',
  carencia: 'Carência não cumprida na data do atendimento',
  cpt: 'Cobertura parcial temporária de doença preexistente',
  segmentacao: 'Segmentação do plano sem cobertura para o atendimento',
  abrangencia: 'Atendimento fora da área de abrangência do plano',
  cartaoDesconto: 'Produto é cartão de desconto, não plano de saúde',
  duplicidade: 'Atendimento já cobrado em outro aviso',
  outro: 'Outro motivo (descrito na justificativa)',
} as const;
export type MotivoImpugnacaoSus = keyof typeof MOTIVOS_IMPUGNACAO_SUS;
export const CODIGOS_MOTIVO_IMPUGNACAO_SUS = Object.keys(MOTIVOS_IMPUGNACAO_SUS) as MotivoImpugnacaoSus[];

/** Decisão da operadora sobre cada atendimento do aviso. */
export const DECISOES_RESSARCIMENTO = {
  pendente: 'Pendente',
  impugnar: 'Impugnar',
  aceitar: 'Aceitar (ressarcir)',
} as const;
export type DecisaoRessarcimento = keyof typeof DECISOES_RESSARCIMENTO;

/** Resultado de cada item no retorno da ANS. */
export const RESULTADOS_ITEM_ANS = {
  enviado: 'Enviado',
  aceito: 'Aceito',
  rejeitado: 'Rejeitado',
} as const;
export type ResultadoItemAns = keyof typeof RESULTADOS_ITEM_ANS;

/** Obrigações que têm GRU de recolhimento (a TPS e o ressarcimento ao SUS). */
export const OBRIGACOES_COM_GRU: readonly ObrigacaoAns[] = ['TPS', 'RESSARCIMENTO_SUS'];

/** Parâmetros da fatia (o responsável pelos envios confirma; D-PRAZO-RESSARC-567, D-TPS-567). */
export const PARAMETROS_ANS = {
  /** Prazo da impugnação do aviso de ressarcimento, em dias corridos do recebimento. */
  diasImpugnacaoRessarcimento: 30,
  /** Teto de beneficiários por arquivo SIB (o restante sai no arquivo seguinte da mesma competência). */
  maximoMovimentosSib: 5000,
  /** Teto de atendimentos por aviso de ressarcimento registrado. */
  maximoItensRessarcimento: 500,
  /** Teto de guias por arquivo do monitoramento TISS. */
  maximoGuiasMonitoramento: 10000,
  /** Tamanho máximo do arquivo gerado (bytes). */
  maximoBytesArquivo: 8_000_000,
} as const;

// ── Entradas ────────────────────────────────────────────────────────────────────────────────────

const texto = (max: number, min: number, msg: string) =>
  textoCp1252(max)
    .overwrite((t) => t.replace(/\s+/g, ' ').trim())
    .pipe(z.string().min(min, msg));
const textoOpcional = (max: number) =>
  textoCp1252(max)
    .overwrite((t) => t.replace(/\s+/g, ' ').trim())
    .nullable()
    .transform((t) => (t ? t : null));
const dataIso = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Data no formato AAAA-MM-DD.');
const id = z.number().int().min(1);
const comVersao = { versao: z.number().int().min(1) };
/** Dinheiro com duas casas (reais), até R$ 9.999.999.999,99 (o balancete da operadora). */
const dinheiro = z
  .number()
  .min(0)
  .max(9_999_999_999.99)
  .refine((v) => Math.abs(Math.round(v * 100) - v * 100) < 1e-6, 'Use no máximo duas casas decimais.');
const obrigacao = z.enum(CODIGOS_OBRIGACAO_ANS as [ObrigacaoAns, ...ObrigacaoAns[]]);
/** Competência: `AAAA-MM`, `AAAA-Tn` ou `AAAA-MM-DD` conforme a periodicidade (a regra pura confere). */
const competencia = z.string().regex(/^\d{4}-(\d{2}|T[1-4]|\d{2}-\d{2})$/, 'Competência inválida.');

/** O balancete do fim do trimestre, informado pela contabilidade da operadora (DIOPS). */
export const esquemaBalanceteDiops = z
  .object({
    ativo: dinheiro,
    passivo: dinheiro,
    patrimonioLiquido: z.number().min(-9_999_999_999.99).max(9_999_999_999.99),
    provisoesTecnicas: dinheiro,
    /** Quem responde pelo balancete (contador da operadora, com o registro no conselho). */
    responsavel: texto(120, 3, 'Informe o contador responsável pelo balancete.'),
  })
  .strict();
export type BalanceteDiops = z.infer<typeof esquemaBalanceteDiops>;

/** O desconto da TPS de um plano (percentual de 0 a 100, com o motivo). */
export const esquemaDescontoTps = z
  .object({
    produto: id,
    percentual: z.number().min(0).max(100),
    motivo: texto(200, 3, 'Informe o motivo do desconto.'),
  })
  .strict();
export type DescontoTps = z.infer<typeof esquemaDescontoTps>;

export const esquemaGerarEnvioAns = z
  .object({
    operadora: id,
    obrigacao: obrigacao.exclude(['RESSARCIMENTO_SUS']),
    competencia,
    balancete: esquemaBalanceteDiops.optional(),
    descontos: z.array(esquemaDescontoTps).max(200).optional(),
  })
  .strict();
export type GerarEnvioAnsEntrada = z.infer<typeof esquemaGerarEnvioAns>;

/** Prévia: o que o arquivo traria, com as pendências, sem gravar. */
export const esquemaPreviaEnvioAns = esquemaGerarEnvioAns;
export type PreviaEnvioAnsEntrada = GerarEnvioAnsEntrada;

/** Envio: no simulador, sem recibo; na ANS (produção), o recibo ou protocolo devolvido pelo sistema da ANS. */
export const esquemaTransmitirEnvioAns = z
  .object({
    ...comVersao,
    recibo: textoOpcional(40).optional(),
  })
  .strict();
export type TransmitirEnvioAnsEntrada = z.infer<typeof esquemaTransmitirEnvioAns>;

export const esquemaItemRetornoAns = z
  .object({
    ordem: z.number().int().min(1),
    aceito: z.boolean(),
    /** CCO dado pela ANS ao beneficiário (SIB, aceito). */
    cco: z
      .string()
      .regex(/^\d{12}$/, 'O CCO tem 12 dígitos.')
      .optional(),
    erro: textoOpcional(300).optional(),
  })
  .strict();
export type ItemRetornoAns = z.infer<typeof esquemaItemRetornoAns>;

/**
 * Retorno da ANS: no simulador, `simular: true` aceita todos (com CCO sintético no SIB); na ANS, o resultado de cada item
 * (o que não vier fica aceito quando `rejeitado` é falso) e o resumo devolvido.
 */
export const esquemaRegistrarRetornoAns = z
  .object({
    ...comVersao,
    simular: z.boolean().optional(),
    rejeitado: z.boolean().optional(),
    resumo: textoOpcional(500).optional(),
    itens: z.array(esquemaItemRetornoAns).max(PARAMETROS_ANS.maximoMovimentosSib).optional(),
  })
  .strict();
export type RegistrarRetornoAnsEntrada = z.infer<typeof esquemaRegistrarRetornoAns>;

export const esquemaPagamentoGru = z
  .object({
    ...comVersao,
    gru: z.string().regex(/^\d{10,30}$/, 'Informe o número da GRU (só dígitos).'),
    valor: dinheiro.refine((v) => v > 0, 'Informe o valor pago.'),
    data: dataIso,
  })
  .strict();
export type PagamentoGruEntrada = z.infer<typeof esquemaPagamentoGru>;

/** Complemento do beneficiário para o SIB (endereço, CCO, DNV, cobertura e motivo do cancelamento). */
export const esquemaComplementoSib = z
  .object({
    versao: z.number().int().min(0),
    logradouro: textoOpcional(60),
    numero: textoOpcional(10),
    complemento: textoOpcional(30),
    bairro: textoOpcional(40),
    municipio: z.number().int().min(1_000_000).max(5_399_999).nullable(),
    cep: z
      .string()
      .regex(/^\d{8}$/, 'O CEP tem 8 dígitos.')
      .nullable(),
    resideExterior: z.boolean(),
    dnv: z
      .string()
      .regex(/^\d{11}$/, 'A declaração de nascido vivo tem 11 dígitos.')
      .nullable(),
    coberturaParcial: z.boolean(),
    itensExcluidos: z.boolean(),
    cco: z
      .string()
      .regex(/^\d{12}$/, 'O CCO tem 12 dígitos.')
      .nullable(),
    motivoCancelamento: z
      .number()
      .int()
      .refine(
        (m) => (MOTIVOS_CANCELAMENTO_SIB as readonly number[]).includes(m),
        'Motivo de cancelamento inválido.',
      )
      .nullable(),
  })
  .strict();
export type ComplementoSibEntrada = z.infer<typeof esquemaComplementoSib>;

export const esquemaAtendimentoSus = z
  .object({
    tipo: z.enum(['AIH', 'APAC']),
    numero: z.string().regex(/^\d{13}$/, 'O número da AIH ou da APAC tem 13 dígitos.'),
    /** Carteirinha do beneficiário (16 dígitos) ou o CNS (15 dígitos) que a ANS identificou. */
    identificacao: z.string().regex(/^(\d{15}|\d{16})$/, 'Informe a carteirinha (16 dígitos) ou o CNS (15).'),
    inicio: dataIso,
    fim: dataIso,
    /** Procedimento principal na tabela do SUS (10 dígitos). */
    procedimento: z.string().regex(/^\d{10}$/, 'O procedimento do SUS tem 10 dígitos.'),
    valor: dinheiro.refine((v) => v > 0, 'Informe o valor cobrado.'),
  })
  .strict();
export type AtendimentoSusEntrada = z.infer<typeof esquemaAtendimentoSus>;

export const esquemaRegistrarAvisoRessarcimento = z
  .object({
    operadora: id,
    /** Número do aviso de beneficiário identificado (ABI). */
    aviso: z.string().regex(/^\d{1,20}$/, 'Informe o número do aviso (só dígitos).'),
    /** Data em que a operadora recebeu a notificação (a competência do envio). */
    recebidoEm: dataIso,
    atendimentos: z
      .array(esquemaAtendimentoSus)
      .min(1, 'Informe ao menos um atendimento.')
      .max(PARAMETROS_ANS.maximoItensRessarcimento),
  })
  .strict();
export type RegistrarAvisoRessarcimentoEntrada = z.infer<typeof esquemaRegistrarAvisoRessarcimento>;

export const esquemaDecidirItemRessarcimento = z
  .object({
    ...comVersao,
    decisao: z.enum(['impugnar', 'aceitar']),
    motivo: z
      .enum(CODIGOS_MOTIVO_IMPUGNACAO_SUS as [MotivoImpugnacaoSus, ...MotivoImpugnacaoSus[]])
      .nullable(),
    justificativa: textoOpcional(1000),
  })
  .strict();
export type DecidirItemRessarcimentoEntrada = z.infer<typeof esquemaDecidirItemRessarcimento>;

export const esquemaFiltroEnviosAns = z.object({
  operadora: z.coerce.number().int().min(1).optional(),
  obrigacao: obrigacao.optional(),
  /** Competência exata ou o ano (AAAA). */
  competencia: z
    .string()
    .regex(/^\d{4}(-(\d{2}|T[1-4]|\d{2}-\d{2}))?$/)
    .optional(),
  situacao: z.enum(CODIGOS_SITUACAO_ENVIO_ANS as [SituacaoEnvioAns, ...SituacaoEnvioAns[]]).optional(),
  apos: z.coerce.number().int().min(1).optional(),
});
export type FiltroEnviosAns = z.infer<typeof esquemaFiltroEnviosAns>;

export const esquemaFiltroPendenciasSib = z.object({
  operadora: z.coerce.number().int().min(1),
  apos: z.coerce.number().int().min(1).optional(),
});
export type FiltroPendenciasSib = z.infer<typeof esquemaFiltroPendenciasSib>;

// ── Respostas ───────────────────────────────────────────────────────────────────────────────────

export interface ProblemaAns {
  readonly codigo: string;
  /** O que o problema impede (o arquivo inteiro ou só o item). */
  readonly alcance: 'arquivo' | 'item';
  /** Item (beneficiário, plano, guia) a que se refere, quando é do item. */
  readonly referencia: string | null;
  readonly mensagem: string;
}

/** Uma parcela de conta agregada, impressa na tela e no arquivo (toda soma vem com as parcelas). */
export interface ParcelaAns {
  readonly rotulo: string;
  readonly valor: number;
  /** Quantidade (beneficiários, eventos, guias), quando houver. */
  readonly quantidade?: number | undefined;
}

export interface QuadroAns {
  readonly titulo: string;
  readonly parcelas: readonly ParcelaAns[];
  readonly total: ParcelaAns;
}

export interface PreviaEnvioAns {
  readonly obrigacao: ObrigacaoAns;
  readonly competencia: string;
  readonly destino: 'simulador' | 'ans';
  /** Registros que o arquivo traria (movimentos, grupos, planos, guias). */
  readonly registros: number;
  readonly quadros: readonly QuadroAns[];
  readonly problemas: readonly ProblemaAns[];
  /** Pode gerar (nenhum problema do arquivo inteiro e ao menos um registro). */
  readonly podeGerar: boolean;
}

export interface EnvioAnsResumo {
  readonly id: number;
  readonly versao: number;
  readonly operadora: { readonly id: number; readonly nome: string; readonly registroAns: string };
  readonly obrigacao: ObrigacaoAns;
  readonly competencia: string;
  readonly sequencial: number;
  readonly destino: 'simulador' | 'ans';
  readonly situacao: SituacaoEnvioAns;
  readonly registros: number;
  readonly valorTotal: number | null;
  readonly arquivoNome: string | null;
  readonly hash: string | null;
  readonly recibo: string | null;
  readonly criadoEm: string;
  readonly criadoPor: string;
  readonly enviadoEm: string | null;
  readonly retornoEm: string | null;
  /** Prazo (ressarcimento: impugnação); null nas outras. */
  readonly prazo: string | null;
  readonly gru: string | null;
  readonly pagoEm: string | null;
  readonly valorPago: number | null;
}

export interface ItemEnvioAns {
  readonly id: number;
  readonly ordem: number;
  readonly tipo: string;
  readonly referencia: string;
  /** Descrição curta do item (o movimento e os campos, o grupo, o plano, o atendimento). */
  readonly descricao: string;
  readonly valor: number | null;
  readonly resultado: ResultadoItemAns;
  readonly erro: string | null;
  /** Ressarcimento: a sugestão da análise e a decisão. */
  readonly sugestao: MotivoImpugnacaoSus | null;
  readonly decisao: DecisaoRessarcimento | null;
  readonly motivo: MotivoImpugnacaoSus | null;
  readonly justificativa: string | null;
}

export interface EventoEnvioAns {
  readonly evento: string;
  readonly situacao: SituacaoEnvioAns;
  readonly texto: string | null;
  readonly por: string;
  readonly em: string;
}

export interface EnvioAnsDetalhe extends EnvioAnsResumo {
  readonly quadros: readonly QuadroAns[];
  readonly itens: readonly ItemEnvioAns[];
  readonly eventos: readonly EventoEnvioAns[];
  readonly retornoResumo: string | null;
  /** Ações possíveis agora (a tela só mostra; o servidor confere de novo). */
  readonly acoes: readonly AcaoEnvioAns[];
}

export type AcaoEnvioAns = 'transmitir' | 'retorno' | 'pagar' | 'decidir' | 'baixar';

export interface EnviosAns {
  readonly itens: readonly EnvioAnsResumo[];
  readonly proxima: number | null;
  readonly totais: {
    readonly gerados: number;
    readonly aguardandoRetorno: number;
    readonly rejeitados: number;
    readonly ressarcimentosEmPrazo: number;
  };
}

export interface ArquivoEnvioAns {
  readonly nome: string;
  readonly tipo: 'application/xml' | 'text/csv';
  readonly base64: string;
  readonly sha256: string;
}

export interface PendenciaSib {
  readonly beneficiario: number;
  readonly carteirinha: string;
  readonly nome: string;
  readonly movimento: MovimentoSib | null;
  readonly problemas: readonly ProblemaAns[];
}

export interface PendenciasSib {
  readonly itens: readonly PendenciaSib[];
  readonly proxima: number | null;
}

export interface ComplementoSib {
  readonly beneficiario: number;
  readonly versao: number;
  readonly logradouro: string | null;
  readonly numero: string | null;
  readonly complemento: string | null;
  readonly bairro: string | null;
  readonly municipio: number | null;
  readonly cep: string | null;
  readonly resideExterior: boolean;
  readonly dnv: string | null;
  readonly coberturaParcial: boolean;
  readonly itensExcluidos: boolean;
  readonly cco: string | null;
  readonly motivoCancelamento: number | null;
  /** Data do último movimento aceito pela ANS. */
  readonly aceitoEm: string | null;
}

export interface ApoioAns {
  readonly destino: 'simulador' | 'ans';
  readonly leiaute: string;
  readonly operadoras: readonly {
    readonly id: number;
    readonly nome: string;
    readonly registroAns: string;
  }[];
  readonly obrigacoes: readonly {
    readonly codigo: ObrigacaoAns;
    readonly rotulo: string;
    readonly periodicidade: string;
  }[];
  readonly motivosSib: readonly { readonly codigo: number; readonly nome: string; readonly grupo: number }[];
  readonly camposSib: readonly { readonly codigo: number; readonly nome: string }[];
  readonly valoresTps: readonly {
    readonly vigencia: string;
    readonly valorAnual: number;
    readonly valorTrimestral: number;
  }[];
  readonly situacao: {
    readonly vale: boolean;
    readonly motivo: string | null;
  };
}

export interface ResultadoEnvioAns {
  readonly id: number;
  readonly versao: number;
  readonly situacao: SituacaoEnvioAns;
}

// ── Rotas, chave e textos ───────────────────────────────────────────────────────────────────────

/** Rotas e permissões da fatia F6 (D-PERM-56: `operadora.ans.ler` / `.gerar`; o envio real só em produção). */
export const ROTAS_OPERADORA_F6 = {
  apoio: { caminho: 'operadora/ans/apoio', permissao: 'operadora.dominio.ler' },
  lista: { caminho: 'operadora/ans/envios', permissao: 'operadora.ans.ler' },
  ficha: { caminho: 'operadora/ans/envios/:id', permissao: 'operadora.ans.ler' },
  arquivo: { caminho: 'operadora/ans/envios/:id/arquivo', permissao: 'operadora.ans.ler' },
  previa: { caminho: 'operadora/ans/previa', permissao: 'operadora.ans.ler' },
  gerar: { caminho: 'operadora/ans/envios', permissao: 'operadora.ans.gerar' },
  transmitir: { caminho: 'operadora/ans/envios/:id/envio', permissao: 'operadora.ans.gerar' },
  retorno: { caminho: 'operadora/ans/envios/:id/retorno', permissao: 'operadora.ans.gerar' },
  pagar: { caminho: 'operadora/ans/envios/:id/pagamento', permissao: 'operadora.ans.gerar' },
  pendenciasSib: { caminho: 'operadora/ans/sib/pendencias', permissao: 'operadora.ans.ler' },
  complementoSib: { caminho: 'operadora/ans/sib/beneficiarios/:id', permissao: 'operadora.ans.ler' },
  gravarComplementoSib: { caminho: 'operadora/ans/sib/beneficiarios/:id', permissao: 'operadora.ans.gerar' },
  registrarAviso: { caminho: 'operadora/ans/ressarcimento', permissao: 'operadora.ans.gerar' },
  decidirItem: { caminho: 'operadora/ans/envios/:id/itens/:item/decisao', permissao: 'operadora.ans.gerar' },
} as const;

/** Chave de liberação da fatia (CHAVES_FATIA_OPERADORA, recurso `ans`). */
export const CHAVE_OPERADORA_ANS = 'operadora.ans' as const;

/** Textos das recusas e das pendências: o mesmo texto na API e na tela. */
export const MENSAGENS_ANS: Readonly<Record<string, string>> = {
  'competencia-invalida':
    'A competência não serve para esta obrigação: mensal AAAA-MM, trimestral AAAA-Tn, sob demanda AAAA-MM-DD.',
  'competencia-futura': 'A competência ainda não terminou: gere o arquivo depois do último dia do período.',
  'sem-registros': 'Não há o que enviar nesta competência.',
  'ja-aceito':
    'Esta competência já tem arquivo aceito pela ANS. Um novo arquivo sai como retificador do aceito (sequencial seguinte).',
  'operadora-inativa': 'A operadora está inativa.',
  'sem-balancete':
    'Informe o balancete do fim do trimestre (ativo, passivo, patrimônio líquido e provisões).',
  'balancete-desequilibrado': 'O ativo tem de ser igual ao passivo mais o patrimônio líquido.',
  'sem-valor-tps': 'Não há valor da taxa de saúde suplementar vigente no trimestre.',
  'desconto-de-outro-plano': 'O desconto informado é de um plano que não é desta operadora.',
  'cpf-obrigatorio': 'CPF obrigatório para beneficiário com 18 anos ou mais.',
  'cpf-invalido': 'CPF inválido.',
  'sem-identificacao-menor':
    'Menor de 18 anos sem CPF precisa do Cartão Nacional de Saúde ou da declaração de nascido vivo.',
  'cns-invalido': 'Cartão Nacional de Saúde inválido.',
  'sem-endereco':
    'Endereço incompleto: informe o logradouro, o bairro, o município e o CEP (ou que reside no exterior).',
  'municipio-invalido': 'Código do município inválido (7 dígitos do IBGE).',
  'sem-registro-plano': 'O plano não tem registro na ANS.',
  'sem-motivo-cancelamento': 'Informe o motivo do cancelamento para o SIB.',
  'sem-cco': 'O beneficiário ainda não tem o código de controle operacional (CCO) dado pela ANS.',
  'cco-invalido': 'CCO inválido (12 dígitos).',
  'titular-sem-cco':
    'O titular ainda não tem o CCO dado pela ANS nem entra neste arquivo: o dependente sai no arquivo seguinte.',
  'aguardando-retorno':
    'Há arquivo desta obrigação enviado e sem o retorno da ANS: registre o retorno antes de gerar outro.',
  'contratante-sem-cnpj': 'Contrato coletivo sem o CNPJ do contratante.',
  'procedimento-sem-grupo': 'Procedimento sem grupo do SIP vigente na data: entra em "não classificados".',
  'guia-sem-beneficiario': 'Guia sem beneficiário da operadora identificado.',
  'sem-recibo': 'Informe o recibo ou o protocolo que a ANS devolveu.',
  'recibo-no-simulador': 'Fora de produção o arquivo vai ao simulador, que não devolve recibo.',
  'envio-desatualizado': 'O envio mudou depois que você abriu (outra pessoa gravou). Abra de novo e confira.',
  'situacao-nao-permite': 'A situação do envio não permite esta ação.',
  'retorno-sem-itens': 'Informe o resultado dos itens devolvidos pela ANS (ou que o arquivo foi rejeitado).',
  'item-de-outro-envio': 'O resultado informado é de um item que não está neste envio.',
  'cco-obrigatorio': 'O beneficiário aceito na inclusão precisa do CCO devolvido pela ANS.',
  'sem-gru': 'Só a taxa de saúde suplementar e o ressarcimento ao SUS têm GRU.',
  'gru-antes-do-aceite': 'Registre a GRU depois do retorno da ANS.',
  'aviso-repetido': 'Este aviso de ressarcimento já foi registrado.',
  'atendimento-repetido': 'O mesmo atendimento (AIH ou APAC) aparece mais de uma vez.',
  'periodo-invalido': 'O fim do atendimento é anterior ao início.',
  'atendimento-depois-do-aviso': 'O atendimento é posterior ao recebimento do aviso.',
  'decisao-pendente': 'Decida todos os atendimentos do aviso antes de protocolar a impugnação.',
  'impugnacao-sem-motivo': 'Informe o motivo da impugnação.',
  'impugnacao-sem-justificativa': 'Descreva a justificativa da impugnação (motivo "outro").',
  'prazo-vencido': 'O prazo da impugnação venceu: só é possível aceitar o atendimento.',
  'arquivo-grande': 'O arquivo passa do tamanho máximo: divida a competência.',
  'simular-so-fora-de-producao': 'O retorno simulado só existe fora de produção.',
  'sem-movimentos': 'Nenhum beneficiário mudou desde o último arquivo aceito.',
};

// ── Esquemas das respostas (a tela valida o que recebe; os tipos acima são a fonte) ─────────────────

const situacaoEnvio = z.enum(CODIGOS_SITUACAO_ENVIO_ANS as [SituacaoEnvioAns, ...SituacaoEnvioAns[]]);
const destinoAns = z.enum(['simulador', 'ans']);
const motivoSus = z.enum(CODIGOS_MOTIVO_IMPUGNACAO_SUS as [MotivoImpugnacaoSus, ...MotivoImpugnacaoSus[]]);
const esquemaProblemaAns = z.object({
  codigo: z.string(),
  alcance: z.enum(['arquivo', 'item']),
  referencia: z.string().nullable(),
  mensagem: z.string(),
});
const esquemaParcelaAns = z.object({
  rotulo: z.string(),
  valor: z.number(),
  quantidade: z.number().optional(),
});
const esquemaQuadroAns = z.object({
  titulo: z.string(),
  parcelas: z.array(esquemaParcelaAns),
  total: esquemaParcelaAns,
});

export const esquemaRespostaPreviaAns: z.ZodType<PreviaEnvioAns> = z.object({
  obrigacao,
  competencia: z.string(),
  destino: destinoAns,
  registros: z.number().int(),
  quadros: z.array(esquemaQuadroAns),
  problemas: z.array(esquemaProblemaAns),
  podeGerar: z.boolean(),
});

const esquemaEnvioAnsResumo = z.object({
  id: z.number().int(),
  versao: z.number().int(),
  operadora: z.object({ id: z.number().int(), nome: z.string(), registroAns: z.string() }),
  obrigacao,
  competencia: z.string(),
  sequencial: z.number().int(),
  destino: destinoAns,
  situacao: situacaoEnvio,
  registros: z.number().int(),
  valorTotal: z.number().nullable(),
  arquivoNome: z.string().nullable(),
  hash: z.string().nullable(),
  recibo: z.string().nullable(),
  criadoEm: z.string(),
  criadoPor: z.string(),
  enviadoEm: z.string().nullable(),
  retornoEm: z.string().nullable(),
  prazo: z.string().nullable(),
  gru: z.string().nullable(),
  pagoEm: z.string().nullable(),
  valorPago: z.number().nullable(),
});

export const esquemaEnviosAns: z.ZodType<EnviosAns> = z.object({
  itens: z.array(esquemaEnvioAnsResumo),
  proxima: z.number().int().nullable(),
  totais: z.object({
    gerados: z.number().int(),
    aguardandoRetorno: z.number().int(),
    rejeitados: z.number().int(),
    ressarcimentosEmPrazo: z.number().int(),
  }),
});

export const esquemaEnvioAnsDetalhe: z.ZodType<EnvioAnsDetalhe> = esquemaEnvioAnsResumo.extend({
  quadros: z.array(esquemaQuadroAns),
  itens: z.array(
    z.object({
      id: z.number().int(),
      ordem: z.number().int(),
      tipo: z.string(),
      referencia: z.string(),
      descricao: z.string(),
      valor: z.number().nullable(),
      resultado: z.enum(['enviado', 'aceito', 'rejeitado']),
      erro: z.string().nullable(),
      sugestao: motivoSus.nullable(),
      decisao: z.enum(['pendente', 'impugnar', 'aceitar']).nullable(),
      motivo: motivoSus.nullable(),
      justificativa: z.string().nullable(),
    }),
  ),
  eventos: z.array(
    z.object({
      evento: z.string(),
      situacao: situacaoEnvio,
      texto: z.string().nullable(),
      por: z.string(),
      em: z.string(),
    }),
  ),
  retornoResumo: z.string().nullable(),
  acoes: z.array(z.enum(['transmitir', 'retorno', 'pagar', 'decidir', 'baixar'])),
});

export const esquemaArquivoEnvioAns: z.ZodType<ArquivoEnvioAns> = z.object({
  nome: z.string(),
  tipo: z.enum(['application/xml', 'text/csv']),
  base64: z.string(),
  sha256: z.string(),
});

export const esquemaPendenciasSib: z.ZodType<PendenciasSib> = z.object({
  itens: z.array(
    z.object({
      beneficiario: z.number().int(),
      carteirinha: z.string(),
      nome: z.string(),
      movimento: z.enum(CODIGOS_MOVIMENTO_SIB as [MovimentoSib, ...MovimentoSib[]]).nullable(),
      problemas: z.array(esquemaProblemaAns),
    }),
  ),
  proxima: z.number().int().nullable(),
});

export const esquemaRespostaComplementoSib: z.ZodType<ComplementoSib> = z.object({
  beneficiario: z.number().int(),
  versao: z.number().int(),
  logradouro: z.string().nullable(),
  numero: z.string().nullable(),
  complemento: z.string().nullable(),
  bairro: z.string().nullable(),
  municipio: z.number().int().nullable(),
  cep: z.string().nullable(),
  resideExterior: z.boolean(),
  dnv: z.string().nullable(),
  coberturaParcial: z.boolean(),
  itensExcluidos: z.boolean(),
  cco: z.string().nullable(),
  motivoCancelamento: z.number().int().nullable(),
  aceitoEm: z.string().nullable(),
});

export const esquemaApoioAns: z.ZodType<ApoioAns> = z.object({
  destino: destinoAns,
  leiaute: z.string(),
  operadoras: z.array(z.object({ id: z.number().int(), nome: z.string(), registroAns: z.string() })),
  obrigacoes: z.array(z.object({ codigo: obrigacao, rotulo: z.string(), periodicidade: z.string() })),
  motivosSib: z.array(z.object({ codigo: z.number().int(), nome: z.string(), grupo: z.number().int() })),
  camposSib: z.array(z.object({ codigo: z.number().int(), nome: z.string() })),
  valoresTps: z.array(
    z.object({ vigencia: z.string(), valorAnual: z.number(), valorTrimestral: z.number() }),
  ),
  situacao: z.object({ vale: z.boolean(), motivo: z.string().nullable() }),
});

export const esquemaResultadoEnvioAns: z.ZodType<ResultadoEnvioAns & { mensagem: string }> = z.object({
  id: z.number().int(),
  versao: z.number().int(),
  situacao: situacaoEnvio,
  mensagem: z.string(),
});
