// Marca da sessão "como" que a casca recebe em GET /api/sessao (ADR 0021). Arquivo sem dependência de
// sessao.ts: sessao.ts o importa (a casca mostra a faixa fixa com "Voltar à minha conta").
import { z } from 'zod';

/** Tipo do ator real de uma sessão "como" (gravado na auditoria e na SGH_TRILHA). */
export const TIPOS_ATOR = ['plataforma', 'suporte'] as const;
export type TipoAtor = (typeof TIPOS_ATOR)[number];

/**
 * Modo da sessão aberta pela conta da plataforma (ADR 0021 e 0022): `como` (a sessão do ALVO, com as
 * permissões reais dele) ou `acesso-total` (só a PLATAFORMA: todas as permissões do catálogo, sem segregação;
 * o alvo é o usuário do SPDATA "em nome de quem gravar" nas escritas do legado).
 */
export const MODOS_COMO = ['como', 'acesso-total'] as const;
export type ModoComo = (typeof MODOS_COMO)[number];

/** Marca da sessão "como" (nunca o id da sessão nem token). */
export const esquemaComoSessao = z.object({
  ator: z.object({ tipo: z.enum(TIPOS_ATOR), email: z.string() }),
  alvo: z.object({ login: z.string(), nome: z.string() }),
  /** Fim absoluto da sessão (nunca renovado), ISO 8601. */
  expiraEm: z.string(),
  motivo: z.string().nullable(),
  /** ADR 0022: ausente = `como` (sessões abertas antes do 0022). */
  modo: z.enum(MODOS_COMO).optional(),
  /** Nome do estabelecimento (a faixa do acesso total: "… acesso total da plataforma em <estab>"). */
  estabelecimentoNome: z.string().optional(),
});

/** Texto fixo da faixa do acesso total (ponto único: casca e testes). */
export function faixaAcessoTotal(estabelecimento: string): string {
  return `Você está com acesso total da plataforma em ${estabelecimento}`;
}
export type ComoSessao = z.infer<typeof esquemaComoSessao>;

/** Rótulo do ator para o hospital: nunca nome, e-mail nem IP (regra 5). */
export const ROTULO_SUPORTE_PARA_HOSPITAL = 'Suporte técnico';

/**
 * Marca visível do registro feito numa sessão "como" (R1; regra 4): o ponto ÚNICO do texto, usado na
 * auditoria e no documento clínico emitido (M09), para que o papel não atribua ao alvo um ato que ele não fez.
 */
export function marcaSuporteTecnico(alvo: string): string {
  return `Registrado pelo suporte técnico em nome de ${alvo}`;
}
