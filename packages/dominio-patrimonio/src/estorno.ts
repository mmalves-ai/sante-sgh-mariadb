// W0-08, parte 5 (matriz, linha "Contábil"; ITG 2000, item 32): o estorno do cálculo da depreciação. O cálculo e as
// cotas nunca se editam nem se apagam: a correção é o estorno, fato novo com motivo, data e origem. Só o ÚLTIMO
// cálculo vigente da empresa se estorna (as competências seguem em sequência: estornar o do meio deixaria a acumulada
// das seguintes errada); com o lote contábil da competência já exportado, cancela-se a exportação antes; um bem baixado
// depois do cálculo impede (a baixa usou a acumulada com a cota).

/** Origem gravada no estorno (a trilha contábil diz de onde veio o fato). */
export const ORIGEM_ESTORNO_DEPRECIACAO = 'patrimonio/estorno-depreciacao';

export interface SituacaoParaEstorno {
  /** O cálculo vigente da competência pedida (null: não há). */
  readonly daCompetencia: { readonly id: number; readonly competencia: string } | null;
  /** O último cálculo vigente da empresa. */
  readonly ultimo: { readonly id: number; readonly competencia: string } | null;
  /** Lotes contábeis exportados que cobrem a competência (o do mês ou o do ano). */
  readonly lotesExportados: readonly { readonly periodo: string; readonly exportadoEm: string }[];
  /** Plaquetas dos bens do cálculo que já estão baixados. */
  readonly bensBaixados: readonly string[];
}

export interface ImpedimentoEstorno {
  readonly codigo: 'sem-calculo' | 'nao-e-o-ultimo' | 'lote-exportado' | 'bem-baixado';
  readonly detalhe: string;
}

/** O que impede estornar o cálculo da competência (null: pode). */
export function impedimentoDoEstorno(competencia: string, s: SituacaoParaEstorno): ImpedimentoEstorno | null {
  if (!s.daCompetencia)
    return {
      codigo: 'sem-calculo',
      detalhe: `A competência ${competencia} não tem cálculo vigente para estornar.`,
    };
  if (s.ultimo && s.ultimo.id !== s.daCompetencia.id)
    return {
      codigo: 'nao-e-o-ultimo',
      detalhe: `Só o último cálculo se estorna: estorne antes a competência ${s.ultimo.competencia}.`,
    };
  const lote = s.lotesExportados[0];
  if (lote)
    return {
      codigo: 'lote-exportado',
      detalhe: `O lote contábil de ${lote.periodo} já foi exportado: cancele a exportação primeiro e estorne depois.`,
    };
  if (s.bensBaixados.length > 0) {
    const lista = s.bensBaixados.slice(0, 10).join(', ');
    const mais = s.bensBaixados.length > 10 ? ` e mais ${s.bensBaixados.length - 10}` : '';
    return {
      codigo: 'bem-baixado',
      detalhe: `${s.bensBaixados.length} bem(ns) do cálculo já foram baixados (${lista}${mais}): a baixa usou a depreciação acumulada com esta cota.`,
    };
  }
  return null;
}
