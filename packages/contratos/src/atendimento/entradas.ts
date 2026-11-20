// Entradas das operações do atendimento externo (M20; ficha, seções 5 e 7), validadas na tela, na API e no executor (o
// mesmo Zod). Vocabulário do novo: o atendimento é o REG da ficha (número do atendimento que a recepção vê), o
// paciente é o ID do cadastro, o profissional é o ID do vínculo profissional × CBO (o CRM vem dele), o convênio é o
// código. Data e hora vêm sempre do relógio do banco (nunca da tela): a ficha guarda data + HHMM e o cabeçalho o
// mesmo instante como data e hora (regra 6).
import { z } from 'zod';
import { esquemaDataIso } from '../preco/entradas.js';
import { textoCp1252 } from '../texto-cp1252.js';
import {
  type CampoHerdado,
  CODIGOS_CARATER,
  CODIGOS_DESFECHO,
  CODIGOS_IMPRESSO,
  CODIGOS_TIPO_ATENDIMENTO,
  desfecho as desfechoDe,
  ETAPAS_PA_MANUAIS,
  HERANCAS,
} from './vocabulario.js';

const id = z.number().int().positive().max(2_147_483_647);
const smallint = z.number().int().min(0).max(32_767);
/** Número do atendimento (RECADATE.REG). */
export const esquemaRegAtendimento = id;
const maiusculas = (max: number) =>
  textoCp1252(max)
    .overwrite((t) => t.replace(/\s+/g, ' ').trim().toLocaleUpperCase('pt-BR'))
    .pipe(textoCp1252(max));
const livre = (max: number) => textoCp1252(max).overwrite((t) => t.replace(/\s+/g, ' ').trim());

// ── atendimento.abrirAtendimento ─────────────────────────────────────────────────────────────────

/** Responsável pelo paciente no atendimento (titular, acompanhante legal): o que a recepção registra. */
export const esquemaResponsavel = z
  .object({
    nome: maiusculas(70).refine((t) => t !== '', 'Informe o nome do responsável.'),
    /** Parentesco (0 cônjuge … 8 outros, como o legado grava). */
    parentesco: z.number().int().min(0).max(8),
    telefone: z
      .string()
      .transform((t) => t.replace(/\D/g, ''))
      .pipe(z.string().min(10).max(15))
      .optional(),
  })
  .strict();
export type Responsavel = z.infer<typeof esquemaResponsavel>;

