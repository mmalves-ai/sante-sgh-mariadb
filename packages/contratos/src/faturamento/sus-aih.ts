// Faturamento SUS próprio, etapa 4 (ficha do M51, seções 4, 5, 7 e 8; regra 6): AIH (autorização de internação
// hospitalar) e o retorno do gestor.
//   - Faixa numérica liberada pelo gestor (13 dígitos com o dígito verificador; a AIH só recebe número da faixa ativa).
//   - AIH: o laudo de solicitação (transcrito do laudo do médico: internação, procedimento solicitado, CID, caráter,
//     médico solicitante e justificativa), a autorização do gestor (número da faixa, autorizador, data), a negativa, o
//     fechamento (procedimento realizado, secundários e OPM da mesma conta, diárias de UTI pela trajetória, permanência)
//     com o espelho, a reabertura e o cancelamento; por competência, o arquivo SISAIH01.
//   - Retorno do gestor (SIH e SIA): o espelho com a situação de cada AIH ou linha do BPA (aprovada, rejeitada, glosada),
//     o motivo e o valor aprovado; a decisão de reapresentar ou aceitar a glosa.
// Construído completo e DESLIGADO por estabelecimento (DP-35: CNES sem SUS; a chave `faturamento.susAih` com o
// pré-requisito do contrato, POL-3). Nenhuma resposta carrega documento de pessoa: a tela recebe o prontuário, a
// internação, códigos e contagens; o CNS e o nome do paciente só vão ao arquivo guardado.
import { z } from 'zod';
import { cnsValido } from '../validacao/cns.js';
import { esquemaCompetenciaSus } from './sus.js';

/** Situação da AIH (SGH_FAT_SUS_AIH.SITUACAO). */
export const SITUACOES_AIH = [
  'solicitada',
  'autorizada',
  'negada',
  'fechada',
  'apresentada',
  'aprovada',
  'rejeitada',
  'cancelada',
] as const;
export type SituacaoAih = (typeof SITUACOES_AIH)[number];

/** Caráter da internação na tabela do SIH (a internação guarda 1 e 2: eletivo e urgência). */
export const CARATERES_INTERNACAO_SIH = {
  '01': 'Eletivo',
  '02': 'Urgência',
  '03': 'Acidente no local de trabalho ou a serviço da empresa',
  '04': 'Acidente no trajeto para o trabalho',
  '05': 'Outros tipos de acidente de trânsito',
  '06': 'Outros tipos de lesões e envenenamentos por agentes químicos ou físicos',
} as const;
export type CaraterInternacaoSih = keyof typeof CARATERES_INTERNACAO_SIH;
const CARATERES = Object.keys(CARATERES_INTERNACAO_SIH) as [CaraterInternacaoSih, ...CaraterInternacaoSih[]];

/** O tipo da linha da AIH fechada (SGH_FAT_SUS_AIH_ITEM.TIPO). */
export const TIPOS_ITEM_AIH = ['principal', 'secundario', 'especial', 'opm', 'diaria-uti'] as const;
export type TipoItemAih = (typeof TIPOS_ITEM_AIH)[number];

/** Situação da faixa numérica (SGH_FAT_SUS_FAIXA_AIH.SITUACAO). */
export const SITUACOES_FAIXA_AIH = ['ativa', 'esgotada', 'cancelada'] as const;
export type SituacaoFaixaAih = (typeof SITUACOES_FAIXA_AIH)[number];

/** Situação de uma linha do retorno do gestor e a decisão do faturamento sobre ela. */
export const SITUACOES_RETORNO_SUS = ['aprovada', 'rejeitada', 'glosada'] as const;
export type SituacaoRetornoSus = (typeof SITUACOES_RETORNO_SUS)[number];
export const TRATAMENTOS_RETORNO_SUS = ['pendente', 'reapresentar', 'aceita'] as const;
export type TratamentoRetornoSus = (typeof TRATAMENTOS_RETORNO_SUS)[number];
/** Instrumentos com retorno importável (o SIH devolve o espelho da AIH; o SIA, o relatório do BPA). */
export const INSTRUMENTOS_RETORNO_SUS = ['aih', 'bpa'] as const;
export type InstrumentoRetornoSus = (typeof INSTRUMENTOS_RETORNO_SUS)[number];

