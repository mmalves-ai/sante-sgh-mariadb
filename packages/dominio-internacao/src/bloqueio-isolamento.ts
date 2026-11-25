// 04-INT linha 75 (C1-065): a não conformidade crítica da auditoria do isolamento bloqueia o quarto até a CCIH
// (comissão de controle de infecção hospitalar) resolver o aviso. Regra pura, sem banco.
//
// Referência pública: RDC 7/2010 (ANVISA) e Programa Nacional de Segurança do Paciente. A falha crítica do isolamento
// impede ocupar o quarto até a liberação da CCIH, sem travar o atendimento do próprio paciente isolado:
//   - só o critério "bloquear" não conforme bloqueia (o "alertar" só avisa);
//   - o leito do paciente isolado nunca é bloqueado (o atendimento dele segue);
//   - os outros leitos do quarto, livres e sem estado aberto (bloqueio, precaução, extra, higienização), ficam
//     bloqueados por isolamento ligados à auditoria;
//   - o leito ocupado por outro paciente não é bloqueado (não se tira ninguém do leito por regra automática): fica
//     listado para a CCIH decidir o remanejamento junto com o aviso;
//   - o leito que já tem estado aberto fica como está (o estado dele já impede a ocupação).
import type { AcaoNaoConformidade } from './controles-assistenciais.js';

export interface LeitoDoQuarto {
  readonly id: number;
  /** O leito do paciente isolado auditado. */
  readonly doIsolado: boolean;
  /** O leito tem período aberto (bloqueio, precaução, extra ou higienização). */
  readonly comEstadoAberto: boolean;
  /** O leito tem ocupação aberta. */
  readonly ocupado: boolean;
}

export interface BloqueioDoQuarto {
  /** A auditoria exige bloqueio (algum critério "bloquear" não conforme). */
  readonly exige: boolean;
  /** Leitos a bloquear por isolamento, ligados à auditoria. */
  readonly bloquear: readonly number[];
  /** Leitos ocupados por outro paciente: não bloqueados, listados para a CCIH remanejar. */
  readonly ocupadosPorOutro: readonly number[];
}

export function bloqueioDoQuartoPelaAuditoria(
  alertas: readonly { readonly acao: AcaoNaoConformidade }[],
  leitos: readonly LeitoDoQuarto[],
): BloqueioDoQuarto {
  const exige = alertas.some((a) => a.acao === 'bloquear');
  if (!exige) return { exige, bloquear: [], ocupadosPorOutro: [] };
  const vizinhos = leitos.filter((l) => !l.doIsolado);
  return {
    exige,
    bloquear: vizinhos.filter((l) => !l.ocupado && !l.comEstadoAberto).map((l) => l.id),
    ocupadosPorOutro: vizinhos.filter((l) => l.ocupado).map((l) => l.id),
  };
}
