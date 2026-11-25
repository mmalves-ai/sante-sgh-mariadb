// Equipe do ato como lista de membros (F3.4, 04-CC linha 95). Cada membro tem a função, o profissional, o procedimento
// (ou o ato inteiro), a entrada, a saída e o percentual. A mesma função pode ter mais de um membro, um depois do outro:
// é a troca de cirurgião ou de anestesista no meio do ato. Os tempos podem ser diferentes por procedimento.
// Padrão público seguido: TISS, com o grau de participação por procedimento e a entrada e saída de cada membro. O
// repasse lê o participante do item da conta: a ponte leva a equipe realizada ao item do procedimento.
import { conferirParticipacao, minutosDepois } from './participacao.js';

/** Funções do registro do ato, na ordem da tela. */
export const FUNCOES_MEMBRO = [
  'cirurgiao',
  'auxiliar1',
  'auxiliar2',
  'auxiliar3',
  'instrumentador',
  'anestesista',
  'pediatra',
  'circulante',
] as const;
export type FuncaoMembro = (typeof FUNCOES_MEMBRO)[number];

export interface MembroInformado {
  readonly funcao: FuncaoMembro;
  readonly profissional: number;
  /** Posição do procedimento no registro (0 = o principal); null = o ato inteiro. */
  readonly procedimento: number | null;
  readonly entrada: string | null;
  readonly saida: string | null;
  readonly percentual: number | null;
}

export interface MembroConferido {
  readonly funcao: FuncaoMembro;
  readonly profissional: number;
  readonly procedimento: number | null;
  /** Minutos depois da entrada do paciente na sala. */
  readonly entradaMin: number;
  readonly saidaMin: number;
  /** Se a entrada e a saída vieram informadas (null no banco quando não vieram: o tempo inteiro). */
  readonly entradaInformada: boolean;
  readonly saidaInformada: boolean;
  readonly percentual: number | null;
}

export interface ProblemaMembro {
  readonly indice: number;
  readonly campo: 'funcao' | 'profissional' | 'procedimento' | 'entrada' | 'saida' | 'percentual';
  readonly texto: string;
}

export type ResultadoMembros =
  | { readonly ok: true; readonly membros: readonly MembroConferido[] }
  | { readonly ok: false; readonly problema: ProblemaMembro };

const mesmoEscopo = (a: number | null, b: number | null) => a === null || b === null || a === b;
const sobrepoe = (a: MembroConferido, b: MembroConferido) =>
  a.entradaMin < b.saidaMin && b.entradaMin < a.saidaMin;

/**
 * Confere a lista de membros: o procedimento existe no registro; as horas ficam dentro do tempo do paciente na sala e
 * a saída vem depois da entrada; o percentual vai de 0 a 100 (sem ele, o padrão da função). Na mesma função e no mesmo
 * procedimento, dois membros não se sobrepõem no tempo (a troca é um depois do outro). O mesmo profissional não está
 * em duas funções ao mesmo tempo no mesmo procedimento. A lista tem pelo menos um cirurgião.
 */
export function conferirMembrosEquipe(
  membros: readonly MembroInformado[],
  sala: { readonly entrada: string; readonly saida: string },
  quantidadeProcedimentos: number,
): ResultadoMembros {
  const duracao = minutosDepois(sala.entrada, sala.saida);
  const conferidos: MembroConferido[] = [];
  for (const [indice, m] of membros.entries()) {
    if (!FUNCOES_MEMBRO.includes(m.funcao))
      return { ok: false, problema: { indice, campo: 'funcao', texto: 'Função da equipe desconhecida.' } };
    if (!Number.isInteger(m.profissional) || m.profissional <= 0)
      return { ok: false, problema: { indice, campo: 'profissional', texto: 'Escolha o profissional.' } };
    if (m.procedimento !== null && (m.procedimento < 0 || m.procedimento >= quantidadeProcedimentos))
      return {
        ok: false,
        problema: { indice, campo: 'procedimento', texto: 'O procedimento do membro não está no registro.' },
      };
    const r = conferirParticipacao(m.funcao, m, sala);
    if (!r.ok) return { ok: false, problema: { indice, campo: r.campo, texto: r.texto } };
    const atual: MembroConferido = {
      funcao: m.funcao,
      profissional: m.profissional,
      procedimento: m.procedimento,
      entradaMin: r.valor.entradaMin ?? 0,
      saidaMin: r.valor.saidaMin ?? duracao,
      entradaInformada: m.entrada !== null,
      saidaInformada: m.saida !== null,
      percentual: r.valor.percentual,
    };
    for (const outro of conferidos) {
      if (!mesmoEscopo(outro.procedimento, atual.procedimento) || !sobrepoe(outro, atual)) continue;
      if (outro.funcao === atual.funcao)
        return {
          ok: false,
          problema: {
            indice,
            campo: 'entrada',
            texto: 'Na troca, o membro da mesma função entra depois da saída do anterior.',
          },
        };
      if (outro.profissional === atual.profissional)
        return {
          ok: false,
          problema: {
            indice,
            campo: 'profissional',
            texto: 'O mesmo profissional não ocupa duas funções ao mesmo tempo.',
          },
        };
    }
    conferidos.push(atual);
  }
  if (!conferidos.some((m) => m.funcao === 'cirurgiao'))
    return {
      ok: false,
      problema: { indice: 0, campo: 'funcao', texto: 'A equipe precisa de pelo menos um cirurgião.' },
    };
  return { ok: true, membros: conferidos };
}