/** O cabeçalho do arquivo de retorno do gestor (D-RETORNO-51: o relatório do gestor exportado em CSV). */
export const COLUNAS_RETORNO_SUS = [
  'instrumento',
  'competencia',
  'identificacao',
  'procedimento',
  'situacao',
  'motivo',
  'valor_apresentado',
  'valor_aprovado',
] as const;

const versao = z.string().min(10).max(40);
const data = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const cid = z
  .string()
  .trim()
  .toUpperCase()
  .transform((v) => v.replace(/[.\s-]/g, ''))
  .pipe(z.string().regex(/^[A-Z]\d{2}[0-9X]?$/));
const justificativa = z.string().trim().min(10).max(500);
const sigtap = z.string().regex(/^\d{10}$/);
const numeroAih = z.string().regex(/^\d{13}$/);
const id = z.number().int().positive().max(2_147_483_647);
/** CNS (15 dígitos com o dígito conferido): o do autorizador do gestor. */
const cns = z
  .string()
  .regex(/^\d{15}$/)
  .refine((v) => cnsValido(v), { message: 'cns-invalido' });

/** `faturamento.registrarFaixaAih`: a faixa liberada pelo gestor (os dois extremos com o dígito) ou o cancelamento. */
export const esquemaRegistrarFaixaAih = z.discriminatedUnion('acao', [
  z
    .object({
      acao: z.literal('registrar'),
      inicial: numeroAih,
      final: numeroAih,
      /** O gestor que liberou (secretaria municipal ou estadual). */
      orgaoEmissor: z.string().trim().min(3).max(60),
      dataLiberacao: data,
    })
    .strict(),
  z.object({ acao: z.literal('cancelar'), faixa: id, versao, justificativa }).strict(),
]);
export type RegistrarFaixaAihEntrada = z.infer<typeof esquemaRegistrarFaixaAih>;

/** O laudo de solicitação de AIH (transcrito do laudo do médico; a internação diz o paciente). */
export const esquemaLaudoAih = z
  .object({
    /** O registro da internação. */
    registro: id,
    procedimentoSolicitado: sigtap,
    cidPrincipal: cid,
    cidSecundario: cid.nullable().default(null),
    carater: z.enum(CARATERES),
    /** O médico solicitante SUS (cadastro de solicitantes SUS: a chave é o CPF dele, como no cadastro). */
    solicitante: z.string().regex(/^\d{1,11}$/),
    dataLaudo: data,
    /** Sinais e sintomas, condições que justificam a internação e os exames que a confirmam. */
    justificativa: z.string().trim().min(10).max(2000),
  })
  .strict();
export type LaudoAihEntrada = z.infer<typeof esquemaLaudoAih>;

/** O OPM conferido no fechamento: o item da conta e os dados que o SISAIH01 pede (nota, CNPJ, Anvisa, série, lote). */
export const esquemaOpmAih = z
  .object({
    /** O item da conta com o vínculo SIGTAP do grupo 07. */
    item: id,
    cnpjFornecedor: z.string().regex(/^\d{14}$/),
    notaFiscal: z.string().trim().min(1).max(15),
    registroAnvisa: z.string().trim().max(20).default(''),
    serie: z.string().trim().max(20).default(''),
    lote: z.string().trim().max(20).default(''),
  })
  .strict();
export type OpmAihEntrada = z.infer<typeof esquemaOpmAih>;

