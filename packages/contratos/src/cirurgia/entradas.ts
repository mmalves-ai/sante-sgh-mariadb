// Entradas das operações do centro cirúrgico (M18, ficha seção 5) e os pedidos das gravações só do novo, validados na
// tela, na API e no executor (o mesmo Zod). Vocabulário neutro: o agendamento, a sala, o profissional e o paciente são
// ids do modelo (o profissional leva também o número do registro), o atendimento é o id do atendimento. Datas
// AAAA-MM-DD e horas do dia "HH:MM"; duração e intervalo em minutos.
import { z } from 'zod';
import { esquemaHora } from '../formatacao/hora.js';
import { esquemaDataIso } from '../preco/entradas.js';
import { textoCp1252 } from '../texto-cp1252.js';
import {
  MOTIVOS_CANCELAMENTO_CIRURGIA,
  RECURSOS_SALA,
  SITUACOES_PENDENCIA,
  SOLICITANTES_CIRURGIA,
  TIPOS_PENDENCIA,
} from './vocabulario.js';
import { idBanco, idBancoOuZero } from '../validacao/id-banco.js';

const id = idBanco;
const smallint = z.number().int().min(0).max(32767);
const inteiro = idBancoOuZero;

export const esquemaSala = z.number().int().min(1).max(32767);
export const esquemaDuracaoMin = z.number().int().min(1, 'Duração de ao menos 1 minuto.').max(1439);
export const esquemaIntervaloMin = z.number().int().min(0).max(240);

/** Profissional escolhido: o id do registro profissional e o número do registro. */
export const esquemaProfissional = z.object({ id, cod: inteiro }).strict();

const funcoesAgenda = {
  cirurgiao: esquemaProfissional,
  auxiliar1: esquemaProfissional.nullable().optional(),
  auxiliar2: esquemaProfissional.nullable().optional(),
  auxiliar3: esquemaProfissional.nullable().optional(),
  instrumentador: esquemaProfissional.nullable().optional(),
  anestesista: esquemaProfissional.nullable().optional(),
  circulante: esquemaProfissional.nullable().optional(),
};
export const esquemaEquipeAgenda = z.object(funcoesAgenda).strict();
export type EquipeAgendaEntrada = z.infer<typeof esquemaEquipeAgenda>;

const codigosMotivo = MOTIVOS_CANCELAMENTO_CIRURGIA.map((m) => m.codigo) as [string, ...string[]];
const camposRecurso = RECURSOS_SALA.map((r) => r.campo) as [string, ...string[]];

/** Urgência em sala ocupada: só com o supervisor e o motivo (fica registrada como exceção, com quem autorizou). */
export const esquemaExcecaoSobreposicao = z
  .object({
    motivo: textoCp1252(200)
      .overwrite((t) => t.replace(/\s+/g, ' ').trim())
      .pipe(z.string().min(10, 'Diga o motivo da exceção (ao menos 10 caracteres).')),
  })
  .strict();

const observacao = textoCp1252(150)
  .overwrite((t) => t.replace(/\s+/g, ' ').trim())
  .nullable();

// ── cirurgia.agendarCirurgia ─────────────────────────────────────────────────────────────────────────