/** Os membros que valem para o procedimento de posição `indice` (os do ato inteiro valem para todos). */
export function membrosDoProcedimento<T extends { readonly procedimento: number | null }>(
  membros: readonly T[],
  indice: number,
): T[] {
  return membros.filter((m) => m.procedimento === null || m.procedimento === indice);
}

/** O principal do ato: o cirurgião do procedimento principal que entrou primeiro. */
export function principalDoAto(membros: readonly MembroConferido[]): MembroConferido | null {
  return (
    membrosDoProcedimento(membros, 0)
      .filter((m) => m.funcao === 'cirurgiao')
      .sort((a, b) => a.entradaMin - b.entradaMin)[0] ?? null
  );
}

/** Minutos de participação lidos do banco (entrada e saída nulas = o tempo do paciente na sala). */
export function minutosDeParticipacao(
  entrada: Date | null,
  saida: Date | null,
  sala: { readonly entrada: Date; readonly saida: Date },
): number {
  const ini = (entrada ?? sala.entrada).getTime();
  const fim = (saida ?? sala.saida).getTime();
  return Math.max(0, Math.round((fim - ini) / 60_000));
}

/** Tipo da função de cobrança que corresponde à função do ato (null = não gera honorário na conta). */
export function tipoCobrancaDaFuncao(funcao: string): {
  readonly tipo: 'cirurgiao' | 'auxiliar' | 'anestesista' | 'instrumentador';
  readonly ordem: number | null;
} | null {
  if (funcao === 'cirurgiao') return { tipo: 'cirurgiao', ordem: null };
  if (funcao === 'anestesista') return { tipo: 'anestesista', ordem: null };
  if (funcao === 'instrumentador') return { tipo: 'instrumentador', ordem: null };
  const aux = /^auxiliar([1-9])$/.exec(funcao);
  return aux ? { tipo: 'auxiliar', ordem: Number(aux[1]) } : null;
}

export interface MembroParaConta {
  readonly profissional: number;
  /** Função de cobrança já resolvida; null = a função do ato não gera honorário. */
  readonly funcaoCobranca: number | null;
  /** Vaga única do item ("cirurgiao", "anestesista", "auxiliar:1"); null = a função admite mais de uma pessoa. */
  readonly vaga: string | null;
  readonly minutos: number;
  readonly percentual: number | null;
}

export interface ParticipanteDoItem {
  readonly profissionalId: number;
  readonly funcaoId: number;
  readonly grauId: number | null;
  readonly percentual: number | null;
  readonly formaPagamento: 'via_hospital' | 'direto_fonte_pagadora' | 'paciente' | 'sem_cobranca';
}

/** A vaga única do item da conta para a função de cobrança (o item tem um cirurgião, um anestesista, um 1º auxiliar). */
export function vagaDaCobranca(tipo: string, ordemAuxiliar: number | null): string | null {
  if (tipo === 'cirurgiao' || tipo === 'anestesista') return tipo;
  if (tipo === 'auxiliar') return `auxiliar:${ordemAuxiliar ?? 0}`;
  return null;
}

