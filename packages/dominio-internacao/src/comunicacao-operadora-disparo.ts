// Disparo da comunicação de internação e de alta à operadora (C2-070, 06-FAT linha 26): ao internar e ao registrar a
// saída, o sistema gera sozinho as comunicações devidas (padrão TISS: comunicação de beneficiário), sem a equipe
// lembrar de abrir cada uma. Regra pura: dada a internação e as comunicações que ela já tem, quais tipos nascem agora.
//   - só para operadora de saúde suplementar com registro e carteira (as mesmas regras do registro manual);
//   - a internação primeiro; a saída (alta, ou óbito quando a alta foi por óbito) só com a alta registrada e a
//     comunicação da internação viva;
//   - um tipo que já existe em qualquer situação não nasce de novo: a cancelada foi decisão da equipe, a rejeitada ou com
//     erro volta pelo reenvio (nada é duplicado nem refeito por baixo da equipe);
//   - comunicada a saída por um tipo, o outro não nasce;
//   - a comunicação desfeita (alta cancelada ou internação excluída) não conta: a nova alta é comunicada de novo, com a
//     data corrigida.
// Quando a saída ou a internação é desfeita (`comunicacoesAoDesfazer`): a comunicação que a operadora ainda não
// recebeu (pendente ou com erro) é cancelada com o motivo; a enviada ou confirmada fica marcada para cancelamento
// junto à operadora (retificação), visível à equipe até ser registrada; a rejeitada e a cancelada só recebem a marca.
// Nada é apagado.
import {
  conferirNovaComunicacao,
  SITUACOES_COMUNICACAO_VIVAS,
  type SituacaoComunicacaoOperadora,
  TIPOS_COMUNICACAO_OPERADORA,
  type TipoComunicacaoOperadora,
} from './comunicacao-operadora.js';

export interface ComunicacaoExistente {
  readonly tipo: TipoComunicacaoOperadora;
  readonly situacao: SituacaoComunicacaoOperadora;
  /** O evento comunicado foi desfeito (alta cancelada ou internação excluída). */
  readonly desfeita?: boolean;
}

export interface ContextoDisparo {
  readonly tipoFonte: string;
  readonly registroAns: string | null;
  readonly numeroCarteira: string | null;
  readonly altaRegistrada: boolean;
  readonly altaPorObito: boolean;
  /** Todas as comunicações da internação, em qualquer situação (as excluídas ficam de fora). */
  readonly existentes: readonly ComunicacaoExistente[];
}

/** Os tipos que nascem agora, na ordem em que devem nascer (a internação antes da saída). */
export function comunicacoesDevidas(c: ContextoDisparo): TipoComunicacaoOperadora[] {
  const devidas: TipoComunicacaoOperadora[] = [];
  const valem = c.existentes.filter((x) => !x.desfeita);
  const vivas = valem.filter((x) => SITUACOES_COMUNICACAO_VIVAS.includes(x.situacao)).map((x) => x.tipo);
  const ja = new Set(valem.map((x) => x.tipo));
  const candidatos: TipoComunicacaoOperadora[] = ['internacao'];
  if (c.altaRegistrada) candidatos.push(c.altaPorObito ? 'obito' : 'alta');
  for (const tipo of candidatos) {
    if (ja.has(tipo)) continue;
    if ((tipo === 'alta' && ja.has('obito')) || (tipo === 'obito' && ja.has('alta'))) continue;
    const p = conferirNovaComunicacao({
      tipo,
      tipoFonte: c.tipoFonte,
      registroAns: c.registroAns,
      numeroCarteira: c.numeroCarteira,
      altaRegistrada: c.altaRegistrada,
      altaPorObito: c.altaPorObito,
      vivas,
    });
    if (p.length) continue;
    devidas.push(tipo);
    vivas.push(tipo);
  }
  return devidas;
}

/** O que foi desfeito: a saída (alta cancelada) ou a internação inteira (excluída). */
export type EventoDesfeito = 'alta' | 'internacao';

export interface ComunicacaoParaDesfazer {
  readonly id: number;
  readonly tipo: TipoComunicacaoOperadora;
  readonly situacao: SituacaoComunicacaoOperadora;
  readonly desfeita: boolean;
}

export interface DecisaoDesfeita {
  readonly id: number;
  /** cancelar: a operadora não recebeu; retificar: recebeu, cancelar junto a ela; marcar: só a marca. */
  readonly acao: 'cancelar' | 'retificar' | 'marcar';
  readonly motivo: string;
}

const MOTIVO_DESFEITA: Record<EventoDesfeito, string> = {
  alta: 'Alta cancelada no hospital: a saída comunicada não vale mais.',
  internacao: 'Internação excluída no hospital: a comunicação não vale mais.',
};

/** As comunicações atingidas quando a saída ou a internação é desfeita, e o que acontece com cada uma. */
export function comunicacoesAoDesfazer(
  evento: EventoDesfeito,
  existentes: readonly ComunicacaoParaDesfazer[],
): DecisaoDesfeita[] {
  const tipos: readonly TipoComunicacaoOperadora[] =
    evento === 'alta' ? ['alta', 'obito'] : TIPOS_COMUNICACAO_OPERADORA;
  const motivo = MOTIVO_DESFEITA[evento];
  return existentes
    .filter((x) => !x.desfeita && tipos.includes(x.tipo))
    .map((x) => ({
      id: x.id,
      acao:
        x.situacao === 'pendente' || x.situacao === 'erro'
          ? ('cancelar' as const)
          : x.situacao === 'enviada' || x.situacao === 'confirmada'
            ? ('retificar' as const)
            : ('marcar' as const),
      motivo,
    }));
}
