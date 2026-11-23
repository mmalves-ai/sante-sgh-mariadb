// Reserva de leito do NIR (M44, etapa 2; ficha, regras 11 e 12): o leito reservado precisa estar livre no mapa
// operacional, sem outra reserva vigente, e atender o perfil da solicitação (sexo e faixa de idade pelos atributos do
// leito, terapia intensiva pelo tipo de acomodação, os tipos aceitos e o isolamento); o leito fora do perfil só com a
// exceção do supervisor, com o motivo. A reserva tem validade: vencida, sai da vigência (o leito volta a livre e a
// solicitação à análise); confirmada, a validade recomeça (o setor de destino aceitou e o paciente está a caminho). A
// ocupação do leito reservado pelo outro sistema é conflito: mostrado e avisado, nunca desfeito. Regras puras.
import type { PerfilLeito, Precaucao, SituacaoReserva } from '@sgh/contratos';
import { compativelComPaciente } from '../adt.js';

const ms = (iso: string) => Date.parse(/[zZ]|[+-]\d{2}:?\d{2}$/.test(iso) ? iso : `${iso}Z`);
const isoSemFuso = (t: number) => new Date(t).toISOString().slice(0, 19);

export interface LeitoParaReserva {
  /** Situação no mapa operacional (livre, ocupado, bloqueado, higienização, conflito, reservado, inativo). */
  readonly situacao: string;
  readonly tipo: number;
  readonly intensiva: boolean;
  readonly atributos: {
    readonly sexo: string | null;
    readonly idadeMinima: number | null;
    readonly idadeMaxima: number | null;
  } | null;
  /** Os outros leitos da mesma acomodação: quantos ocupados e as precauções abertas neles. */
  readonly acomodacao: { readonly ocupados: number; readonly precaucoes: readonly Precaucao[] };
}

export interface PacienteParaReserva {
  readonly sexo: string | null;
  readonly idade: number | null;
}

/** Por que o leito não atende o perfil (null: atende). A exceção do supervisor passa por cima disto, nunca da vaga. */
export function incompatibilidadeComPerfil(
  l: LeitoParaReserva,
  perfil: PerfilLeito,
  p: PacienteParaReserva,
): string | null {
  if (perfil.intensiva && !l.intensiva)
    return 'O pedido é de terapia intensiva e o leito não é de terapia intensiva.';
  if (!perfil.intensiva && l.intensiva)
    return 'O leito é de terapia intensiva e o pedido não: guarde-o para quem precisa.';
  if (perfil.tiposAcomodacao.length > 0 && !perfil.tiposAcomodacao.includes(l.tipo))
    return 'O tipo de acomodação do leito não está entre os aceitos pelo pedido.';
  const atributo = compativelComPaciente(l.atributos, p);
  if (atributo) return atributo;
  if (perfil.precaucao && l.acomodacao.ocupados > 0)
    return 'O paciente precisa de isolamento e a acomodação tem outro paciente.';
  if (!perfil.precaucao && l.acomodacao.precaucoes.length > 0)
    return 'A acomodação tem paciente em isolamento: escolha outra.';
  if (perfil.precaucao && l.acomodacao.precaucoes.some((x) => x !== perfil.precaucao))
    return 'A acomodação tem precaução de outro tipo.';
  return null;
}

export type DecisaoReserva =
  | { readonly ok: true; readonly comExcecao: boolean }
  | {
      readonly ok: false;
      readonly codigo: 'leito-indisponivel' | 'leito-reservado' | 'leito-incompativel';
      readonly motivo: string;
    };

/** Pode reservar? A vaga (livre e sem outra reserva) nunca tem exceção; o perfil, só com o motivo do supervisor. */
export function decidirReserva(
  l: LeitoParaReserva,
  perfil: PerfilLeito,
  p: PacienteParaReserva,
  excecao: string | null,
): DecisaoReserva {
  if (l.situacao === 'reservado')
    return {
      ok: false,
      codigo: 'leito-reservado',
      motivo: 'O leito já tem uma reserva vigente para outra solicitação.',
    };
  if (l.situacao !== 'livre')
    return {
      ok: false,
      codigo: 'leito-indisponivel',
      motivo: 'O leito não está livre no mapa (ocupado, bloqueado ou em higienização).',
    };
  const inc = incompatibilidadeComPerfil(l, perfil, p);
  if (inc && !excecao) return { ok: false, codigo: 'leito-incompativel', motivo: inc };
  return { ok: true, comExcecao: inc !== null };
}

/** A validade da reserva a partir de agora (hora local sem fuso). */
export function validadeDaReserva(agora: string, minutos: number): string {
  return isoSemFuso(ms(agora) + minutos * 60_000);
}

export function reservaVigente(s: SituacaoReserva): boolean {
  return s === 'ativa' || s === 'confirmada';
}

/**
 * Cancelar a reserva (o antigo "excluir a criada por engano" também cancela: a linha fica para a auditoria, com o
 * motivo, quem e quando; SBIS-26). Só a vigente se cancela, e o leito volta a livre; a convertida em internação se
 * corrige pela internação; a já encerrada (expirada ou cancelada) fica como está, no histórico.
 */
export function decidirCancelamentoReserva(
  s: SituacaoReserva,
):
  | { readonly ok: true }
  | {
      readonly ok: false;
      readonly codigo: 'reserva-convertida' | 'reserva-desatualizada';
      readonly motivo: string;
    } {
  if (s === 'consumida')
    return {
      ok: false,
      codigo: 'reserva-convertida',
      motivo: 'A reserva já virou internação: não se altera nem se cancela (corrija pela internação).',
    };
  if (!reservaVigente(s))
    return {
      ok: false,
      codigo: 'reserva-desatualizada',
      motivo: 'A reserva já está encerrada (expirada ou cancelada): fica no histórico como está.',
    };
  return { ok: true };
}

/** A reserva vigente que passou da validade (o `worker` a expira). */
export function reservaVencida(r: { situacao: SituacaoReserva; validaAte: string }, agora: string): boolean {
  return reservaVigente(r.situacao) && ms(agora) > ms(r.validaAte);
}

/** Minutos que faltam para vencer (negativo: vencida). */
export function minutosParaVencer(validaAte: string, agora: string): number {
  return Math.floor((ms(validaAte) - ms(agora)) / 60_000);
}

/** A chave idempotente da expiração (dois consumidores do `worker` não expiram duas vezes). */
export function chaveExpiracao(hospital: string, reserva: number): string {
  return `nir.reserva.expira:${hospital}:${reserva}`;
}

/**
 * Regra 12: o leito reservado no novo que o outro sistema ocupou. O conflito é visto (e avisado ao NIR) uma vez: a
 * reserva fica como está até o NIR decidir (cancelar e escolher outro leito); o novo nunca desfaz a ocupação.
 */
export function conflitoDaReserva(
  r: { situacao: SituacaoReserva; conflitoEm: string | null },
  ocupadoPor: number | null,
): 'novo' | 'registrado' | null {
  if (!reservaVigente(r.situacao) || ocupadoPor === null) return null;
  return r.conflitoEm ? 'registrado' : 'novo';
}
