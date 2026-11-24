// Retenção do exame na bancada pelo mapa de trabalho (F3.5, 05-SADT linha 8).
import { z } from 'zod';
import { enviar } from '../exames/api-exames.js';

const esquemaRetencao = z.object({
  id: z.number(),
  exame: z.number(),
  lote: z.string(),
  situacao: z.enum(['retido', 'pendente']),
});
export type RetencaoNaBancada = z.infer<typeof esquemaRetencao>;

export const reterExame = (exame: number, motivo: string, chave: string): Promise<RetencaoNaBancada> =>
  enviar('/api/sadt/mapa-trabalho/reter', { exame, motivo }, esquemaRetencao, chave);

export const soltarExame = (exame: number, chave: string): Promise<RetencaoNaBancada> =>
  enviar('/api/sadt/mapa-trabalho/soltar', { exame }, esquemaRetencao, chave);
