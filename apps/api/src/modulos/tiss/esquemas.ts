// Entradas das operações do pós-fechamento (M31) pelo nome da operação: o mesmo Zod dos contratos na memória e no
// banco (a porta própria declara as operações com estes esquemas; a memória valida com eles antes de aplicar).
import {
  esquemaFecharCompetencia,
  esquemaGerarLote,
  esquemaRegistrarGlosa,
  esquemaRegistrarProtocolo,
  esquemaRegistrarRecurso,
  esquemaRegistrarRetornoRecurso,
} from '@sgh/contratos';
import type { ZodType } from 'zod';

export const ENTRADAS_TISS: Readonly<Record<string, ZodType>> = {
  'faturamento.gerarLote': esquemaGerarLote,
  'faturamento.registrarProtocolo': esquemaRegistrarProtocolo,
  'faturamento.registrarGlosa': esquemaRegistrarGlosa,
  'faturamento.registrarRecurso': esquemaRegistrarRecurso,
  'faturamento.registrarRetornoRecurso': esquemaRegistrarRetornoRecurso,
  'faturamento.fecharCompetencia': esquemaFecharCompetencia,
};
