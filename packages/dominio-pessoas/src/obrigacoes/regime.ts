// Regimes das obrigações legais (M53-F7; ficha do M53, regra 7 e DP-47): a obrigação é exigida no período conforme
// os parâmetros da empresa vigentes nele (vigência por início AAAA-MM, a mais recente que já começou), nunca por
// constante no código. As pendências comuns às gerações também moram aqui.
import {
  APURACAO_DA_OBRIGACAO,
  type CodigoPendenciaObrigacao,
  type ParametrosObrigacoes,
  type PendenciaObrigacao,
  type RegimeObrigacao,
  type TipoObrigacao,
} from '@sgh/contratos';

export const pendenciaObrigacao = (
  codigo: CodigoPendenciaObrigacao,
  mensagem: string,
  vinculos: readonly number[] = [],
): PendenciaObrigacao => ({ codigo, mensagem, vinculos: [...vinculos].sort((a, b) => a - b) });

/** A competência de referência do período: o mensal é ele mesmo; o ano-base, dezembro. */
export const competenciaDoPeriodo = (tipo: TipoObrigacao, periodo: string): string =>
  APURACAO_DA_OBRIGACAO[tipo] === 'anual' ? `${periodo}-12` : periodo;

/** As competências que o período cobre (o ano-base, os 12 meses). */
export function competenciasDaObrigacao(tipo: TipoObrigacao, periodo: string): string[] {
  if (APURACAO_DA_OBRIGACAO[tipo] === 'mensal') return [periodo];
  return Array.from({ length: 12 }, (_, i) => `${periodo}-${String(i + 1).padStart(2, '0')}`);
}

/** O último dia do mês da competência (AAAA-MM-DD). */
export function fimDaCompetenciaObrigacao(c: string): string {
  const [a, m] = c.split('-').map(Number) as [number, number];
  return `${c}-${String(new Date(Date.UTC(a, m, 0)).getUTCDate()).padStart(2, '0')}`;
}

/** Os parâmetros da empresa vigentes na competência (a vigência mais recente que já começou). */
export function parametrosObrigacoesNa<T extends Pick<ParametrosObrigacoes, 'empresa' | 'inicio'>>(
  vs: readonly T[],
  empresa: number,
  competencia: string,
): T | null {
  return (
    vs
      .filter((v) => v.empresa === empresa && v.inicio <= competencia)
      .sort((a, b) => b.inicio.localeCompare(a.inicio))[0] ?? null
  );
}

/**
 * O regime exige a obrigação no período? Os limites do regime são AAAA-MM (mensais) ou AAAA (a RAIS); um limite
 * AAAA num tipo mensal vale pelo ano inteiro (2019 = de 2019-01 a 2019-12), e um AAAA-MM num anual, pelo ano dele.
 */
export function obrigacaoExigida(regime: RegimeObrigacao, tipo: TipoObrigacao, periodo: string): boolean {
  const anual = APURACAO_DA_OBRIGACAO[tipo] === 'anual';
  const chave = (limite: string, fim: boolean): string => {
    if (anual) return limite.slice(0, 4);
    return limite.length === 4 ? `${limite}-${fim ? '12' : '01'}` : limite;
  };
  if (regime.exigidaDe && periodo < chave(regime.exigidaDe, false)) return false;
  if (regime.exigidaAte && periodo > chave(regime.exigidaAte, true)) return false;
  return true;
}

/** Sobreposição de vigências não existe (a chave é empresa + início); confere a ordem e o formato. */
export function conferirParametrosObrigacoes(x: ParametrosObrigacoes): string[] {
  const erros: string[] = [];
  for (const [tipo, r] of Object.entries(x.regimes) as [TipoObrigacao, RegimeObrigacao][]) {
    const anual = APURACAO_DA_OBRIGACAO[tipo] === 'anual';
    for (const l of [r.exigidaDe, r.exigidaAte])
      if (l && anual && l.length !== 4) erros.push(`${tipo}: o ano-base vai como AAAA.`);
  }
  return erros;
}

/** O período já terminou (hoje é AAAA-MM-DD; a competência só se declara depois do último dia). */
export function periodoEncerrado(tipo: TipoObrigacao, periodo: string, hoje: string): boolean {
  return fimDaCompetenciaObrigacao(competenciaDoPeriodo(tipo, periodo)) < hoje;
}
