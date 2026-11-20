// Quebra de vidro (M06, regra 8; cap-08 §8.5): o pedido que o diálogo envia. A justificativa é texto do
// profissional, restrito ao CP1252 (mesmo validador na tela e no servidor); a senha é a reautenticação.
import { z } from 'zod';
import { textoCp1252 } from '../texto-cp1252.js';

export const MOTIVOS_QUEBRA_DE_VIDRO = [
  'intercorrencia-outro-setor',
  'parada-cardiorrespiratoria',
  'interconsulta-sem-registro',
  'transferencia-em-andamento',
  'outro',
] as const;

export const esquemaPedidoEmergencia = z.object({
  idPaciente: z.number().int().positive(),
  atendimento: z.number().int().positive().optional(),
  motivo: z.enum(MOTIVOS_QUEBRA_DE_VIDRO),
  justificativa: textoCp1252(500).pipe(z.string().trim().min(15)),
  senha: z.string().min(1).max(64),
});
export type PedidoEmergencia = z.infer<typeof esquemaPedidoEmergencia>;

export const esquemaEmergenciaAberta = z.object({
  id: z.string(),
  inicio: z.string(),
  fim: z.string(),
  alerta: z.enum(['enfileirado', 'sem-fila']),
});
export type EmergenciaAberta = z.infer<typeof esquemaEmergenciaAberta>;