/** A ação do `faturamento.registrarAih` (uma por chamada; a versão da AIH que a tela leu nas que mudam uma). */
export const esquemaRegistrarAih = z.discriminatedUnion('acao', [
  z.object({ acao: z.literal('laudo'), laudo: esquemaLaudoAih }).strict(),
  z
    .object({
      acao: z.literal('autorizar'),
      aih: id,
      versao,
      faixa: id,
      /** Número da faixa (13 dígitos); vazio: o próximo livre da faixa. */
      numero: numeroAih.nullable().default(null),
      autorizador: cns,
      dataAutorizacao: data,
    })
    .strict(),
  z.object({ acao: z.literal('negar'), aih: id, versao, justificativa }).strict(),
  z
    .object({
      acao: z.literal('fechar'),
      aih: id,
      versao,
      /** O procedimento realizado (vazio: o solicitado); a mudança vai marcada no arquivo. */
      procedimentoRealizado: sigtap.nullable().default(null),
      opm: z.array(esquemaOpmAih).max(60).default([]),
    })
    .strict(),
  z.object({ acao: z.literal('reabrir'), aih: id, versao, justificativa }).strict(),
  z.object({ acao: z.literal('cancelar'), aih: id, versao, justificativa }).strict(),
]);
export type RegistrarAihEntrada = z.infer<typeof esquemaRegistrarAih>;
export type AcaoAih = RegistrarAihEntrada['acao'];

/** `faturamento.gerarSisaih`: a competência AIH aberta, criticada, sem bloqueante e na versão que a tela leu. */
export const esquemaGerarSisaih = z.object({ competencia: esquemaCompetenciaSus, versao }).strict();
export type GerarSisaihEntrada = z.infer<typeof esquemaGerarSisaih>;

/** A lista das AIHs (paginação no servidor). */
export const esquemaFiltroAihs = z
  .object({
    situacao: z.enum(SITUACOES_AIH).optional(),
    numero: z
      .string()
      .regex(/^\d{1,13}$/)
      .optional(),
    prontuario: z.coerce.number().int().positive().max(2_147_483_647).optional(),
    registro: z.coerce.number().int().positive().max(2_147_483_647).optional(),
    pagina: z.coerce.number().int().min(0).default(0),
    porPagina: z.coerce.number().int().min(10).max(200).default(50),
  })
  .strict();
export type FiltroAihs = z.infer<typeof esquemaFiltroAihs>;

const carimbo = z.string();

/** A AIH como a tela lista (o paciente pelo prontuário; nenhum documento). */
export const esquemaAihLida = z.object({
  id: z.number().int(),
  situacao: z.enum(SITUACOES_AIH),
  registro: z.number().int(),
  prontuario: z.number().int().nullable(),
  conta: z.number().int().nullable(),
  entrada: z.string().nullable(),
  alta: z.string().nullable(),
  procedimentoSolicitado: z.string(),
  procedimentoSolicitadoNome: z.string().nullable(),
  procedimentoRealizado: z.string().nullable(),
  cidPrincipal: z.string(),
  cidSecundario: z.string().nullable(),
  carater: z.enum(CARATERES),
  solicitante: z.string(),
  solicitanteNome: z.string().nullable(),
  dataLaudo: z.string(),
  justificativa: z.string(),
  faixa: z.number().int().nullable(),
  numero: z.string().nullable(),
  dataAutorizacao: z.string().nullable(),
  permanencia: z.number().int().nullable(),
  diariasUti: z.number().int().nullable(),
  /** A competência em que a AIH foi apresentada (o último SISAIH01 que a levou). */
  competenciaApresentacao: z.string().nullable(),
  arquivo: z.number().int().nullable(),
  /** Reapresentação depois de rejeitada pelo gestor (quantas vezes). */
  reapresentacoes: z.number().int(),
  justificativaSituacao: z.string().nullable(),
  registradaPor: z.string(),
  registradaEm: carimbo,
  alteradaPor: z.string().nullable(),
  alteradaEm: carimbo.nullable(),
  versao,
});
export type AihLida = z.infer<typeof esquemaAihLida>;

export const esquemaPaginaAihs = z.object({
  itens: z.array(esquemaAihLida),
  total: z.number().int(),
  porSituacao: z.record(z.string(), z.number().int()),
});
export type PaginaAihs = z.infer<typeof esquemaPaginaAihs>;

