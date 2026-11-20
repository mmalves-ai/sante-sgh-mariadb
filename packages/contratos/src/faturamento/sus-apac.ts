// Faturamento SUS próprio, etapa 3 (ficha do M51, seções 4, 5, 7 e 8): APAC (autorização de procedimento ambulatorial
// de alta complexidade). O laudo de solicitação (procedimento principal, CID, médico solicitante, justificativa e, quando
// o procedimento exige, o laudo específico de nefrologia com os domínios FAHEMO*), a autorização do gestor (número de 13
// dígitos com o dígito verificador, autorizador, validade de até três competências), a negativa, a continuidade
// (competência a competência dentro da validade), o encerramento (motivo de saída) e o cancelamento; por competência, o
// arquivo APAC-Mag com a produção da mesma conta. Construído completo e DESLIGADO por estabelecimento (DP-35: CNES sem
// SUS; a chave `faturamento.susApac` com o pré-requisito do contrato, POL-3). Nenhuma resposta carrega documento de
// pessoa (nem o CPF do médico solicitante, que vai por chave opaca): a tela recebe o prontuário, o atendimento, códigos e contagens; o CNS do paciente só vai ao arquivo guardado.
import { z } from 'zod';
import { textoCp1252 } from '../texto-cp1252.js';
import { cnsValido } from '../validacao/cns.js';
import { esquemaCompetenciaSus } from './sus.js';

/** Situação da APAC (SGH_FAT_SUS_APAC.SITUACAO). */
export const SITUACOES_APAC = ['solicitada', 'autorizada', 'negada', 'encerrada', 'cancelada'] as const;
export type SituacaoApac = (typeof SITUACOES_APAC)[number];

/** Tipo da APAC autorizada: inicial (com continuidade nas competências seguintes da validade) ou única (uma só). */
export const TIPOS_APAC = ['inicial', 'unica'] as const;
export type TipoApac = (typeof TIPOS_APAC)[number];

/** Tipo da APAC no arquivo da competência (APAC-Mag): 1 inicial, 2 continuidade, 3 única. */
export const TIPOS_APAC_NO_ARQUIVO = ['1', '2', '3'] as const;
export type TipoApacNoArquivo = (typeof TIPOS_APAC_NO_ARQUIVO)[number];

/** Laudo específico exigido por alguns procedimentos (o de nefrologia usa os domínios FAHEMO* do faturamento SUS). */
export const LAUDOS_ESPECIFICOS_APAC = ['nenhum', 'nefrologia'] as const;
export type LaudoEspecificoApac = (typeof LAUDOS_ESPECIFICOS_APAC)[number];

/**
 * Motivos de saída e de permanência do SIA (tabela de motivo de cobrança da APAC). Os 2x são de permanência (a APAC
 * continua); o encerramento usa os de alta (1x), transferência (3x), óbito (4x) e o administrativo (51).
 */
export const MOTIVOS_SAIDA_APAC = {
  '11': 'Alta curado',
  '12': 'Alta melhorado',
  '14': 'Alta a pedido',
  '15': 'Alta com previsão de retorno para acompanhamento',
  '16': 'Alta por evasão',
  '18': 'Alta por outros motivos',
  '21': 'Permanência por características próprias da doença',
  '22': 'Permanência por intercorrência',
  '23': 'Permanência por impossibilidade sociofamiliar',
  '28': 'Permanência por outros motivos',
  '31': 'Transferência para outro estabelecimento',
  '41': 'Óbito com declaração fornecida pelo médico assistente',
  '42': 'Óbito com declaração fornecida pelo IML',
  '43': 'Óbito com declaração fornecida pelo SVO',
  '51': 'Encerramento administrativo',
} as const;
export type MotivoSaidaApac = keyof typeof MOTIVOS_SAIDA_APAC;
export const MOTIVOS_ENCERRAMENTO_APAC = (Object.keys(MOTIVOS_SAIDA_APAC) as MotivoSaidaApac[]).filter(
  (m) => !m.startsWith('2'),
);
/** O motivo de permanência informado nas competências em que a APAC continua (D-PERMANENCIA-51). */
export const MOTIVO_PERMANENCIA_PADRAO_APAC: MotivoSaidaApac = '21';

