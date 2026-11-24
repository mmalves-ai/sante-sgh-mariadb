import {
  type GrupoPrioridadeCadastro,
  type PrioridadeDoPaciente,
  prioridadeNaMarcacao,
} from './prioridade-marcacao.js';
// Ordem da lista de espera por vaga (02-AGE linha 48). A prioridade legal (idoso, idoso acima de 80, gestante,
// pessoa com deficiência, TEA) é a MESMA da senha e da marcação: o grupo sai de `prioridadeNaMarcacao`
// (prioridade-marcacao.ts), com o informado, o do cadastro do paciente e o da idade. Na inclusão ele fica gravado no
// pedido (lista_espera.grupo_prioridade_legal_id) e no histórico, como retrato; a FILA, porém, reavalia o grupo na
// data da leitura e da oferta (`grupoLegalVigenteNaEspera`): quem faz 60 ou 80 anos esperando sobe, quem tem a
// vigência encerrada (fim da gestação) ou o grupo desativado deixa de passar à frente. Quem decide a ordem entre os
// grupos é o peso do grupo (menor chama antes), o mesmo que ordena a senha e os encaixes.
//
// A fila é POR VAGA: a chave é a agenda do pedido, ou a especialidade quando o pedido não tem agenda
// (`chaveFilaEspera`). A posição conta dentro da chave, e a oferta que passa alguém à frente na mesma chave exige
// motivo (`conferirOfertaEspera`), gravado no histórico.
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
  /** Agenda do pedido (nula: só especialidade). */
  readonly agenda?: number | null;
  /** Código da especialidade do pedido. */
  readonly especialidade?: number | null;
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

/** A chave da fila do pedido: a agenda, ou a especialidade quando o pedido não tem agenda. */
export function chaveFilaEspera(i: {
  readonly agenda?: number | null;
  readonly especialidade?: number | null;
}): string {
  if (i.agenda !== null && i.agenda !== undefined) return `agenda:${i.agenda}`;
  return `especialidade:${i.especialidade ?? '-'}`;
}

/** A posição de cada pedido aguardando DENTRO da sua fila (chave), na ordem da regra. */
export function posicoesNaFilaEspera<T extends ItemFilaEsperaPrioridade>(
  itens: readonly T[],
): Map<number, number> {
  const pos = new Map<number, number>();
  const cont = new Map<string, number>();
  for (const i of ordenarFilaEspera(itens)) {
    const k = chaveFilaEspera(i);
    const n = (cont.get(k) ?? 0) + 1;
    cont.set(k, n);
    pos.set(i.id, n);
  }
  return pos;
}

/**
 * Grupo legal VIGENTE do pedido na data (leitura ou oferta): a mesma regra da marcação e da senha, com o grupo
 * informado na inclusão como candidato (se o grupo foi desativado, deixa de valer, sem recusar a leitura), mais o
 * cadastro do paciente vigente na data e a idade na data.
 */
export function grupoLegalVigenteNaEspera(
  grupos: readonly GrupoPrioridadeCadastro[],
  e: {
    readonly informada: number | null;
    readonly doPaciente: readonly PrioridadeDoPaciente[];
    readonly nascimento: string | null;
    readonly data: string;
  },
): number | null {
  const informada =
    e.informada !== null && grupos.some((g) => g.id === e.informada && g.ativo) ? e.informada : null;
  const r = prioridadeNaMarcacao(grupos, { ...e, informada });
  return r.ok ? r.grupo : null;
}

/**
 * O que a fila mostra na coluna de prioridade com o grupo vigente: urgente fica urgente; com grupo, preferencial; o
 * pedido antigo só "preferencial", sem grupo gravado, continua preferencial; o resto, normal.
 */
export function prioridadeVigenteNaEspera(
  gravada: string,
  grupoGravado: number | null,
  vigente: number | null,
): PrioridadeGravadaEspera {
  if (gravada === 'urgente') return 'urgente';
  if (vigente !== null) return 'preferencial';
  return gravada === 'preferencial' && grupoGravado === null ? 'preferencial' : 'normal';
}

export type ConferenciaOfertaEspera =
  | { readonly ok: true; readonly aFrente: number }
  | { readonly ok: false; readonly codigo: string; readonly motivo: string; readonly aFrente: number };

/**
 * A oferta de uma vaga a um pedido: a vaga tem de ser da agenda do pedido (ou, no pedido sem agenda, de uma agenda
 * que atende a especialidade dele); quem tem pedidos à frente na mesma fila só recebe a vaga com motivo.
 */
export function conferirOfertaEspera<T extends ItemFilaEsperaPrioridade>(
  fila: readonly T[],
  pedido: T,
  vaga: { readonly agenda: number; readonly especialidadesDaAgenda: readonly number[] },
  motivo: string | null,
): ConferenciaOfertaEspera {
  const compativel =
    pedido.agenda !== null && pedido.agenda !== undefined
      ? pedido.agenda === vaga.agenda
      : pedido.especialidade !== null &&
        pedido.especialidade !== undefined &&
        vaga.especialidadesDaAgenda.includes(pedido.especialidade);
  const k = chaveFilaEspera(pedido);
  const ordem = ordenarFilaEspera(fila.filter((i) => chaveFilaEspera(i) === k));
  const idx = ordem.findIndex((i) => i.id === pedido.id);
  const aFrente = idx < 0 ? 0 : idx;
  if (!compativel)
    return {
      ok: false,
      codigo: 'vaga-incompativel',
      motivo: 'A vaga não é da agenda do pedido nem de uma agenda que atende a especialidade dele.',
      aFrente,
    };
  if (aFrente > 0 && !(motivo ?? '').trim())
    return {
      ok: false,
      codigo: 'oferta-fora-da-ordem',
      motivo: `Há ${aFrente} pedido(s) à frente nesta fila: informe o motivo para ofertar fora da ordem.`,
      aFrente,
    };
  return { ok: true, aFrente };
}
