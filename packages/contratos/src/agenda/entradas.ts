// Entradas das operações de gravação compatível da agenda de consultas (M17, ficha seção 5), validadas na tela,
// na API e no executor (o mesmo Zod). Vocabulário neutro: a agenda, o paciente (cadastro único) e a marcação são
// IDs do modelo próprio; horas do dia em "HH:MM" (a tela aceita a hora digitada sem os dois-pontos e converte);
// durações de agenda em minutos; datas AAAA-MM-DD; textos restritos ao CP1252 com o tamanho da coluna.
import { z } from 'zod';
import { lerHoraDigitada } from '../formatacao/hora.js';
import { esquemaDataIso } from '../preco/entradas.js';
import { textoCp1252 } from '../texto-cp1252.js';
import { CANAIS_MARCACAO, MOTIVOS_BLOQUEIO, MOTIVOS_CANCELAMENTO } from './vocabulario.js';
import { idBanco } from '../validacao/id-banco.js';

export const TETO_HORARIOS_POR_GRAVACAO = 400;

const id = idBanco;
const smallint = z.number().int().min(0).max(32767);
/**
 * @deprecated Transição: só o contrato do portal do médico externo ainda o importa (pedido ao lote 21 da F2.4 para
 * trocar por `esquemaHora`). Mantém, sem mudança, a regra antiga desse contrato (hora de quatro dígitos sem os
 * dois-pontos). A agenda não o usa.
 */
export const esquemaHhmm = z
  .string()
  .regex(/^([01]\d|2[0-3])[0-5]\d$/, 'Hora com quatro dígitos (0000 a 2359).');

/**
 * Hora do dia da agenda: entrega sempre "HH:MM". Aceita também a hora sem os dois-pontos ("0830" ou "830"), que o
 * portal do paciente e os testes de outros módulos ainda mandam durante a F2.4; a inválida é recusada com a mensagem
 * de `lerHoraDigitada`. Quando todos os chamadores mandarem "HH:MM", vira `esquemaHora` (estrito).
 */
export const esquemaHoraAgenda = z.string().transform((v, ctx) => {
  try {
    const h = lerHoraDigitada(v);
    if (h !== null) return h;
    ctx.addIssue({ code: 'custom', message: 'Hora obrigatória (HH:MM).' });
  } catch (e) {
    ctx.addIssue({ code: 'custom', message: (e as Error).message });
  }
  return z.NEVER;
});

/** Duração de um atendimento da agenda, em minutos (5 a 480, a faixa do banco; a geração da grade limita a 240). */
export const esquemaDuracaoAgendaMinutos = z.number().int().min(5).max(480);
export const esquemaHorario = z.object({ data: esquemaDataIso, hora: esquemaHoraAgenda }).strict();
export type HorarioAgenda = z.infer<typeof esquemaHorario>;

const codigosMotivo = MOTIVOS_CANCELAMENTO.map((m) => m.codigo) as [string, ...string[]];
const codigosCanal = CANAIS_MARCACAO.map((c) => c.codigo) as [string, ...string[]];
const codigosBloqueio = MOTIVOS_BLOQUEIO.map((m) => m.codigo) as [string, ...string[]];

export const esquemaCanal = z.enum(codigosCanal);
export const esquemaMotivoCancelamento = z.enum(codigosMotivo);
export const SOLICITANTES_CANCELAMENTO = ['paciente', 'hospital', 'profissional'] as const;

/** Recado do balcão na marcação: até 500 caracteres CP1252. */
const observacao = textoCp1252(500)
  .overwrite((t) => t.replace(/\s+/g, ' ').trim())
  .nullable();
const complemento = textoCp1252(200)
  .overwrite((t) => t.replace(/\s+/g, ' ').trim())
  .nullable();

// ── agenda.gerarGrade / agenda.reverterGrade ─────────────────────────────────────────────────────────

export const esquemaLinhaEscala = z
  .object({
    semana: z.number().int().min(1).max(7),
    /** Duração de um atendimento em horas e minutos ("00:15"). */
    duracao: esquemaHoraAgenda,
    horaInicio: esquemaHoraAgenda,
    horaFim: esquemaHoraAgenda,
    /** null = sem intervalo. */
    intervaloInicio: esquemaHoraAgenda.nullable(),
    intervaloFim: esquemaHoraAgenda.nullable(),
  })
  .strict();
export type LinhaEscalaEntrada = z.infer<typeof esquemaLinhaEscala>;

