// Ordem da lista de espera por vaga (02-AGE linha 48). A prioridade legal (idoso, idoso acima de 80, gestante,
// pessoa com deficiência, TEA) é a MESMA da senha e da marcação: o grupo sai de `prioridadeNaMarcacao`
// (prioridade-marcacao.ts) na data da inclusão, com o informado, o do cadastro do paciente e o da idade, e fica
// gravado no pedido (lista_espera.grupo_prioridade_legal_id). Quem decide a ordem entre os grupos é o peso do grupo
// (menor chama antes), o mesmo que ordena a senha e os encaixes.
//
// Critério próprio, à parte da lei: a URGÊNCIA CLÍNICA. É a indicação do profissional que pediu a vaga (o quadro do
// paciente não pode esperar a antiguidade); não é prioridade legal e não se confunde com ela. Ordem da fila:
//   1. urgência clínica (urgente antes);
//   2. grupo de prioridade legal (menor peso antes; o pedido antigo marcado só como "preferencial", sem grupo,
//      vem depois de todos os grupos e antes de quem não tem prioridade);
//   3. antiguidade (entrada na fila) e, no empate, o número do pedido.
// Só os pedidos aguardando entram na fila; os ofertados ficam fora da posição até voltarem.

export type UrgenciaEspera = 'normal' | 'urgente';
/** O que fica na coluna `prioridade` do pedido: a urgência clínica, ou "preferencial" quando há grupo legal. */
export type PrioridadeGravadaEspera = 'normal' | 'preferencial' | 'urgente';

/** Peso do pedido antigo só "preferencial", sem grupo: depois de todo grupo legal, antes de quem não tem. */
export const PESO_PREFERENCIAL_SEM_GRUPO = 1_000_000;
const SEM_PRIORIDADE = Number.MAX_SAFE_INTEGER;

export function prioridadeGravadaNaEspera(
  urgencia: UrgenciaEspera,
  grupoLegal: number | null,
): PrioridadeGravadaEspera {
  if (urgencia === 'urgente') return 'urgente';
  return grupoLegal !== null ? 'preferencial' : 'normal';
}

export interface ItemFilaEsperaPrioridade {
  readonly id: number;
  /** A coluna gravada: normal, preferencial ou urgente. */
  readonly prioridade: string;
  /** Peso do grupo de prioridade legal do pedido (nulo: sem grupo). */
  readonly pesoPrioridadeLegal: number | null;
  /** Entrada na fila, em texto ordenável (ISO). */
  readonly desde: string;
  readonly situacao: string;
}

function pesoLegal(i: ItemFilaEsperaPrioridade): number {
  if (i.pesoPrioridadeLegal !== null) return i.pesoPrioridadeLegal;
  return i.prioridade === 'preferencial' ? PESO_PREFERENCIAL_SEM_GRUPO : SEM_PRIORIDADE;
}

/** A fila de quem aguarda, na ordem da regra (urgência clínica, grupo legal, antiguidade). */
export function ordenarFilaEspera<T extends ItemFilaEsperaPrioridade>(itens: readonly T[]): T[] {
  const u = (i: T) => (i.prioridade === 'urgente' ? 0 : 1);
  return itens
    .filter((i) => i.situacao === 'aguardando')
    .sort(
      (a, b) => u(a) - u(b) || pesoLegal(a) - pesoLegal(b) || a.desde.localeCompare(b.desde) || a.id - b.id,
    );
}
