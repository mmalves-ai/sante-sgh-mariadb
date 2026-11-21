// Telemedicina, etapa 4 do M50 (ficha, seções 5, 7, 8 e 12; regra 7; cap-13 §13.3.5 TELE-01 a TELE-06; Res. CFM
// 2.314/2022; Lei 14.510/2022): a teleconsulta (o paciente na sala de espera virtual do portal, com o termo aceito e o
// local informado antes de o médico iniciar; o atendimento aberto como uma consulta pela receita do M20, com a
// modalidade, o termo e o local em SGH_ATD_TELECONSULTA) e a teleinterconsulta (o médico assistente pede a opinião de
// outro médico do corpo clínico, com o consentimento do paciente; o parecer fica no registro da interconsulta).
// A sala de vídeo é do provedor contratado (só em produção, com a autorização do dono); fora de produção, o provedor
// SIMULADO (nada sai da máquina). Nenhuma mensagem ao paciente (DP-44 a): ele vê a sala no portal.
import { z } from 'zod';
import { UFS } from '../preco/entradas.js';
import { textoCp1252 } from '../texto-cp1252.js';

export const CHAVE_TELEMEDICINA = 'telemedicina';

export const MODALIDADES_TELEMEDICINA = ['teleconsulta', 'teleinterconsulta'] as const;
export type ModalidadeTelemedicina = (typeof MODALIDADES_TELEMEDICINA)[number];

/** A modalidade da marcação no portal (presencial: como sempre; teleconsulta: a sala de espera virtual). */
export const MODALIDADES_MARCACAO = ['presencial', 'teleconsulta'] as const;
export type ModalidadeMarcacao = (typeof MODALIDADES_MARCACAO)[number];

/**
 * Situações da teleconsulta: agendada (a marcação pelo portal) → aguardando (o paciente na sala de espera, com o termo
 * e o local) → sala-aberta (o médico abriu a sala do provedor) → em-andamento (o atendimento aberto pela receita do M20)
 * → encerrada; ou cancelada (a marcação cancelada). Teleinterconsulta: solicitada → sala-aberta (o convidado entrou) →
 * respondida (o parecer); ou cancelada.
 */
export const SITUACOES_TELECONSULTA = [
  'agendada',
  'aguardando',
  'sala-aberta',
  'em-andamento',
  'encerrada',
  'cancelada',
  'solicitada',
  'respondida',
] as const;
export type SituacaoTeleconsulta = (typeof SITUACOES_TELECONSULTA)[number];

/** Versão vigente do termo de consentimento da teleconsulta (TELE-02); o texto abaixo, aceito no portal. */
export const VERSAO_TERMO_TELECONSULTA = 'TELE-2026.1';
export const TEXTO_TERMO_TELECONSULTA: readonly string[] = [
  'A teleconsulta é um atendimento médico a distância, por vídeo, com o mesmo sigilo da consulta presencial (Resolução CFM nº 2.314/2022 e Lei nº 14.510/2022).',
  'O médico pode, a qualquer momento, indicar que o atendimento continue presencialmente quando a avaliação a distância não for suficiente.',
  'A conversa não é gravada pelo hospital. O que o médico registrar fica no seu prontuário, como em qualquer consulta, e os documentos emitidos levam a indicação de que foram emitidos em modalidade de telemedicina.',
  'Para a sua segurança, informe de onde você está participando e esteja em um lugar reservado. Você pode desistir antes de o médico iniciar.',
];

/** Declaração do médico ao iniciar (termo do médico, CFM 2.299 e 2.314; DOC-07): versão e texto. */
export const VERSAO_DECLARACAO_MEDICO = 'CFM-2314-2026.1';
export const TEXTO_DECLARACAO_MEDICO =
  'Declaro que conduzo esta teleconsulta em ambiente reservado, que conferi a identidade do paciente pela imagem e pelo documento e que indicarei o atendimento presencial sempre que a avaliação a distância não for suficiente (Resolução CFM nº 2.314/2022).';

