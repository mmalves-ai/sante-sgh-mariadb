// Ligações da especialidade (F3.1, 02-CAD linha 17): procedimentos permitidos, com vigência, e ocupações (CBO) que
// correspondem à especialidade, com uma principal. A agenda e o faturamento leem o que vale no dia.

export interface PeriodoProcedimento {
  readonly id: number;
  readonly procedimento: number;
  readonly inicio: string;
  readonly fim: string | null;
}

/** Erros do período proposto. */
export function errosPeriodoProcedimento(p: { inicio: string; fim: string | null }): string[] {
  return p.fim !== null && p.fim < p.inicio ? ['vigencia-invertida'] : [];
}

/** Períodos do mesmo procedimento que se cruzam com o novo (recusa: encerre o anterior antes). */
export function periodosSobrepostos(
  existentes: readonly PeriodoProcedimento[],
  novo: { procedimento: number; inicio: string; fim: string | null },
): number[] {
  return existentes
    .filter(
      (x) =>
        x.procedimento === novo.procedimento &&
        (x.fim === null || x.fim >= novo.inicio) &&
        (novo.fim === null || novo.fim >= x.inicio),
    )
    .map((x) => x.id);
}

/** O procedimento vale para a especialidade no dia. */
export function procedimentoPermitido(
  periodos: readonly PeriodoProcedimento[],
  procedimento: number,
  dia: string,
): boolean {
  return periodos.some(
    (p) => p.procedimento === procedimento && p.inicio <= dia && (p.fim === null || p.fim >= dia),
  );
}

/**
 * A ocupação principal é uma só por especialidade: ao marcar uma, as outras deixam de ser. A primeira ocupação da
 * especialidade já entra como principal (a guia precisa de uma).
 */
export function principaisADesmarcar(
  atuais: readonly { id: number; principal: boolean }[],
  nova: { id: number | null; principal: boolean },
): { desmarcar: number[]; principal: boolean } {
  const principal = nova.principal || atuais.filter((a) => a.id !== nova.id).length === 0;
  return {
    desmarcar: principal ? atuais.filter((a) => a.principal && a.id !== nova.id).map((a) => a.id) : [],
    principal,
  };
}