const versao = z.string().min(10).max(40);
const data = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const cid = z
  .string()
  .trim()
  .toUpperCase()
  .transform((v) => v.replace(/[.\s-]/g, ''))
  .pipe(z.string().regex(/^[A-Z]\d{2}[0-9X]?$/));
/** Os textos livres vão ao banco charset NONE: só CP1252 (ADR 0008), com a troca proposta na recusa (D-CP1252-513). */
const justificativa = textoCp1252(500).pipe(z.string().trim().min(10));
const justificativaLaudo = textoCp1252(2000).pipe(z.string().trim().min(10));
/**
 * O médico solicitante como a tela o vê: um identificador opaco que o servidor sela (o CPF do cadastro nunca sai do
 * servidor; D-SOLICITANTE-513) e abre de volta só na gravação e no arquivo.
 */
const chaveSolicitante = z.string().regex(/^[A-Za-z0-9_-]{16,200}$/);
const dominio = z.number().int().min(0).max(2_147_483_647);

/** O laudo específico de nefrologia (terapia renal substitutiva): os quatro domínios FAHEMO* e o início do tratamento. */
export const esquemaLaudoNefrologia = z
  .object({
    caracteristicaTratamento: dominio,
    contraindicacaoTransplante: dominio,
    situacaoTransplante: dominio,
    acessoVascular: dominio,
    inicioTratamento: data,
  })
  .strict();
export type LaudoNefrologia = z.infer<typeof esquemaLaudoNefrologia>;

/** O laudo de solicitação (transcrito do laudo do médico; a chave do atendimento diz o paciente). */
export const esquemaLaudoApac = z
  .object({
    /** O registro do atendimento ambulatorial do laudo (RECADATE.REG). */
    registro: z.number().int().positive().max(2_147_483_647),
    /** O procedimento principal SIGTAP (10 dígitos). */
    procedimento: z.string().regex(/^\d{10}$/),
    cidPrincipal: cid,
    cidSecundario: cid.nullable().default(null),
    cidAssociado: cid.nullable().default(null),
    /** O médico solicitante SUS (FAMEDSOL), pela chave opaca que a busca dos solicitantes devolve. */
    solicitante: chaveSolicitante,
    dataSolicitacao: data,
    justificativa: justificativaLaudo,
    laudoEspecifico: z.enum(LAUDOS_ESPECIFICOS_APAC).default('nenhum'),
    nefrologia: esquemaLaudoNefrologia.nullable().default(null),
  })
  .strict()
  .refine((l) => (l.laudoEspecifico === 'nefrologia') === (l.nefrologia !== null), {
    message: 'laudo-especifico-incoerente',
    path: ['nefrologia'],
  });
export type LaudoApacEntrada = z.infer<typeof esquemaLaudoApac>;

/**
 * A correção do laudo da APAC ainda solicitada (D-CORRIGIR-513): o que foi transcrito do laudo do médico (CIDs, médico
 * solicitante, data, justificativa e o laudo específico). O atendimento e o procedimento não mudam: outro procedimento é
 * outro laudo (cancele e registre de novo).
 */
export const esquemaCorrecaoLaudoApac = z
  .object({
    cidPrincipal: cid,
    cidSecundario: cid.nullable().default(null),
    cidAssociado: cid.nullable().default(null),
    solicitante: chaveSolicitante,
    dataSolicitacao: data,
    justificativa: justificativaLaudo,
    laudoEspecifico: z.enum(LAUDOS_ESPECIFICOS_APAC).default('nenhum'),
    nefrologia: esquemaLaudoNefrologia.nullable().default(null),
  })
  .strict()
  .refine((l) => (l.laudoEspecifico === 'nefrologia') === (l.nefrologia !== null), {
    message: 'laudo-especifico-incoerente',
    path: ['nefrologia'],
  });
export type CorrecaoLaudoApac = z.infer<typeof esquemaCorrecaoLaudoApac>;

