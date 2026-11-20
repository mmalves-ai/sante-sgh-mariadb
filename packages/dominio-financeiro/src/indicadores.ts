// Indicadores do cap-06b §6.8 (M32; ficha, seção 4): os três com as parcelas de cada conta impressas.
//   - títulos pagos sem aprovação, nos dois sistemas (MFCONPAG × SGH_FIN_APROVACAO);
//   - contas sem título (FCCTAEXT × MFCTAREC; linha de base 13.260 de 40.693 contas de 2025 ligadas);
//   - credor não encontrado no cadastro (MFCONPAG.FORN × TBFORNEC; 12,9%).
export interface Parcela {
  readonly rotulo: string;
  readonly valor: number;
}

export interface Indicador {
  readonly codigo: string;
  readonly titulo: string;
  readonly valor: number;
  readonly unidade: '%' | 'titulos' | 'contas';
  /** As parcelas que compõem a conta (numerador e denominador), impressas na tela e no relatório. */
  readonly parcelas: readonly Parcela[];
}

const pct = (a: number, b: number) => (b > 0 ? Math.round((a / b) * 10_000) / 100 : 0);

export function indicadorPagosSemAprovacao(
  pagos: number,
  aprovados: number,
  pagosPeloNovo: number,
): Indicador {
  const sem = Math.max(0, pagos - aprovados);
  return {
    codigo: 'pagos-sem-aprovacao',
    titulo: 'Títulos pagos sem aprovação na alçada',
    valor: pct(sem, pagos),
    unidade: '%',
    parcelas: [
      { rotulo: 'Títulos pagos no período', valor: pagos },
      { rotulo: 'Com aprovação registrada', valor: aprovados },
      { rotulo: 'Sem aprovação', valor: sem },
      { rotulo: 'Pagos por esta plataforma (sempre com aprovação)', valor: pagosPeloNovo },
    ],
  };
}

export function indicadorContasSemTitulo(contas: number, comTitulo: number): Indicador {
  return {
    codigo: 'contas-sem-titulo',
    titulo: 'Contas apresentadas sem título a receber',
    valor: pct(contas - comTitulo, contas),
    unidade: '%',
    parcelas: [
      { rotulo: 'Contas fechadas ou apresentadas', valor: contas },
      { rotulo: 'Com título ligado', valor: comTitulo },
      { rotulo: 'Sem título', valor: contas - comTitulo },
    ],
  };
}

export function indicadorCredorOrfao(titulos: number, orfaos: number): Indicador {
  return {
    codigo: 'credor-nao-encontrado',
    titulo: 'Títulos com credor não encontrado no cadastro',
    valor: pct(orfaos, titulos),
    unidade: '%',
    parcelas: [
      { rotulo: 'Títulos a pagar', valor: titulos },
      { rotulo: 'Credor não encontrado no cadastro', valor: orfaos },
    ],
  };
}

/** Contagem abaixo de 5 vira "<5" na exibição (agregados de pessoas; regra do projeto). */
export const contagemExibida = (n: number): string => (n > 0 && n < 5 ? '<5' : String(n));
