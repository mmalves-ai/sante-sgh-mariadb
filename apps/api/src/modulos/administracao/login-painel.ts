// M43 (regra 4; cap-08 §8.3), compartilhado pela tela de usuários (M10) e pelo desligamento do colaborador (M52.1): o
// login do grupo de painéis só é bloqueado depois que a TV ou o totem passou ao aparelho com token do novo, válido e
// conferido no setor (no banco, pela tela do aparelho, ou no registro versionado do fim, a mesma fonte da revisão).
// Falha fechada: o grupo, os aparelhos ou o relógio do banco que não se leram recusam o bloqueio (503).
import {
  CODIGO_CONFERENCIA_PAINEL_INDISPONIVEL,
  CODIGO_LOGIN_PAINEL_EM_USO,
  GRUPO_PAINEIS,
} from '@sgh/contratos';
import { motivoBloqueioLoginPainel } from '@sgh/dominio-config';
import { ErroProblema } from '../../problema.filter.js';
import { lerRegistroFim } from '../coexistencia/public-api.js';
import type { PortaRecepcao } from '../recepcao/public-api.js';

export interface FontesLoginPainel {
  readonly recepcao: PortaRecepcao | null;
  /** O registro versionado do fim (as substituições de painel conferidas fora da tela). */
  readonly raizFim: string | null;
}

const indisponivel = (): never => {
  throw new ErroProblema(
    'indisponivel',
    503,
    'Bloqueio recusado',
    'Não foi possível conferir agora se este login ainda é o de uma TV ou de um totem: tente de novo em instantes.',
    { codigo: CODIGO_CONFERENCIA_PAINEL_INDISPONIVEL },
  );
};

/** O grupo do login é o de painéis (TV ou totem)? */
export const ehGrupoDePainel = (grupo: string | null | undefined): boolean =>
  (grupo ?? '').trim().toUpperCase() === GRUPO_PAINEIS;

/**
 * Recusa o bloqueio do login de painel ainda em uso (409) ou não conferível agora (503). `grupo` lê o grupo do login
 * (undefined: o login não existe; a receita recusa depois); a falha da leitura é 503.
 */
export async function conferirLoginDePainel(
  fontes: FontesLoginPainel,
  alvo: { rede: string; hospital: string },
  login: string,
  grupo: () => Promise<string | null | undefined>,
): Promise<void> {
  const g = await grupo().catch(() => indisponivel());
  if (!ehGrupoDePainel(g)) return;
  if (!fontes.recepcao) return indisponivel();
  const [dispositivos, relogio] = await Promise.all([
    fontes.recepcao.dispositivos(alvo).catch(() => null),
    fontes.recepcao.relogio(alvo).catch(() => null),
  ]);
  if (!dispositivos || !relogio) return indisponivel();
  const doRegistro = fontes.raizFim ? lerRegistroFim(fontes.raizFim, alvo.hospital).registro.paineis : [];
  const motivo = motivoBloqueioLoginPainel(login, dispositivos, alvo.hospital, relogio.agora, doRegistro);
  if (motivo)
    throw new ErroProblema('recusa-de-negocio', 409, 'Bloqueio recusado', motivo, {
      codigo: CODIGO_LOGIN_PAINEL_EM_USO,
    });
}
