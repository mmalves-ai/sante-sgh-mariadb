// Contexto do componente de alergia do formulário clínico (D-ALE-2): o paciente e o atendimento do registro em
// edição. A tela do registro fornece; o campo de alergia usa para gravar a alergia na hora (pep.registrarAlergia).
// Sem contexto (visualização, impressão, administração de modelos), o campo só informa.
import type { ComputedRef, InjectionKey } from 'vue';

export interface ContextoAlergiaFormulario {
  readonly paciente: number;
  readonly atendimento: number | null;
}

export const CONTEXTO_ALERGIA_FORMULARIO: InjectionKey<ComputedRef<ContextoAlergiaFormulario | null>> =
  Symbol('contexto-alergia-formulario');
