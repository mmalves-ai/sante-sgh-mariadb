// Etiqueta da amostra na coleta (ficha do M26, regra 3; cap-09 §9.8): ZPL de 50 × 25 mm com o Code 128 do código único
// da amostra, o nome completo e a data de nascimento (os dois identificadores), o prontuário, o atendimento e os exames.
// Vai à fila da impressora da estação (o agente local imprime na hora da coleta).
import type { ExameSadt } from '@sgh/contratos';
import { zplEtiquetaAmostra } from '@sgh/dominio-documento';

/** A etiqueta ZPL da amostra (Code 128 com o código; nome, nascimento, prontuário, atendimento e os exames). */
export function etiquetaDaAmostra(codigo: string, e: ExameSadt, exames: readonly ExameSadt[]): string {
  return zplEtiquetaAmostra({
    nomeCompleto: e.paciente.nome || 'PACIENTE',
    nascimento: e.paciente.nascimento ?? '',
    prontuario: Math.max(1, e.paciente.prontuario),
    atendimento: Math.max(1, e.atendimento.reg),
    amostra: codigo,
    exame: exames.map((x) => x.exame.codigo).join(' '),
  });
}