export const esquemaAbrirAtendimento = z
  .object({
    tipo: z.enum(CODIGOS_TIPO_ATENDIMENTO),
    paciente: id,
    convenio: smallint.refine((c) => c > 0, 'Informe o convênio.'),
    /** Plano do convênio, como aparece na carteirinha. */
    plano: maiusculas(40).optional(),
    matricula: livre(24).optional(),
    validadeCarteira: esquemaDataIso.optional(),
    guia: livre(20).optional(),
    senhaConvenio: livre(20).optional(),
    validadeSenha: esquemaDataIso.optional(),
    /** Profissional que atende (vínculo × CBO); na requisição de laboratório, o executante do setor. */
    profissional: id,
    /** Especialidade (0 só na requisição de laboratório). */
    especialidade: smallint,
    unidade: smallint.refine((u) => u > 0, 'Informe a unidade.'),
    centroCusto: z.number().int().positive(),
    clinica: z.enum(['M', 'C', 'O']).default('M'),
    procedimento: z.number().int().min(0).max(999_999_999),
    carater: z.enum(CODIGOS_CARATER),
    retorno: z.boolean().default(false),
    cidPrincipal: id.optional(),
    cidSecundario: id.optional(),
    /** Médico solicitante (cadastro de solicitantes) e a data do pedido: requisição de laboratório. */
    solicitante: id.optional(),
    dataRequisicao: esquemaDataIso.optional(),
    /** A senha chamada (demanda espontânea) ou a do check-in. */
    senha: id.optional(),
    /** O local de atendimento onde a recepção abre (para o fluxo da senha). */
    local: smallint.optional(),
    /** A marcação de consulta do dia (a partir do agendamento). */
    marcacao: id.optional(),
    responsavel: esquemaResponsavel.optional(),
    /** Tipo de guia do SADT (H, E, S: só os valores vistos; a confirmar, DP-46.6); sem ele, o padrão do tipo. */
    tipoGuia: z.enum(['H', 'E', 'S']).optional(),
    /** Acréscimo do horário especial (noite, fim de semana e feriado): 30%, o único percentual visto. */
    horarioEspecial: z.boolean().default(false),
    /** Empresa do segurado (a carteirinha empresarial), como aparece na ficha. */
    empresa: maiusculas(40).optional(),
    observacao: livre(400).optional(),
    /**
     * M50, etapa 4 (cenário "teleconsulta"): a teleconsulta da marcação (SGH_ATD_TELECONSULTA.ID). A ficha é a da
     * consulta a partir da marcação do dia, sem senha (o paciente não passa pela recepção); a modalidade, o termo e o
     * local ficam no registro do novo, na mesma transação (TELE-01, TELE-02).
     */
    teleconsulta: z.object({ id }).strict().optional(),
  })
  .strict()
  .superRefine((e, ctx) => {
    const lab = e.tipo === 'requisicaoLab';
    if (e.teleconsulta && (e.tipo !== 'consulta' || !e.marcacao))
      ctx.addIssue({
        code: 'custom',
        path: ['teleconsulta'],
        message: 'A teleconsulta abre uma consulta a partir da marcação do dia.',
      });
    if (e.teleconsulta && e.senha)
      ctx.addIssue({
        code: 'custom',
        path: ['senha'],
        message: 'A teleconsulta não passa pela senha da recepção.',
      });
    if (lab && e.horarioEspecial)
      ctx.addIssue({
        code: 'custom',
        path: ['horarioEspecial'],
        message: 'A requisição de laboratório não tem acréscimo de horário.',
      });
    if (lab && !e.solicitante)
      ctx.addIssue({ code: 'custom', path: ['solicitante'], message: 'Informe o médico solicitante.' });
    if (lab && e.especialidade !== 0)
      ctx.addIssue({
        code: 'custom',
        path: ['especialidade'],
        message: 'A requisição de laboratório não tem especialidade.',
      });
    if (!lab && e.especialidade === 0)
      ctx.addIssue({ code: 'custom', path: ['especialidade'], message: 'Informe a especialidade.' });
    if (!lab && !e.cidPrincipal)
      ctx.addIssue({ code: 'custom', path: ['cidPrincipal'], message: 'Informe o CID principal.' });
    if (!lab && e.procedimento === 0)
      ctx.addIssue({ code: 'custom', path: ['procedimento'], message: 'Informe o procedimento.' });
    if (lab && e.marcacao)
      ctx.addIssue({
        code: 'custom',
        path: ['marcacao'],
        message: 'A requisição de laboratório não sai de agendamento de consulta.',
      });
    if (e.senha && !e.local)
      ctx.addIssue({ code: 'custom', path: ['local'], message: 'Informe o local da recepção.' });
    if (e.dataRequisicao && !lab)
      ctx.addIssue({
        code: 'custom',
        path: ['dataRequisicao'],
        message: 'A data do pedido é da requisição de laboratório.',
      });
  });
export type AbrirAtendimentoEntrada = z.infer<typeof esquemaAbrirAtendimento>;

// ── atendimento.alterarSegurado ──────────────────────────────────────────────────────────────────

/** Carteirinha, guia e responsável do atendimento já aberto (controle otimista pelo carimbo da ficha). */
export const esquemaAlterarSegurado = z
  .object({
    atendimento: esquemaRegAtendimento,
    matricula: livre(24).optional(),
    validadeCarteira: esquemaDataIso.nullable().optional(),
    guia: livre(20).optional(),
    senhaConvenio: livre(20).optional(),
    validadeSenha: esquemaDataIso.nullable().optional(),
    plano: maiusculas(40).optional(),
    /** Carimbo lido pela tela (DATA_HORA_ULTIMA_ATUALIZACAO): colisão com o outro sistema vira 409. */
    versao: z.string().min(10).max(30),
  })
  .strict()
  .refine(
    (e) =>
      e.matricula !== undefined ||
      e.validadeCarteira !== undefined ||
      e.guia !== undefined ||
      e.senhaConvenio !== undefined ||
      e.validadeSenha !== undefined ||
      e.plano !== undefined,
    'Nada a alterar.',
  );