/** A marca dos documentos emitidos no atendimento de teleconsulta (regra 7). */
export const MARCA_TELEMEDICINA =
  'Documento emitido em modalidade de telemedicina (teleconsulta; Resolução CFM nº 2.314/2022).';

/** Dias sem consulta presencial a partir dos quais o paciente crônico gera o alerta (regra 7; TELE-04). */
export const DIAS_ALERTA_CRONICO = 180;
/** A sala de espera abre este tanto antes do horário marcado e fecha este tanto depois (minutos). */
export const MINUTOS_ANTES_SALA_ESPERA = 30;
export const MINUTOS_DEPOIS_SALA_ESPERA = 120;
/** Teto das listas da tela do médico (teleconsultas do dia e teleinterconsultas em aberto). */
export const TETO_LISTA_TELEMEDICINA = 100;

export const TIPOS_LOCAL_PACIENTE = ['residencia', 'trabalho', 'unidade-saude', 'outro'] as const;
export type TipoLocalPaciente = (typeof TIPOS_LOCAL_PACIENTE)[number];

export const MOTIVOS_ENCERRAMENTO_TELECONSULTA = [
  'concluida',
  'paciente-ausente',
  'falha-conexao',
  'presencial-indicado',
] as const;
export type MotivoEncerramentoTeleconsulta = (typeof MOTIVOS_ENCERRAMENTO_TELECONSULTA)[number];

const id = z.number().int().positive().max(2_147_483_647);
const versao = z.number().int().positive().max(2_147_483_647);
const livre = (max: number, min: number) =>
  textoCp1252(max)
    .overwrite((t) => t.replace(/[ \t]+/g, ' ').trim())
    .pipe(z.string().min(min, `Escreva ao menos ${min} caracteres.`));

// ── Portal: sala de espera ─────────────────────────────────────────────────────────────────────────────────────────

/** De onde o paciente participa (TELE-02: o local informado; a cidade em CP1252, como o cadastro). */
export const esquemaLocalPaciente = z
  .object({
    uf: z.enum(UFS),
    municipio: textoCp1252(60)
      .overwrite((t) => t.replace(/\s+/g, ' ').trim().toUpperCase())
      .pipe(z.string().min(2, 'Informe a cidade.')),
    tipo: z.enum(TIPOS_LOCAL_PACIENTE),
  })
  .strict();
export type LocalPaciente = z.infer<typeof esquemaLocalPaciente>;

/** `portal.entrarSalaEspera`: o termo aceito (a versão vigente) e o local, antes de o médico iniciar. */
export const esquemaEntrarSalaEspera = z
  .object({
    termo: z.literal(VERSAO_TERMO_TELECONSULTA, { error: 'Aceite o termo vigente da teleconsulta.' }),
    aceito: z.literal(true, { error: 'Aceite o termo da teleconsulta.' }),
    local: esquemaLocalPaciente,
  })
  .strict();
export type EntrarSalaEspera = z.infer<typeof esquemaEntrarSalaEspera>;

// ── Tela do médico ─────────────────────────────────────────────────────────────────────────────────────────────────

/**
 * `atendimento.abrirSalaTeleconsulta` + `atendimento.abrirAtendimento` (cenário teleconsulta): a declaração do médico, os
 * dados da ficha que a marcação não traz (o CID principal; o procedimento, a especialidade, a unidade e o centro de
 * custo vêm da marcação e o médico confere) e a ciência do alerta do crônico, quando houver.
 */
export const esquemaIniciarTeleconsulta = z
  .object({
    declaracao: z.literal(VERSAO_DECLARACAO_MEDICO, { error: 'Confirme a declaração do médico.' }),
    cidPrincipal: id,
    procedimento: z.number().int().positive().max(999_999_999),
    especialidade: z.number().int().positive().max(32_767),
    unidade: z.number().int().positive().max(32_767),
    centroCusto: z.number().int().positive(),
    /** O médico viu o alerta do crônico sem consulta presencial e decidiu seguir a distância. */
    cienteAlerta: z.boolean().default(false),
    versao,
  })
  .strict();
