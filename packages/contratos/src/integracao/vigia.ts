// Contratos do vigia de mudanças (M16; ficha, regra 15; cap-09 §9.9; cap-10 §10.6): uma consulta leve por canal e
// estabelecimento a cada 1 a 2 s, qualquer que seja o número de telas abertas, publica que algo mudou; a tela relê.
// Sem trigger novo no banco. O evento só diz o canal e uma versão (nunca a linha que mudou nem dado de pessoa).
import { z } from 'zod';

export const CANAIS_VIGIA = ['leitos', 'senhas', 'dispensacao', 'bloco'] as const;
export type CanalVigia = (typeof CANAIS_VIGIA)[number];

/** Faixa do intervalo do ciclo (ficha: 1 a 2 s). */
export const INTERVALO_VIGIA_MIN_MS = 1_000;
export const INTERVALO_VIGIA_MAX_MS = 2_000;
export const INTERVALO_VIGIA_PADRAO_MS = 1_500;

export const esquemaEventoVigia = z.object({
  canal: z.enum(CANAIS_VIGIA),
  estabelecimento: z.string(),
  /** Versão do canal neste processo (cresce a cada mudança vista). */
  versao: z.number().int().min(0),
  /** Momento do ciclo que viu a mudança (ISO). */
  em: z.string(),
});
export type EventoVigia = z.infer<typeof esquemaEventoVigia>;

export const esquemaSaudeCanalVigia = z.object({
  canal: z.enum(CANAIS_VIGIA),
  estabelecimento: z.string(),
  ligado: z.boolean(),
  intervaloMs: z.number().int(),
  ciclos: z.number().int(),
  /** Consultas ao banco no último ciclo (a carga fixa: 1, qualquer que seja o número de telas). */
  consultasUltimoCiclo: z.number().int(),
  consultasTotais: z.number().int(),
  mudancas: z.number().int(),
  erros: z.number().int(),
  assinantes: z.number().int(),
  ultimoCiclo: z.string().nullable(),
  ultimaMudanca: z.string().nullable(),
  /** Atraso desde o último ciclo bem-sucedido (ms); null antes do primeiro. */
  atrasoMs: z.number().int().nullable(),
  duracaoUltimoMs: z.number().int().nullable(),
  /** A marca d'água foi perdida e as tabelas pequenas foram relidas inteiras (vezes). */
  releituras: z.number().int(),
});
export type SaudeCanalVigia = z.infer<typeof esquemaSaudeCanalVigia>;

export const esquemaSaudeVigia = z.object({
  canais: z.array(esquemaSaudeCanalVigia),
  marcaDagua: z.enum(['valkey', 'memoria']),
});
export type SaudeVigia = z.infer<typeof esquemaSaudeVigia>;
