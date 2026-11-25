// Corpo da impressão de documento do prontuário (01-ADM L82): a 1ª via leva a justificativa; a nova via, o motivo.
// Nos documentos do prontuário a nova via leva o motivo do catálogo de reimpressão (`motivoReimpressao`) e o
// complemento quando o motivo pede (01-ADM L79: um só caminho de motivo, com a via no registro de reimpressões).
// A obrigatoriedade e os mínimos são do domínio (regraJustificativaImpressao); aqui só o formato e o CP1252.
import { z } from 'zod';
import { textoCp1252 } from '../texto-cp1252.js';

export const esquemaImprimirDocumentoProntuario = z
  .object({
    justificativa: textoCp1252(200).optional(),
    motivo: textoCp1252(200).optional(),
    motivoReimpressao: z.number().int().positive().optional(),
    complemento: textoCp1252(500).optional(),
  })
  .strict();
export type ImprimirDocumentoProntuario = z.infer<typeof esquemaImprimirDocumentoProntuario>;

/** Um motivo ativo do catálogo de reimpressão, como a tela oferece. */
export interface MotivoReimpressaoAtivo {
  readonly id: number;
  readonly codigo: string;
  readonly descricao: string;
  readonly exigeComplemento: boolean;
}

/** As vias do documento do prontuário: se já saiu a 1ª (a próxima é nova via) e os motivos do catálogo. */
export interface ViasDocumentoProntuario {
  readonly impresso: boolean;
  readonly motivos: readonly MotivoReimpressaoAtivo[];
  /** Mínimo do complemento quando o motivo pede (regra do domínio, mandada à tela para validar na hora). */
  readonly complementoMinimo: number;
}
