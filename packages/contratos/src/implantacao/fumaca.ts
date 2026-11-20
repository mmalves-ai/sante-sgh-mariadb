// M60, etapa 3 (testes pós-implantação): o contrato da fumaça do servidor e da verificação pós-implantação.
// A fumaça do servidor é o que a própria instância confere de si (fuso e relógio contra o banco, Valkey, worker e
// filas, impressão digital da parte legada contra a homologada, chaves de liberação); a verificação pós-implantação
// (`pnpm implantacao:verificar`) junta essa fumaça com as sondas do M38, a conferência da instalação do M60.2, os
// serviços do systemd e o HTTPS com os cabeçalhos, e grava o relatório. Só leitura; só códigos e contagens: nada de
// pessoa (as chaves por pessoa saem contadas, nunca com o login), de senha nem de endereço.
import { z } from 'zod';
import { SITUACOES_ITEM_CONFERENCIA } from './instalacao.js';

/** A fumaça do servidor na Saúde do sistema (mesma permissão da conferência, D-PERM-60.2). */
export const ROTA_FUMACA_IMPLANTACAO = '/api/administracao/implantacao/fumaca';

/** A mesma fumaça sem sessão, só com x-sonda-token = SONDA_TOKEN (sem ele, 404), para `implantacao:verificar`. */
export const ROTA_SONDA_FUMACA = '/api/sistema/sonda/fumaca';

/** Fuso obrigatório dos processos do servidor (D-TZ-60.2). */
export const FUSO_DO_SERVIDOR = 'UTC';

/** Deriva máxima aceita entre o relógio do servidor de aplicação e o do banco, já descontado o fuso (ms). */
export const DERIVA_MAXIMA_MS = 5_000;
/** Acima disto, alerta (o NTP de um dos lados está atrasando). */
export const DERIVA_ALERTA_MS = 1_000;

/** Itens da fumaça do servidor, na ordem em que aparecem. */
export const ITENS_FUMACA_SERVIDOR = [
  'fuso',
  'relogio',
  'hora-confiavel',
  'valkey',
  'worker',
  'filas',
  'impressao-digital',
  'chaves',
] as const;
export type ItemFumacaServidor = (typeof ITENS_FUMACA_SERVIDOR)[number];

export const esquemaItemFumaca = z.object({
  codigo: z.string().min(1),
  titulo: z.string().min(1),
  situacao: z.enum(SITUACOES_ITEM_CONFERENCIA),
  detalhe: z.string(),
});
export type ItemFumaca = z.infer<typeof esquemaItemFumaca>;

export const esquemaRelogioConferido = z.object({
  /** Relógio do servidor de aplicação (ISO, UTC). */
  servidorEm: z.string(),
  /** O fuso do processo (variável TZ; o que o Node resolveu). */
  fuso: z.string(),
  /** Hora de parede do banco (CURRENT_TIMESTAMP do Firebird, sem fuso): AAAA-MM-DDTHH:mm:ss.sss; nula se não leu. */
  bancoLocal: z.string().nullable(),
  /** O fuso do servidor do banco deduzido (minutos em relação ao UTC, múltiplo de 15); nulo se não leu. */
  fusoBancoMin: z.number().int().nullable(),
  /** Deriva entre os relógios já descontado o fuso (ms, com sinal: positivo = banco adiantado). */
  derivaMs: z.number().int().nullable(),
});
export type RelogioConferido = z.infer<typeof esquemaRelogioConferido>;

export const REFERENCIAS_HORA = ['ntp', 'sem-referencia'] as const;

/**
 * W0-09 (M2): hora confiável. O desvio do relógio do servidor da API e do banco contra o NTP (NTP.br por padrão);
 * sem resposta do NTP, `referencia` = 'sem-referencia' e os desvios ficam nulos. O fuso da instituição só muda a
 * exibição: a hora se grava em UTC.
 */
export const esquemaHoraConfiavel = z.object({
  servidorNtp: z.string(),
  referencia: z.enum(REFERENCIAS_HORA),
  /** A hora do NTP no meio da consulta (ISO, UTC); nula sem referência. */
  ntpEm: z.string().nullable(),
  /** Desvio do relógio do servidor da API contra o NTP (ms, positivo = adiantado). */
  desvioServidorMs: z.number().int().nullable(),
  /** Desvio do relógio do banco contra o NTP, já descontado o fuso do banco (ms, positivo = adiantado). */
  desvioBancoMs: z.number().int().nullable(),
  limiarMs: z.number().int().positive(),
  fusoInstituicao: z.string(),
  /** O instante da conferência exibido no fuso da instituição (DD/MM/AAAA HH:mm:ss). */
  exibidoNoFuso: z.string(),
});
export type HoraConfiavel = z.infer<typeof esquemaHoraConfiavel>;

export const esquemaValkeyConferido = z.object({
  configurado: z.boolean(),
  responde: z.boolean(),
  latenciaMs: z.number().int().nonnegative().nullable(),
});
export type ValkeyConferido = z.infer<typeof esquemaValkeyConferido>;

/** Filas do BullMQ que a fumaça confere (o nome real leva a rede: email-<rede>, relatorio-<rede>). */
export const FILAS_CONFERIDAS = ['email', 'relatorio'] as const;
export type FilaConferidaCodigo = (typeof FILAS_CONFERIDAS)[number];