export type AlterarSeguradoEntrada = z.infer<typeof esquemaAlterarSegurado>;

// ── atendimento.alterarAtendimento (W1-05) ───────────────────────────────────────────────────────

/**
 * Correção da ficha aberta (W1-05): convênio, profissional, especialidade, procedimento, CID, solicitante,
 * responsável, observação e caráter, com o efeito na conta aberta (a mesma conta reprecificada no item da própria
 * ficha). Só os campos informados mudam; `null` limpa (CID secundário, solicitante, observação). A justificativa vai à
 * trilha com o valor anterior e o novo de cada campo e o total da conta antes e depois.
 */
export const esquemaAlterarAtendimento = z
  .object({
    atendimento: esquemaRegAtendimento,
    convenio: smallint.refine((c) => c > 0, 'Informe o convênio.').optional(),
    profissional: id.optional(),
    especialidade: smallint.optional(),
    procedimento: z.number().int().positive().max(999_999_999).optional(),
    cidPrincipal: id.optional(),
    cidSecundario: id.nullable().optional(),
    solicitante: id.nullable().optional(),
    responsavel: esquemaResponsavel.optional(),
    observacao: livre(400).nullable().optional(),
    carater: z.enum(CODIGOS_CARATER).optional(),
    justificativa: livre(200).refine((t) => t.length >= 10, 'Justifique com pelo menos 10 caracteres.'),
    /** Carimbo lido pela tela (DATA_HORA_ULTIMA_ATUALIZACAO): colisão com o outro sistema vira 409. */
    versao: z.string().min(10).max(30),
  })
  .strict()
  .refine(
    (e) =>
      [
        e.convenio,
        e.profissional,
        e.especialidade,
        e.procedimento,
        e.cidPrincipal,
        e.cidSecundario,
        e.solicitante,
        e.responsavel,
        e.observacao,
        e.carater,
      ].some((v) => v !== undefined),
    'Nada a alterar.',
  );
export type AlterarAtendimentoEntrada = z.infer<typeof esquemaAlterarAtendimento>;

// ── atendimento.alterarHeranca ───────────────────────────────────────────────────────────────────

/**
 * O que a ficha nova copia do atendimento anterior do paciente (configuração única da rede, REPARATE): marca por
 * campo. Controle otimista pelas marcas lidas pela tela (`versao`: as letras na ordem de HERANCAS).
 */
export const esquemaAlterarHeranca = z
  .object({
    marcas: z
      .object(
        Object.fromEntries(HERANCAS.map((h) => [h.campo, z.boolean().optional()])) as Record<
          CampoHerdado,
          z.ZodOptional<z.ZodBoolean>
        >,
      )
      .strict(),
    versao: z.string().regex(/^[TF ]{12}$/),
  })
  .strict()
  .refine((e) => Object.values(e.marcas).some((v) => v !== undefined), 'Nada a alterar.');
export type AlterarHerancaEntrada = z.infer<typeof esquemaAlterarHeranca>;

// ── atendimento.lancarProcedimentoExtra ──────────────────────────────────────────────────────────

export const esquemaLancarProcedimentoExtra = z
  .object({
    atendimento: esquemaRegAtendimento,
    procedimento: z.number().int().positive().max(999_999_999),
    quantidade: z.number().int().min(1).max(999),
    /** Profissional executante (vínculo × CBO); sem ele, o da ficha. */
    profissional: id.optional(),
  })
  .strict();
export type LancarProcedimentoExtraEntrada = z.infer<typeof esquemaLancarProcedimentoExtra>;

// ── atendimento.estornarProcedimentoExtra / corrigirProcedimentoExtra (W1-05) ─────────────────────

const justificativaExtra = livre(200).refine(
  (t) => t.length >= 10,
  'Justifique com pelo menos 10 caracteres.',
);

