// Disparo da comunicação de internação e de alta à operadora (C2-070, 06-FAT linha 26): ao internar e ao registrar a
// saída, o sistema gera sozinho as comunicações devidas (padrão TISS: comunicação de beneficiário), sem a equipe
// lembrar de abrir cada uma. Regra pura: dada a internação e as comunicações que ela já tem, quais tipos nascem agora.
//   - só para operadora de saúde suplementar com registro e carteira (as mesmas regras do registro manual);
//   - a internação primeiro; a saída (alta, ou óbito quando a alta foi por óbito) só com a alta registrada e a
//     comunicação da internação viva;
//   - um tipo que já existe em qualquer situação não nasce de novo: a cancelada foi decisão da equipe, a rejeitada ou com
//     erro volta pelo reenvio (nada é duplicado nem refeito por baixo da equipe);
//   - comunicada a saída por um tipo, o outro não nasce.
import {
  conferirNovaComunicacao,
  SITUACOES_COMUNICACAO_VIVAS,
  type SituacaoComunicacaoOperadora,
  type TipoComunicacaoOperadora,
} from './comunicacao-operadora.js';

export interface ComunicacaoExistente {
  readonly tipo: TipoComunicacaoOperadora;
  readonly situacao: SituacaoComunicacaoOperadora;
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
  const vivas = c.existentes
    .filter((x) => SITUACOES_COMUNICACAO_VIVAS.includes(x.situacao))
    .map((x) => x.tipo);
  const ja = new Set(c.existentes.map((x) => x.tipo));
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
