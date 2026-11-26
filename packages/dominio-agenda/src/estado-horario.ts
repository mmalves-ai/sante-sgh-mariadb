// Estado do horário e da marcação (ficha do M17, regras 1, 2, 3 e 8; Anexo A §A.3; ref 01 §2.1 e §9.1).
//   - Vaga = PACIENTE vazio (nunca LIVRE): LIVRE='N' é bloqueado e LIVRE continua 'S' com paciente.
//   - A legenda da situação do horário: 'C' é Confirmado (não Cancelado: o cancelado sai da grade e vai
//     para o histórico de cancelamentos). O novo grava só '', 'C', 'F' e 'T' (transferência na remarcação, o
//     caminho do Delphi medido no perfil); 'A' e 'S' são da recepção e do atendimento (M19/M20).
//   - Encaixe (tipo de horário 'E') nunca vira vaga pública.
//   - Comparecimento é o sinal "atendido" da marcação; vigência = ativa e com horário que ainda não começou.
import { horarioJaPassou, type Horario, type Relogio } from './tempo.js';

export interface SituacaoAgenda {
  readonly codigo: string;
  readonly rotulo: string;
  /** O novo grava este valor (os demais só são lidos). */
  readonly gravadaPeloNovo: boolean;
  /** Ocupa o horário (o paciente continua nele). */
  readonly ocupa: boolean;
}

/** Legenda completa das situações do horário (16 situações; 'N' e '' são "não informado"). */
export const SITUACOES_AGENDA: readonly SituacaoAgenda[] = [
  { codigo: '', rotulo: 'Marcado', gravadaPeloNovo: true, ocupa: true },
  { codigo: 'C', rotulo: 'Confirmado', gravadaPeloNovo: true, ocupa: true },
  { codigo: 'F', rotulo: 'Faltou', gravadaPeloNovo: true, ocupa: true },
  { codigo: 'T', rotulo: 'Transferido (remarcado)', gravadaPeloNovo: true, ocupa: true },
  { codigo: 'A', rotulo: 'Aguardando (chegou)', gravadaPeloNovo: false, ocupa: true },
  { codigo: 'S', rotulo: 'Realizado', gravadaPeloNovo: false, ocupa: true },
  { codigo: 'X', rotulo: 'Cancelado', gravadaPeloNovo: false, ocupa: true },
  { codigo: 'HR', rotulo: 'Horário reservado', gravadaPeloNovo: false, ocupa: true },
  { codigo: 'Q', rotulo: 'Feriado', gravadaPeloNovo: false, ocupa: true },
  { codigo: 'P', rotulo: 'Manutenção', gravadaPeloNovo: false, ocupa: true },
  { codigo: 'U', rotulo: 'Suspenso', gravadaPeloNovo: false, ocupa: true },
  { codigo: 'V', rotulo: 'Óbito', gravadaPeloNovo: false, ocupa: true },
  { codigo: 'W', rotulo: 'Alta', gravadaPeloNovo: false, ocupa: true },
  { codigo: 'Z', rotulo: 'Outras intercorrências', gravadaPeloNovo: false, ocupa: true },
  { codigo: 'R', rotulo: 'Outros', gravadaPeloNovo: false, ocupa: true },
  { codigo: 'N', rotulo: 'Não informado', gravadaPeloNovo: false, ocupa: true },
];

export function situacao(codigo: string | null | undefined): SituacaoAgenda | null {
  const c = (codigo ?? '').trim();
  return SITUACOES_AGENDA.find((s) => s.codigo === c) ?? null;
}

export function rotuloSituacao(codigo: string | null | undefined): string {
  return situacao(codigo)?.rotulo ?? `Código ${(codigo ?? '').trim() || 'vazio'}`;
}

/** Linha da grade de horários como as leituras a devolvem (texto aparado). */
export interface LinhaGrade extends Horario {
  readonly paciente: string;
  /** 'S' disponível; 'N' bloqueado. */
  readonly livre: string;
  readonly situacao: string;
  /** 'N' normal; 'E' encaixe. */
  readonly tipo: string;
}