/** CNS (15 dígitos com o dígito conferido): o do autorizador do gestor. */
const cns = z
  .string()
  .regex(/^\d{15}$/)
  .refine((v) => cnsValido(v), { message: 'cns-invalido' });

/** A ação do `faturamento.registrarApac` (uma por chamada; a versão da APAC que a tela leu nas que mudam uma). */
export const esquemaRegistrarApac = z.discriminatedUnion('acao', [
  z.object({ acao: z.literal('laudo'), laudo: esquemaLaudoApac }).strict(),
  z
    .object({
      acao: z.literal('corrigir'),
      apac: z.number().int().positive(),
      versao,
      laudo: esquemaCorrecaoLaudoApac,
    })
    .strict(),
  z
    .object({
      acao: z.literal('autorizar'),
      apac: z.number().int().positive(),
      versao,
      numero: z.string().regex(/^\d{13}$/),
      tipo: z.enum(TIPOS_APAC),
      autorizador: cns,
      dataAutorizacao: data,
      competenciaInicial: esquemaCompetenciaSus,
      competenciaFinal: esquemaCompetenciaSus,
    })
    .strict(),
  z.object({ acao: z.literal('negar'), apac: z.number().int().positive(), versao, justificativa }).strict(),
  z.object({ acao: z.literal('continuar'), apac: z.number().int().positive(), versao }).strict(),
  z
    .object({
      acao: z.literal('encerrar'),
      apac: z.number().int().positive(),
      versao,
      motivo: z.enum(MOTIVOS_ENCERRAMENTO_APAC as [MotivoSaidaApac, ...MotivoSaidaApac[]]),
      dataEncerramento: data,
    })
    .strict(),
  z
    .object({ acao: z.literal('cancelar'), apac: z.number().int().positive(), versao, justificativa })
    .strict(),
]);
export type RegistrarApacEntrada = z.infer<typeof esquemaRegistrarApac>;
export type AcaoApac = RegistrarApacEntrada['acao'];

/** A lista das APACs (paginação no servidor; filtro pela situação, pelo número, pelo prontuário e pela competência). */
export const esquemaFiltroApacs = z
  .object({
    situacao: z.enum(SITUACOES_APAC).optional(),
    numero: z
      .string()
      .regex(/^\d{1,13}$/)
      .optional(),
    prontuario: z.coerce.number().int().positive().max(2_147_483_647).optional(),
    /** Só as APACs apresentáveis na competência (validade e continuidade). */
    competencia: esquemaCompetenciaSus.optional(),
    pagina: z.coerce.number().int().min(0).default(0),
    porPagina: z.coerce.number().int().min(10).max(200).default(50),
  })
  .strict();
export type FiltroApacs = z.infer<typeof esquemaFiltroApacs>;

const carimbo = z.string();

/** A APAC como a tela lista (o paciente pelo prontuário; o CNS só como "válido" ou não). */
export const esquemaApacLida = z.object({
  id: z.number().int(),
  situacao: z.enum(SITUACOES_APAC),
  prontuario: z.number().int().nullable(),
  registro: z.number().int(),
  atendimento: z.number().int().nullable(),
  procedimento: z.string(),
  procedimentoNome: z.string().nullable(),
  cidPrincipal: z.string(),
  cidSecundario: z.string().nullable(),
  cidAssociado: z.string().nullable(),
  /** A chave opaca do médico solicitante (nunca o CPF). */
  solicitante: z.string(),
  solicitanteNome: z.string().nullable(),
  solicitanteCrm: z.number().int().nullable(),
  dataSolicitacao: z.string(),
  justificativa: z.string(),
  laudoEspecifico: z.enum(LAUDOS_ESPECIFICOS_APAC),
  nefrologia: esquemaLaudoNefrologia.nullable(),
  numero: z.string().nullable(),
  tipo: z.enum(TIPOS_APAC).nullable(),
  dataAutorizacao: z.string().nullable(),
  competenciaInicial: z.string().nullable(),
  competenciaFinal: z.string().nullable(),
  /** A última competência em que a APAC é apresentada (a continuidade a avança mês a mês até a final). */
  ultimaCompetencia: z.string().nullable(),
  motivoSaida: z.string().nullable(),
  dataEncerramento: z.string().nullable(),
  justificativaSituacao: z.string().nullable(),
  registradaPor: z.string(),
  registradaEm: carimbo,
  alteradaPor: z.string().nullable(),
  alteradaEm: carimbo.nullable(),
  versao,
});
export type ApacLida = z.infer<typeof esquemaApacLida>;