/** Estorno do procedimento extra lançado por engano, com a conta do atendimento aberta (fechada: faturamento). */
export const esquemaEstornarProcedimentoExtra = z
  .object({
    atendimento: esquemaRegAtendimento,
    /** O ordinal do procedimento na ficha (REPROEXT.SEQ). */
    sequencia: z.number().int().positive().max(32_767),
    justificativa: justificativaExtra,
  })
  .strict();
export type EstornarProcedimentoExtraEntrada = z.infer<typeof esquemaEstornarProcedimentoExtra>;

/** Correção da quantidade e/ou da data de realização do procedimento extra, com a conta aberta. */
export const esquemaCorrigirProcedimentoExtra = z
  .object({
    atendimento: esquemaRegAtendimento,
    sequencia: z.number().int().positive().max(32_767),
    quantidade: z.number().int().min(1).max(999).optional(),
    /** A data de realização (o item da conta); entre a data do atendimento e hoje. */
    data: esquemaDataIso.optional(),
    justificativa: justificativaExtra,
  })
  .strict()
  .refine((e) => e.quantidade !== undefined || e.data !== undefined, {
    message: 'Informe a quantidade ou a data a corrigir.',
    path: ['quantidade'],
  });
export type CorrigirProcedimentoExtraEntrada = z.infer<typeof esquemaCorrigirProcedimentoExtra>;

// ── atendimento.encerrarAtendimento ──────────────────────────────────────────────────────────────

export const esquemaEncerrarAtendimento = z
  .object({
    atendimento: esquemaRegAtendimento,
    desfecho: z.enum(CODIGOS_DESFECHO),
    /** Local onde o paciente é liberado (o do consultório ou o da recepção), quando há senha ligada. */
    local: smallint.optional(),
    /** Destino (texto curto de produto): hospital da transferência, serviço do encaminhamento. */
    destino: livre(60).optional(),
    /** O vínculo profissional de quem registra o desfecho clínico (ato médico: Lei 12.842/2013). */
    profissional: id.optional(),
  })
  .strict()
  .superRefine((e, ctx) => {
    if (desfechoDe(e.desfecho)?.atoMedico && !e.profissional)
      ctx.addIssue({
        code: 'custom',
        path: ['profissional'],
        message: 'O desfecho clínico é ato médico: informe o profissional que registra.',
      });
    if ((e.desfecho === 'transferencia' || e.desfecho === 'encaminhamento') && !e.destino)
      ctx.addIssue({ code: 'custom', path: ['destino'], message: 'Informe o destino.' });
  });
export type EncerrarAtendimentoEntrada = z.infer<typeof esquemaEncerrarAtendimento>;

// ── atendimento.cancelarAtendimento ──────────────────────────────────────────────────────────────

export const esquemaCancelarAtendimento = z
  .object({
    atendimento: esquemaRegAtendimento,
    /** Motivo do cadastro de motivos de exclusão do atendimento. */
    motivo: z.number().int().positive().max(32_767),
    justificativa: livre(80).refine((t) => t.length >= 10, 'Justifique com pelo menos 10 caracteres.'),
  })
  .strict();
export type CancelarAtendimentoEntrada = z.infer<typeof esquemaCancelarAtendimento>;

// ── Fila do consultório (eventos do local: o M19 deixou para cá) ────────────────────────────────

/** Eventos do consultório: chamar (letra C, a senha em C) e atender (letra A, a senha em A). */
export const EVENTOS_CONSULTORIO = ['chamar', 'atender'] as const;
export type EventoConsultorio = (typeof EVENTOS_CONSULTORIO)[number];

export const esquemaConduzirNoConsultorio = z
  .object({
    atendimento: esquemaRegAtendimento,
    local: smallint.refine((l) => l > 0, 'Informe o local.'),
    evento: z.enum(EVENTOS_CONSULTORIO),
  })
  .strict();
export type ConduzirNoConsultorioEntrada = z.infer<typeof esquemaConduzirNoConsultorio>;

// ── Pronto atendimento: etapas, observação ───────────────────────────────────────────────────────