export type IniciarTeleconsulta = z.infer<typeof esquemaIniciarTeleconsulta>;

export const esquemaEncerrarTeleconsulta = z
  .object({ motivo: z.enum(MOTIVOS_ENCERRAMENTO_TELECONSULTA), versao })
  .strict();
export type EncerrarTeleconsulta = z.infer<typeof esquemaEncerrarTeleconsulta>;

/** `atendimento.solicitarTeleinterconsulta`: no atendimento aberto, o convidado do corpo clínico e o motivo. */
export const esquemaSolicitarTeleinterconsulta = z
  .object({
    /** O atendimento (id) em que o médico assistente pede a opinião. */
    atendimento: id,
    /** O vínculo profissional (id) do médico convidado. */
    convidado: id,
    motivo: livre(1000, 10),
    /** O paciente (ou o responsável) consentiu com a teleinterconsulta. */
    consentimento: z.literal(true, { error: 'Registre o consentimento do paciente.' }),
  })
  .strict();
export type SolicitarTeleinterconsulta = z.infer<typeof esquemaSolicitarTeleinterconsulta>;

export const esquemaResponderTeleinterconsulta = z.object({ parecer: livre(4000, 10), versao }).strict();
export type ResponderTeleinterconsulta = z.infer<typeof esquemaResponderTeleinterconsulta>;

export const esquemaCancelarTeleinterconsulta = z.object({ motivo: livre(200, 5), versao }).strict();
export type CancelarTeleinterconsulta = z.infer<typeof esquemaCancelarTeleinterconsulta>;

// ── Respostas ──────────────────────────────────────────────────────────────────────────────────────────────────────

/** O alerta do crônico sem consulta presencial há mais de 180 dias (regra 7; TELE-04). */
export interface AlertaCronico {
  /** O paciente tem condição crônica nos atendimentos dos últimos dois anos (pelo CID principal). */
  readonly cronico: boolean;
  /** Os grupos de CID crônicos achados (só os códigos, para o médico). */
  readonly condicoes: readonly string[];
  /** A última consulta presencial (data AAAA-MM-DD; null: nenhuma no histórico lido). */
  readonly ultimaPresencial: string | null;
  readonly diasSemPresencial: number | null;
  readonly alerta: boolean;
  readonly mensagem: string | null;
}

export interface SalaTeleconsulta {
  readonly provedor: 'simulado' | 'provedor';
  /** O endereço da sala para quem está vendo (o médico ou o paciente); nunca vai à trilha. */
  readonly endereco: string;
  readonly abertaEm: string;
}

/** A teleconsulta (ou a teleinterconsulta) na tela do médico. */
export interface TeleconsultaResumo {
  readonly id: number;
  readonly modalidade: ModalidadeTelemedicina;
  readonly situacao: SituacaoTeleconsulta;
  /** Data (AAAA-MM-DD) e hora do dia (HH:MM) marcadas, no fuso do estabelecimento; na teleinterconsulta, quando foi pedida. */
  readonly data: string;
  readonly hora: string;
  readonly agenda: string;
  readonly paciente: { readonly id: number; readonly nome: string; readonly prontuario: number } | null;
  readonly atendimento: number | null;
  readonly pacienteNaEspera: boolean;
  readonly versao: number;
}