export const esquemaPaginaApacs = z.object({
  itens: z.array(esquemaApacLida),
  total: z.number().int(),
  porSituacao: z.record(z.string(), z.number().int()),
});
export type PaginaApacs = z.infer<typeof esquemaPaginaApacs>;

/** O atendimento do laudo conferido no servidor (sem documento: só se o paciente tem CNS válido e se a conta é SUS). */
export const esquemaAtendimentoLaudoApac = z.object({
  registro: z.number().int(),
  atendimento: z.number().int().nullable(),
  prontuario: z.number().int().nullable(),
  data: z.string().nullable(),
  convenio: z.number().int().nullable(),
  contaSus: z.boolean(),
  cnsValido: z.boolean(),
  cidPrincipal: z.string().nullable(),
});
export type AtendimentoLaudoApac = z.infer<typeof esquemaAtendimentoLaudoApac>;

/** Um valor de domínio do laudo de nefrologia (FAHEMO*: código e nome). */
export const esquemaValorDominioApac = z.object({ id: z.number().int(), nome: z.string() });
export const esquemaDominiosApac = z.object({
  caracteristicaTratamento: z.array(esquemaValorDominioApac),
  contraindicacaoTransplante: z.array(esquemaValorDominioApac),
  situacaoTransplante: z.array(esquemaValorDominioApac),
  acessoVascular: z.array(esquemaValorDominioApac),
});
export type DominiosApac = z.infer<typeof esquemaDominiosApac>;

/** O médico solicitante SUS achado para o laudo (FAMEDSOL): a chave opaca, o nome, o CRM e se o CNS é válido. */
export const esquemaSolicitanteApac = z.object({
  /** Opaca (selada no servidor): o CPF do cadastro não vai ao navegador. */
  chave: z.string(),
  nome: z.string(),
  crm: z.number().int().nullable(),
  cnsValido: z.boolean(),
});
export type SolicitanteApac = z.infer<typeof esquemaSolicitanteApac>;

/** faturamento.gerarApac: a competência APAC aberta, criticada, sem bloqueante e na versão que a tela leu. */
export const esquemaGerarApac = z.object({ competencia: esquemaCompetenciaSus, versao }).strict();
export type GerarApacEntrada = z.infer<typeof esquemaGerarApac>;

/** As linhas de procedimento do APAC-Mag gerado (paginação no servidor; sem dado pessoal). */
export const esquemaFiltroLinhasApac = z
  .object({
    arquivo: z.coerce.number().int().positive(),
    pagina: z.coerce.number().int().min(0).default(0),
    porPagina: z.coerce.number().int().min(10).max(200).default(50),
  })
  .strict();
export type FiltroLinhasApac = z.infer<typeof esquemaFiltroLinhasApac>;

export const esquemaLinhaApacLida = z.object({
  id: z.number().int(),
  apac: z.number().int(),
  numero: z.string(),
  tipoNoArquivo: z.enum(TIPOS_APAC_NO_ARQUIVO),
  procedimento: z.string(),
  principal: z.boolean(),
  cbo: z.string(),
  quantidade: z.number().int(),
  conta: z.number().int().nullable(),
});
export type LinhaApacLida = z.infer<typeof esquemaLinhaApacLida>;

export const esquemaPaginaLinhasApac = z.object({
  itens: z.array(esquemaLinhaApacLida),
  total: z.number().int(),
  apacs: z.number().int(),
  quantidade: z.number().int(),
});
export type PaginaLinhasApac = z.infer<typeof esquemaPaginaLinhasApac>;
