// Início do ato transfusional (ficha do M47, regra 2; cap-05b §5.11 "Regras, Transfusão" e §5.8 "dupla checagem de
// hemocomponente"): sem a dupla checagem da bolsa contra a pulseira, a transfusão não é registrada como iniciada. A
// conferência junta, numa decisão só (o servidor recusa com TRANSFUSAO_BLOQUEADA e os motivos):
//   - a pulseira lida é do paciente da requisição (no hemocomponente a leitura é obrigatória; só a extrema urgência
//     aceita o motivo de não ler, como na checagem do M25);
//   - o segundo profissional conferiu com o próprio login (outra pessoa, autenticada na hora, com a permissão);
//   - a amostra pré-transfusional foi coletada e está na validade (dispensada na extrema urgência);
//   - o termo de consentimento está assinado (ou a extrema urgência tem a justificativa);
//   - os sinais vitais de antes foram medidos há pouco;
//   - a bolsa passa na regra 3 e ainda não foi usada em outro ato;
//   - o horário do item no outro sistema, quando nasceu, está pendente de checagem (situação P).
// A pulseira é interpretada na API pela conferência do M25 (`conferirPulseira`, @sgh/dominio-enfermagem): aqui chega o
// paciente lido.
import type { EstadoRequisicaoTransfusao, UrgenciaTransfusao } from '@sgh/contratos';
import type { AlertaBolsa, BloqueioBolsa, ConferenciaBolsa } from './bolsa.js';
import { dispensaProvas } from './requisicao.js';

/** Validade da amostra pré-transfusional (horas; RDC 34/2014: até 72 h). Parâmetro do estabelecimento. */
export const VALIDADE_AMOSTRA_HORAS = 72;
/** Até quanto tempo antes do início os sinais "antes" valem (minutos). */
export const JANELA_SINAIS_ANTES_MIN = 30;

export type BloqueioInicio =
  | BloqueioBolsa
  | 'pulseira-nao-lida'
  | 'pulseira-outro-paciente'
  | 'sem-segundo-profissional'
  | 'segundo-profissional-igual'
  | 'segundo-profissional-sem-permissao'
  | 'sem-amostra'
  | 'amostra-vencida'
  | 'sem-termo'
  | 'sem-sinais-antes'
  | 'sinais-antes-antigos'
  | 'bolsa-ja-usada'
  | 'requisicao-fechada'
  | 'horario-nao-pendente';

export const MENSAGENS_INICIO: Readonly<Partial<Record<BloqueioInicio, string>>> = {
  'pulseira-nao-lida': 'Leia a pulseira do paciente: a transfusão exige a leitura.',
  'pulseira-outro-paciente': 'A pulseira lida não é do paciente da requisição: confira antes de transfundir.',
  'sem-segundo-profissional': 'A transfusão exige a conferência de um segundo profissional.',
  'segundo-profissional-igual': 'O segundo profissional tem de ser outra pessoa.',
  'segundo-profissional-sem-permissao':
    'O segundo profissional não tem permissão para conferir a transfusão.',
  'sem-amostra': 'Colete a amostra pré-transfusional antes.',
  'amostra-vencida': 'A amostra pré-transfusional passou da validade: colete outra.',
  'sem-termo': 'O termo de consentimento da transfusão não está assinado.',
  'sem-sinais-antes': 'Meça os sinais vitais antes de iniciar.',
  'sinais-antes-antigos': 'Os sinais vitais de antes foram medidos há mais de 30 minutos: meça de novo.',
  'bolsa-ja-usada': 'Esta bolsa já foi usada em outra transfusão.',
  'requisicao-fechada': 'A requisição não está aberta para transfusão.',
  'horario-nao-pendente': 'O horário do item não está pendente de checagem (suspenso ou já checado).',
};

const minutos = (de: string, ate: string) =>
  (Date.parse(`${ate.slice(0, 19)}Z`) - Date.parse(`${de.slice(0, 19)}Z`)) / 60_000;

