// Regra 9 do M43 (cap-15 §15.5, "Janeiro chega com setores no legado"): o setor que passou da meta da sua onda sem ter
// sido liberado prolonga a coexistência DAQUELE setor, sem parar o hospital; o relatório semanal e a aba do fim mostram
// o setor, a meta e uma nova data proposta (o último dia do mês seguinte ao da medida), que o dono revê. As metas são
// as do cap-15 §15.3.3 para o primeiro estabelecimento (DP-4); o segundo só começa depois (as datas dele, o dono fixa).

/** Fim da janela de cada onda no primeiro estabelecimento (cap-15 §15.3.3; meta do dono para a Fase 4). */
export const META_FIM_ONDA: Readonly<Record<number, string>> = {
  0: '2026-11-30',
  1: '2026-11-30',
  2: '2026-12-31',
  3: '2026-12-31',
  4: '2027-01-31',
  5: '2027-01-31',
};

/** Situações em que o setor ainda não passou ao novo (o lote não foi aplicado). */
const AINDA_NO_OUTRO = new Set(['legado', 'homologacao', 'treinamento']);

export interface SetorParaAtraso {
  readonly codigo: string;
  readonly nome: string;
  readonly onda: number;
  readonly situacao: string;
}

export interface SetorAtrasado {
  readonly codigo: string;
  readonly nome: string;
  readonly onda: number;
  readonly situacao: string;
  readonly meta: string;
  /** Proposta (o dono revê): o último dia do mês seguinte ao da medida. */
  readonly novaData: string;
}

const ultimoDiaDoMesSeguinte = (dia: string): string => {
  const [a, m] = dia.split('-').map(Number) as [number, number];
  return new Date(Date.UTC(a, m + 1, 0)).toISOString().slice(0, 10);
};

/** Os setores depois da meta da onda e ainda no outro sistema, na ordem da onda e do nome. */
export function setoresAtrasados(
  setores: readonly SetorParaAtraso[],
  hoje: string,
  metas: Readonly<Record<number, string>> = META_FIM_ONDA,
): SetorAtrasado[] {
  return setores
    .filter((s) => AINDA_NO_OUTRO.has(s.situacao) && metas[s.onda] !== undefined && hoje > metas[s.onda]!)
    .map((s) => ({
      codigo: s.codigo,
      nome: s.nome,
      onda: s.onda,
      situacao: s.situacao,
      meta: metas[s.onda]!,
      novaData: ultimoDiaDoMesSeguinte(hoje),
    }))
    .sort((a, b) => a.onda - b.onda || a.nome.localeCompare(b.nome));
}