export const esquemaFilaConferida = z.object({
  codigo: z.enum(FILAS_CONFERIDAS),
  /** Consumidores conectados (workers do BullMQ); nulo se o Valkey não respondeu. */
  consumidores: z.number().int().nonnegative().nullable(),
  aguardando: z.number().int().nonnegative().nullable(),
  ativos: z.number().int().nonnegative().nullable(),
  atrasados: z.number().int().nonnegative().nullable(),
  falhas: z.number().int().nonnegative().nullable(),
});
export type FilaConferida = z.infer<typeof esquemaFilaConferida>;

export const ESTADOS_IMPRESSAO = ['homologado', 'divergente', 'sem-homologacao', 'indisponivel'] as const;

export const esquemaImpressaoConferida = z.object({
  /** Nulo: a verificação de estrutura ainda não rodou neste processo. */
  estado: z.enum(ESTADOS_IMPRESSAO).nullable(),
  /** Os 16 primeiros caracteres do resumo atual e do homologado (comparáveis a olho no relatório). */
  resumo: z.string().nullable(),
  resumoHomologado: z.string().nullable(),
  verificadaEm: z.string().nullable(),
  /** Tabelas do sistema anterior com escrita bloqueada pela divergência. */
  tabelasBloqueadas: z.number().int().nonnegative(),
  bloqueiaTudo: z.boolean(),
});
export type ImpressaoConferida = z.infer<typeof esquemaImpressaoConferida>;

export const esquemaChaveLigada = z.object({
  tipo: z.enum(['operacao', 'recurso']),
  chave: z.string(),
  /** Linhas ligadas por escopo (contagens; o valor do escopo pessoa nunca sai). */
  hospital: z.number().int().nonnegative(),
  setor: z.number().int().nonnegative(),
  grupo: z.number().int().nonnegative(),
  pessoa: z.number().int().nonnegative(),
});
export type ChaveLigada = z.infer<typeof esquemaChaveLigada>;

export const esquemaChavesConferidas = z.object({
  /** Falso: a leitura de SGH_CFG_LIBERACAO falhou (o item sai em falha). */
  lidas: z.boolean(),
  ligadas: z.array(esquemaChaveLigada),
  /**
   * As chaves que podem estar ligadas (IMPLANTACAO_CHAVES_ESPERADAS; M61, liberação full: `*` com as exceções `!x`, o
   * padrão da instalação; vazio: nenhuma).
   */
  esperadas: z.array(z.string()),
  /** Ligadas fora da lista esperada. */
  inesperadas: z.array(z.string()),
});
export type ChavesConferidas = z.infer<typeof esquemaChavesConferidas>;

export const esquemaFumacaServidor = z.object({
  hospital: z.string(),
  em: z.string(),
  ambiente: z.string(),
  relogio: esquemaRelogioConferido,
  horaConfiavel: esquemaHoraConfiavel,
  valkey: esquemaValkeyConferido,
  filas: z.array(esquemaFilaConferida),
  impressao: esquemaImpressaoConferida,
  chaves: esquemaChavesConferidas,
  itens: z.array(esquemaItemFumaca),
  situacao: z.enum(SITUACOES_ITEM_CONFERENCIA),
});
export type FumacaServidor = z.infer<typeof esquemaFumacaServidor>;

/**
 * Itens do relatório de `pnpm implantacao:verificar`, na ordem do manual (seção 8, testes pós-implantação). Cada um
 * vira uma linha do relatório com a situação e o que fazer se falhar.
 */
export const ITENS_VERIFICACAO_IMPLANTACAO = [
  'servicos',
  'https',
  'cabecalhos',
  'saude-api',
  'versao',
  'login-sonda',
  'conexao-banco',
  'scripts-sgh',
  'impressao-digital',
  'consultas-ao-vivo',
  'chaves',
  'worker-filas',
  'valkey',
  'fuso-relogio',
] as const;
export type ItemVerificacaoImplantacao = (typeof ITENS_VERIFICACAO_IMPLANTACAO)[number];

/** Cabeçalhos de segurança que o nginx do pacote põe em toda resposta (deploy/ubuntu, M60.2). */
export const CABECALHOS_SEGURANCA = [
  'strict-transport-security',
  'x-content-type-options',
  'x-frame-options',
  'referrer-policy',
  'content-security-policy',
  'permissions-policy',
] as const;

export const esquemaItemVerificacao = esquemaItemFumaca.extend({
  codigo: z.enum(ITENS_VERIFICACAO_IMPLANTACAO),
  /** O que fazer se falhar (a seção do manual que trata do item). */
  seFalhar: z.string(),
});
export type ItemVerificacao = z.infer<typeof esquemaItemVerificacao>;

export const esquemaRelatorioVerificacao = z.object({
  hospital: z.string(),
  endereco: z.string(),
  em: z.string(),
  duracaoMs: z.number().int().nonnegative(),
  versaoEsperada: z.string().nullable(),
  itens: z.array(esquemaItemVerificacao),
  situacao: z.enum(SITUACOES_ITEM_CONFERENCIA),
});
export type RelatorioVerificacao = z.infer<typeof esquemaRelatorioVerificacao>;
