// Operações de gravação da farmácia (M29) pelo Executor: o nome da operação e o Zod da entrada (contrato das telas).
// A porta em memória aplica o mesmo Zod; a porta própria recusa com 'modelo-pendente' as que ainda não gravam no banco próprio.
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
