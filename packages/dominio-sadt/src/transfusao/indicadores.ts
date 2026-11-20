// Indicadores de hemovigilância (cap-05b §5.11 "Indicadores"; painel do NSP no M48): sempre com o numerador e o
// denominador impressos, para a conta ser conferida. Reações por mil transfusões, atos com os sinais completos, prazo
// da requisição urgente cumprido e requisições com a indicação escrita.

export interface Indicador {
  readonly codigo: string;
  readonly rotulo: string;
  readonly numerador: number;
  readonly denominador: number;
  /** null quando o denominador é zero. */
  readonly valor: number | null;
  readonly unidade: '%' | 'por mil';
}

const ind = (
  codigo: string,
  rotulo: string,
  numerador: number,
  denominador: number,
  unidade: '%' | 'por mil',
): Indicador => ({
  codigo,
  rotulo,
  numerador,
  denominador,
  valor:
    denominador === 0 ? null : Math.round((numerador / denominador) * (unidade === '%' ? 1000 : 10000)) / 10,
  unidade,
});

export function indicadoresHemovigilancia(c: {
  readonly atos: readonly { readonly sinaisCompletos: boolean; readonly comReacao: boolean }[];
  readonly reacoesGraves: number;
  readonly requisicoesUrgentes: readonly { readonly noPrazo: boolean }[];
  readonly requisicoes: readonly { readonly comIndicacao: boolean }[];
}): readonly Indicador[] {
  const n = c.atos.length;
  return [
    ind(
      'reacoesPorMil',
      'Reações transfusionais por mil transfusões',
      c.atos.filter((a) => a.comReacao).length,
      n,
      'por mil',
    ),
    ind('gravesPorMil', 'Reações graves por mil transfusões', c.reacoesGraves, n, 'por mil'),
    ind(
      'sinaisCompletos',
      'Transfusões com os sinais vitais completos',
      c.atos.filter((a) => a.sinaisCompletos).length,
      n,
      '%',
    ),
    ind(
      'urgentesNoPrazo',
      'Requisições urgentes atendidas no prazo',
      c.requisicoesUrgentes.filter((r) => r.noPrazo).length,
      c.requisicoesUrgentes.length,
      '%',
    ),
    ind(
      'comIndicacao',
      'Requisições com a indicação clínica escrita',
      c.requisicoes.filter((r) => r.comIndicacao).length,
      c.requisicoes.length,
      '%',
    ),
  ];
}
