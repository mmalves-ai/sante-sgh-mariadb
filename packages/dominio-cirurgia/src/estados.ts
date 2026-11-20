// Estados do agendamento cirúrgico (ficha do M18, seção 6: SGH_CC_AGENDA_ESTADO). O outro sistema só conhece a linha
// de CCAGENDA (ID_TBSITAGE nulo em 100% em 2025): "solicitado" vive só no novo e não ocupa a sala; confirmar grava a
// CCAGENDA (o outro sistema passa a ver a cirurgia); cancelar e suspender tiram a linha pelo caminho auditável
// (cópia em CCAGENDA_EXC_CANC e exclusão); "no bloco" e "em sala" são marcações do novo; "realizado" nasce do
// registro do ato (CCCADCIR).

export const ESTADOS_AGENDAMENTO = [
  'solicitado',
  'confirmado',
  'no-bloco',
  'em-sala',
  'realizado',
  'suspenso',
  'cancelado',
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
};

const TRANSICOES: Readonly<Record<EstadoAgendamento, readonly EstadoAgendamento[]>> = {
  solicitado: ['confirmado', 'suspenso', 'cancelado'],
  confirmado: ['no-bloco', 'em-sala', 'realizado', 'suspenso', 'cancelado'],
  'no-bloco': ['em-sala', 'realizado', 'suspenso', 'cancelado'],
  'em-sala': ['realizado'],
  suspenso: ['solicitado', 'cancelado'],
  realizado: [],
  cancelado: [],
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

/** O agendamento ocupa a sala no legado (tem linha em CCAGENDA)? */
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
    retomar: e === 'suspenso',
    registrar: ocupaSala(e),
    marcarNoBloco: e === 'confirmado',
    marcarEmSala: e === 'confirmado' || e === 'no-bloco',
  };
}