export interface TeleconsultaDetalhe extends TeleconsultaResumo {
  readonly marcacao: number | null;
  readonly termo: { readonly versao: string; readonly aceitoEm: string } | null;
  readonly local: LocalPaciente | null;
  readonly esperaDesde: string | null;
  readonly pacienteEntrouEm: string | null;
  readonly iniciadaEm: string | null;
  readonly encerradaEm: string | null;
  readonly motivoEncerramento: MotivoEncerramentoTeleconsulta | null;
  readonly medico: string | null;
  readonly sala: SalaTeleconsulta | null;
  readonly alerta: AlertaCronico | null;
  /** O que a marcação já traz para a abertura (o médico confere; o CID é dele). */
  readonly abertura: {
    readonly convenio: number;
    readonly especialidade: number;
    readonly unidade: number;
    readonly centroCusto: number;
    readonly procedimento: number;
  } | null;
  /** Teleinterconsulta: quem pediu, o convidado, o motivo e o parecer. */
  readonly interconsulta: {
    readonly solicitante: string;
    readonly convidado: { readonly vinculo: number; readonly nome: string };
    readonly motivo: string;
    readonly parecer: string | null;
    readonly respondidaEm: string | null;
    readonly paraMim: boolean;
    readonly minha: boolean;
  } | null;
  readonly acoes: {
    readonly iniciar: { readonly pode: boolean; readonly motivo: string | null };
    readonly encerrar: { readonly pode: boolean; readonly motivo: string | null };
    readonly responder: { readonly pode: boolean; readonly motivo: string | null };
    readonly cancelar: { readonly pode: boolean; readonly motivo: string | null };
  };
}

export interface ListaTelemedicina {
  readonly data: string;
  readonly teleconsultas: TeleconsultaResumo[];
  readonly interconsultas: TeleconsultaResumo[];
  readonly truncado: boolean;
  /** A chave `telemedicina` no estabelecimento (desligada: as telas ficam em consulta). */
  readonly ligada: boolean;
  readonly motivo: string | null;
  readonly podeRealizar: boolean;
  /** O vínculo profissional da sessão (sem ele, não há ato médico). */
  readonly profissional: { readonly vinculo: number; readonly nome: string } | null;
}

export interface ResultadoTeleconsulta {
  readonly ok: true;
  readonly teleconsulta: TeleconsultaDetalhe;
  readonly mensagem: string;
}

/** A teleconsulta vista pelo paciente no portal (nada do médico além do nome da agenda). */
export interface TeleconsultaDoPortal {
  readonly id: number;
  readonly situacao: SituacaoTeleconsulta;
  readonly data: string;
  readonly hora: string;
  readonly agenda: string;
  readonly termo: { readonly versao: string; readonly aceitoEm: string } | null;
  readonly local: LocalPaciente | null;
  readonly salaEspera: {
    readonly aberta: boolean;
    readonly abreEm: string;
    readonly fechaEm: string;
    readonly motivo: string | null;
  };
  /** A sala do provedor, quando o médico já iniciou (o paciente entra por ela). */
  readonly sala: SalaTeleconsulta | null;
  readonly podeEntrar: boolean;
}

export interface ListaTeleconsultasPortal {
  readonly itens: TeleconsultaDoPortal[];
  /** A chave `telemedicina` (desligada: o portal não oferece a teleconsulta). */
  readonly ligada: boolean;
  readonly termo: { readonly versao: string; readonly texto: readonly string[] };
}

/** Teleconsulta: procedimento da consulta em consultório sugerido quando a marcação não traz (o médico confere). */
export const PROCEDIMENTO_PADRAO_TELECONSULTA = 10101012;

/** As listas da tela do médico (a abertura da teleconsulta e o convite da teleinterconsulta). */
export interface ApoioTelemedicina {
  readonly especialidades: { readonly codigo: number; readonly nome: string }[];
  readonly unidades: { readonly codigo: number; readonly nome: string }[];
  readonly centrosCusto: { readonly codigo: number; readonly nome: string }[];
  readonly procedimentoPadrao: number;
  /** Os médicos ativos do corpo clínico (o convidado da teleinterconsulta). */
  readonly medicos: { readonly vinculo: number; readonly nome: string; readonly crm: number }[];
}
