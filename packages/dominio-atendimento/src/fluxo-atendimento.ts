// Regras da abertura, da condução no consultório, da exclusão, da observação do PA e do ato médico, puras (sem banco).
// As portas (memória e banco) leem os fatos e perguntam aqui; a recusa volta com o código e a mensagem de negócio.
import type { SituacaoFila } from './fila-consultorio.js';

export interface Recusa {
  readonly codigo: string;
  readonly mensagem: string;
}

const r = (codigo: string, mensagem: string): Recusa => ({ codigo, mensagem });

/** Situação da senha da recepção (vocabulário do banco próprio). */
export type SituacaoSenha =
  | 'aguardando'
  | 'chamada'
  | 'em_atendimento'
  | 'encaminhada'
  | 'atendida'
  | 'nao_compareceu'
  | 'cancelada';

/** A senha só abre atendimento se for do dia, estiver na fila (aguardando ou chamada) e sem outro atendimento ativo. */
export function recusaSenhaNaAbertura(s: {
  readonly existe: boolean;
  readonly doDia: boolean;
  readonly situacao: string;
  readonly outroAtendimentoAtivo: boolean;
}): Recusa | null {
  if (!s.existe) return r('senha-inexistente', 'A senha não existe neste estabelecimento.');
  if (s.outroAtendimentoAtivo) return r('senha-ja-atendida', 'A senha já tem atendimento aberto.');
  if (!s.doDia) return r('senha-de-outro-dia', 'A senha não é de hoje.');
  if (s.situacao !== 'aguardando' && s.situacao !== 'chamada')
    return r('senha-concluida', 'A senha já foi concluída ou está em atendimento.');
  return null;
}

/** A marcação só abre atendimento se existir, for do dia, do mesmo paciente e ainda sem atendimento. */
export function recusaMarcacaoNaAbertura(m: {
  readonly existe: boolean;
  readonly doDia: boolean;
  readonly jaAtendida: boolean;
  readonly mesmoPaciente: boolean;
}): Recusa | null {
  if (!m.existe) return r('marcacao-inexistente', 'O agendamento não existe mais.');
  if (!m.doDia) return r('marcacao-de-outro-dia', 'O agendamento não é de hoje.');
  if (m.jaAtendida) return r('marcacao-ja-atendida', 'O agendamento já tem atendimento aberto.');
  if (!m.mesmoPaciente) return r('marcacao-de-outro-paciente', 'O agendamento é de outro paciente.');
  return null;
}

/** A situação do atendimento na fila do consultório: pela situação do atendimento e pela chamada já feita. */
export function situacaoNoConsultorio(a: { readonly situacao: string; readonly chamado: boolean }): SituacaoFila {
  if (a.situacao === 'encerrado' || a.situacao === 'cancelado') return 'liberado';
  if (a.situacao === 'em_atendimento' || a.situacao === 'em_observacao') return 'emAtendimento';
  return a.chamado ? 'chamado' : 'aguardando';
}

/** Chamar: quem aguarda ou já foi chamado (chamar de novo). Atender: só quem foi chamado. */
export function recusaConducao(evento: 'chamar' | 'atender', s: SituacaoFila): Recusa | null {
  if (s === 'liberado') return r('atendimento-encerrado', 'O atendimento já foi encerrado.');
  if (s === 'emAtendimento') return r('situacao-mudou', 'O paciente já está em atendimento.');
  if (evento === 'atender' && s !== 'chamado')
    return r('paciente-nao-chamado', 'Chame o paciente antes de iniciar o atendimento.');
  return null;
}

/** Prioridade da fila: '0' acima de 80 anos, '1' demais prioridades legais, '2' normal (menor chama antes). */
export function prioridadeDaSenha(s: {
  readonly prioritaria: boolean;
  readonly idadeMinimaDoGrupo: number | null;
}): '0' | '1' | '2' {
  if (s.idadeMinimaDoGrupo !== null && s.idadeMinimaDoGrupo >= 80) return '0';
  return s.prioritaria ? '1' : '2';
}

/** A exclusão é só do atendimento aberto por engano: nunca do encerrado nem do já excluído. */
export function recusaCancelamento(a: { readonly situacao: string; readonly temDesfecho: boolean }): Recusa | null {
  if (a.situacao === 'cancelado') return r('exclusao-recusada', 'O atendimento já foi excluído.');
  if (a.temDesfecho || a.situacao === 'encerrado')
    return r('exclusao-recusada', 'O atendimento já foi encerrado: a exclusão é só do atendimento aberto por engano.');
  return null;
}

/** Na exclusão, a senha só volta à fila se estava em atendimento e é do dia (a senha de outro dia não reaparece). */
export function senhaVoltaAFila(s: { readonly situacao: string; readonly doDia: boolean }): boolean {
  return s.situacao === 'em_atendimento' && s.doDia;
}

/** Mínimo de caracteres da justificativa da permanência acima do limite da observação. */
export const JUSTIFICATIVA_OBSERVACAO_MINIMO = 10;

/** Saída da observação: acima do limite, pede justificativa (a transferência de leito não é saída). */
export function recusaSaidaObservacao(s: {
  readonly horas: number;
  readonly limiteHoras: number;
  readonly justificativa: string | null;
  readonly transferencia: boolean;
}): Recusa | null {
  if (s.transferencia || s.horas < s.limiteHoras) return null;
  if ((s.justificativa ?? '').trim().length >= JUSTIFICATIVA_OBSERVACAO_MINIMO) return null;
  return r(
    'justificativa-obrigatoria',
    `A observação passou de ${s.limiteHoras} horas: registre a justificativa da permanência (ao menos ${JUSTIFICATIVA_OBSERVACAO_MINIMO} caracteres).`,
  );
}

/**
 * Ato médico (Lei 12.842/2013): alta, encaminhamento, internação, transferência e óbito só por médico, ou seja, CBO da
 * família 225 ou inscrição ativa (ou provisória) no conselho de medicina.
 */
export function ehMedico(p: {
  readonly codigoCbo: string | null;
  readonly siglaConselho: string | null;
  readonly inscricaoAtiva: boolean;
}): boolean {
  if ((p.codigoCbo ?? '').replace(/\D/g, '').startsWith('225')) return true;
  return p.inscricaoAtiva && (p.siglaConselho ?? '').trim().toUpperCase() === 'CRM';
}
