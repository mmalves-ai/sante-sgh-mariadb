// Prescrição de lentes da oftalmologia (03-PEP linha 139): as prescrições do paciente pela internação, a emissão e o
// cancelamento com motivo (a gravação vai com o CSRF e a Idempotency-Key).
import { z } from 'zod';
import { enviar, ler } from '../exames/api-exames.js';

const E = '/api/especialidades/oftalmologia';
const num = z.number().nullable();
const esquemaOlho = z.object({
  esferico: num,
  cilindrico: num,
  eixo: num,
  prisma: num,
  basePrisma: z.enum(['interna', 'externa', 'superior', 'inferior']).nullable(),
  acuidade: z.string().nullable(),
});
export const esquemaPrescricaoLenteLida = z.object({
  id: z.number(),
  versao: z.number(),
  internacao: z.number().nullable(),
  prescritoEm: z.string(),
  tipo: z.enum(['oculos', 'lente_contato']),
  uso: z.enum(['longe', 'perto', 'intermediario', 'bifocal', 'multifocal']),
  od: esquemaOlho,
  oe: esquemaOlho,
  adicao: num,
  distanciaPupilarMm: num,
  curvaBase: num,
  diametro: num,
  validadeAte: z.string().nullable(),
  observacao: z.string().nullable(),
  situacao: z.enum(['rascunho', 'emitida', 'cancelada']),
  vigente: z.boolean(),
  profissional: z.string(),
  registroConselho: z.string().nullable(),
});
export type PrescricaoLenteLida = z.infer<typeof esquemaPrescricaoLenteLida>;
const esquemaLista = z.object({ hoje: z.string(), itens: z.array(esquemaPrescricaoLenteLida) });
const esquemaEmitida = z.object({
  ok: z.boolean(),
  id: z.number(),
  validadeAte: z.string(),
  mensagem: z.string(),
});
const esquemaCancelada = z.object({ ok: z.boolean(), id: z.number(), mensagem: z.string() });

export const lerLentes = (reg: number) => ler(`${E}/internacoes/${reg}/lentes`, esquemaLista);
export const emitirLente = (corpo: unknown, chave: string) =>
  enviar(`${E}/lentes`, corpo, esquemaEmitida, chave);
export const cancelarLente = (
  reg: number,
  id: number,
  corpo: { motivo: string; versao: number },
  chave: string,
) => enviar(`${E}/lentes/${id}/cancelamento?internacao=${reg}`, corpo, esquemaCancelada, chave);
