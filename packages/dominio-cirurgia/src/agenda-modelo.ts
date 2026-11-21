// Agenda do centro cirúrgico sobre o modelo próprio: a tradução entre a situação gravada no agendamento
// (agendamento_cirurgico.situacao) e o estado da tela (EstadoAgendamento), e as regras de horário na sala, puras, que a
// porta própria aplica sob a transação (com a sala travada) e a porta em memória aplica sobre o estado sintético.
// Melhoria: as regras do cadastro da sala (preparo, intervalo e duração mínimos, procedimento vedado) valem na agenda,
// além do conflito com preparo e limpeza dos dois lados, do horário no passado e da remarcação para o mesmo horário.
import { type EstadoAgendamento, podeIr } from './estados.js';
import { type Conflito, conflitosNaSala, type OcupacaoSala } from './sobreposicao.js';

/** Situações do agendamento no modelo (CHECK de agendamento_cirurgico.situacao). */
export const SITUACOES_AGENDAMENTO_MODELO = [
  'solicitado',
  'em_analise',
  'reprovado',
  'agendado',
  'confirmado',
  'no_bloco',
  'em_andamento',
  'realizado',
  'suspenso',
  'cancelado',
] as const;
export type SituacaoAgendamentoModelo = (typeof SITUACOES_AGENDAMENTO_MODELO)[number];

const ESTADO_DA_SITUACAO: Readonly<Record<SituacaoAgendamentoModelo, EstadoAgendamento>> = {
  solicitado: 'solicitado',
  em_analise: 'solicitado',
  reprovado: 'cancelado',
  agendado: 'confirmado',
  confirmado: 'confirmado',
  no_bloco: 'no-bloco',
  em_andamento: 'em-sala',
  realizado: 'realizado',
  suspenso: 'suspenso',
  cancelado: 'cancelado',
};

/** Situação gravada → estado da tela; null para código desconhecido (quem chama registra ou recusa). */
export function estadoDaSituacao(s: string): EstadoAgendamento | null {
  return (SITUACOES_AGENDAMENTO_MODELO as readonly string[]).includes(s)
    ? ESTADO_DA_SITUACAO[s as SituacaoAgendamentoModelo]
    : null;
}

/** Estado pedido pela tela → situação a gravar. */
export function situacaoDoEstado(e: EstadoAgendamento): SituacaoAgendamentoModelo {
  switch (e) {
    case 'solicitado':
      return 'solicitado';
    case 'confirmado':
      return 'confirmado';
    case 'em-sala':
      return 'em_andamento';
    case 'realizado':
      return 'realizado';
    case 'suspenso':
      return 'suspenso';
    case 'cancelado':
      return 'cancelado';
    case 'no-bloco':
      return 'no_bloco';
  }
}

/** A situação gravada ocupa a sala? */
export function situacaoOcupaSala(s: string): boolean {
  return (
    s === 'agendado' || s === 'confirmado' || s === 'no_bloco' || s === 'em_andamento' || s === 'realizado'
  );
}

export type RecusaTransicao = 'situacao-desconhecida' | 'estado-mudou' | 'transicao-invalida' | null;

/**
 * Conferência da mudança de estado sob a transação: a situação relida tem de ser a que a tela viu (quando informada)
 * e a transição tem de valer pela regra dos estados. Ir ao estado em que já está é aceito (sem efeito).
 */
export function conferirTransicao(
  situacaoAtual: string,
  nova: EstadoAgendamento,
  visto: EstadoAgendamento | null,
): RecusaTransicao {
  const atual = estadoDaSituacao(situacaoAtual);
  if (atual === null) return 'situacao-desconhecida';
  if (visto !== null && atual !== visto) return 'estado-mudou';
  if (atual === nova) return null;
  return podeIr(atual, nova) ? null : 'transicao-invalida';
}

/** O cadastro da sala que a agenda confere. */
export interface SalaDaAgenda {
  readonly id: number;
  /** sala_cirurgica.tempo_preparo_minutos. */
  readonly preparoMin: number;
  /** sala_cirurgica.tempo_minimo_minutos (menor duração aceita). */
  readonly duracaoMinimaMin: number | null;
  /** sala_cirurgica.intervalo_minimo_minutos (intervalo mínimo entre cirurgias). */
  readonly intervaloMinimoMin: number | null;
  /** Procedimentos com regra "vedado" nesta sala. */
  readonly procedimentosVedados: readonly number[];
}