/**
 * A PRÉVIA aprovada (o motor da agenda a monta numa leitura; a pessoa confere a lista). A receita reconfere
 * sob a trava que nenhum horário apareceu desde a prévia e grava exatamente esta lista.
 */
export const esquemaGerarGrade = z
  .object({
    agenda: id,
    de: esquemaDataIso,
    ate: esquemaDataIso,
    duracao: esquemaHoraAgenda,
    horarios: z.array(esquemaHorario).min(1).max(TETO_HORARIOS_POR_GRAVACAO),
    escala: z.array(esquemaLinhaEscala).min(1).max(21),
    semanas: z.array(z.enum(['T', 'F'])).length(7),
  })
  .strict()
  .refine((e) => e.ate >= e.de, { message: 'O fim vem antes do início.', path: ['ate'] })
  .refine((e) => e.horarios.every((h) => h.data >= e.de && h.data <= e.ate), {
    message: 'Horário fora do período.',
    path: ['horarios'],
  })
  .refine((e) => new Set(e.horarios.map((h) => `${h.data} ${h.hora}`)).size === e.horarios.length, {
    message: 'Horário repetido na prévia.',
    path: ['horarios'],
  });
export type GerarGradeEntrada = z.infer<typeof esquemaGerarGrade>;

/** Reversão de uma geração FEITA PELO NOVO (SGH_AGE_GERACAO): só os horários que continuam vazios. */
export const esquemaReverterGrade = z.object({ geracao: id }).strict();
export type ReverterGradeEntrada = z.infer<typeof esquemaReverterGrade>;

// ── Marcação ─────────────────────────────────────────────────────────────────────────────────────────

const baseMarcacao = {
  agenda: id,
  data: esquemaDataIso,
  hora: esquemaHoraAgenda,
  /** Paciente do cadastro único: o prontuário e o contato vêm dele. */
  paciente: id,
  convenio: smallint,
  retorno: z.boolean(),
  observacao: observacao.optional(),
  canal: esquemaCanal,
};

export const esquemaAgendarConsulta = z
  .object({
    ...baseMarcacao,
    /**
     * M50, etapa 4: a teleconsulta da marcação feita pelo portal, gravada na MESMA transação da marcação (a conta do
     * portal que marcou). Só o portal a envia: a rota da central recusa o campo.
     */
    teleconsulta: z.object({ conta: id }).strict().optional(),
  })
  .strict();
export type AgendarConsultaEntrada = z.infer<typeof esquemaAgendarConsulta>;

export const esquemaEncaixar = z
  .object({
    ...baseMarcacao,
    /** Motivo do encaixe (regra do novo; vai à extensão da marcação, não ao legado). */
    motivo: textoCp1252(200)
      .overwrite((t) => t.trim())
      .pipe(z.string().min(5, 'Diga o motivo do encaixe (ao menos 5 caracteres).')),
  })
  .strict();
export type EncaixarEntrada = z.infer<typeof esquemaEncaixar>;

export const esquemaDesfazerEncaixe = z
  .object({
    marcacao: id,
    motivo: esquemaMotivoCancelamento.default('ENCAIXE-DESFEITO'),
    complemento: complemento.optional(),
  })
  .strict();
export type DesfazerEncaixeEntrada = z.infer<typeof esquemaDesfazerEncaixe>;

export const esquemaCancelarConsulta = z
  .object({
    marcacao: id,
    motivo: esquemaMotivoCancelamento,
    complemento: complemento.optional(),
    solicitante: z.enum(SOLICITANTES_CANCELAMENTO),
  })
  .strict()
  .refine((e) => e.motivo !== 'OUTRO' || (e.complemento ?? '').length >= 5, {
    message: 'Em "Outro motivo", descreva o motivo.',
    path: ['complemento'],
  });
export type CancelarConsultaEntrada = z.infer<typeof esquemaCancelarConsulta>;

/**
 * Remarcação. `transferir` é o caminho do legado (o horário antigo fica com o paciente e a situação 'T'
 * Transferências; a marcação antiga permanece; 323 de 342 transferências medidas têm a marcação nova depois);
 * `liberar` cancela a antiga com o motivo (o horário volta a ser vaga) e marca a nova, na MESMA transação.
 */
export const MODOS_REMARCACAO = ['transferir', 'liberar'] as const;
export const esquemaRemarcarConsulta = z
  .object({
    marcacao: id,
    destino: z.object({ agenda: id, data: esquemaDataIso, hora: esquemaHoraAgenda }).strict(),
    modo: z.enum(MODOS_REMARCACAO),
    convenio: smallint.optional(),
    observacao: observacao.optional(),
    canal: esquemaCanal,
    motivo: esquemaMotivoCancelamento.default('PAC-OUTRA-DATA'),
    complemento: complemento.optional(),
  })
  .strict();
