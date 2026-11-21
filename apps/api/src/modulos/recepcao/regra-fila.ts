// Regras da fila da senha (puras, sem banco): a ordem de chamada pela configuração do serviço (ordem_lista do
// cadastro), o peso do grupo de prioridade legal e o grupo atribuído pelo botão do serviço na emissão.
// Pedido ao integrador: mover para packages/dominio-recepcao (o lote só edita o próprio módulo).
//
// Melhoria: as três ordens do cadastro (chegada, prioridade, horário da marcação) são respeitadas; entre as
// prioritárias, o peso do grupo (menor chama antes) decide, e depois a chegada.

/** Ordem da fila no cadastro do serviço (gerador_senha.ordem_lista) e a intercalada do contrato da tela. */
export type OrdemDaFila = 'chegada' | 'prioridade' | 'intercalada' | 'horario_marcacao';
const ORDENS: readonly OrdemDaFila[] = ['chegada', 'prioridade', 'intercalada', 'horario_marcacao'];

/** Senha candidata à chamada, em vocabulário neutro. */
export interface SenhaCandidata {
  readonly id: number;
  /** Instante da emissão (ISO, ou a hora civil: a mesma escala em todas as candidatas). */
  readonly emitidaEm: string;
  readonly prioritaria: boolean;
  /** Peso do grupo de prioridade legal (menor chama antes); null: sem grupo. */
  readonly pesoGrupo: number | null;
  /** Início do horário da marcação ligada à senha (na mesma escala da emissão); null: sem marcação. */
  readonly horarioMarcacao: string | null;
}

export type DecisaoOrdem =
  | { readonly ok: true; readonly ordem: OrdemDaFila }
  | { readonly ok: false; readonly codigo: string; readonly motivo: string };

/** A ordem da fila dos serviços do guichê: todos com a mesma ordem; ordem desconhecida ou divergente é recusada. */
export function ordemDosServicos(ordens: readonly string[]): DecisaoOrdem {
  const distintas = [...new Set(ordens)];
  const desconhecida = distintas.find((o) => !ORDENS.includes(o as OrdemDaFila));
  if (desconhecida !== undefined)
    return {
      ok: false,
      codigo: 'ordem-fila-desconhecida',
      motivo: `A ordem de fila "${desconhecida}" do cadastro do serviço não é conhecida: corrija o cadastro.`,
    };
  if (distintas.length !== 1)
    return {
      ok: false,
      codigo: 'ordens-fila-diferentes',
      motivo:
        'Os serviços deste guichê têm ordens de fila diferentes: chame a senha pela lista ou alinhe a ordem no cadastro dos serviços.',
    };
  return { ok: true, ordem: distintas[0] as OrdemDaFila };
}

const porChegada = (a: SenhaCandidata, b: SenhaCandidata) =>
  a.emitidaEm.localeCompare(b.emitidaEm) || a.id - b.id;
const porHorario = (a: SenhaCandidata, b: SenhaCandidata) =>
  (a.horarioMarcacao ?? a.emitidaEm).localeCompare(b.horarioMarcacao ?? b.emitidaEm) || porChegada(a, b);
const porPeso = (a: SenhaCandidata, b: SenhaCandidata) =>
  (a.pesoGrupo ?? Number.MAX_SAFE_INTEGER) - (b.pesoGrupo ?? Number.MAX_SAFE_INTEGER) || porChegada(a, b);

/**
 * A fila na ordem de chamada.
 *  - chegada: pela emissão;
 *  - horario_marcacao: pelo horário marcado (a senha sem marcação entra pela emissão);
 *  - prioridade: as prioritárias primeiro (peso do grupo, depois a chegada), depois as normais pela chegada;
 *  - intercalada: `intercalar` prioritárias por normal, contando as prioritárias já chamadas em seguida.
 */
export function ordenarCandidatas<T extends SenhaCandidata>(
  senhas: readonly T[],
  ordem: OrdemDaFila,
  opcoes: { readonly intercalar?: number; readonly prioritariasSeguidas?: number } = {},
): T[] {
  if (ordem === 'chegada') return [...senhas].sort(porChegada);
  if (ordem === 'horario_marcacao') return [...senhas].sort(porHorario);
  const prio = senhas.filter((s) => s.prioritaria).sort(porPeso);
  const normais = senhas.filter((s) => !s.prioritaria).sort(porChegada);
  if (ordem === 'prioridade') return [...prio, ...normais];
  const n = Math.min(9, Math.max(1, Math.trunc(opcoes.intercalar ?? 2)));
  const r: T[] = [];
  let seguidas = Math.max(0, opcoes.prioritariasSeguidas ?? 0);
  let i = 0;
  let j = 0;
  while (i < prio.length || j < normais.length) {
    if ((seguidas >= n || i >= prio.length) && j < normais.length) {
      r.push(normais[j++]!);
      seguidas = 0;
    } else {
      r.push(prio[i++]!);
      seguidas++;
    }
  }
  return r;
}

/**
 * O grupo de prioridade da senha emitida: o escolhido no balcão, ou o do botão do serviço (gerador_senha
 * .grupo_prioridade_legal_id, "grupo atribuído às senhas deste botão"); null: senha normal.
 */
export function grupoDaEmissao<G>(escolhido: G | null, doBotao: G | null): G | null {
  return escolhido ?? doBotao;
}
