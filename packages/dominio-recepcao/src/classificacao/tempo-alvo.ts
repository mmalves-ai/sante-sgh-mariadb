// Tempo-alvo, prazo, estouro e reclassificação obrigatória (ficha do M44, regra 4; cap-05a §5.3). O relógio começa na
// classificação vigente e para no início do atendimento médico (a marca `atendimentoMedico` de SGH_PA_ETAPA, M20).
// Estouro sem atendimento médico gera um aviso (um por classificação: o `worker` com dois consumidores não duplica) e
// torna a reclassificação obrigatória; a mudança de quadro também obriga, a qualquer momento antes da decisão.
// As horas são instantes ISO (UTC quando sem fuso, como o quadro do PA).
import type { ConteudoProtocolo, CorRisco, MotivoClassificacao, MotivoReclassificacao } from '@sgh/contratos';
import { CORES_RISCO } from '@sgh/contratos';

const ms = (iso: string) => Date.parse(/[zZ]|[+-]\d{2}:?\d{2}$/.test(iso) ? iso : `${iso}Z`);
const MINUTO = 60_000;

/** O tempo-alvo da cor na versão do protocolo (sem a cor na versão, o padrão da regra 4). */
export function tempoAlvoDaCor(conteudo: Pick<ConteudoProtocolo, 'cores'> | null, cor: CorRisco): number {
  const daVersao = conteudo?.cores.find((c) => c.cor === cor)?.tempoAlvoMin;
  return daVersao ?? CORES_RISCO.find((c) => c.codigo === cor)!.tempoAlvoPadraoMin;
}

/** Prazo do atendimento médico: classificação + tempo-alvo (instante ISO em UTC). */
export function prazoDoAtendimento(classificadoEm: string, tempoAlvoMin: number): string {
  return new Date(ms(classificadoEm) + tempoAlvoMin * MINUTO).toISOString();
}

export interface ClassificacaoVigente {
  readonly id: number;
  readonly cor: CorRisco;
  readonly classificadoEm: string;
  readonly tempoAlvoMin: number;
  readonly motivo: MotivoClassificacao;
}

/** A vigente é a mais recente (só inclusão: a reclassificação é uma linha nova). */
export function classificacaoVigente<T extends Pick<ClassificacaoVigente, 'id' | 'classificadoEm'>>(
  linhas: readonly T[],
): T | null {
  return (
    [...linhas].sort((a, b) => ms(a.classificadoEm) - ms(b.classificadoEm) || a.id - b.id).at(-1) ?? null
  );
}

export interface SituacaoTempo {
  readonly prazoEm: string;
  readonly minutosDecorridos: number;
  /** Minutos até o prazo; negativo depois dele. Parado no início do atendimento médico. */
  readonly minutosRestantes: number;
  /** Prazo vencido sem atendimento médico iniciado até ele. */
  readonly estourado: boolean;
  /** O atendimento médico começou (o relógio parou). */
  readonly atendido: boolean;
}

export function situacaoDoTempo(
  vigente: Pick<ClassificacaoVigente, 'classificadoEm' | 'tempoAlvoMin'>,
  agora: string,
  atendimentoMedicoEm: string | null,
): SituacaoTempo {
  const inicio = ms(vigente.classificadoEm);
  const prazo = inicio + vigente.tempoAlvoMin * MINUTO;
  const medico = atendimentoMedicoEm !== null ? ms(atendimentoMedicoEm) : null;
  const atendido = medico !== null && medico >= inicio - MINUTO;
  const fim = atendido ? Math.min(medico, ms(agora)) : ms(agora);
  return {
    prazoEm: new Date(prazo).toISOString(),
    minutosDecorridos: Math.max(0, Math.floor((fim - inicio) / MINUTO)),
    minutosRestantes: Math.floor((prazo - fim) / MINUTO),
    estourado: atendido ? medico > prazo : ms(agora) > prazo,
    atendido,
  };
}

/** A reclassificação é obrigatória agora? (estouro sem atendimento médico; regra 4) */
export function reclassificacaoObrigatoria(
  vigente: Pick<ClassificacaoVigente, 'classificadoEm' | 'tempoAlvoMin'>,
  agora: string,
  atendimentoMedicoEm: string | null,
): boolean {
  const s = situacaoDoTempo(vigente, agora, atendimentoMedicoEm);
  return s.estourado && !s.atendido;
}

/**
 * Chave do aviso de estouro (idempotência no `worker`): um aviso por classificação vigente, por hospital. A
 * reclassificação cria uma linha nova e, com ela, uma chave nova.
 */
export function chaveAvisoEstouro(hospital: string, classificacao: number): string {
  return `pa.classificacao.estouro:${hospital}:${classificacao}`;
}

export type ProblemaReclassificacao =
  'sem-classificacao' | 'anterior-desatualizada' | 'sem-estouro' | 'atendimento-encerrado';

/** A reclassificação pedida pode ser gravada? */
export function problemaDaReclassificacao(entrada: {
  readonly vigente: Pick<ClassificacaoVigente, 'id' | 'classificadoEm' | 'tempoAlvoMin'> | null;
  readonly anterior: number;
  readonly motivo: MotivoReclassificacao;
  readonly agora: string;
  readonly atendimentoMedicoEm: string | null;
  /** O PA já registrou a decisão ou a saída (não se reclassifica depois disso). */
  readonly encerrado: boolean;
}): ProblemaReclassificacao | null {
  if (!entrada.vigente) return 'sem-classificacao';
  if (entrada.encerrado) return 'atendimento-encerrado';
  if (entrada.vigente.id !== entrada.anterior) return 'anterior-desatualizada';
  if (
    entrada.motivo === 'estouro' &&
    !reclassificacaoObrigatoria(entrada.vigente, entrada.agora, entrada.atendimentoMedicoEm)
  )
    return 'sem-estouro';
  return null;
}
