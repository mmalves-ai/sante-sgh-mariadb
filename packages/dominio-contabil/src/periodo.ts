// Regra 3 (cap-07 §7.2): período encerrado não aceita lançamento; a correção vai para o período aberto, com
// referência ao original. Na etapa 1 serve ao reprocessamento (só período aberto) e à data do estorno de fato
// alterado; o encerramento com bloqueio (SGH_CTB_PERIODO, quem encerrou) é da etapa 2.

export interface PeriodoContabil {
  readonly empresa: number;
  readonly competencia: string;
  readonly situacao: 'aberto' | 'encerrado';
}

export function periodoAberto(
  periodos: readonly PeriodoContabil[],
  empresa: number,
  competencia: string,
): boolean {
  const p = periodos.find((x) => x.empresa === empresa && x.competencia === competencia);
  // Competência sem registro é aberta (nasce na primeira contabilização); só o encerramento explícito fecha.
  return !p || p.situacao === 'aberto';
}

/** Primeiro período aberto a partir da competência (inclusive) para a empresa. */
export function primeiroPeriodoAberto(
  periodos: readonly PeriodoContabil[],
  empresa: number,
  competencia: string,
): string {
  let c = competencia;
  for (let i = 0; i < 1200; i++) {
    if (periodoAberto(periodos, empresa, c)) return c;
    c = competenciaSeguinte(c);
  }
  throw new RangeError('Nenhum período aberto em 100 anos.');
}

export function competenciaSeguinte(competencia: string): string {
  const m = /^(\d{4})-(\d{2})$/.exec(competencia);
  if (!m) throw new RangeError(`Competência inválida: ${competencia}`);
  const ano = Number(m[1]);
  const mes = Number(m[2]);
  return mes === 12 ? `${ano + 1}-01` : `${ano}-${String(mes + 1).padStart(2, '0')}`;
}

/**
 * Data contábil do lançamento do fato: a do fato se o período dele está aberto; senão o primeiro dia do primeiro
 * período aberto depois dele (regra 3: correção no período aberto, com referência ao original).
 */
export function dataContabil(periodos: readonly PeriodoContabil[], empresa: number, data: string): string {
  const comp = data.slice(0, 7);
  if (periodoAberto(periodos, empresa, comp)) return data;
  return `${primeiroPeriodoAberto(periodos, empresa, comp)}-01`;
}
