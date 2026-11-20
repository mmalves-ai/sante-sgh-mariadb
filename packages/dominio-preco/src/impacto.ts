// Impacto de uma tabela em mais de um convênio (ficha do M12, regra 5; cap-11 §11.3, riscos): a tabela de
// honorários é apontada pelo convênio para a conta de internação (THM) e para a externa (THM_E). Reajustar
// uma tabela usada por mais de um convênio ativo muda o preço de todos eles; a tabela 10 é a conhecida
// (SUS e Particular). O aviso exige confirmação explícita.
import { TABELA_COMPARTILHADA } from '@sgh/contratos';

export interface ConvenioDaTabela {
  readonly codigo: number;
  readonly nome: string;
  readonly ativo: boolean;
  /** Tabela de honorários da conta de internação (TBCONVEN.THM). */
  readonly honorariosInternacao: number | null;
  /** Tabela de honorários da conta externa (TBCONVEN.THM_E). */
  readonly honorariosExterna: number | null;
  readonly diarias?: number | null;
  readonly matmed?: number | null;
}

export type UsoTabela = 'internacao' | 'externa' | 'diarias' | 'matmed';

export interface UsoDaTabela {
  readonly codigo: number;
  readonly nome: string;
  readonly ativo: boolean;
  readonly usos: readonly UsoTabela[];
}

/** Convênios que usam a tabela (e em qual conta), ordenados pelo código. */
export function conveniosDaTabela(
  tabela: number,
  convenios: readonly ConvenioDaTabela[],
  tipo: 'honorarios' | 'diarias' | 'matmed' = 'honorarios',
): UsoDaTabela[] {
  const r: UsoDaTabela[] = [];
  for (const c of convenios) {
    const usos: UsoTabela[] = [];
    if (tipo === 'honorarios') {
      if (c.honorariosInternacao === tabela) usos.push('internacao');
      if (c.honorariosExterna === tabela) usos.push('externa');
    } else if (tipo === 'diarias') {
      if (c.diarias === tabela) usos.push('diarias');
    } else if (c.matmed === tabela) usos.push('matmed');
    if (usos.length > 0) r.push({ codigo: c.codigo, nome: c.nome, ativo: c.ativo, usos });
  }
  return r.sort((a, b) => a.codigo - b.codigo);
}

/** A tabela é compartilhada: é a tabela 10 ou mais de um convênio ativo a usa. */
export function tabelaCompartilhada(tabela: number, usos: readonly UsoDaTabela[]): boolean {
  return tabela === TABELA_COMPARTILHADA || usos.filter((u) => u.ativo).length > 1;
}
