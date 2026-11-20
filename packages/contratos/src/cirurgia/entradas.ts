// Entradas das operações do centro cirúrgico (M18, ficha seção 5) e os pedidos das gravações só do novo, validados na
// tela, na API e no executor (o mesmo Zod). Vocabulário do novo: o agendamento é o ID de CCAGENDA, a sala é o código
// de CCSALAS, o profissional é o ID de TBCBOPRO com o código (COD) que o par do gatilho exige, o paciente é o ID do
// cadastro único (RICADPAC), o atendimento é o REG. Datas AAAA-MM-DD e horas HHMM (a tela converte de HH:MM);
// duração e intervalo em minutos (a receita grava o TIMESTAMP 1899-12-30 HH:MM do legado).
import { z } from 'zod';
import { esquemaHhmm } from '../agenda/entradas.js';
import { esquemaDataIso } from '../preco/entradas.js';
import { textoCp1252 } from '../texto-cp1252.js';
import {
  MOTIVOS_CANCELAMENTO_CIRURGIA,
  RECURSOS_SALA,
  SITUACOES_PENDENCIA,
  SOLICITANTES_CIRURGIA,
  TIPOS_PENDENCIA,
} from './vocabulario.js';

const id = z.number().int().positive().max(2_147_483_647);
const smallint = z.number().int().min(0).max(32767);
const inteiro = z.number().int().min(0).max(2_147_483_647);

export const esquemaSala = z.number().int().min(1).max(32767);
export const esquemaDuracaoMin = z.number().int().min(1, 'Duração de ao menos 1 minuto.').max(1439);
export const esquemaIntervaloMin = z.number().int().min(0).max(240);

/** Profissional escolhido: o ID (TBCBOPRO) e o código do par. */
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

/** Urgência em sala ocupada: só com o supervisor e o motivo (vai à SGH_CC_EXCECAO). */
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
    hora: esquemaHhmm,
    duracaoMin: esquemaDuracaoMin,
    intervaloMin: esquemaIntervaloMin.default(0),
    /** Cadastro único: prontuário, nome, documento, nascimento e contato vêm dele. */
    paciente: id,
    /** REG do atendimento ou da internação (0 = ainda sem atendimento: o legado tem 199 de 821 assim). */
    reg: inteiro,
    atendimento: z.enum(['I', 'E']),
    especialidade: smallint,
    convenio: smallint,
    /** Procedimento principal (código do procedimento). */
    procedimento: inteiro,
    /** Tipo de anestesia (TBANESTESIA.COD; 0 = não informado). */
    anestesia: smallint,
    equipe: esquemaEquipeAgenda,
    /** Pediatra (TBCBOPRO.ID); null = sem pediatra (o par fica no sentinela 1). */
    pediatra: id.nullable().default(null),
    recursos: z.array(z.enum(camposRecurso)).max(13).default([]),
    procedimentosAdicionais: z
      .array(inteiro.refine((v) => v > 0))
      .max(10)
      .default([]),
    observacao: observacao.optional(),
    /** Caráter (CCTPURGENCIA) e a solicitação que é confirmada (vão ao estado do novo). */
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
    hora: esquemaHhmm,
    duracaoMin: esquemaDuracaoMin.optional(),
    /** O que a tela leu (controle otimista: se mudou por fora, 409). */
    lido: z.object({ sala: esquemaSala, data: esquemaDataIso, hora: esquemaHhmm }).strict(),
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
    /** O agendamento (CCAGENDA.ID) de que o ato nasceu; null = registro sem agendamento (urgência). */
    agendamento: id.nullable(),
    reg: id,
    data: esquemaDataIso,
    sala: esquemaSala,
    convenio: smallint,
    porte: z.enum(['P', 'M', 'G']),
    potencialContaminacao: z.enum(['L', 'P', 'C']),
    carater: smallint,
    tipoAnestesia: smallint,
    inicio: esquemaHhmm,
    fim: esquemaHhmm,
    inicioAnestesia: esquemaHhmm.nullable(),
    fimAnestesia: esquemaHhmm.nullable(),
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
    /**
     * M46 (etapa 2, regra 2): com a trava da incisão ligada, o ato sem agendamento com a hora da incisão é a exceção
     * do supervisor, só em urgência e com o motivo (10 a 100 caracteres; vai à trilha da exceção). Ignorado nos demais.
     */
    motivoExcecaoIncisao: textoCp1252(100)
      .overwrite((t) => t.replace(/\s+/g, ' ').trim())
      .nullable()
      .optional(),
    /** Tempos e dados sem coluna no legado (vão ao registro do novo). */
    extensao: z
      .object({
        entradaSala: esquemaHhmm.nullable(),
        incisao: esquemaHhmm.nullable(),
        saidaSala: esquemaHhmm.nullable(),
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
    /** TBUSERS.NOME (login do outro sistema; sensível a maiúsculas como lá). */
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
    hora: esquemaHhmm,
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

/** Revisão humana da ligação cirurgia realizada → agendamento (casamento por REG, sala e data). */
export const esquemaPedidoLigacaoCirurgia = z.object({ realizada: id, agendamento: id.nullable() }).strict();
export type PedidoLigacaoCirurgia = z.infer<typeof esquemaPedidoLigacaoCirurgia>;
