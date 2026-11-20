// Entradas da contabilidade, etapa 1 (M54-F1): plano de contas, regra de contabilização versionada e consulta dos
// fatos lidos. Tudo grava só em SGH_CTB_* (ficha, seção 5: nenhuma escrita nova em tabela legada de movimento).
import { z } from 'zod';
import { textoCp1252 } from '../texto-cp1252.js';
import {
  CODIGOS_GRUPO_CONTA,
  CODIGOS_ORIGEM_LANCAMENTO,
  CODIGOS_TIPO_FATO,
  LOTE_FATOS_MAXIMO,
  SITUACOES_FATO,
  type GrupoConta,
  type OrigemLancamento,
  type SituacaoFato,
  type TipoFato,
} from './vocabulario.js';

const DATA = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Data no formato AAAA-MM-DD.');
const COMPETENCIA = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'Competência no formato AAAA-MM.');
/** Código da conta: dígitos separados por ponto (a máscara da empresa confere o tamanho de cada nível). */
export const CODIGO_CONTA = z
  .string()
  .trim()
  .regex(/^\d+(\.\d+)*$/, 'Código da conta: números separados por ponto.')
  .max(30);

export const esquemaGrupoConta = z.enum(CODIGOS_GRUPO_CONTA as [GrupoConta, ...GrupoConta[]]);
export const esquemaOrigemLancamento = z
  .number()
  .int()
  .refine((n) => (CODIGOS_ORIGEM_LANCAMENTO as number[]).includes(n), 'Origem desconhecida.')
  .transform((n) => n as OrigemLancamento);
export const esquemaTipoFato = z.enum(CODIGOS_TIPO_FATO as [TipoFato, ...TipoFato[]]);
export const esquemaSituacaoFato = z.enum(Object.keys(SITUACOES_FATO) as [SituacaoFato, ...SituacaoFato[]]);

// ---------------------------------------------------------------------------------------------- plano de contas

export const esquemaContaPlano = z.object({
  empresa: z.number().int().positive(),
  codigo: CODIGO_CONTA,
  nome: textoCp1252(80),
  grupo: esquemaGrupoConta,
  tipo: z.enum(['sintetica', 'analitica']),
  natureza: z.enum(['devedora', 'credora']),
  /** ID do tipo de plano referencial (COTIPOPLANOCONTAREFERENCIAL.ID) e o código da conta referencial. */
  referencialTipo: z.number().int().positive().nullable().default(null),
  referencialConta: z.string().trim().max(30).nullable().default(null),
  /** Conta contábil do de-para da exportação (TBINTCRC.CTA_CONTABIL), quando a conta corresponde a uma de lá. */
  contaExportacao: z.number().int().positive().nullable().default(null),
  /** Exige centro de custo no lançamento (contas de resultado, em geral). */
  exigeCentroCusto: z.boolean().default(false),
  ativa: z.boolean().default(true),
});
export type ContaPlano = z.output<typeof esquemaContaPlano>;
export type ContaPlanoEntrada = z.input<typeof esquemaContaPlano>;

export const esquemaIncluirConta = esquemaContaPlano;
export const esquemaAlterarConta = esquemaContaPlano
  .pick({
    nome: true,
    referencialTipo: true,
    referencialConta: true,
    contaExportacao: true,
    exigeCentroCusto: true,
    ativa: true,
  })
  .partial()
  .extend({
    empresa: z.number().int().positive(),
    codigo: CODIGO_CONTA,
    versao: z.number().int().nonnegative(),
  });

// --------------------------------------------------------------------------------------------- regra versionada

/** Valor da partida: o valor do fato, um campo do fato, ou a fração do valor (rateio em percentuais). */
export const esquemaValorPartida = z.discriminatedUnion('base', [
  z.object({ base: z.literal('valorFato') }),
  z.object({ base: z.literal('campo'), campo: z.string().regex(/^[a-z][a-zA-Z0-9]*$/) }),
  z.object({ base: z.literal('percentual'), percentual: z.number().gt(0).lte(100) }),
]);
export type ValorPartida = z.output<typeof esquemaValorPartida>;

