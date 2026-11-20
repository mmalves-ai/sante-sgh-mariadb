// Regra 7 da ficha do M20 (Portaria SAS 312/2002): a observação no pronto atendimento fica abaixo de 24 horas; o
// quadro avisa antes (parâmetro atendimento.observacaoAvisoHoras, padrão 20 h) e marca o excedido. Passou do limite:
// a saída da observação pede justificativa.
import { OBSERVACAO_AVISO_HORAS, OBSERVACAO_LIMITE_HORAS } from '@sgh/contratos';

export type AlertaObservacao = 'nenhum' | 'aviso' | 'excedido';

const H = 3_600_000;

/** Horas (uma casa) entre a entrada e a saída (ou agora). */
export function horasDeObservacao(entrada: string, ate: string): number {
  const e = Date.parse(entrada.endsWith('Z') ? entrada : `${entrada}Z`);
  const s = Date.parse(ate.endsWith('Z') ? ate : `${ate}Z`);
  if (!Number.isFinite(e) || !Number.isFinite(s)) return 0;
  return Math.max(0, Math.round(((s - e) / H) * 10) / 10);
}

export function alertaObservacao(
  horas: number,
  avisoHoras: number = OBSERVACAO_AVISO_HORAS,
): AlertaObservacao {
  if (horas >= OBSERVACAO_LIMITE_HORAS) return 'excedido';
  if (horas >= avisoHoras) return 'aviso';
  return 'nenhum';
}

export function exigeJustificativaSaida(horas: number): boolean {
  return horas >= OBSERVACAO_LIMITE_HORAS;
}