export type EstadoHorario = 'vago' | 'bloqueado' | 'ocupado' | 'encaixe' | 'passado' | 'situacao-especial';

const vazio = (s: string | null | undefined) => (s ?? '').trim() === '';

/** Regra 2: vaga = paciente vazio, horário normal, livre e sem situação (ex.: feriado Q ou manutenção P). */
export function ehVaga(h: LinhaGrade): boolean {
  return vazio(h.paciente) && h.livre.trim() !== 'N' && vazio(h.situacao) && h.tipo.trim() !== 'E';
}

/** Estado para a tela (cor e ação): o relógio do banco decide o "passado". */
export function estadoDoHorario(h: LinhaGrade, relogio: Relogio | null): EstadoHorario {
  const passou = relogio ? horarioJaPassou(h, relogio) : false;
  if (!vazio(h.paciente)) return h.tipo.trim() === 'E' ? 'encaixe' : 'ocupado';
  if (h.livre.trim() === 'N') return 'bloqueado';
  if (!vazio(h.situacao)) return 'situacao-especial';
  if (h.tipo.trim() === 'E') return 'situacao-especial';
  return passou ? 'passado' : 'vago';
}

/** Vaga oferecida para marcar: vaga e ainda não começou pelo relógio do banco. */
export function vagaOferecida(h: LinhaGrade, relogio: Relogio): boolean {
  return ehVaga(h) && !horarioJaPassou(h, relogio);
}

/** Pode bloquear: horário sem paciente, ainda não bloqueado. Desbloquear: bloqueado e sem paciente. */
export function podeBloquear(h: LinhaGrade): boolean {
  return vazio(h.paciente) && h.livre.trim() !== 'N';
}
export function podeDesbloquear(h: LinhaGrade): boolean {
  return vazio(h.paciente) && h.livre.trim() === 'N';
}

/** Marcação com o estado da grade ao lado. */
export interface SinaisMarcacao {
  readonly atendido: string;
  readonly situacaoHorario: string;
  readonly temSenha: boolean;
}

/** 'nao_informada': marcação migrada sem situação na origem (sinal 'N'), encerrada: nenhuma ação. */
export type EstadoMarcacao =
  'marcada' | 'confirmada' | 'chegou' | 'atendida' | 'faltou' | 'transferida' | 'nao_informada' | 'outra';

export function estadoDaMarcacao(m: SinaisMarcacao): EstadoMarcacao {
  if (m.atendido.trim() === 'S') return 'atendida';
  const s = m.situacaoHorario.trim();
  if (s === 'F') return 'faltou';
  if (s === 'T') return 'transferida';
  if (s === 'N') return 'nao_informada';
  if (s === 'A' || m.temSenha) return 'chegou';
  if (s === 'C') return 'confirmada';
  if (s === '') return 'marcada';
  return 'outra';
}

/** O que a pessoa pode fazer com a marcação (as recusas do banco e do executor continuam valendo). */
export interface AcoesMarcacao {
  readonly cancelar: boolean;
  readonly remarcar: boolean;
  readonly confirmar: boolean;
  readonly registrarFalta: boolean;
}

/**
 * Ações pelo estado: cancelar e remarcar só até o check-in (senha ligada ou atendido recusam); confirmar só
 * marcada; falta só de horário que já passou e sem chegada.
 */
export function acoesDaMarcacao(m: SinaisMarcacao, h: Horario, relogio: Relogio): AcoesMarcacao {
  const e = estadoDaMarcacao(m);
  const aberta = e === 'marcada' || e === 'confirmada';
  const passou = horarioJaPassou(h, relogio);
  return {
    cancelar: aberta || e === 'faltou',
    remarcar: aberta || e === 'faltou',
    confirmar: e === 'marcada' && !passou,
    registrarFalta: aberta && passou,
  };
}

/** Regra 1: vigente = ativa e ao menos um horário que ainda não começou (PERINI/PERFIN não são vigência). */
export function agendaVigente(ativa: string, horariosFuturos: number): boolean {
  return ativa.trim() === 'S' && horariosFuturos > 0;
}
