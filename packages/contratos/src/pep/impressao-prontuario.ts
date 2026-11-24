// Corpo da impressão de documento do prontuário (01-ADM L82): a 1ª via leva a justificativa; a nova via, o motivo.
// A obrigatoriedade e os mínimos são do domínio (regraJustificativaImpressao); aqui só o formato e o CP1252.
import { z } from 'zod';
import { textoCp1252 } from '../texto-cp1252.js';

export const esquemaImprimirDocumentoProntuario = z
  .object({
    justificativa: textoCp1252(255).optional(),
    motivo: textoCp1252(255).optional(),
  })
  .strict();
export type ImprimirDocumentoProntuario = z.infer<typeof esquemaImprimirDocumentoProntuario>;