/** A internação para o laudo (consulta pelo registro; o CNS só como "válido"). */
export const esquemaInternacaoParaAih = z.object({
  registro: z.number().int(),
  prontuario: z.number().int().nullable(),
  conta: z.number().int().nullable(),
  convenio: z.number().int().nullable(),
  sus: z.boolean(),
  entrada: z.string().nullable(),
  alta: z.string().nullable(),
  cidPrincipal: z.string().nullable(),
  carater: z.enum(CARATERES).nullable(),
  motivoSaida: z.number().int().nullable(),
  cnsValido: z.boolean(),
  /** A AIH já registrada para a internação (não cancelada nem negada). */
  aih: z.number().int().nullable(),
});
export type InternacaoParaAih = z.infer<typeof esquemaInternacaoParaAih>;

/** Uma linha do espelho (montagem ou fechamento): procedimento, quantidade, CBO e os valores da SIGTAP da competência. */
export const esquemaLinhaEspelhoAih = z.object({
  tipo: z.enum(TIPOS_ITEM_AIH),
  procedimento: z.string(),
  nome: z.string().nullable(),
  quantidade: z.number().int(),
  cbo: z.string().nullable(),
  /** O item da conta; null na diária de UTI. */
  item: z.number().int().nullable(),
  /** O tipo de UTI do SIH na diária. */
  tipoUti: z.number().int().nullable(),
  valorServicoHospitalar: z.number(),
  valorServicoProfissional: z.number(),
  valorTotal: z.number(),
  opm: esquemaOpmAih.omit({ item: true }).nullable(),
});
export type LinhaEspelhoAih = z.infer<typeof esquemaLinhaEspelhoAih>;

/** O espelho da AIH: o que vai (ou foi) ao SISAIH01, os valores, as críticas e o retorno do gestor. */
export const esquemaEspelhoAih = z.object({
  aih: esquemaAihLida,
  /** 'montagem' (da conta e da trajetória, agora) ou 'fechamento' (o que foi conferido e gravado). */
  origem: z.enum(['montagem', 'fechamento']),
  competencia: z.string().nullable(),
  linhas: z.array(esquemaLinhaEspelhoAih),
  permanencia: z.object({
    dias: z.number().int().nullable(),
    media: z.number().int().nullable(),
  }),
  diariasUti: z.object({ total: z.number().int(), mesAnterior: z.number().int() }),
  /** Itens da conta com vínculo SIGTAP que não cabem na AIH (SADT, consulta) e os sem vínculo. */
  itensForaDaAih: z.number().int(),
  itensSemSigtap: z.number().int(),
  valorTotal: z.number(),
  criticas: z.array(
    z.object({
      regra: z.string(),
      gravidade: z.enum(['bloqueante', 'aviso']),
      detalhe: z.record(z.string(), z.union([z.string(), z.number(), z.null()])),
    }),
  ),
  /** Os lotes das saídas de estoque do atendimento (sugestão para o OPM). */
  lotesSaida: z.array(
    z.object({ item: z.number().int(), nome: z.string(), quantidade: z.number(), lote: z.string() }),
  ),
  retorno: z
    .object({
      situacao: z.enum(SITUACOES_RETORNO_SUS),
      motivo: z.string().nullable(),
      valorAprovado: z.number().nullable(),
      tratamento: z.enum(TRATAMENTOS_RETORNO_SUS),
    })
    .nullable(),
});
export type EspelhoAih = z.infer<typeof esquemaEspelhoAih>;

/** A faixa numérica como a tela lista. */
export const esquemaFaixaAihLida = z.object({
  id: z.number().int(),
  inicial: z.string(),
  final: z.string(),
  /** O próximo número livre (com o dígito); null: esgotada. */
  proximo: z.string().nullable(),
  usados: z.number().int(),
  total: z.number().int(),
  orgaoEmissor: z.string(),
  dataLiberacao: z.string(),
  situacao: z.enum(SITUACOES_FAIXA_AIH),
  registradaPor: z.string(),
  registradaEm: carimbo,
  justificativa: z.string().nullable(),
  versao,
});
export type FaixaAihLida = z.infer<typeof esquemaFaixaAihLida>;

