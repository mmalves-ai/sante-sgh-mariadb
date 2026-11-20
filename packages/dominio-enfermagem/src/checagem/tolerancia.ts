// Tolerância e estado do horário no turno (ficha do M25, regra 3; cap-05b §5.8; ref 04 §6.1): a tolerância é por
// unidade e classe (padrão 60 minutos, do parâmetro de tolerância do estabelecimento, 01:00; a classe de tempo crítico
// tem a dela). Fora da tolerância a dose ainda não checada fica "atrasada"; sem checagem até o fim do turno, "omitida"
// (vai para o indicador e para a passagem de plantão). As situações do horário são sensíveis a maiúsculas.
import type { EstadoHorario } from '@sgh/contratos';
import { diferencaMinutos, minutos } from '../tempo.js';

export const TOLERANCIA_PADRAO_MINUTOS = 60;

/** A tolerância do horário: a da classe de tempo crítico, quando o item é de alta vigilância ou antimicrobiano. */
export function toleranciaDaClasse(t: {
  readonly geral: number;
  readonly tempoCritico: number;
  readonly altaVigilancia: boolean;
  readonly antimicrobiano?: boolean;
}): number {
  return t.altaVigilancia || t.antimicrobiano ? Math.min(t.geral, t.tempoCritico) : t.geral;
}

/** O ato está dentro da tolerância do previsto (antes ou depois)? Limite inclusivo (60 minutos: dentro; 61: fora). */
export function dentroDaTolerancia(previsto: string, ato: string, toleranciaMinutos: number): boolean {
  return Math.abs(diferencaMinutos(previsto, ato)) <= toleranciaMinutos;
}

/** Minutos de atraso além da tolerância (0 dentro dela; antes do previsto também 0). */
export function atrasoAlemDaTolerancia(previsto: string, agora: string, toleranciaMinutos: number): number {
  return Math.max(0, diferencaMinutos(previsto, agora) - toleranciaMinutos);
}

/** Regra 3: o estado do horário no turno. */
export function estadoDoHorario(h: {
  readonly situacao: string;
  readonly previsto: string;
  readonly agora: string;
  readonly toleranciaMinutos: number;
  /** Fim do turno em que o horário caiu (a omissão fecha no fim do turno). */
  readonly fimDoTurno: string;
}): EstadoHorario {
  switch (h.situacao) {
    case 'A':
      return 'administrada';
    case 'N':
      return 'naoAdministrada';
    case 'S':
    case 'C':
    case 'X':
      return 'suspensa';
    case 'P': {
      if (minutos(h.agora) >= minutos(h.fimDoTurno) && minutos(h.previsto) < minutos(h.fimDoTurno))
        return 'omitida';
      return atrasoAlemDaTolerancia(h.previsto, h.agora, h.toleranciaMinutos) > 0 ? 'atrasada' : 'pendente';
    }
    default:
      return 'outro';
  }
}