export const esquemaAgendarCirurgia = z
  .object({
    sala: esquemaSala,
    data: esquemaDataIso,
    hora: esquemaHora,
    duracaoMin: esquemaDuracaoMin,
    intervaloMin: esquemaIntervaloMin.default(0),
    /** Cadastro único: prontuário, nome, documento, nascimento e contato vêm dele. */
    paciente: id,
    /** Id do atendimento ou da internação (0 = ainda sem atendimento). */
    reg: inteiro,
    atendimento: z.enum(['I', 'E']),
    especialidade: smallint,
    convenio: smallint,
    /** Procedimento principal (código do procedimento). */
    procedimento: inteiro,
    /** Tipo de anestesia (id do cadastro; 0 = não informado). */
    anestesia: smallint,
    equipe: esquemaEquipeAgenda,
    /** Pediatra (id do registro profissional); null = sem pediatra. */
    pediatra: id.nullable().default(null),
    recursos: z.array(z.enum(camposRecurso)).max(13).default([]),
    procedimentosAdicionais: z
      .array(inteiro.refine((v) => v > 0))
      .max(10)
      .default([]),
    observacao: observacao.optional(),
    /** Caráter da cirurgia (id do cadastro) e a solicitação que é confirmada. */
    carater: smallint.default(2),
    solicitacao: id.nullable().default(null),
    excecao: esquemaExcecaoSobreposicao.nullable().default(null),
    /** Preparo mínimo da sala: o SERVIDOR preenche pelo parâmetro (o que vier da tela é sobrescrito). */
    preparoMinimoMin: esquemaIntervaloMin.default(0),
  })
  .strict()
  .refine((e) => new Set(e.procedimentosAdicionais).size === e.procedimentosAdicionais.length, {
    message: 'Procedimento adicional repetido.',
    path: ['procedimentosAdicionais'],
  })
  .refine((e) => !e.procedimentosAdicionais.includes(e.procedimento), {
    message: 'O procedimento principal não entra de novo como adicional.',
    path: ['procedimentosAdicionais'],
  });
export type AgendarCirurgiaEntrada = z.infer<typeof esquemaAgendarCirurgia>;

// ── cirurgia.cancelarCirurgia / cirurgia.remarcarCirurgia ────────────────────────────────────────────

export const esquemaCancelarCirurgia = z
  .object({
    agendamento: id,
    motivo: z.enum(codigosMotivo),
    complemento: textoCp1252(200)
      .overwrite((t) => t.replace(/\s+/g, ' ').trim())
      .nullable()
      .optional(),
    solicitante: z.enum(SOLICITANTES_CIRURGIA),
    /** Suspensão: a sala é liberada como no cancelamento e o pedido volta como "suspenso" (pode ser retomado). */
    suspender: z.boolean().default(false),
  })
  .strict()
  .refine((e) => e.motivo !== 'OUTRO' || (e.complemento ?? '').length >= 5, {
    message: 'Em "Outro motivo", descreva o motivo.',
    path: ['complemento'],
  });
export type CancelarCirurgiaEntrada = z.infer<typeof esquemaCancelarCirurgia>;

export const esquemaRemarcarCirurgia = z
  .object({
    agendamento: id,
    sala: esquemaSala,
    data: esquemaDataIso,
    hora: esquemaHora,
    duracaoMin: esquemaDuracaoMin.optional(),
    /** O que a tela leu (controle otimista: se mudou por fora, 409). */
    lido: z.object({ sala: esquemaSala, data: esquemaDataIso, hora: esquemaHora }).strict(),
    justificativa: textoCp1252(150)
      .overwrite((t) => t.replace(/\s+/g, ' ').trim())
      .pipe(z.string().min(5, 'Diga o motivo da mudança (ao menos 5 caracteres).')),
    excecao: esquemaExcecaoSobreposicao.nullable().default(null),
    /** Preparo mínimo da sala: o SERVIDOR preenche pelo parâmetro (o que vier da tela é sobrescrito). */
    preparoMinimoMin: esquemaIntervaloMin.default(0),
  })
  .strict();
export type RemarcarCirurgiaEntrada = z.infer<typeof esquemaRemarcarCirurgia>;

// ── cirurgia.registrarCirurgia ───────────────────────────────────────────────────────────────────────

const funcoesRegistro = {
  cirurgiao: esquemaProfissional,
  auxiliar1: esquemaProfissional.nullable().optional(),
  auxiliar2: esquemaProfissional.nullable().optional(),
  auxiliar3: esquemaProfissional.nullable().optional(),
  instrumentador: esquemaProfissional.nullable().optional(),
  anestesista: esquemaProfissional.nullable().optional(),
  pediatra: esquemaProfissional.nullable().optional(),
  circulante: esquemaProfissional.nullable().optional(),
};

/**
 * Participação de um membro da equipe (F3.4, 04-CC linha 95): entrada e saída na sala ("HH:MM" do dia do ato; nulas =
 * o tempo inteiro do paciente na sala) e o percentual de participação (nulo = o padrão da função).
 */
