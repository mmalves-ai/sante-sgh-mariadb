// Entradas das operações da farmácia hospitalar e da farmácia clínica (M29; ficha, seções 5 e 7), validadas na tela, na
// API e no executor (o mesmo Zod). Vocabulário do novo: o horário é o horário prescrito (o ID do horário da
// prescrição); a dose é a dose dispensada; o item é o código do cadastro de itens; o atendimento, o número do
// atendimento. Número de documento, valor e data gravada nunca vêm da tela (o banco e os gatilhos fazem).
import { z } from 'zod';
import { textoCp1252 } from '../texto-cp1252.js';
import { idBanco } from '../validacao/id-banco.js';

const id = idBanco;
const local = id;
const quantidade = z
  .number()
  .positive('A quantidade tem de ser maior que zero.')
  .max(999_999)
  .refine((n) => Math.abs(n * 1000 - Math.round(n * 1000)) < 1e-6, {
    message: 'No máximo 3 casas decimais.',
  });
const dataIso = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Data no formato AAAA-MM-DD.');
const livre = (max: number) => textoCp1252(max).overwrite((t) => t.replace(/\s+/g, ' ').trim());
const justificativa = livre(250);
const motivo = livre(250).pipe(z.string().min(10, 'Escreva o motivo (ao menos 10 caracteres).'));

const esquemaLoteDose = z
  .object({ lote: livre(20).pipe(z.string().min(1)), validade: dataIso, quantidade })
  .strict();

// ── suprimentos.dispensarHorario ──────────────────────────────────────────────────────────────────────

/** Uma dose da fila: o horário prescrito, a quantidade (a da prescrição por padrão) e os lotes do item rastreável. */
export const esquemaDoseDispensar = z
  .object({
    horario: id,
    quantidade: quantidade.optional(),
    lotes: z.array(esquemaLoteDose).max(10).default([]),
  })
  .strict();

export const esquemaDispensarHorario = z
  .object({
    /** O atendimento da internação (as doses são todas dele). */
    atendimento: id,
    /** O local de estoque da farmácia que dispensa e o centro de custo da unidade. */
    local,
    centroCusto: id,
    doses: z.array(esquemaDoseDispensar).min(1, 'Escolha ao menos uma dose.').max(100),
  })
  .strict();
export type DispensarHorarioEntrada = z.infer<typeof esquemaDispensarHorario>;

// ── suprimentos.confirmarEntrega ──────────────────────────────────────────────────────────────────────

export const esquemaConfirmarEntrega = z
  .object({
    /** A linha de controle de entrega (o documento dispensado em situação 7). */
    controle: id,
    /** A dose lida (a etiqueta) ou confirmada no tablet. */
    dose: id.optional(),
    modo: z.enum(['leitura', 'tablet']),
    /** O conteúdo lido da etiqueta (modo leitura). */
    leitura: z.string().max(200).optional(),
    dispositivo: livre(60).optional(),
  })
  .strict()
  .refine((e) => e.modo !== 'leitura' || (e.leitura ?? '').trim() !== '', {
    message: 'Leia a etiqueta da dose.',
    path: ['leitura'],
  });
export type ConfirmarEntregaEntrada = z.infer<typeof esquemaConfirmarEntrega>;

// ── suprimentos.devolverDose ──────────────────────────────────────────────────────────────────────────

export const esquemaDevolverDose = z
  .object({
    /** A dose dispensada (o horário dispensado). */
    dose: id,
    /** O local de estoque que recebe a devolução. */
    local,
    quantidade,
    lote: livre(20).optional(),
    motivo: z.enum(['nao-administrado', 'suspenso', 'sobra', 'outro']),
    observacao: livre(60).optional(),
  })
  .strict();
export type DevolverDoseEntrada = z.infer<typeof esquemaDevolverDose>;

// ── suprimentos.cancelarDispensacao (P2) ─────────────────────────────────────────────────────────────

export const esquemaCancelarDispensacao = z.object({ dose: id, motivo }).strict();
export type CancelarDispensacaoEntrada = z.infer<typeof esquemaCancelarDispensacao>;

// ── suprimentos.avaliarPrescricao (P2, DP-25) ────────────────────────────────────────────────────────

export const esquemaAvaliarPrescricao = z
  .object({
    /** O horário prescrito do item (o evento do extrato é por horário). */
    horario: id,
    decisao: z.enum(['valido', 'nao-aprovado', 'pendencia-revisao-medica']),
    justificativa: justificativa.default(''),
  })
  .strict();
export type AvaliarPrescricaoEntrada = z.infer<typeof esquemaAvaliarPrescricao>;

// ── suprimentos.registrarPerdaControlado (P2) ────────────────────────────────────────────────────────

export const esquemaRegistrarPerdaControlado = z
  .object({
    item: id,
    local,
    centroCusto: id,
    lote: livre(20).pipe(z.string().min(1)),
    validade: dataIso,
    quantidade,
    motivo,
    testemunha: livre(31).pipe(z.string().min(1, 'Informe a testemunha.')),
  })
  .strict();
export type RegistrarPerdaControladoEntrada = z.infer<typeof esquemaRegistrarPerdaControlado>;