export type RemarcarConsultaEntrada = z.infer<typeof esquemaRemarcarConsulta>;

export const esquemaConfirmarConsulta = z.object({ marcacao: id }).strict();
export type ConfirmarConsultaEntrada = z.infer<typeof esquemaConfirmarConsulta>;

export const esquemaRegistrarFalta = z.object({ marcacao: id }).strict();
export type RegistrarFaltaEntrada = z.infer<typeof esquemaRegistrarFalta>;

export const ACOES_BLOQUEIO = ['bloquear', 'desbloquear'] as const;
export const esquemaBloquearHorarios = z
  .object({
    agenda: id,
    acao: z.enum(ACOES_BLOQUEIO),
    horarios: z.array(esquemaHorario).min(1).max(TETO_HORARIOS_POR_GRAVACAO),
    motivo: z.enum(codigosBloqueio),
    complemento: complemento.optional(),
    previsaoRetorno: esquemaDataIso.nullable().optional(),
  })
  .strict();
export type BloquearHorariosEntrada = z.infer<typeof esquemaBloquearHorarios>;

// ── Cadastro de agendas ──────────────────────────────────────────────────────────────────────────────

export const ACOES_VINCULO = ['incluir', 'remover'] as const;

export const esquemaDefinirCobertura = z
  .object({
    agenda: id,
    convenio: smallint,
    acao: z.enum(ACOES_VINCULO),
    /** Remover o último convênio faz a agenda aceitar TODOS: só com esta confirmação explícita. */
    confirmarAceitarTodos: z.boolean().default(false),
  })
  .strict();
export type DefinirCoberturaEntrada = z.infer<typeof esquemaDefinirCobertura>;

export const esquemaDefinirEspecialidade = z
  .object({ agenda: id, especialidade: z.number().int().min(0).max(99), acao: z.enum(ACOES_VINCULO) })
  .strict();
export type DefinirEspecialidadeEntrada = z.infer<typeof esquemaDefinirEspecialidade>;

/** Nome da agenda: chave do legado (40 caracteres, maiúsculas, "PROCEDIMENTO - PROFISSIONAL"). */
export const esquemaNomeAgenda = textoCp1252(40)
  .overwrite((t) => t.replace(/\s+/g, ' ').trim().toUpperCase())
  .pipe(z.string().min(5, 'Nome da agenda com ao menos 5 caracteres.'));

export const esquemaIncluirAgenda = z
  .object({
    nome: esquemaNomeAgenda,
    duracaoMinutos: esquemaDuracaoAgendaMinutos,
    teleatendimento: z.boolean(),
    observacao: textoCp1252(2000)
      .overwrite((t) => t.trim())
      .nullable()
      .optional(),
  })
  .strict();
export type IncluirAgendaEntrada = z.infer<typeof esquemaIncluirAgenda>;

export const esquemaAlterarAgenda = z
  .object({
    agenda: id,
    /** Valores que a tela leu (controle otimista). */
    lidos: z
      .object({
        duracaoMinutos: z.number().int().positive().nullable(),
        ativa: z.boolean(),
        teleatendimento: z.boolean(),
      })
      .strict(),
    valores: z
      .object({
        duracaoMinutos: esquemaDuracaoAgendaMinutos.optional(),
        ativa: z.boolean().optional(),
        teleatendimento: z.boolean().optional(),
      })
      .strict()
      .refine((v) => Object.keys(v).length > 0, 'Nada a alterar.'),
  })
  .strict();
export type AlterarAgendaEntrada = z.infer<typeof esquemaAlterarAgenda>;

/** Pré-cadastro na marcação sem prontuário (especificada: falta provar a ligação com o horário). */
export const esquemaAgendarSemProntuario = z
  .object({
    agenda: id,
    data: esquemaDataIso,
    hora: esquemaHoraAgenda,
    nome: textoCp1252(70)
      .overwrite((t) => t.replace(/\s+/g, ' ').trim().toUpperCase())
      .pipe(z.string().min(3)),
    nascimento: esquemaDataIso,
    telefone: z.string().regex(/^\d{8,15}$/, 'Telefone só com dígitos (8 a 15).'),
    convenio: smallint,
    canal: esquemaCanal,
  })
  .strict();
export type AgendarSemProntuarioEntrada = z.infer<typeof esquemaAgendarSemProntuario>;
