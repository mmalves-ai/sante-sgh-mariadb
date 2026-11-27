// Fluxo de aprovação por etapas do documento da qualidade (F3.9 publicarDocumento, C2-060): elaboração, revisão e
// aprovação por pessoas diferentes, cada uma decidindo na própria sessão, na ordem. Regra pura: as portas (memória e
// banco próprio) chamam estas funções sobre as etapas lidas na transação.
import type {
  DecisaoEtapaDocumento,
  EtapaAprovacaoDocumentoCodigo,
  SituacaoEtapaDocumento,
  SituacaoSubmissaoDocumento,
} from '@sgh/contratos';

export type RecusaAprovacaoDocumento =
  | 'designacao-repetida'
  | 'etapa-inexistente'
  | 'etapa-ja-decidida'
  | 'etapa-fora-de-ordem'
  | 'decisor-nao-designado'
  | 'parecer-obrigatorio'
  | 'submissao-pendente';

export const MENSAGENS_RECUSA_APROVACAO_DOCUMENTO: Readonly<Record<RecusaAprovacaoDocumento, string>> = {
  'designacao-repetida': 'Autor, revisor e aprovador têm de ser pessoas diferentes.',
  'etapa-inexistente': 'A etapa informada não existe nesta revisão.',
  'etapa-ja-decidida': 'Esta etapa já foi decidida.',
  'etapa-fora-de-ordem': 'A etapa anterior ainda não foi aprovada.',
  'decisor-nao-designado': 'Só a pessoa designada decide esta etapa.',
  'parecer-obrigatorio': 'Para devolver ou reprovar, escreva o parecer (ao menos 10 caracteres).',
  'submissao-pendente': 'Já há uma revisão deste código no fluxo de aprovação.',
};

export interface EtapaParaDecidir {
  readonly sequencia: number;
  readonly etapa: EtapaAprovacaoDocumentoCodigo;
  readonly responsavel: string;
  readonly situacao: SituacaoEtapaDocumento | 'dispensada';
}

const igual = (a: string, b: string): boolean => a.trim().toUpperCase() === b.trim().toUpperCase();

/**
 * As etapas da submissão: a elaboração já aprovada pelo autor (quem submete), a revisão e a aprovação pendentes.
 * Autor, revisor e aprovador são pessoas diferentes (ONA: elaboração, revisão e aprovação separadas).
 */
export function montarEtapasAprovacao(
  autor: string,
  revisor: string,
  aprovador: string,
): { recusa: RecusaAprovacaoDocumento } | { etapas: EtapaParaDecidir[] } {
  if (igual(autor, revisor) || igual(autor, aprovador) || igual(revisor, aprovador))
    return { recusa: 'designacao-repetida' };
  return {
    etapas: [
      { sequencia: 1, etapa: 'elaboracao', responsavel: autor.trim().toUpperCase(), situacao: 'aprovada' },
      { sequencia: 2, etapa: 'revisao', responsavel: revisor.trim().toUpperCase(), situacao: 'pendente' },
      { sequencia: 3, etapa: 'aprovacao', responsavel: aprovador.trim().toUpperCase(), situacao: 'pendente' },
    ],
  };
}

/** O efeito da decisão: a situação nova da revisão e se ela é publicada (última etapa aprovada). */
export interface EfeitoDecisaoEtapa {
  readonly situacao: SituacaoSubmissaoDocumento;
  readonly publicar: boolean;
}

/**
 * Confere a decisão da etapa: existe, está pendente, as anteriores estão aprovadas, quem decide é o designado e
 * devolver ou reprovar trazem parecer. Aprovar a última publica; aprovar outra passa à seguinte; devolver ou reprovar
 * encerra o fluxo e a revisão volta ao autor (nada fica vigente).
 */
export function conferirDecisaoEtapa(e: {
  readonly etapas: readonly EtapaParaDecidir[];
  readonly sequencia: number;
  readonly decisor: string;
  readonly decisao: DecisaoEtapaDocumento;
  readonly parecer: string | null | undefined;
}): { recusa: RecusaAprovacaoDocumento } | EfeitoDecisaoEtapa {
  const ordem = [...e.etapas].sort((a, b) => a.sequencia - b.sequencia);
  const alvo = ordem.find((x) => x.sequencia === e.sequencia);
  if (!alvo) return { recusa: 'etapa-inexistente' };
  if (alvo.situacao !== 'pendente') return { recusa: 'etapa-ja-decidida' };
  if (
    ordem.some(
      (x) => x.sequencia < alvo.sequencia && x.situacao !== 'aprovada' && x.situacao !== 'dispensada',
    )
  )
    return { recusa: 'etapa-fora-de-ordem' };
  if (!igual(alvo.responsavel, e.decisor)) return { recusa: 'decisor-nao-designado' };
  if (e.decisao !== 'aprovada') {
    if ((e.parecer ?? '').trim().length < 10) return { recusa: 'parecer-obrigatorio' };
    return { situacao: 'devolvida', publicar: false };
  }
  const proxima = ordem.find((x) => x.sequencia > alvo.sequencia && x.situacao === 'pendente');
  if (!proxima) return { situacao: 'vigente', publicar: true };
  return { situacao: proxima.etapa === 'aprovacao' ? 'em_aprovacao' : 'em_revisao', publicar: false };
}