// ── Gravações só no novo (SGH_) ──────────────────────────────────────────────────────────────────────

/** A decisão da avaliação no novo (fila em SGH_): a mesma entrada, por item da prescrição. */
export const esquemaDecidirAvaliacao = z
  .object({
    item: id,
    decisao: z.enum(['valido', 'nao-aprovado', 'pendencia-revisao-medica']),
    justificativa: justificativa.default(''),
  })
  .strict();
export type DecidirAvaliacaoEntrada = z.infer<typeof esquemaDecidirAvaliacao>;

export const esquemaRegistrarIntervencao = z
  .object({
    item: id,
    tipo: z.enum([
      'ajuste-dose',
      'troca-via',
      'suspensao',
      'substituicao',
      'alergia',
      'duplicidade',
      'outra',
    ]),
    texto: livre(1000).pipe(z.string().min(10, 'Descreva a intervenção (ao menos 10 caracteres).')),
  })
  .strict();
export type RegistrarIntervencaoEntrada = z.infer<typeof esquemaRegistrarIntervencao>;

export const esquemaResponderIntervencao = z
  .object({ resposta: z.enum(['aceita', 'recusada']), justificativa: justificativa.default('') })
  .strict();
export type ResponderIntervencaoEntrada = z.infer<typeof esquemaResponderIntervencao>;

export const esquemaConferirControlado = z
  .object({
    item: id,
    /** O documento conferido (saída da dispensação ou devolução): tipo e ID. */
    documento: z.object({ tipo: z.enum(['saida', 'devolucao', 'perda']), id }).strict(),
    lote: livre(20).optional(),
    quantidadeDocumento: z.number().min(0).max(999_999),
    quantidadeContada: z.number().min(0).max(999_999),
    justificativa: justificativa.default(''),
  })
  .strict();
export type ConferirControladoEntrada = z.infer<typeof esquemaConferirControlado>;

export const esquemaFecharLivro = z
  .object({
    livro: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4)]),
    inicio: dataIso,
    fim: dataIso,
    oficial: z.boolean().default(false),
  })
  .strict();
export type FecharLivroEntrada = z.infer<typeof esquemaFecharLivro>;

export const esquemaDispensarAmbulatorial = z
  .object({
    paciente: id,
    item: id,
    lote: livre(20).pipe(z.string().min(1)),
    validade: dataIso,
    quantidade,
    receitaNumero: livre(30).optional(),
    receitaData: dataIso.optional(),
    prescritor: id.optional(),
  })
  .strict();
export type DispensarAmbulatorialEntrada = z.infer<typeof esquemaDispensarAmbulatorial>;

export const esquemaEscriturarSngpc = z.object({ inicio: dataIso, fim: dataIso }).strict();
export type EscriturarSngpcEntrada = z.infer<typeof esquemaEscriturarSngpc>;

// ── F3.6 (05-SUP linha 7): parâmetros da integração prescrição × estoque ───────────────────────────────────────

const idOuNulo = id.nullable().default(null);

/** suprimentos.gravarRegraIntegracao: inclui (sem regra) ou altera (com regra e versão) a regra de integração. */
export const esquemaGravarRegraIntegracao = z
  .object({
    regra: id.optional(),
    versao: z.number().int().positive().optional(),
    centroCusto: idOuNulo,
    setor: idOuNulo,
    unidade: idOuNulo,
    tipoItem: idOuNulo,
    grupo: idOuNulo,
    subgrupo: idOuNulo,
    item: idOuNulo,
    localAtendente: id,
    localSubstituto: idOuNulo,
    tipoIntegracao: z.enum(['requisicao_automatica', 'dispensacao_direta', 'sem_integracao']),
    momento: z.enum(['na_prescricao', 'na_liberacao_farmaceutica', 'no_aprazamento', 'antes_do_horario']),
    antecedenciaMinutos: z.number().int().positive().max(10_080).nullable().default(null),
    forma: z.enum(['dose_individualizada', 'dose_unitaria', 'dose_coletiva', 'kit']),
    geraManipulacao: z.boolean().default(false),
    prioridade: z.number().int().min(1).max(999).default(100),
    ativo: z.boolean().default(true),
  })
  .strict()
  .refine((e) => (e.regra === undefined) === (e.versao === undefined), {
    message: 'Para alterar, envie a regra e a versão lida.',
    path: ['versao'],
  });
export type GravarRegraIntegracaoEntrada = z.infer<typeof esquemaGravarRegraIntegracao>;

/**
 * suprimentos.gravarHorariosPadrao: a grade padrão inteira do número de doses ao dia que a frequência dá, no
 * estabelecimento todo (grade nula) ou numa grade de horário de unidade. É a mesma grade que o aprazamento lê.
 */
export const esquemaGravarHorariosPadrao = z
  .object({
    frequencia: id,
    grade: idOuNulo,
    horarios: z
      .array(z.object({ hora: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use HH:MM.') }).strict())
      .max(48),
  })
  .strict();
export type GravarHorariosPadraoEntrada = z.infer<typeof esquemaGravarHorariosPadrao>;