/**
 * A equipe do item da conta depois da ponte. Os participantes que o faturista já tinha ficam como estão. Cada membro do
 * procedimento que gera honorário entra uma vez por profissional e função de cobrança; a reentrada soma os minutos e
 * fica com o maior percentual. Na vaga única do item (cirurgião, anestesista, cada auxiliar), entra quem ficou mais
 * tempo; os demais da troca voltam em `foraDaVaga` para o faturista decidir, e a vaga já ocupada no item não muda.
 */
export function equipeDoItemComOAto(
  existentes: readonly (ParticipanteDoItem & { readonly vaga: string | null })[],
  membros: readonly MembroParaConta[],
): {
  readonly participantes: ParticipanteDoItem[];
  readonly incluidos: number;
  readonly foraDaVaga: { readonly profissional: number; readonly funcaoCobranca: number }[];
} {
  const chave = (p: number, f: number) => `${p}:${f}`;
  const vistos = new Set(existentes.map((p) => chave(p.profissionalId, p.funcaoId)));
  const vagasOcupadas = new Set(existentes.map((p) => p.vaga).filter((v): v is string => v !== null));
  const juntos = new Map<string, MembroParaConta & { funcaoCobranca: number }>();
  for (const m of membros) {
    if (m.funcaoCobranca === null) continue;
    const k = chave(m.profissional, m.funcaoCobranca);
    if (vistos.has(k)) continue;
    const ja = juntos.get(k);
    const percentual =
      ja && ja.percentual !== null && m.percentual !== null
        ? Math.max(ja.percentual, m.percentual)
        : (ja?.percentual ?? m.percentual);
    juntos.set(k, {
      ...m,
      funcaoCobranca: m.funcaoCobranca,
      minutos: (ja?.minutos ?? 0) + m.minutos,
      percentual,
    });
  }
  const escolhidos: (MembroParaConta & { funcaoCobranca: number })[] = [];
  const foraDaVaga: { profissional: number; funcaoCobranca: number }[] = [];
  const porVaga = new Map<string, MembroParaConta & { funcaoCobranca: number }>();
  for (const m of juntos.values()) {
    if (m.vaga === null) {
      escolhidos.push(m);
      continue;
    }
    if (vagasOcupadas.has(m.vaga)) {
      foraDaVaga.push({ profissional: m.profissional, funcaoCobranca: m.funcaoCobranca });
      continue;
    }
    const atual = porVaga.get(m.vaga);
    if (!atual || m.minutos > atual.minutos) {
      if (atual) foraDaVaga.push({ profissional: atual.profissional, funcaoCobranca: atual.funcaoCobranca });
      porVaga.set(m.vaga, m);
    } else foraDaVaga.push({ profissional: m.profissional, funcaoCobranca: m.funcaoCobranca });
  }
  const novos = [...escolhidos, ...porVaga.values()].map((m): ParticipanteDoItem => ({
    profissionalId: m.profissional,
    funcaoId: m.funcaoCobranca,
    grauId: null,
    percentual: m.percentual,
    formaPagamento: 'via_hospital',
  }));
  const semVaga = existentes.map((p): ParticipanteDoItem => ({
    profissionalId: p.profissionalId,
    funcaoId: p.funcaoId,
    grauId: p.grauId,
    percentual: p.percentual,
    formaPagamento: p.formaPagamento,
  }));
  return { participantes: [...semVaga, ...novos], incluidos: novos.length, foraDaVaga };
}

/** Tipos de item faturável que recebem a equipe do ato: o procedimento e o honorário (nunca material, diária, taxa). */
export const TIPOS_ITEM_COM_EQUIPE = ['procedimento', 'honorario'] as const;
/** Situações do item da conta que já não aceitam equipe (o registro fica, mas a equipe não muda). */
export const SITUACOES_ITEM_SEM_EQUIPE = ['estornado', 'transferido'] as const;

/** Por que o item da conta não recebe a equipe do ato; null quando recebe. */
export function motivoItemSemEquipe(item: {
  readonly tipoItem: string;
  readonly situacao: string;
  readonly contaEditavel: boolean;
}): 'tipo' | 'inativo' | 'conta-fechada' | null {
  if (!(TIPOS_ITEM_COM_EQUIPE as readonly string[]).includes(item.tipoItem)) return 'tipo';
  if ((SITUACOES_ITEM_SEM_EQUIPE as readonly string[]).includes(item.situacao)) return 'inativo';
  if (!item.contaEditavel) return 'conta-fechada';
  return null;
}
