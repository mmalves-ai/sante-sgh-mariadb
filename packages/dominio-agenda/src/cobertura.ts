// Cobertura de convênio por agenda (ficha do M17, `agenda.definirCobertura` e regra 7; ref 01 §3.6;
// sante-api: src/services/cobertura.js). A lista de convênios aceitos é POR AGENDA (por profissional), não por
// especialidade: lista vazia = aceita todos (ausência de cadastro não é negativa). Convênio fora da lista →
// recusa com até 8 aceitos e as alternativas (mesmo procedimento, outro profissional, que aceita).
// Remover a última linha inverte o efeito (passa a aceitar todos): exige confirmação explícita; remover o
// PARTICULAR avisa.
import { partesDoNome } from './nome-agenda.js';

/** TBCONVEN.COD do particular (ref 01 §3.6; cobertura.js). */
export const CONVENIO_PARTICULAR = 10;
export const MAX_ACEITOS_NA_RESPOSTA = 8;

export interface AvaliacaoCobertura {
  /** A agenda tem lista de convênios. */
  readonly configurada: boolean;
  readonly aceito: boolean;
}

export function avaliarCobertura(aceitos: readonly number[], convenio: number): AvaliacaoCobertura {
  if (aceitos.length === 0) return { configurada: false, aceito: true };
  return { configurada: true, aceito: aceitos.includes(convenio) };
}

export interface AgendaComCobertura {
  readonly nome: string;
  readonly aceitos: readonly number[];
  readonly vigente: boolean;
}

/** Outras agendas vigentes do MESMO procedimento (parte do nome antes do hífen) que aceitam o convênio. */
export function alternativas(
  agendas: readonly AgendaComCobertura[],
  agendaAtual: string,
  convenio: number,
): string[] {
  const alvo = partesDoNome(agendaAtual).procedimento.toUpperCase();
  if (!alvo) return [];
  return agendas
    .filter(
      (a) =>
        a.vigente &&
        a.nome !== agendaAtual &&
        partesDoNome(a.nome).procedimento.toUpperCase() === alvo &&
        avaliarCobertura(a.aceitos, convenio).aceito,
    )
    .map((a) => a.nome)
    .sort();
}

export interface ImpactoRemocao {
  /** A lista fica vazia: a agenda passa a aceitar TODOS os convênios. */
  readonly passaAAceitarTodos: boolean;
  readonly removeParticular: boolean;
}

export function impactoDaRemocao(aceitos: readonly number[], remover: number): ImpactoRemocao {
  const resto = aceitos.filter((c) => c !== remover);
  return {
    passaAAceitarTodos: aceitos.includes(remover) && resto.length === 0,
    removeParticular: remover === CONVENIO_PARTICULAR,
  };
}