export const esquemaParticipacaoEquipe = z
  .object({
    entrada: esquemaHora.nullable(),
    saida: esquemaHora.nullable(),
    percentual: z
      .number()
      .min(0, 'O percentual vai de 0 a 100.')
      .max(100, 'O percentual vai de 0 a 100.')
      .nullable(),
  })
  .strict();
export type ParticipacaoEquipeEntrada = z.infer<typeof esquemaParticipacaoEquipe>;
export const esquemaParticipacaoPorFuncao = z
  .object(
    Object.fromEntries(
      Object.keys(funcoesRegistro).map((f) => [f, esquemaParticipacaoEquipe.optional()]),
    ) as {
      [K in keyof typeof funcoesRegistro]: z.ZodOptional<typeof esquemaParticipacaoEquipe>;
    },
  )
  .strict();

/**
 * Membro da equipe do ato (F3.4, 04-CC linha 95): a função, o profissional, o procedimento (posição no registro; null =
 * o ato inteiro), a entrada e a saída na sala ("HH:MM"; nulas = o tempo inteiro do paciente na sala) e o percentual
 * (nulo = o padrão da função). A mesma função pode ter mais de um membro, um depois do outro (troca no meio do ato).
 */
export const esquemaMembroEquipeEntrada = z
  .object({
    funcao: z.enum(
      Object.keys(funcoesRegistro) as [keyof typeof funcoesRegistro, ...(keyof typeof funcoesRegistro)[]],
    ),
    profissional: esquemaProfissional,
    procedimento: z.number().int().min(0).max(9).nullable(),
    entrada: esquemaHora.nullable(),
    saida: esquemaHora.nullable(),
    percentual: z
      .number()
      .min(0, 'O percentual vai de 0 a 100.')
      .max(100, 'O percentual vai de 0 a 100.')
      .nullable(),
  })
  .strict();
export type MembroEquipeEntrada = z.infer<typeof esquemaMembroEquipeEntrada>;

export const esquemaProcedimentoRealizado = z
  .object({
    procedimento: inteiro.refine((v) => v > 0, 'Informe o procedimento.'),
    especialidade: smallint,
    tecnica: z.number().int().min(0).max(2),
    equipe: z.object(funcoesRegistro).strict(),
  })
  .strict();

const usoComTexto = z
  .object({
    usado: z.boolean(),
    descricao: textoCp1252(35)
      .overwrite((t) => t.trim())
      .nullable(),
  })
  .strict();

export const esquemaRegistrarCirurgia = z
  .object({
    /** O agendamento de que o ato nasceu; null = registro sem agendamento (urgência). */
    agendamento: id.nullable(),
    reg: id,
    data: esquemaDataIso,
    sala: esquemaSala,
    convenio: smallint,
    porte: z.enum(['P', 'M', 'G']),
    potencialContaminacao: z.enum(['L', 'P', 'C']),
    carater: smallint,
    tipoAnestesia: smallint,
    inicio: esquemaHora,
    fim: esquemaHora,
    inicioAnestesia: esquemaHora.nullable(),
    fimAnestesia: esquemaHora.nullable(),
    cid10: z
      .string()
      .regex(/^[A-Z]\d{2}(\.?\d{0,2})?$/, 'CID-10 no formato A00 ou A00.0.')
      .nullable(),
    pressao: z
      .string()
      .regex(/^\d{2,3}[x/]\d{2,3}$/, 'Pressão como 120x80.')
      .nullable(),
    pulso: z.number().int().min(20).max(250).nullable(),
    supuracao: z.boolean(),
    usos: z
      .object({
        tubo: usoComTexto,
        antimicrobiano: usoComTexto,
        sonda: usoComTexto,
        cateter: usoComTexto,
        puncao: usoComTexto,
      })
      .strict(),
    procedimentos: z.array(esquemaProcedimentoRealizado).min(1).max(10),
    /** Entrada, saída e percentual de cada função da equipe (vale para o membro em todos os procedimentos). */
    participacao: esquemaParticipacaoPorFuncao.optional(),
    /**
     * Equipe como lista de membros (troca no meio do ato e tempos por procedimento). Quando vem, substitui a equipe de
     * cada procedimento e a participação por função.
     */
    membros: z.array(esquemaMembroEquipeEntrada).min(1).max(60).optional(),
    /**
     * M46 (etapa 2, regra 2): com a trava da incisão ligada, o ato sem agendamento com a hora da incisão é a exceção
     * do supervisor, só em urgência e com o motivo (10 a 100 caracteres; vai à trilha da exceção). Ignorado nos demais.
     */
    motivoExcecaoIncisao: textoCp1252(100)
      .overwrite((t) => t.replace(/\s+/g, ' ').trim())
      .nullable()
      .optional(),
    /** Tempos de sala, incisão, classificação ASA e observação do ato. */
    extensao: z
      .object({
        entradaSala: esquemaHora.nullable(),
        incisao: esquemaHora.nullable(),
        saidaSala: esquemaHora.nullable(),
        asa: z.number().int().min(1).max(6).nullable(),
        observacao: textoCp1252(400)
          .overwrite((t) => t.trim())
          .nullable(),
      })
      .strict(),
  })
  .strict()
  .refine((e) => new Set(e.procedimentos.map((p) => p.procedimento)).size === e.procedimentos.length, {
    message: 'Procedimento repetido no registro.',
    path: ['procedimentos'],
  });
