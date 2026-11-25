// 02-REC linha 33 (C2-005): contrato do cadastro dos locais de atendimento de cada recepção e dos encaminhamentos
// permitidos entre locais. Vocabulário neutro (booleano, id, texto). As regras de negócio moram em
// @sgh/dominio-recepcao (locais-atendimento.ts); aqui só a forma do pedido e da resposta.
import { z } from 'zod';

const id = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);
const versao = z.number().int().positive();

export const esquemaIncluirLocalAtendimento = z
  .object({
    codigo: z.string().trim().min(1).max(30),
    descricao: z.string().trim().min(1).max(150),
    permiteEncaminhamento: z.boolean(),
    baseTempoEspera: z.boolean(),
    reavaliacaoMedica: z.boolean(),
    canalAudio: z
      .string()
      .max(40)
      .nullable()
      .transform((v) => (v === null || v.trim() === '' ? null : v.trim())),
  })
  .strict();
export const esquemaAlterarLocalAtendimento = esquemaIncluirLocalAtendimento.extend({ versao }).strict();

/** A lista inteira de destinos do local (substitui a anterior; o que sai fica marcado, nunca apagado). */
export const esquemaDestinosEncaminhamento = z.object({ destinos: z.array(id).max(200), versao }).strict();

export type IncluirLocalAtendimento = z.infer<typeof esquemaIncluirLocalAtendimento>;
export type AlterarLocalAtendimento = z.infer<typeof esquemaAlterarLocalAtendimento>;
export type DestinosEncaminhamento = z.infer<typeof esquemaDestinosEncaminhamento>;

export const esquemaLocalDaEstrutura = z.object({
  id,
  pontoId: id,
  codigo: z.string(),
  descricao: z.string(),
  permiteEncaminhamento: z.boolean(),
  baseTempoEspera: z.boolean(),
  reavaliacaoMedica: z.boolean(),
  canalAudio: z.string().nullable(),
  ativo: z.boolean(),
  versao,
  /** Locais para onde este encaminha (vigentes). */
  destinos: z.array(id),
});
export const esquemaLocaisDaRecepcao = z.object({
  pontos: z.array(z.object({ id, codigo: z.string(), descricao: z.string(), ativo: z.boolean() })),
  locais: z.array(esquemaLocalDaEstrutura),
});
export type LocalDaEstrutura = z.infer<typeof esquemaLocalDaEstrutura>;
export type LocaisDaRecepcao = z.infer<typeof esquemaLocaisDaRecepcao>;
