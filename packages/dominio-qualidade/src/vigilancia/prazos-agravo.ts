// Prazo da notificação compulsória (ficha do M48, regra 3; Portaria de consolidação nº 4/2017, anexo V, art. 2º e
// lista nacional): imediata em até 24 horas do conhecimento da suspeita; semanal em até 7 dias. Contado em horas
// corridas (a imediata vale em fim de semana e feriado; a semanal também é corrida), sobre o instante local do gatilho
// (o Brasil não tem horário de verão desde 2019), como os prazos do NSP.
import {
  type EstadoPrazoAgravo,
  horasDaPeriodicidade,
  type PeriodicidadeAgravo,
  type SituacaoCasoAgravo,
} from '@sgh/contratos';
import { instanteDeMs, msLocal } from '../nsp/prazos.js';

const HORA_MS = 3_600_000;

/** Antecedência do aviso "vencendo": 6 horas na imediata, 24 horas na semanal. */
export const AVISO_AGRAVO_HORAS: Readonly<Record<PeriodicidadeAgravo, number>> = { imediata: 6, semanal: 24 };

/** O instante-limite da notificação (texto local `AAAA-MM-DDTHH:mm:ss`). */
export function prazoDoAgravo(periodicidade: PeriodicidadeAgravo, gatilhoEm: string): string {
  return instanteDeMs(msLocal(gatilhoEm) + horasDaPeriodicidade(periodicidade) * HORA_MS);
}

/** Horas inteiras até o prazo (para baixo; negativas depois dele). */
export function horasAtePrazo(prazoEm: string, agora: string): number {
  return Math.floor((msLocal(prazoEm) - msLocal(agora)) / HORA_MS);
}

/**
 * Estado do prazo: o caso notificado no prazo ou depois é `cumprido` (o atraso fica na trilha e no relatório, não
 * reabre); o descartado não tem prazo; o aberto vence em `prazoEm`.
 */
export function estadoPrazoAgravo(
  periodicidade: PeriodicidadeAgravo,
  prazoEm: string,
  agora: string,
  situacao: SituacaoCasoAgravo,
): { readonly estado: EstadoPrazoAgravo; readonly horasRestantes: number | null } {
  if (situacao === 'notificado') return { estado: 'cumprido', horasRestantes: null };
  if (situacao === 'descartado') return { estado: 'naoSeAplica', horasRestantes: null };
  const ms = msLocal(prazoEm) - msLocal(agora);
  const horas = Math.floor(ms / HORA_MS);
  if (ms < 0) return { estado: 'vencido', horasRestantes: horas };
  return {
    estado: ms <= AVISO_AGRAVO_HORAS[periodicidade] * HORA_MS ? 'vencendo' : 'noPrazo',
    horasRestantes: horas,
  };
}

/** A notificação saiu depois do prazo (para o relatório e o aviso na tela; não impede o registro). */
export function notificadoComAtraso(prazoEm: string, notificadoEm: string): boolean {
  return msLocal(notificadoEm) > msLocal(prazoEm);
}
