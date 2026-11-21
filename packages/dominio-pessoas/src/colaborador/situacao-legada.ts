// Regra 4 do M52 (Anexo A; ref 02; DP-46.1): a situação do profissional no cadastro de origem NÃO define vínculo
// trabalhista. Os valores O, F e E
// (758, 109 e 4 profissionais no pc) têm baixa confiança e saem na tela com "a confirmar". A atividade do registro vem
// da inscrição no conselho estar ativa; o vínculo de trabalho vem só do vínculo de trabalho (vinculo_trabalho).
import {
  SITUACOES_PROFISSIONAL_LEGADO,
  TIPOS_VINCULO,
  type SituacaoProfissionalLegado,
  type TipoVinculo,
} from '@sgh/contratos';

export interface LegendaSituacao {
  readonly codigo: SituacaoProfissionalLegado;
  readonly rotulo: string;
  readonly aConfirmar: true;
}

/** Legenda da situação lida do cadastro de profissionais; código desconhecido ou vazio: null (a tela não mostra). */
export function legendaSituacaoProfissional(valor: string | null): LegendaSituacao | null {
  const v = valor?.trim().toUpperCase() ?? '';
  if (!(v in SITUACOES_PROFISSIONAL_LEGADO)) return null;
  const codigo = v as SituacaoProfissionalLegado;
  return { codigo, rotulo: SITUACOES_PROFISSIONAL_LEGADO[codigo], aConfirmar: true };
}

/** Inscrição no conselho ativa: T ativo, F inativo, nulo ou outro valor "não informado". */
export function registroAtivo(valor: string | null): boolean | null {
  const v = valor?.trim().toUpperCase();
  return v === 'T' ? true : v === 'F' ? false : null;
}

/** O profissional atua (lado assistencial) se algum registro estiver ativo; sem registro informado: null. */
export function profissionalAtivo(registros: readonly { readonly ativo: boolean | null }[]): boolean | null {
  if (registros.some((r) => r.ativo === true)) return true;
  if (registros.some((r) => r.ativo === false)) return false;
  return null;
}

/**
 * O vínculo mostrado na ficha: só o de SGH_PES_VINCULO (de propósito, a função não recebe a situação). A situação
 * do cadastro de profissionais nunca é promovida a vínculo (um "F" sem vínculo no Sante SGH aparece como "sem
 * vínculo registrado").
 */
export function vinculoExibido(
  tipo: TipoVinculo | null,
): { readonly tipo: TipoVinculo; readonly rotulo: string } | null {
  return tipo ? { tipo, rotulo: TIPOS_VINCULO[tipo] } : null;
}