export type RegistrarCirurgiaEntrada = z.infer<typeof esquemaRegistrarCirurgia>;

// ── cirurgia.definirSalaUsuario ──────────────────────────────────────────────────────────────────────

export const esquemaDefinirSalaUsuario = z
  .object({
    sala: esquemaSala,
    /** Login do usuário (sensível a maiúsculas). */
    usuario: z
      .string()
      .min(1)
      .max(31)
      .regex(/^[A-Za-z0-9._@-]+$/, 'Login com letras, números, ponto, hífen e sublinhado.'),
    acao: z.enum(['incluir', 'remover']),
  })
  .strict();
export type DefinirSalaUsuarioEntrada = z.infer<typeof esquemaDefinirSalaUsuario>;

// ── Pedidos das gravações só do novo ─────────────────────────────────────────────────────────────────

/** Solicitação: vive só no novo (não ocupa a sala) até a confirmação. */
export const esquemaPedidoSolicitarCirurgia = z
  .object({
    sala: esquemaSala,
    data: esquemaDataIso,
    hora: esquemaHora,
    duracaoMin: esquemaDuracaoMin,
    paciente: id,
    reg: inteiro,
    procedimento: inteiro,
    convenio: smallint,
    cirurgiao: id.nullable(),
    carater: smallint.default(2),
    anestesia: smallint.default(0),
    observacao: observacao.optional(),
  })
  .strict();
export type PedidoSolicitarCirurgia = z.infer<typeof esquemaPedidoSolicitarCirurgia>;

/** Marcações de andamento do novo ("no bloco", "em sala") e a retomada da suspensa. */
export const esquemaPedidoAndamento = z
  .object({ estado: z.enum(['no-bloco', 'em-sala', 'solicitado']) })
  .strict();
export type PedidoAndamento = z.infer<typeof esquemaPedidoAndamento>;

const tiposPendencia = TIPOS_PENDENCIA.map((t) => t.codigo) as [string, ...string[]];
const situacoesPendencia = SITUACOES_PENDENCIA.map((s) => s.codigo) as [string, ...string[]];

export const esquemaPedidoPendencia = z
  .object({
    tipo: z.enum(tiposPendencia),
    situacao: z.enum(situacoesPendencia),
    observacao: textoCp1252(200)
      .overwrite((t) => t.replace(/\s+/g, ' ').trim())
      .nullable()
      .optional(),
  })
  .strict();
export type PedidoPendencia = z.infer<typeof esquemaPedidoPendencia>;

/** Revisão humana da ligação cirurgia realizada → agendamento (casamento por atendimento, sala e data). */
export const esquemaPedidoLigacaoCirurgia = z.object({ realizada: id, agendamento: id.nullable() }).strict();
export type PedidoLigacaoCirurgia = z.infer<typeof esquemaPedidoLigacaoCirurgia>;
