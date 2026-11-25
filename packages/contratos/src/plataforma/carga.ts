// Tela "Carga e sincronismo" do painel técnico da plataforma (obra carga-painel, 2026-11-24; ADR 0010): seleção do
// conector Firebird do cliente, configuração da origem de servidor (senha só no cofre, nunca na resposta), carga
// completa ou diferencial, pausa e retomada, progresso ao vivo e log da execução. Só agregados: contagens por tabela
// de destino e por regra; nunca valores de linha nem nomes do sistema de origem.
import { z } from 'zod';
import {
  ESTADOS_EXECUCAO_CONECTOR,
  TIPOS_EXECUCAO_CONECTOR,
  TIPOS_ORIGEM_CONECTOR,
  esquemaCodigoCliente,
} from './onboarding.js';

const contagem = z.number().int().nonnegative();

export const MODOS_CARGA = ['completa', 'diferencial'] as const;
export type ModoCarga = (typeof MODOS_CARGA)[number];

/** Situação da base (`contadores.progresso.base`): quanto da origem já está no banco do cliente. Calculada uma vez
 * por execução, depois do plano, a partir do resumo por tabela do conector; sobe com as gravadas. */
export const esquemaBaseCarga = z.object({
  linhasOrigem: contagem.default(0),
  linhasNaBase: contagem.default(0),
  linhasRecusadas: contagem.default(0),
  linhasFaltam: contagem.default(0),
  tabelas: contagem.default(0),
  tabelasLidasNesta: contagem.default(0),
  /** Tabelas do plano sem situação conhecida (contam como faltantes). */
  tabelasSemSituacao: contagem.default(0),
  calculoMs: contagem.nullish(),
  calculadaEm: z.string().nullish(),
  /** Até 20 tabelas de destino com mais linhas faltando. */
  porTabelaTop: z
    .array(
      z.object({
        tabela: z.string(),
        linhasOrigem: contagem,
        naBase: contagem,
        recusadas: contagem,
        faltam: contagem,
      }),
    )
    .max(20)
    .optional(),
});
export type BaseCarga = z.infer<typeof esquemaBaseCarga>;

/** `contadores.progresso` gravado pelo motor a cada batimento (≤ 15 s). Percentual geral = linhasProcessadas /
 * linhasTotal (por linhas). Os contadores principais valem 0 quando ausentes. */
export const esquemaProgressoCarga = z.object({
  tabelaAtual: z.string().nullish(),
  tabelaOrigemLinhas: contagem.nullish(),
  tabelaProcessadas: contagem.nullish(),
  onda: contagem.nullish(),
  ondas: contagem.nullish(),
  tabelasFeitas: contagem.default(0),
  tabelasTotal: contagem.default(0),
  linhasTotal: contagem.default(0),
  linhasProcessadas: contagem.default(0),
  gravadas: contagem.default(0),
  puladasIguais: contagem.default(0),
  recusadas: contagem.default(0),
  pendenciasAviso: contagem.default(0),
  /** Recusas por regra (ex.: `restricao_destino_1048`). */
  recusasPorRegra: z.record(z.string(), contagem).optional(),
  /** Até 20 tabelas de destino com mais recusas. */
  recusasPorTabela: z
    .array(z.object({ tabela: z.string(), recusadas: contagem }))
    .max(20)
    .optional(),
  atualizadoEm: z.string().nullish(),
  /** `contagem` no preparo (contagem das tabelas da origem), antes do plano. */
  etapa: z.string().nullish(),
  /** Tabela sendo contada no preparo: nome de destino ou "tabela N de M" (nunca o nome da origem). */
  tabelaContando: z.string().nullish(),
  tabelasContadas: contagem.nullish(),
  /** Situação da base; ausente nas execuções antigas (a tela cai no andamento da execução). */
  base: esquemaBaseCarga.nullish(),
});
export type ProgressoCarga = z.infer<typeof esquemaProgressoCarga>;

/** Ações que a tela pode oferecer agora (calculadas pela API a partir do estado). */
export const esquemaAcoesCarga = z.object({
  iniciar: z.boolean(),
  pausar: z.boolean(),
  retomar: z.boolean(),
});
export type AcoesCarga = z.infer<typeof esquemaAcoesCarga>;

