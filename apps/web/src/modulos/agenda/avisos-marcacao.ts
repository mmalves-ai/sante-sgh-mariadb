// 02-AGE 47: os avisos que a marcação devolve (texto do prazo ao paciente, regra da agenda ainda a confirmar, cota que
// só alerta) chegam a quem marca. A tela que marca guarda os avisos antes de abrir a ficha da marcação; a ficha os
// retira (uma vez só) e mostra.
import { ref } from 'vue';

const pendentes = ref<string[]>([]);

/** Os avisos do resultado da operação (uma linha por aviso). */
export function avisosDoResultado(resultado: Record<string, unknown>): string[] {
  const v = resultado['avisos'];
  return typeof v === 'string'
    ? v
        .split('\n')
        .map((x) => x.trim())
        .filter(Boolean)
    : [];
}

export function guardarAvisos(resultado: Record<string, unknown>): void {
  pendentes.value = avisosDoResultado(resultado);
}

export function retirarAvisos(): string[] {
  const l = pendentes.value;
  pendentes.value = [];
  return l;
}