export interface ConferenciaInicio {
  readonly pode: boolean;
  readonly bloqueios: readonly BloqueioInicio[];
  readonly alertas: readonly AlertaBolsa[];
}

/** Regra 2: a dupla checagem e as condições do início. */
export function conferirInicioTransfusao(c: {
  readonly agora: string;
  readonly urgencia: UrgenciaTransfusao;
  readonly estadoRequisicao: EstadoRequisicaoTransfusao;
  readonly pacienteDaRequisicao: number;
  /** Paciente lido da pulseira (null = não lida, com motivo). */
  readonly pacienteDaPulseira: number | null;
  readonly profissional: string;
  readonly segundoProfissional: {
    readonly login: string;
    readonly autenticado: boolean;
    readonly temPermissao: boolean;
  } | null;
  readonly amostraColetadaEm: string | null;
  readonly termoAssinado: boolean;
  readonly sinaisAntesEm: string | null;
  readonly bolsa: ConferenciaBolsa;
  readonly bolsaJaUsada: boolean;
  /** Situação do horário no outro sistema (PRCHKGERAL), quando nasceu; null = o item não tem horário. */
  readonly situacaoHorario: string | null;
}): ConferenciaInicio {
  const b: BloqueioInicio[] = [];
  const urgencia = dispensaProvas(c.urgencia);
  if (
    c.estadoRequisicao !== 'requisitada' &&
    c.estadoRequisicao !== 'amostraColetada' &&
    c.estadoRequisicao !== 'emAtendimento'
  )
    b.push('requisicao-fechada');
  if (c.pacienteDaPulseira === null) {
    if (!urgencia) b.push('pulseira-nao-lida');
  } else if (c.pacienteDaPulseira !== c.pacienteDaRequisicao) b.push('pulseira-outro-paciente');
  const s = c.segundoProfissional;
  if (!s || !s.autenticado) b.push('sem-segundo-profissional');
  else if (s.login.trim().toUpperCase() === c.profissional.trim().toUpperCase())
    b.push('segundo-profissional-igual');
  else if (!s.temPermissao) b.push('segundo-profissional-sem-permissao');
  if (!urgencia) {
    if (c.amostraColetadaEm === null) b.push('sem-amostra');
    else if (minutos(c.amostraColetadaEm, c.agora) > VALIDADE_AMOSTRA_HORAS * 60) b.push('amostra-vencida');
    if (!c.termoAssinado) b.push('sem-termo');
  }
  if (c.sinaisAntesEm === null) b.push('sem-sinais-antes');
  else if (minutos(c.sinaisAntesEm, c.agora) > JANELA_SINAIS_ANTES_MIN) b.push('sinais-antes-antigos');
  b.push(...c.bolsa.bloqueios);
  if (c.bolsaJaUsada) b.push('bolsa-ja-usada');
  if (c.situacaoHorario !== null && c.situacaoHorario !== 'P') b.push('horario-nao-pendente');
  return { pode: b.length === 0, bloqueios: b, alertas: c.bolsa.alertas };
}

/** A amostra vale até (ISO sem fuso). */
export function amostraValidaAte(coletadaEm: string, horas = VALIDADE_AMOSTRA_HORAS): string {
  return new Date(Date.parse(`${coletadaEm.slice(0, 19)}Z`) + horas * 3_600_000).toISOString().slice(0, 19);
}

/**
 * O que vai ao horário do item no outro sistema quando ele existe: a checagem "Administrado" do M25, no início do
 * ato (a dupla checagem já feita). Sem horário, o ato fica só no novo e o prontuário mostra a transfusão pelo registro
 * clínico do formulário "Ato transfusional" (ficha, seção 5).
 */
export function gravacaoNoHorario(
  situacaoHorario: string | null,
): 'checar-administrado' | 'so-registro-clinico' {
  return situacaoHorario === 'P' ? 'checar-administrado' : 'so-registro-clinico';
}
