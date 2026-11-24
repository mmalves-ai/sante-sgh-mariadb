// Prioridade legal na marcação (02-AGE linha 49; Lei 10.048/2000, Lei 10.741/2003 com a prioridade especial acima de
// 80 anos da Lei 13.466/2017, Lei 12.764/2012). A marcação grava o grupo (marcacao_horario.grupo_prioridade_legal_id),
// que vai à senha na chegada e ordena os encaixes do dia.
//
// Regras:
//   - candidatos: o grupo informado na marcação, os grupos vigentes do cadastro do paciente na data da marcação e o
//     grupo por idade (o de maior idade mínima que a idade alcança);
//   - vence o de menor peso (menor chama antes); no empate, o informado, depois o do cadastro, depois o da idade;
//   - o informado inexistente ou inativo é recusado (nada é gravado com grupo inválido);
//   - a recepção não tira a prioridade que a lei dá pela idade ou pelo cadastro: informar "sem grupo" não apaga.
import { idadeNaData } from './prioridade-idade.js';

export interface GrupoPrioridadeCadastro {
  readonly id: number;
  readonly descricao: string;
  readonly ativo: boolean;
  /** Menor chama antes. */
  readonly peso: number;
  /** Idade mínima em anos quando o grupo é por idade. */
  readonly idadeMinima: number | null;
}

export interface PrioridadeDoPaciente {
  readonly grupo: number;
  readonly vigenciaInicio: string;
  readonly vigenciaFim: string | null;
}

export type OrigemPrioridade = 'informada' | 'cadastro' | 'idade';

export type PrioridadeNaMarcacao =
  | { readonly ok: true; readonly grupo: number | null; readonly origem: OrigemPrioridade | null }
  | { readonly ok: false; readonly codigo: 'prioridade-invalida'; readonly motivo: string };

const ORDEM: Record<OrigemPrioridade, number> = { informada: 0, cadastro: 1, idade: 2 };

export function prioridadeNaMarcacao(
  grupos: readonly GrupoPrioridadeCadastro[],
  e: {
    readonly informada?: number | null;
    readonly doPaciente?: readonly PrioridadeDoPaciente[];
    readonly nascimento?: string | null;
    /** Data da marcação (AAAA-MM-DD): a vigência e a idade contam nela. */
    readonly data: string;
  },
): PrioridadeNaMarcacao {
  const ativos = grupos.filter((g) => g.ativo);
  const cand: { g: GrupoPrioridadeCadastro; origem: OrigemPrioridade }[] = [];
  if (e.informada != null) {
    const g = ativos.find((x) => x.id === e.informada);
    if (!g)
      return {
        ok: false,
        codigo: 'prioridade-invalida',
        motivo: 'O grupo de prioridade legal informado não existe ou está inativo.',
      };
    cand.push({ g, origem: 'informada' });
  }
  for (const p of e.doPaciente ?? []) {
    if (p.vigenciaInicio > e.data || (p.vigenciaFim !== null && p.vigenciaFim < e.data)) continue;
    const g = ativos.find((x) => x.id === p.grupo);
    if (g) cand.push({ g, origem: 'cadastro' });
  }
  const idade = idadeNaData(e.nascimento ?? null, e.data);
  if (idade !== null) {
    const porIdade = ativos
      .filter((g) => g.idadeMinima !== null && g.idadeMinima <= idade)
      .sort((a, b) => (b.idadeMinima ?? 0) - (a.idadeMinima ?? 0))[0];
    if (porIdade) cand.push({ g: porIdade, origem: 'idade' });
  }
  if (!cand.length) return { ok: true, grupo: null, origem: null };
  cand.sort((a, b) => a.g.peso - b.g.peso || ORDEM[a.origem] - ORDEM[b.origem]);
  return { ok: true, grupo: cand[0]!.g.id, origem: cand[0]!.origem };
}

/** Encaixes do mesmo horário: o prioritário (menor peso) antes, depois a ordem de chegada do encaixe. */
export function ordenarEncaixes<T extends { readonly pesoPrioridade: number | null; readonly ordem: number }>(
  itens: readonly T[],
): T[] {
  return [...itens].sort(
    (a, b) =>
      (a.pesoPrioridade ?? Number.MAX_SAFE_INTEGER) - (b.pesoPrioridade ?? Number.MAX_SAFE_INTEGER) ||
      a.ordem - b.ordem,
  );
}