/** Execução resumida para a tela de carga. */
export const esquemaExecucaoCargaResumo = z.object({
  id: z.number().int(),
  tipo: z.enum(TIPOS_EXECUCAO_CONECTOR),
  modo: z.enum(MODOS_CARGA).nullable(),
  estado: z.enum(ESTADOS_EXECUCAO_CONECTOR),
  etapa: z.string().nullable(),
  percentual: z.number(),
  motivoFalha: z.string().nullable(),
  solicitadoEm: z.string().nullable(),
  iniciadoEm: z.string().nullable(),
  concluidoEm: z.string().nullable(),
  batimentoEm: z.string().nullable(),
  pausaSolicitadaEm: z.string().nullable(),
  /** Há log da execução para baixar (`GET clientes/:codigo/carga/:id/log`). */
  temLog: z.boolean(),
});
export type ExecucaoCargaResumo = z.infer<typeof esquemaExecucaoCargaResumo>;

/** Resposta do `GET plataforma/carga/clientes/:codigo/carga`: execução ativa ou, sem ativa, a última. */
export const esquemaCargaCliente = z.object({
  codigo: esquemaCodigoCliente,
  execucao: esquemaExecucaoCargaResumo.nullable(),
  progresso: esquemaProgressoCarga.nullable(),
  /** Execução ativa sem batimento há mais de 3 minutos. */
  batimentoAtrasado: z.boolean(),
  /** Resumo da conciliação da carga: `conferido=false` quando há recusadas. */
  conciliacaoCarga: z.object({ recusadas: contagem, conferido: z.boolean() }).nullable().optional(),
  acoes: esquemaAcoesCarga,
});
export type CargaCliente = z.infer<typeof esquemaCargaCliente>;

/** Origem de servidor como volta da API: sem a senha (só se ela está definida no cofre). */
export const esquemaOrigemServidor = z.object({
  host: z.string(),
  porta: z.number().int().min(1).max(65535),
  banco: z.string(),
  usuario: z.string(),
  nomeExibicao: z.string().nullable(),
  senhaDefinida: z.boolean(),
});
export type OrigemServidor = z.infer<typeof esquemaOrigemServidor>;

/** `PUT plataforma/carga/clientes/:codigo/origem-servidor`. A senha é opcional na alteração (mantém a do cofre) e vai
 * só para o cofre; nunca volta. */
export const esquemaOrigemServidorEntrada = z
  .object({
    host: z
      .string()
      .trim()
      .min(1)
      .max(255)
      .regex(/^[A-Za-z0-9.:_-]+$/, 'host inválido'),
    porta: z.number().int().min(1).max(65535),
    banco: z
      .string()
      .trim()
      .min(1)
      .max(500)
      .refine((s) => !/[\0\r\n]/.test(s), 'banco inválido'),
    usuario: z
      .string()
      .trim()
      .min(1)
      .max(63)
      .regex(/^[A-Za-z0-9_$]+$/, 'usuário inválido'),
    senha: z.string().min(1).max(200).optional(),
    nomeExibicao: z.string().trim().min(1).max(120),
  })
  .strict();
export type OrigemServidorEntrada = z.infer<typeof esquemaOrigemServidorEntrada>;

/** Resultado do `POST .../origem-servidor/testar` (ponte para `conector.sh testar-origem`): só agregados. */
export const esquemaTesteOrigem = z.object({
  ok: z.boolean(),
  versaoServidor: z.string().nullable(),
  ods: z.string().nullable(),
  tabelas: contagem.nullable(),
  mensagem: z.string(),
});
export type TesteOrigem = z.infer<typeof esquemaTesteOrigem>;

/** `POST plataforma/carga/clientes/:codigo/carga`. */
export const esquemaPedirCargaEntrada = z.object({ modo: z.enum(MODOS_CARGA) }).strict();
export type PedirCargaEntrada = z.infer<typeof esquemaPedirCargaEntrada>;

/** Um conector (cliente) na seleção da tela. */
export const esquemaConectorCarga = z.object({
  codigo: esquemaCodigoCliente,
  nome: z.string(),
  origem: z
    .object({
      tipo: z.enum(TIPOS_ORIGEM_CONECTOR),
      nomeExibicao: z.string().nullable(),
      /** Endereço legível: `host:porta/banco` (servidor) ou o caminho relativo (arquivo). Nunca a senha. */
      endereco: z.string(),
      /** Só servidor: a senha está definida no cofre. */
      senhaDefinida: z.boolean().nullable(),
    })
    .nullable(),
  ultimaExecucao: esquemaExecucaoCargaResumo.nullable(),
});
export type ConectorCarga = z.infer<typeof esquemaConectorCarga>;

/** Resposta do `GET plataforma/carga/conectores`. */
export const esquemaListaConectores = z.object({ conectores: z.array(esquemaConectorCarga) });
export type ListaConectores = z.infer<typeof esquemaListaConectores>;
