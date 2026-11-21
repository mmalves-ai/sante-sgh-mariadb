// Operações de gravação da farmácia (M29) pelo Executor: o nome da operação e o Zod da entrada (contrato das telas).
// A porta em memória aplica o mesmo Zod; a porta própria grava cada uma no banco do cliente (gravador-dispensacao.ts e,
// para a avaliação pelo horário, gravador-avaliacao.ts), numa operação do Executor com trilha, outbox e idempotência.
import {
  esquemaAvaliarPrescricao,
  esquemaCancelarDispensacao,
  esquemaConfirmarEntrega,
  esquemaDevolverDose,
  esquemaDispensarHorario,
  esquemaRegistrarPerdaControlado,
} from '@sgh/contratos';
import type { ZodType } from 'zod';

export const ENTRADAS_FARMACIA: Readonly<Record<string, ZodType>> = {
  'suprimentos.dispensarHorario': esquemaDispensarHorario,
  'suprimentos.confirmarEntrega': esquemaConfirmarEntrega,
  'suprimentos.devolverDose': esquemaDevolverDose,
  'suprimentos.cancelarDispensacao': esquemaCancelarDispensacao,
  'suprimentos.registrarPerdaControlado': esquemaRegistrarPerdaControlado,
  'suprimentos.avaliarPrescricao': esquemaAvaliarPrescricao,
};
