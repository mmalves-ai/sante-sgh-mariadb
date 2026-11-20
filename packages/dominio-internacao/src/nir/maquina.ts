// Máquina de estados do NIR (M44, etapa 2; ficha, regras 9 e 10): `solicitado → em_analise → reservado → em_transito →
// internado`, ou `cancelado`/`rejeitado` com motivo, de qualquer estado não final. A reserva encerrada (expirada ou
// cancelada) devolve a solicitação à análise; a admissão ou a transferência pelo M21 a conclui. O de-para das 23
// situações de regulação do sistema anterior diz qual delas corresponde a cada estado (a proposta, sobreposta pelas
// linhas aprovadas pelo NIR). Regras puras: sem banco, sem HTTP.
import {
  type AcaoSolicitacaoNir,
  DEPARA_SITUACAO_REGULACAO,
  ESTADOS_FINAIS_NIR,
  type EstadoSolicitacaoNir,
} from '@sgh/contratos';

/** As transições permitidas: de quais estados cada ação parte e para onde leva (priorizar não muda o estado). */
const TRANSICOES: Readonly<
  Record<AcaoSolicitacaoNir, { de: readonly EstadoSolicitacaoNir[]; para: EstadoSolicitacaoNir | null }>
> = {
  analisar: { de: ['solicitado'], para: 'em_analise' },
  reservar: { de: ['solicitado', 'em_analise'], para: 'reservado' },
  // A reserva encerrada (expirada ou cancelada) devolve à análise também a solicitação a caminho (regra 11): sem o leito,
  // o NIR escolhe outro; ela nunca fica em trânsito sem reserva.
  liberarReserva: { de: ['reservado', 'em_transito'], para: 'em_analise' },
  transito: { de: ['reservado'], para: 'em_transito' },
  internar: { de: ['reservado', 'em_transito'], para: 'internado' },
  priorizar: { de: ['solicitado', 'em_analise', 'reservado', 'em_transito'], para: null },
  cancelar: { de: ['solicitado', 'em_analise', 'reservado', 'em_transito'], para: 'cancelado' },
  rejeitar: { de: ['solicitado', 'em_analise', 'reservado', 'em_transito'], para: 'rejeitado' },
};

export function estadoFinal(e: EstadoSolicitacaoNir): boolean {
  return ESTADOS_FINAIS_NIR.includes(e);
}

export type ResultadoTransicao =
  | { readonly ok: true; readonly de: EstadoSolicitacaoNir; readonly para: EstadoSolicitacaoNir }
  | { readonly ok: false; readonly codigo: 'transicao-invalida' | 'estado-final'; readonly motivo: string };

const ROTULO: Readonly<Record<EstadoSolicitacaoNir, string>> = {
  solicitado: 'solicitada',
  em_analise: 'em análise',
  reservado: 'com leito reservado',
  em_transito: 'em trânsito',
  internado: 'concluída (internado)',
  cancelado: 'cancelada',
  rejeitado: 'rejeitada',
};

/** A transição da ação a partir do estado atual; a recusa com o motivo que a tela mostra. */
export function transicao(atual: EstadoSolicitacaoNir, acao: AcaoSolicitacaoNir): ResultadoTransicao {
  if (estadoFinal(atual))
    return {
      ok: false,
      codigo: 'estado-final',
      motivo: `A solicitação já está ${ROTULO[atual]}: nada mais muda nela. Abra uma nova, se preciso.`,
    };
  const t = TRANSICOES[acao];
  if (!t.de.includes(atual))
    return {
      ok: false,
      codigo: 'transicao-invalida',
      motivo: `A solicitação está ${ROTULO[atual]}: esta ação não vale agora.`,
    };
  return { ok: true, de: atual, para: t.para ?? atual };
}

/** As ações possíveis a partir do estado (o que a tela oferece; o servidor confere de novo). */
export function acoesPossiveis(atual: EstadoSolicitacaoNir): AcaoSolicitacaoNir[] {
  return (Object.keys(TRANSICOES) as AcaoSolicitacaoNir[]).filter((a) => transicao(atual, a).ok);
}

// ── De-para das situações de regulação (regra 10) ─────────────────────────────────────────────────

export interface DeparaAprovado {
  readonly situacao: number;
  readonly estado: EstadoSolicitacaoNir;
  readonly aprovadoPor: string;
  readonly aprovadoEm: string;
}

export interface LinhaDepara {
  readonly situacao: number;
  readonly rotulo: string;
  readonly proposto: EstadoSolicitacaoNir | null;
  readonly estado: EstadoSolicitacaoNir | null;
  readonly aConfirmar: boolean;
  readonly aprovadoPor: string | null;
  readonly aprovadoEm: string | null;
}

/**
 * O de-para vigente: a proposta, com as linhas aprovadas pelo NIR por cima (a aprovada perde a marca "a confirmar").
 * `rotulos`: os nomes do cadastro do estabelecimento (sem o cadastro, os do perfil).
 */
export function deparaVigente(
  aprovados: readonly DeparaAprovado[],
  rotulos: ReadonlyMap<number, string> = new Map(),
): LinhaDepara[] {
  const por = new Map(aprovados.map((a) => [a.situacao, a]));
  return DEPARA_SITUACAO_REGULACAO.map((p) => {
    const a = por.get(p.situacao);
    return {
      situacao: p.situacao,
      rotulo: rotulos.get(p.situacao) ?? p.rotulo,
      proposto: p.estado,
      estado: a ? a.estado : p.estado,
      aConfirmar: a ? false : p.aConfirmar,
      aprovadoPor: a?.aprovadoPor ?? null,
      aprovadoEm: a?.aprovadoEm ?? null,
    };
  });
}

/** Toda situação tem destino ou a marca "a confirmar" (23 de 23; ficha, regra 10). */
export function deparaCompleto(linhas: readonly LinhaDepara[]): boolean {
  return (
    linhas.length === DEPARA_SITUACAO_REGULACAO.length &&
    linhas.every((l) => l.estado !== null || l.aConfirmar)
  );
}

/**
 * A situação do sistema anterior equivalente ao estado do NIR (a primeira do de-para com aquele destino), para a
 * coluna de equivalência da fila e do histórico. Null quando nenhuma situação corresponde.
 */
export function situacaoEquivalente(
  estado: EstadoSolicitacaoNir,
  linhas: readonly LinhaDepara[],
): { codigo: number; rotulo: string; aConfirmar: boolean } | null {
  const l = linhas.find((x) => x.estado === estado);
  return l ? { codigo: l.situacao, rotulo: l.rotulo, aConfirmar: l.aConfirmar } : null;
}
