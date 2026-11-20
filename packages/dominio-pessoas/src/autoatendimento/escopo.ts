// Autosserviço do colaborador, fatia F6 (M52.6; ficha, regra 21; cap-07 §7.1.1): o colaborador vê só o próprio. O
// vínculo nunca vem do pedido: sai do login (os vínculos do usuário no estabelecimento); se o pedido nomear um vínculo,
// ele precisa ser um destes, senão é recusado (nunca "o primeiro que existir"). O holerite e as férias só existem se a
// folha estiver no Sante SGH (M53, chave `pessoas.folha`); sem ela, a tela diz onde consultar, sem link para fora.
import { type RecusaSesmt, recusaSesmt } from '../sesmt/recusa.js';

export interface EscopoProprio {
  readonly vinculo: number | null;
  readonly recusa: RecusaSesmt | null;
}

/**
 * O vínculo do autosserviço: o pedido (quando houver) precisa ser um dos vínculos do login; sem pedido, o vínculo ativo
 * mais recente (o maior ID entre os ativos; se nenhum ativo, o mais recente). Sem vínculo, null sem recusa (a tela diz
 * que o login não tem cadastro de colaborador).
 */
export function escopoProprio(
  doLogin: readonly { id: number; ativo: boolean }[],
  pedido: number | null,
): EscopoProprio {
  if (pedido !== null) {
    if (!doLogin.some((v) => v.id === pedido))
      return {
        vinculo: null,
        recusa: recusaSesmt('so-o-proprio', 'O autosserviço mostra só os seus próprios dados.', 'vinculo'),
      };
    return { vinculo: pedido, recusa: null };
  }
  if (doLogin.length === 0) return { vinculo: null, recusa: null };
  const ativos = doLogin.filter((v) => v.ativo);
  const base = ativos.length > 0 ? ativos : doLogin;
  return { vinculo: Math.max(...base.map((v) => v.id)), recusa: null };
}

export type DisponibilidadeFolha = 'disponivel' | 'folha-fora';

/** O holerite e as férias aparecem só com a folha no Sante SGH (a chave `pessoas.folha` ligada; M53). */
export function holeriteDisponivel(folhaLigada: boolean): DisponibilidadeFolha {
  return folhaLigada ? 'disponivel' : 'folha-fora';
}
