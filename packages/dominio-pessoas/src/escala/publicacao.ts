// Publicação da escala e a mudança da escala publicada (M52.2; regra 8, primeira parte: "escala publicada só muda com
// motivo"; a troca entre colegas é da F3). A escala publica uma vez; depois, cada inclusão, alteração ou cancelamento
// leva o motivo, que vai para a trilha da escala e para o evento de mudança. Publicar com furo de cobertura exige a
// justificativa da coordenação (D-FURO-52); com plantão de conselho vencido no dia, não publica (regra 3).
import type { EstadoEscala } from '@sgh/contratos';
import { OK, recusar, type Conferencia } from './plantao.js';

export function conferirMudancaNaEscala(estado: EstadoEscala, motivo: string | null): Conferencia {
  if (estado === 'publicada' && !(motivo && motivo.trim().length >= 10))
    return recusar(
      'sem-motivo',
      'A escala já foi publicada: informe o motivo da mudança (pelo menos 10 caracteres).',
    );
  return OK;
}

export interface SituacaoParaPublicar {
  readonly estado: EstadoEscala;
  readonly plantoesPrevistos: number;
  readonly furos: number;
  /** Plantões cujo conselho estará vencido no dia (o registro venceu depois da inclusão). */
  readonly bloqueadosPeloConselho: number;
  readonly justificativaFuro: string | null;
}

export function conferirPublicacao(s: SituacaoParaPublicar): Conferencia {
  if (s.estado === 'publicada') return recusar('ja-publicada', 'A escala já está publicada.');
  if (s.plantoesPrevistos === 0) return recusar('escala-vazia', 'A escala não tem plantão: nada a publicar.');
  if (s.bloqueadosPeloConselho > 0)
    return recusar(
      'conselho-vencido-na-escala',
      `${s.bloqueadosPeloConselho === 1 ? 'Um plantão' : `${s.bloqueadosPeloConselho} plantões`} da escala ${s.bloqueadosPeloConselho === 1 ? 'é' : 'são'} de quem estará com o conselho vencido no dia: troque ou cancele antes de publicar.`,
    );
  if (s.furos > 0 && !(s.justificativaFuro && s.justificativaFuro.trim().length >= 10))
    return recusar(
      'furo-sem-justificativa',
      `A escala tem ${s.furos === 1 ? 'um turno' : `${s.furos} turnos`} abaixo da cobertura mínima: justifique para publicar assim.`,
    );
  return OK;
}
