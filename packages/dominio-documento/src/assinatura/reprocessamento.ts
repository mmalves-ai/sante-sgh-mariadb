// Assinatura pendente e reprocessamento (M49; regra 5; SBIS-37; cap-13 §13.6.4): LCR, OCSP, carimbo do tempo ou
// provedor fora do ar NÃO é recusa: o documento fica pendente, o autor e o diretor técnico são avisados uma vez, e o
// agendador tenta de novo com espera crescente (dobra a cada tentativa, até 4 h). Esgotadas as tentativas, vira falha
// (aviso de novo; o autor pode reprocessar à mão ou voltar ao papel). Puro: o relógio e os parâmetros vêm de fora.
import type { EstadoAssinatura, FalhaTransitoriaAssinatura } from '@sgh/contratos';

export interface SituacaoReprocessamento {
  readonly estado: EstadoAssinatura;
  readonly tentativas: number;
  readonly falha: FalhaTransitoriaAssinatura | null;
  readonly proximaEm: Date | null;
}

export interface ConfiguracaoReprocessamento {
  /** `documento.assinaturaTentativas`. */
  readonly maxTentativas: number;
  /** `documento.assinaturaEsperaInicialMin`. */
  readonly esperaInicialMin: number;
}

export type DestinatarioAviso = 'autor' | 'diretor-tecnico';

export interface TransicaoReprocessamento {
  readonly situacao: SituacaoReprocessamento;
  /** Quem avisar agora (vazio: já avisado antes nesta pendência). */
  readonly avisar: readonly DestinatarioAviso[];
  readonly evento:
    'documento.assinatura.falhou' | 'documento.assinatura.reprocessada' | 'documento.assinatura.assinado';
}

export const TETO_ESPERA_MIN = 240;

/** Espera antes da tentativa `n` (1 = primeira nova tentativa): inicial × 2^(n−1), com teto de 4 h. */
export function esperaMin(n: number, inicialMin: number): number {
  return Math.min(inicialMin * 2 ** Math.max(0, n - 1), TETO_ESPERA_MIN);
}

export const NOVA: SituacaoReprocessamento = {
  estado: 'pendente',
  tentativas: 0,
  falha: null,
  proximaEm: null,
};

/** Mais uma falha transitória: segue pendente com a próxima tentativa marcada, ou vira falha se esgotou. */
export function registrarFalhaTransitoria(
  s: SituacaoReprocessamento,
  falha: FalhaTransitoriaAssinatura,
  agora: Date,
  cfg: ConfiguracaoReprocessamento,
): TransicaoReprocessamento {
  if (s.estado === 'assinada') throw new Error('Assinatura já concluída não volta a pendente.');
  const tentativas = s.tentativas + 1;
  if (tentativas >= cfg.maxTentativas)
    return {
      situacao: { estado: 'falha', tentativas, falha, proximaEm: null },
      avisar: ['autor', 'diretor-tecnico'],
      evento: 'documento.assinatura.falhou',
    };
  return {
    situacao: {
      estado: 'pendente',
      tentativas,
      falha,
      proximaEm: new Date(agora.getTime() + esperaMin(tentativas, cfg.esperaInicialMin) * 60_000),
    },
    // Avisa só na primeira falha da pendência (sem repetir o aviso a cada tentativa).
    avisar: s.tentativas === 0 ? ['autor', 'diretor-tecnico'] : [],
    evento: s.tentativas === 0 ? 'documento.assinatura.falhou' : 'documento.assinatura.reprocessada',
  };
}

/** A tentativa deu certo. */
export function registrarSucesso(s: SituacaoReprocessamento): TransicaoReprocessamento {
  if (s.estado === 'assinada') throw new Error('Assinatura já concluída.');
  return {
    situacao: { estado: 'assinada', tentativas: s.tentativas, falha: null, proximaEm: null },
    avisar: [],
    evento: 'documento.assinatura.assinado',
  };
}

/** Reprocessamento à mão (`documento.reprocessarPendente`): uma falha volta a pendente com as tentativas zeradas. */
export function reabrir(s: SituacaoReprocessamento, agora: Date): SituacaoReprocessamento {
  if (s.estado === 'assinada') throw new Error('Assinatura já concluída.');
  return { estado: 'pendente', tentativas: 0, falha: s.falha, proximaEm: agora };
}

/** Pendentes vencidas, as mais antigas primeiro, até o teto da rodada do agendador. */
export function vencidasParaReprocessar<
  T extends { readonly id: number; readonly situacao: SituacaoReprocessamento },
>(lista: readonly T[], agora: Date, teto: number): T[] {
  return lista
    .filter(
      (x) =>
        x.situacao.estado === 'pendente' && x.situacao.proximaEm !== null && x.situacao.proximaEm <= agora,
    )
    .sort((a, b) => a.situacao.proximaEm!.getTime() - b.situacao.proximaEm!.getTime() || a.id - b.id)
    .slice(0, teto);
}
