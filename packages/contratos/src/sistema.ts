import { z } from 'zod';

/** Resposta de GET /api/saude. */
export const esquemaSaude = z.object({
  status: z.literal('ok'),
  em: z.iso.datetime(),
});
export type Saude = z.infer<typeof esquemaSaude>;

/**
 * Resposta de GET /api/versao. O nome do produto vem da configuração (PRODUTO_NOME, DP-49),
 * nunca de texto fixo; a versão é rastreável ao commit, ou à data do build quando não há git.
 */
export const esquemaVersao = z.object({
  produto: z.string().min(1),
  versao: z.string().min(1),
  commit: z.string().min(7).nullable(),
  construidoEm: z.iso.datetime(),
  identificacao: z.string().min(1),
});
export type Versao = z.infer<typeof esquemaVersao>;
