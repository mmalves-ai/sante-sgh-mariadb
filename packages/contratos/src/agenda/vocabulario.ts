// Vocabulário da agenda que o novo decide sozinho (POL-1: padrão de mercado como parâmetro; ajuste quando a
// resposta do call center chegar): motivos codificados do cancelamento (a base de origem guarda texto livre no
// motivo, 1.160 "." e 858 "ca" desde 10/2025, e o cadastro de motivos está vazio), canais da marcação (o código
// numérico do tipo de agendamento da origem: 0 não informado, 10 presencial, 20 telefone, 30 WhatsApp; código de
// baixa confiança, DP-46.2: legenda "a confirmar"), quem pediu o cancelamento (na origem, 1 Agendamento e
// 2 Atendimento; o produto guarda o solicitante próprio), prioridades e situações da lista de espera e resultados
// da confirmação ativa (1 não confirmado, 2 confirmado, 3 refutado, 4 cancelado).

export interface MotivoCancelamento {
  readonly codigo: string;
  /** Texto gravado no motivo do cancelamento (até 300 caracteres, CP1252). */
  readonly texto: string;
  /** Quem costuma pedir. */
  readonly solicitante: 'paciente' | 'hospital' | 'profissional';
}

export const MOTIVOS_CANCELAMENTO: readonly MotivoCancelamento[] = [
  { codigo: 'PAC-DESISTIU', texto: 'Paciente desistiu da consulta', solicitante: 'paciente' },
  { codigo: 'PAC-OUTRA-DATA', texto: 'Paciente pediu outra data', solicitante: 'paciente' },
  { codigo: 'PAC-SAUDE', texto: 'Paciente sem condição de comparecer (saúde)', solicitante: 'paciente' },
  { codigo: 'PAC-OBITO', texto: 'Óbito do paciente', solicitante: 'hospital' },
  { codigo: 'PROF-AUSENTE', texto: 'Profissional indisponível na data', solicitante: 'profissional' },
  { codigo: 'HOSP-AGENDA', texto: 'Ajuste da agenda pelo hospital', solicitante: 'hospital' },
  { codigo: 'CONV-NAO-AUTORIZOU', texto: 'Convênio não autorizou o atendimento', solicitante: 'hospital' },
  { codigo: 'ERRO-MARCACAO', texto: 'Marcação feita por engano', solicitante: 'hospital' },
  { codigo: 'DUPLICADA', texto: 'Marcação em duplicidade', solicitante: 'hospital' },
  { codigo: 'ENCAIXE-DESFEITO', texto: 'Encaixe desfeito', solicitante: 'hospital' },
  { codigo: 'OUTRO', texto: 'Outro motivo', solicitante: 'hospital' },
];

export function motivoCancelamento(codigo: string): MotivoCancelamento | null {
  return MOTIVOS_CANCELAMENTO.find((m) => m.codigo === codigo) ?? null;
}

/** Texto do motivo do cancelamento: o do código, com o complemento (até 300 caracteres). */
export function textoDoMotivo(codigo: string, complemento?: string | null): string {
  const m = motivoCancelamento(codigo);
  if (!m) throw new Error('Motivo de cancelamento desconhecido.');
  const c = (complemento ?? '').replace(/\s+/g, ' ').trim();
  return (c ? `${m.texto}: ${c}` : m.texto).slice(0, 300);
}

export interface CanalMarcacao {
  readonly codigo: 'nao-informado' | 'presencial' | 'telefone' | 'whatsapp' | 'portal';
  readonly rotulo: string;
  /** Código numérico do tipo de agendamento (canal) gravado na marcação; 0 = não informado. */
  readonly codigoTipoAgendamento: number;
  readonly aConfirmar: boolean;
}

export const CANAIS_MARCACAO: readonly CanalMarcacao[] = [
  { codigo: 'presencial', rotulo: 'Presencial (balcão)', codigoTipoAgendamento: 10, aConfirmar: true },
  { codigo: 'telefone', rotulo: 'Telefone (central)', codigoTipoAgendamento: 20, aConfirmar: true },
  { codigo: 'whatsapp', rotulo: 'WhatsApp', codigoTipoAgendamento: 30, aConfirmar: true },
  // Portal do paciente: fora dos tipos da origem. Sem a resposta da DP-46.2, usa o mesmo código do call center (20;
  // ficha do M50, seção 5); o canal "portal" é gravado no modelo próprio.
  { codigo: 'portal', rotulo: 'Portal do paciente', codigoTipoAgendamento: 20, aConfirmar: true },
  { codigo: 'nao-informado', rotulo: 'Não informado', codigoTipoAgendamento: 0, aConfirmar: true },
];

export function canalMarcacao(codigo: string): CanalMarcacao | null {
  return CANAIS_MARCACAO.find((c) => c.codigo === codigo) ?? null;
}

export function canalDoCodigoTipoAgendamento(codigo: number | null | undefined): CanalMarcacao {
  return (
    CANAIS_MARCACAO.find((c) => c.codigoTipoAgendamento === codigo && c.codigo !== 'portal') ??
    (CANAIS_MARCACAO.find((c) => c.codigo === 'nao-informado') as CanalMarcacao)
  );
}

/** O que o pedido guarda: a urgência clínica, ou "preferencial" quando tem grupo de prioridade legal. */
export const PRIORIDADES_ESPERA = ['normal', 'preferencial', 'urgente'] as const;
export type PrioridadeEspera = (typeof PRIORIDADES_ESPERA)[number];
/** O que se informa na inclusão: a urgência clínica (a prioridade legal vai pelo grupo, 02-AGE 48). */
export const URGENCIAS_ESPERA = ['normal', 'urgente'] as const;
export const SITUACOES_ESPERA = ['aguardando', 'ofertado', 'atendido', 'cancelado'] as const;
export type SituacaoEspera = (typeof SITUACOES_ESPERA)[number];

// A ordem da fila de espera é regra do domínio: `ordenarFilaEspera` (@sgh/dominio-agenda, fila-espera.ts).

/** O resultado da tentativa de confirmação. */
export const RESULTADOS_CONFIRMACAO = [
  { id: 1, codigo: 'nao-confirmado', rotulo: 'Não confirmado (sem contato)' },
  { id: 2, codigo: 'confirmado', rotulo: 'Confirmado' },
  { id: 3, codigo: 'refutado', rotulo: 'Recusou (não virá)' },
  { id: 4, codigo: 'cancelado', rotulo: 'Pediu o cancelamento' },
] as const;
export type ResultadoConfirmacao = (typeof RESULTADOS_CONFIRMACAO)[number]['codigo'];

export const MOTIVOS_BLOQUEIO = [
  { codigo: 'FERIAS', rotulo: 'Férias do profissional' },
  { codigo: 'LICENCA', rotulo: 'Licença do profissional' },
  { codigo: 'CONGRESSO', rotulo: 'Congresso ou curso' },
  { codigo: 'PLANTAO', rotulo: 'Plantão em outro setor' },
  { codigo: 'MANUTENCAO', rotulo: 'Manutenção da sala ou equipamento' },
  { codigo: 'FERIADO', rotulo: 'Feriado ou ponto facultativo' },
  { codigo: 'OUTRO', rotulo: 'Outro motivo' },
] as const;
export type MotivoBloqueio = (typeof MOTIVOS_BLOQUEIO)[number]['codigo'];
