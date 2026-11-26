// Estados do agendamento cirúrgico (ficha do M18, seção 6). "Solicitado" não ocupa a sala; confirmar põe a cirurgia
// na agenda da sala; cancelar e suspender tiram da sala pelo caminho auditável (a situação muda, com o motivo); "no
// bloco" e "em sala" são marcações do andamento; "realizado" nasce do registro do ato cirúrgico.
// "Não informada" (V-D1, recusas da carga): o agendamento migrado sem situação na origem. Não é acionável (não ocupa a
// sala, não vai ao mapa do bloco, à fila do dia nem ao aviso); só se consulta, cancela ou reagenda (volta a pedido de
// sala, como a suspensa retomada, e é confirmado na sala pelo caminho de sempre).

export const ESTADOS_AGENDAMENTO = [
  'solicitado',
  'confirmado',
  'no-bloco',
  'em-sala',
  'realizado',
  'suspenso',
  'cancelado',
  'nao-informada',
] as const;
export type EstadoAgendamento = (typeof ESTADOS_AGENDAMENTO)[number];

export const ROTULOS_ESTADO: Readonly<Record<EstadoAgendamento, string>> = {
  solicitado: 'Solicitado',
  confirmado: 'Confirmado',
  'no-bloco': 'No bloco',
  'em-sala': 'Em sala',
  realizado: 'Realizado',
  suspenso: 'Suspenso',
  cancelado: 'Cancelado',
  'nao-informada': 'Não informada na origem',
};

const TRANSICOES: Readonly<Record<EstadoAgendamento, readonly EstadoAgendamento[]>> = {
  solicitado: ['confirmado', 'suspenso', 'cancelado'],
  confirmado: ['no-bloco', 'em-sala', 'realizado', 'suspenso', 'cancelado'],
  'no-bloco': ['em-sala', 'realizado', 'suspenso', 'cancelado'],
  'em-sala': ['realizado'],
  suspenso: ['solicitado', 'cancelado'],
  realizado: [],
  cancelado: [],
  'nao-informada': ['solicitado', 'cancelado'],
};

export function estadoValido(e: string): e is EstadoAgendamento {
  return (ESTADOS_AGENDAMENTO as readonly string[]).includes(e);
}

export function podeIr(de: EstadoAgendamento, para: EstadoAgendamento): boolean {
  return TRANSICOES[de].includes(para);
}

export function proximosEstados(de: EstadoAgendamento): readonly EstadoAgendamento[] {
  return TRANSICOES[de];
}

/** O agendamento ocupa a sala (está na agenda da sala)? */
export function ocupaSala(e: EstadoAgendamento): boolean {
  return e === 'confirmado' || e === 'no-bloco' || e === 'em-sala';
}

/** Estado de uma cirurgia do mapa sem registro do novo (gravada pelo outro sistema): confirmado. */
export function estadoEfetivo(
  registrado: EstadoAgendamento | null,
  temRealizada: boolean,
): EstadoAgendamento {
  if (temRealizada) return 'realizado';
  return registrado ?? 'confirmado';
}

/** Ações que a tela oferece para o estado (cada uma ainda exige a permissão e a sala do usuário). */
export interface AcoesAgendamento {
  readonly confirmar: boolean;
  readonly mover: boolean;
  readonly cancelar: boolean;
  readonly suspender: boolean;
  readonly retomar: boolean;
  readonly registrar: boolean;
  readonly marcarNoBloco: boolean;
  readonly marcarEmSala: boolean;
}

export function acoesDoEstado(e: EstadoAgendamento): AcoesAgendamento {
  return {
    confirmar: e === 'solicitado',
    mover: e === 'confirmado' || e === 'solicitado',
    cancelar: podeIr(e, 'cancelado'),
    suspender: podeIr(e, 'suspenso'),
    retomar: e === 'suspenso' || e === 'nao-informada',
    registrar: ocupaSala(e),
    marcarNoBloco: e === 'confirmado',
    marcarEmSala: e === 'confirmado' || e === 'no-bloco',
  };
}