export const esquemaRegistrarEtapaPa = z
  .object({
    atendimento: esquemaRegAtendimento,
    etapa: z.enum(ETAPAS_PA_MANUAIS),
  })
  .strict();
export type RegistrarEtapaPaEntrada = z.infer<typeof esquemaRegistrarEtapaPa>;

export const esquemaAlocarObservacao = z
  .object({
    atendimento: esquemaRegAtendimento,
    /** Leito ou poltrona de observação (cadastro de leitos de observação). */
    leito: z.number().int().positive().max(32_767),
  })
  .strict();
export type AlocarObservacaoEntrada = z.infer<typeof esquemaAlocarObservacao>;

export const esquemaLiberarObservacao = z
  .object({
    atendimento: esquemaRegAtendimento,
    /** Justificativa obrigatória quando passa do limite de 24 horas (Portaria SAS 312/2002). */
    justificativa: livre(200).optional(),
  })
  .strict();
export type LiberarObservacaoEntrada = z.infer<typeof esquemaLiberarObservacao>;

// ── Impressos ────────────────────────────────────────────────────────────────────────────────────

export const esquemaEmitirImpresso = z
  .object({
    atendimento: esquemaRegAtendimento,
    impresso: z.enum(CODIGOS_IMPRESSO),
    formato: z.enum(['zpl', 'pdf']),
    copias: z.number().int().min(1).max(10).default(1),
    /** A ficha configurada (modelo das fichas a imprimir): o PDF sai com o título do modelo. */
    modelo: z.number().int().positive().max(32_767).optional(),
  })
  .strict();
export type EmitirImpressoEntrada = z.infer<typeof esquemaEmitirImpresso>;

// ── Paciente não identificado ────────────────────────────────────────────────────────────────────

export const esquemaMarcarNaoIdentificado = z
  .object({
    paciente: id,
    /** Características visíveis para a identificação posterior (sem nome; texto curto). */
    caracteristicas: livre(200).refine((t) => t.length >= 5, 'Descreva as características.'),
  })
  .strict();
export type MarcarNaoIdentificadoEntrada = z.infer<typeof esquemaMarcarNaoIdentificado>;

/** A identificação do paciente não identificado: o cadastro de destino (a unificação segue pelo cadastro único). */
export const esquemaIdentificarPaciente = z
  .object({
    paciente: id,
    destino: id,
  })
  .strict()
  .refine((e) => e.paciente !== e.destino, {
    path: ['destino'],
    message: 'O cadastro de destino é outro cadastro.',
  });
export type IdentificarPacienteEntrada = z.infer<typeof esquemaIdentificarPaciente>;

// ── Leituras com filtro ──────────────────────────────────────────────────────────────────────────

export const esquemaFiltroAtendimentosDia = z
  .object({
    data: esquemaDataIso.optional(),
    unidade: smallint.optional(),
    tipo: z.enum(CODIGOS_TIPO_ATENDIMENTO).optional(),
    /** Inclui as requisições de laboratório (sem consulta). */
    requisicoes: z.boolean().optional(),
    /** Local de atendimento (o consultório ou a recepção da senha, ou o local da fila do novo). */
    local: smallint.optional(),
    /** Busca: nome contendo, prontuário, número do atendimento ou senha (letras e número). */
    termo: livre(40).optional(),
  })
  .strict();
export type FiltroAtendimentosDia = z.infer<typeof esquemaFiltroAtendimentosDia>;

export const esquemaFiltroIndicadoresAtendimento = z
  .object({
    inicio: esquemaDataIso,
    fim: esquemaDataIso,
    unidade: smallint.optional(),
  })
  .strict()
  .refine((f) => f.inicio <= f.fim, 'O início vem antes do fim.')
  .refine(
    (f) => (Date.parse(`${f.fim}T00:00:00Z`) - Date.parse(`${f.inicio}T00:00:00Z`)) / 86_400_000 <= 366,
    'Período de até 366 dias.',
  );
export type FiltroIndicadoresAtendimento = z.infer<typeof esquemaFiltroIndicadoresAtendimento>;