/**
 * Conta da partida: fixa (código do plano) ou pelo de-para (a chave do de-para vem de um campo do fato, por exemplo o
 * tipo de lançamento do financeiro ou o convênio da conta). Assim a contabilidade própria e a exportação ao contador
 * usam o MESMO de-para (regra 6).
 */
export const esquemaContaPartida = z.discriminatedUnion('modo', [
  z.object({ modo: z.literal('fixa'), conta: CODIGO_CONTA }),
  z.object({
    modo: z.literal('dePara'),
    campoChave: z.string().regex(/^[a-z][a-zA-Z0-9]*$/),
    contaPadrao: CODIGO_CONTA.nullable().default(null),
  }),
]);

export const esquemaPartidaRegra = z.object({
  lado: z.enum(['D', 'C']),
  conta: esquemaContaPartida,
  valor: esquemaValorPartida,
  /** Histórico com marcadores {campo} do fato (sem dado pessoal: só documento, competência e IDs). */
  historico: textoCp1252(120),
  centroCusto: z.enum(['doFato', 'nenhum']).default('nenhum'),
});
export type PartidaRegra = z.output<typeof esquemaPartidaRegra>;

/** Condição simples sobre um campo do fato (a regra só se aplica quando todas valem). */
export const esquemaCondicaoRegra = z.object({
  campo: z.string().regex(/^[a-z][a-zA-Z0-9]*$/),
  operador: z.enum(['igual', 'diferente', 'em', 'maiorQue', 'menorQue']),
  valor: z.union([z.string(), z.number(), z.array(z.union([z.string(), z.number()]))]),
});
export type CondicaoRegra = z.output<typeof esquemaCondicaoRegra>;

export const esquemaRegraContabil = z.object({
  empresa: z.number().int().positive(),
  origem: esquemaOrigemLancamento,
  tipoFato: esquemaTipoFato,
  /** Versão sequencial por (empresa, origem, tipo, nome). */
  versao: z.number().int().positive(),
  nome: textoCp1252(60),
  vigenciaInicio: DATA,
  vigenciaFim: DATA.nullable().default(null),
  /** Prioridade entre regras do mesmo tipo (a menor vence; empate é erro na publicação). */
  prioridade: z.number().int().min(0).max(999).default(100),
  condicoes: z.array(esquemaCondicaoRegra).max(10).default([]),
  partidas: z.array(esquemaPartidaRegra).min(2).max(20),
});
export type RegraContabil = z.output<typeof esquemaRegraContabil>;
export type RegraContabilEntrada = z.input<typeof esquemaRegraContabil>;

export const esquemaPublicarRegra = z.object({
  regra: esquemaRegraContabil,
  /** Motivo da nova versão (vai à trilha). */
  justificativa: textoCp1252(500).refine(
    (s) => s.trim().length >= 10,
    'Justificativa com ao menos 10 caracteres.',
  ),
});

// -------------------------------------------------------------------------------------------------------- fatos

export const esquemaFiltroFatos = z.object({
  empresa: z.number().int().positive().optional(),
  competencia: COMPETENCIA.optional(),
  origem: esquemaOrigemLancamento.optional(),
  tipoFato: esquemaTipoFato.optional(),
  situacao: esquemaSituacaoFato.optional(),
  pagina: z.number().int().min(1).default(1),
  tamanho: z.number().int().min(1).max(200).default(50),
});

/** Pedido de reprocessamento de um período aberto (regra 2: o resultado tem de ser idêntico). */
export const esquemaReprocessarPeriodo = z.object({
  empresa: z.number().int().positive(),
  competencia: COMPETENCIA,
  /** Só compara (não grava): o `pnpm contabil:reprocessar -- --conferir`. */
  somenteConferir: z.boolean().default(true),
});

export const esquemaLoteLeitura = z.object({
  tabela: z.string().regex(/^[A-Z_][A-Z0-9_$]*$/),
  tamanho: z.number().int().min(1).max(LOTE_FATOS_MAXIMO),
});
