// 02-CAD linha 13: a linha do paciente lida pelas portas próprias (falecido, situação e data do óbito) no vocabulário
// neutro da regra do domínio que recusa a entrada de paciente falecido (@sgh/dominio-atendimento).
import type { VidaDoPaciente } from '@sgh/dominio-atendimento';

export function vidaDoPaciente(linha: Record<string, unknown>): VidaDoPaciente {
  const f = linha['falecido'];
  const d = linha['data_hora_obito'];
  return {
    falecido: f === true || f === 1 || f === '1' || f === 1n,
    situacao: linha['situacao'] == null ? null : String(linha['situacao']),
    dataObito:
      d instanceof Date ? (Number.isNaN(d.getTime()) ? null : d.toISOString()) : d == null ? null : String(d),
  };
}