/** `faturamento.importarRetornoSus`: o arquivo do retorno (texto CSV; até 900 mil caracteres: o corpo da requisição tem teto de 1 MiB) de uma competência. */
export const esquemaImportarRetornoSus = z
  .object({
    instrumento: z.enum(INSTRUMENTOS_RETORNO_SUS),
    competencia: esquemaCompetenciaSus,
    nomeArquivo: z
      .string()
      .trim()
      .min(1)
      .max(60)
      .regex(/^[\w .()-]+$/),
    conteudo: z.string().min(1).max(900_000),
  })
  .strict();
export type ImportarRetornoSusEntrada = z.infer<typeof esquemaImportarRetornoSus>;

/** A decisão do faturamento sobre uma linha rejeitada ou glosada: reapresentar (AIH) ou aceitar a glosa. */
export const esquemaTratarRetornoSus = z
  .object({
    retorno: id,
    versao,
    decisao: z.enum(['reapresentar', 'aceita']),
    justificativa,
  })
  .strict();
export type TratarRetornoSusEntrada = z.infer<typeof esquemaTratarRetornoSus>;

export const esquemaFiltroRetornosSus = z
  .object({
    instrumento: z.enum(INSTRUMENTOS_RETORNO_SUS).optional(),
    competencia: esquemaCompetenciaSus.optional(),
    situacao: z.enum(SITUACOES_RETORNO_SUS).optional(),
    tratamento: z.enum(TRATAMENTOS_RETORNO_SUS).optional(),
    pagina: z.coerce.number().int().min(0).default(0),
    porPagina: z.coerce.number().int().min(10).max(200).default(50),
  })
  .strict();
export type FiltroRetornosSus = z.infer<typeof esquemaFiltroRetornosSus>;

/** Uma linha do retorno do gestor (a identificação do registro, a situação, o motivo e os valores). */
export const esquemaRetornoSusLido = z.object({
  id: z.number().int(),
  instrumento: z.enum(INSTRUMENTOS_RETORNO_SUS),
  competencia: z.string(),
  /** Número da AIH ou a linha do BPA (tipo, folha e sequência). */
  identificacao: z.string(),
  procedimento: z.string().nullable(),
  aih: z.number().int().nullable(),
  linhaBpa: z.number().int().nullable(),
  situacao: z.enum(SITUACOES_RETORNO_SUS),
  motivo: z.string().nullable(),
  valorApresentado: z.number().nullable(),
  valorAprovado: z.number().nullable(),
  valorGlosado: z.number(),
  tratamento: z.enum(TRATAMENTOS_RETORNO_SUS),
  justificativa: z.string().nullable(),
  arquivoRetorno: z.string(),
  hashRetorno: z.string(),
  importadoPor: z.string(),
  importadoEm: carimbo,
  tratadoPor: z.string().nullable(),
  tratadoEm: carimbo.nullable(),
  versao,
});
export type RetornoSusLido = z.infer<typeof esquemaRetornoSusLido>;

export const esquemaPaginaRetornosSus = z.object({
  itens: z.array(esquemaRetornoSusLido),
  total: z.number().int(),
  porSituacao: z.record(z.string(), z.number().int()),
  valorGlosado: z.number(),
});
export type PaginaRetornosSus = z.infer<typeof esquemaPaginaRetornosSus>;

/** O resultado da importação do retorno: contagens (sem dado pessoal). */
export const esquemaResultadoRetornoSus = z.object({
  instrumento: z.enum(INSTRUMENTOS_RETORNO_SUS),
  competencia: z.string(),
  hash: z.string(),
  linhas: z.number().int(),
  casadas: z.number().int(),
  /** Linhas sem registro correspondente no Sante (número ou linha desconhecida): ficam fora, listadas. */
  naoCasadas: z.array(z.object({ linha: z.number().int(), identificacao: z.string() })),
  erros: z.array(z.object({ linha: z.number().int(), problema: z.string() })),
  porSituacao: z.record(z.string(), z.number().int()),
  valorGlosado: z.number(),
  /** Linhas iguais a uma já importada (mesmo arquivo de novo): não gravadas. */
  repetidas: z.number().int(),
});
export type ResultadoRetornoSus = z.infer<typeof esquemaResultadoRetornoSus>;
