// Trava da incisão (ficha do M46, regra 2; cap-05a §5.5): com a trava ligada para o bloco do estabelecimento, a hora da
// incisão não é aceita no novo sem a pausa cirúrgica (o time-out) concluída no checklist, e não pode ser anterior a ela;
// a exceção é só em urgência, registrada pelo supervisor com o motivo. A trava é ligada por bloco inteiro (chave
// `bloco.checklistTrava`), só com o bloco todo no novo: desligada, nada é conferido. Regras puras.
import type { RecusaBlocoSeguro } from '@sgh/contratos';
import { minutosDoInstante } from '../ficha/instante.js';
import type { ChecklistLido } from './checklist.js';

/** Caráter do agendamento (1 urgência, 2 eletiva, 3 acidente; null quando o agendamento não informa). */
export const CARATER_ELETIVA = 2;

export interface PedidoDeIncisao {
  readonly travaLigada: boolean;
  /** O agendamento do ato (null: o ato registrado sem agendamento). */
  readonly agendamento: number | null;
  /** "AAAA-MM-DDTHH:mm" da incisão informada (null: sem incisão no pedido, nada a conferir). */
  readonly incisao: string | null;
  readonly checklist: ChecklistLido | null;
  /** A sessão tem a permissão da exceção (supervisor)? Vale só para o ato sem agendamento. */
  readonly supervisor: boolean;
  /** Caráter do ato sem agendamento (o registro informa; a eletiva não tem exceção). */
  readonly carater?: number | null;
  /** Motivo da exceção do ato sem agendamento (ao menos 10 caracteres). */
  readonly motivo?: string | null;
}

/** Tamanho mínimo do motivo da exceção (o mesmo da exceção pelo checklist). */
export const MOTIVO_EXCECAO_MIN = 10;

export type DecisaoTrava =
  | { readonly ok: true; readonly por: 'desligada' | 'sem-incisao' | 'pausa' | 'excecao' | 'supervisor' }
  | { readonly ok: false; readonly codigo: RecusaBlocoSeguro };

/**
 * A decisão da trava. O ato sem agendamento (a urgência registrada direto, sem checklist possível) só passa com a
 * incisão informada pelo supervisor do bloco, como a exceção pelo checklist: só em urgência (a eletiva recusa) e com o
 * motivo (a trilha registra a exceção com ele).
 */
export function decidirTrava(p: PedidoDeIncisao): DecisaoTrava {
  if (!p.travaLigada) return { ok: true, por: 'desligada' };
  if (!p.incisao) return { ok: true, por: 'sem-incisao' };
  if (p.agendamento === null) {
    if (!p.supervisor) return { ok: false, codigo: 'incisao-sem-timeout' };
    if (p.carater === CARATER_ELETIVA) return { ok: false, codigo: 'excecao-so-urgencia' };
    if ((p.motivo ?? '').trim().length < MOTIVO_EXCECAO_MIN)
      return { ok: false, codigo: 'excecao-sem-motivo' };
    return { ok: true, por: 'supervisor' };
  }
  const c = p.checklist;
  if (c?.timeoutEm) {
    if (minutosDoInstante(p.incisao) < minutosDoInstante(c.timeoutEm))
      return c.excecaoEm ? { ok: true, por: 'excecao' } : { ok: false, codigo: 'incisao-antes-do-timeout' };
    return { ok: true, por: 'pausa' };
  }
  if (c?.excecaoEm) return { ok: true, por: 'excecao' };
  return { ok: false, codigo: 'incisao-sem-timeout' };
}

/** A exceção pode ser registrada? Só em urgência (a eletiva não tem), uma vez, e antes de a pausa ser concluída. */
export function conferirExcecao(c: ChecklistLido | null, carater: number | null): RecusaBlocoSeguro | null {
  if (carater === CARATER_ELETIVA) return 'excecao-so-urgencia';
  if (c?.excecaoEm) return 'excecao-ja-registrada';
  if (c?.timeoutEm) return 'excecao-timeout-concluido';
  return null;
}

/** A incisão do registro do ato (hora "HH:MM" no dia do ato) como instante local. */
export function instanteDaIncisao(data: string, hora: string | null): string | null {
  if (!hora || !/^([01]\d|2[0-3]):[0-5]\d$/.test(hora)) return null;
  return `${data}T${hora}`;
}