export interface HorarioPedido {
  /** Id do agendamento (0 no novo; na remarcação, o próprio fica fora do conflito). */
  readonly id: number;
  readonly sala: number;
  /** "AAAA-MM-DD HH:MM", civil do estabelecimento. */
  readonly inicio: string;
  readonly duracaoMin: number;
  /** Limpeza depois desta cirurgia (agendamento_cirurgico.tempo_limpeza_minutos). */
  readonly limpezaMin: number;
  readonly procedimentos: readonly number[];
  /** Preparo mínimo do parâmetro do estabelecimento. */
  readonly preparoMinimoMin: number;
  /** Agora, "AAAA-MM-DD HH:MM", civil do estabelecimento. */
  readonly agora: string;
  /** Na remarcação, a sala e o início vistos. */
  readonly anterior: { readonly sala: number; readonly inicio: string } | null;
  /** Exceção de urgência registrada (só libera o conflito de horário). */
  readonly excecao: boolean;
}

export type CodigoRecusaAgenda =
  | 'horario-passado'
  | 'mesmo-horario'
  | 'procedimento-vedado-na-sala'
  | 'duracao-abaixo-do-minimo'
  | 'sala-ocupada';

export interface RecusaAgenda {
  readonly codigo: CodigoRecusaAgenda;
  readonly mensagem: string;
  readonly campo: 'hora' | 'sala' | 'procedimento' | 'duracaoMin';
}

export interface ConferenciaAgenda {
  readonly recusa: RecusaAgenda | null;
  /** Conflitos aceitos pela exceção de urgência (a tela marca a cirurgia). */
  readonly conflitos: readonly Conflito[];
}

/** Preparo entre cirurgias da sala: o maior entre o da sala, o intervalo mínimo dela e o do parâmetro. */
export function preparoDaSala(sala: SalaDaAgenda, preparoMinimoMin: number): number {
  return Math.max(sala.preparoMin, sala.intervaloMinimoMin ?? 0, preparoMinimoMin, 0);
}

/** Regras de horário na sala, na ordem em que a tela as explica. `ocupadas`: as cirurgias que ocupam a sala. */
export function conferirHorarioNaSala(
  p: HorarioPedido,
  sala: SalaDaAgenda,
  ocupadas: readonly OcupacaoSala[],
): ConferenciaAgenda {
  const recusa = (
    codigo: CodigoRecusaAgenda,
    campo: RecusaAgenda['campo'],
    mensagem: string,
  ): ConferenciaAgenda => ({
    recusa: { codigo, campo, mensagem },
    conflitos: [],
  });
  if (p.inicio <= p.agora)
    return recusa(
      'horario-passado',
      'hora',
      'O início já passou pelo relógio do estabelecimento: escolha outro horário.',
    );
  if (p.anterior && p.anterior.sala === p.sala && p.anterior.inicio === p.inicio)
    return recusa('mesmo-horario', 'hora', 'O horário novo é o mesmo do agendamento.');
  const vedado = p.procedimentos.find((x) => sala.procedimentosVedados.includes(x));
  if (vedado !== undefined)
    return recusa(
      'procedimento-vedado-na-sala',
      'procedimento',
      'O procedimento é vedado nesta sala pelo cadastro do bloco: escolha outra sala.',
    );
  if (sala.duracaoMinimaMin !== null && p.duracaoMin < sala.duracaoMinimaMin)
    return recusa(
      'duracao-abaixo-do-minimo',
      'duracaoMin',
      `A sala aceita cirurgias de pelo menos ${sala.duracaoMinimaMin} minutos.`,
    );
  const outras = ocupadas.filter((o) => o.id !== p.id && o.sala === p.sala);
  if (outras.some((o) => o.inicio === p.inicio))
    return recusa(
      'sala-ocupada',
      'hora',
      'Já há uma cirurgia começando nesse minuto na sala: escolha outro horário.',
    );
  const conflitos = conflitosNaSala(
    { id: p.id, sala: p.sala, inicio: p.inicio, duracaoMin: p.duracaoMin, intervaloMin: p.limpezaMin },
    outras,
    preparoDaSala(sala, p.preparoMinimoMin),
  );
  if (conflitos.length > 0 && !p.excecao)
    return recusa(
      'sala-ocupada',
      'hora',
      `A sala está ocupada nesse horário, contando o preparo e a limpeza (cruza com a cirurgia das ${conflitos[0]!.inicio.slice(11)}): escolha outro horário ou registre a exceção de urgência.`,
    );
  return { recusa: null, conflitos };
}
