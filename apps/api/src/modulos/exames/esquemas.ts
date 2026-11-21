// Entradas das operações de gravação da agenda de exames (M18): o Zod do contrato de cada operação, comum à porta
// do banco (operacoes.ts, pelo Executor) e à memória de dev/ci, para as duas validarem igual.
// Melhoria: o esquema da operação é o do contrato da tela (antes vinha da receita do núcleo antigo).
import {
  esquemaAgendarExame,
  esquemaAgendarExameSemProntuario,
  esquemaCancelarExame,
  esquemaDefinirCoberturaExame,
  esquemaGerarGradeExame,
  esquemaRemarcarExame,
} from '@sgh/contratos';
import type { ZodType } from 'zod';

export const ESQUEMAS_OPERACAO_EXAME: Readonly<Record<string, ZodType>> = {
  'agenda.agendarExame': esquemaAgendarExame,
  'agenda.agendarExameSemProntuario': esquemaAgendarExameSemProntuario,
  'agenda.cancelarExame': esquemaCancelarExame,
  'agenda.remarcarExame': esquemaRemarcarExame,
  'agenda.gerarGradeExame': esquemaGerarGradeExame,
  'agenda.definirCoberturaExame': esquemaDefinirCoberturaExame,
};

/**
 * Operações construídas e ainda desligadas, com o motivo para a tela. A marcação sem prontuário espera o
 * pré-cadastro da recepção (pre_cadastro) ligado à marcação.
 */
export const OPERACOES_EXAME_DESLIGADAS: Readonly<Record<string, string>> = {
  'agenda.agendarExameSemProntuario':
    'a marcação sem prontuário depende do pré-cadastro da recepção, ainda não ligado à agenda de exames',
};
