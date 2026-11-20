// W0-04 (M4, mercado: ouvidoria/SAC hospitalar): os indicadores da ouvidoria por competência (mês do recebimento), com
// as parcelas impressas: respostas no prazo (das manifestações com desfecho conhecido: respondidas e as abertas de
// prazo vencido), por tipo, por área responsável e por canal de origem. A manifestação cancelada não conta (fica
// visível como inativa na lista). O prazo é o parâmetro `qualidade.ouvidoria.prazoDiasUteis` (padrão 10 dias úteis) e o
// canal da Hal-AI fica desligado por `qualidade.ouvidoria.canalHalai` até o dono configurar o canal.

/** A conta impressa de uma taxa: numerador ÷ denominador × 100 (valor nulo sem denominador). */
export interface ParcelaOuvidoria {
  readonly numerador: number;
  readonly denominador: number;
  readonly valor: number | null;
  readonly conta: string | null;
}

export interface GrupoIndicadorOuvidoria {
  /** O código do tipo ou do canal, ou o nome da área. */
  readonly chave: string;
  readonly total: number;
  readonly respondidas: number;
  readonly vencidas: number;
  readonly noPrazo: ParcelaOuvidoria;
}

export interface IndicadoresOuvidoria {
  readonly competencia: string;
  readonly prazoDiasUteis: number;
  readonly total: number;
  readonly canceladas: number;
  readonly respondidas: number;
  /** Abertas ou encaminhadas com o prazo já vencido. */
  readonly vencidas: number;
  readonly noPrazo: ParcelaOuvidoria;
  readonly porTipo: readonly GrupoIndicadorOuvidoria[];
  readonly porArea: readonly GrupoIndicadorOuvidoria[];
  readonly porCanal: readonly GrupoIndicadorOuvidoria[];
}

/** Chaves dos parâmetros da ouvidoria (M4). */
export const PARAMETRO_PRAZO_OUVIDORIA = 'qualidade.ouvidoria.prazoDiasUteis';
export const PARAMETRO_CANAL_HALAI_OUVIDORIA = 'qualidade.ouvidoria.canalHalai';
