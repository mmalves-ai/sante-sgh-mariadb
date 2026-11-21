// Entradas da fatia F6 da gestão de pessoas (M52.6; ficha, seções 5, 7 e 8, regras 20 e 21): cursos, turmas e
// participação, versões de POP e a ciência, o plantão realizado (registro, decisão, tarifa) e o lançamento no repasse.
// O mesmo Zod vale na tela e no servidor; textos na faixa do CP1252 (retrocompatibilidade).
import { z } from 'zod';
import { textoCp1252 } from '../texto-cp1252.js';
import {
  type AproveitamentoTreinamentoCodigo,
  APROVEITAMENTOS_TREINAMENTO,
  type CategoriaCurso,
  CODIGOS_CATEGORIA_CURSO,
  CODIGOS_MODALIDADE_TURMA,
  type ModalidadeTurma,
  type PresencaTreinamentoCodigo,
  PRESENCAS_TREINAMENTO,
  SITUACOES_REALIZADO,
  SITUACOES_TREINAMENTO,
  type SituacaoRealizadoCodigo,
  type SituacaoTreinamentoCodigo,
} from './treinamento-vocabulario.js';

const id = z.number().int().positive();
const smallint = z.number().int().min(0).max(32_767);
const versao = z.number().int().min(0);
const data = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/, 'Data no formato AAAA-MM-DD.');
const competencia = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'Competência no formato AAAA-MM.');
/** Instante local no fuso do estabelecimento (AAAA-MM-DDTHH:MM). */
const instante = z
  .string()
  .regex(
    /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])T([01]\d|2[0-3]):[0-5]\d$/,
    'Data e hora no formato AAAA-MM-DDTHH:MM.',
  );
const motivo = textoCp1252(400).pipe(z.string().min(10, 'Explique com pelo menos 10 caracteres.'));
const textoOpcional = (n: number) => textoCp1252(n).nullable().default(null);
const codigo = textoCp1252(20).pipe(
  z
    .string()
    .min(2, 'Informe o código.')
    .regex(/^[A-Z0-9][A-Z0-9._-]*$/, 'Use letras maiúsculas, números, ponto, hífen ou sublinhado.'),
);

const chaves = <T extends string>(o: Record<T, string>) => Object.keys(o) as [T, ...T[]];

// ── Cursos (catálogo) ─────────────────────────────────────────────────────────────────────────────────────────

export const esquemaAlvoCurso = z
  .object({
    tipo: z.enum(['unidade', 'funcao']),
    /** Código da unidade assistencial ou o nome da função (a chave é calculada no servidor). */
    valor: textoCp1252(60).pipe(z.string().min(1, 'Informe a unidade ou a função.')),
  })
  .strict();
export type AlvoCursoEntrada = z.infer<typeof esquemaAlvoCurso>;

const camposCurso = {
  codigo,
  titulo: textoCp1252(120).pipe(z.string().min(3, 'Informe o título.')),
  conteudo: textoCp1252(2000).pipe(
    z.string().min(10, 'Descreva o conteúdo programático (10 caracteres ou mais).'),
  ),
  categoria: z.enum(CODIGOS_CATEGORIA_CURSO as [CategoriaCurso, ...CategoriaCurso[]]),
  /** Carga horária mínima, em minutos. */
  cargaMinimaMin: z.number().int().min(1).max(10_000),
  /** Validade em meses (0 = sem vencimento). */
  validadeMeses: z.number().int().min(0).max(120),
  obrigatorio: z.boolean(),
  alvos: z.array(esquemaAlvoCurso).max(50).default([]),
};

export const esquemaCurso = z.object(camposCurso).strict();
export type CursoEntrada = z.infer<typeof esquemaCurso>;

export const esquemaAlterarCurso = z
  .object({ ...camposCurso, curso: id, ativo: z.boolean(), versao })
  .strict();
export type AlterarCursoEntrada = z.infer<typeof esquemaAlterarCurso>;

// ── Turmas e participação ─────────────────────────────────────────────────────────────────────────────────────

export const esquemaTurma = z
  .object({
    curso: id,
    inicio: data,
    fim: data,
    cargaMin: z.number().int().min(1).max(10_000),
    instrutor: textoCp1252(70).pipe(z.string().min(3, 'Informe o instrutor.')),
    modalidade: z.enum(CODIGOS_MODALIDADE_TURMA as [ModalidadeTurma, ...ModalidadeTurma[]]),
    local: textoOpcional(80),
    /** A versão do POP trabalhada na turma (a conclusão registra a ciência dessa versão). */
    pop: id.nullable().default(null),
    observacao: textoOpcional(400),
  })
  .strict()
  .refine((t) => t.fim >= t.inicio, { message: 'O fim vem antes do início.', path: ['fim'] });
export type TurmaEntrada = z.infer<typeof esquemaTurma>;

/** W0-06: alteração da turma ABERTA, com o motivo (o valor anterior fica na trilha da gestão de pessoas). */
export const esquemaAlterarTurma = z
  .object({
    treinamento: id,
    inicio: data,
    fim: data,
    cargaMin: z.number().int().min(1).max(10_000),
    instrutor: textoCp1252(70).pipe(z.string().min(3, 'Informe o instrutor.')),
    modalidade: z.enum(CODIGOS_MODALIDADE_TURMA as [ModalidadeTurma, ...ModalidadeTurma[]]),
    local: textoOpcional(80),
    pop: id.nullable().default(null),
    observacao: textoOpcional(400),
    motivo,
    versao,
  })
  .strict()
  .refine((t) => t.fim >= t.inicio, { message: 'O fim vem antes do início.', path: ['fim'] });
export type AlterarTurmaEntrada = z.infer<typeof esquemaAlterarTurma>;

/** W0-06: retirada da inscrição feita por engano (só sem presença lançada; o retrato fica guardado). */
export const esquemaRetirarInscricao = z.object({ treinamento: id, vinculo: id, motivo, versao }).strict();
export type RetirarInscricaoEntrada = z.infer<typeof esquemaRetirarInscricao>;

export const esquemaInscricao = z
  .object({ treinamento: id, vinculos: z.array(id).min(1).max(200) })
  .strict()
  .refine((x) => new Set(x.vinculos).size === x.vinculos.length, {
    message: 'Colaborador repetido na inscrição.',
    path: ['vinculos'],
  });
export type InscricaoEntrada = z.infer<typeof esquemaInscricao>;

export const esquemaParticipacao = z
  .object({
    treinamento: id,
    vinculo: id,
    presenca: z.enum(chaves<PresencaTreinamentoCodigo>(PRESENCAS_TREINAMENTO)),
    aproveitamento: z
      .enum(chaves<AproveitamentoTreinamentoCodigo>(APROVEITAMENTOS_TREINAMENTO))
      .nullable()
      .default(null),
    conclusao: data.nullable().default(null),
    observacao: textoOpcional(400),
    versao,
  })
  .strict();
export type ParticipacaoEntrada = z.infer<typeof esquemaParticipacao>;

/** W0-06: correção da presença e do aproveitamento já lançados, com o motivo (também na turma encerrada). */
export const esquemaCorrigirParticipacao = z
  .object({
    treinamento: id,
    vinculo: id,
    presenca: z.enum(chaves<PresencaTreinamentoCodigo>(PRESENCAS_TREINAMENTO)),
    aproveitamento: z
      .enum(chaves<AproveitamentoTreinamentoCodigo>(APROVEITAMENTOS_TREINAMENTO))
      .nullable()
      .default(null),
    conclusao: data.nullable().default(null),
    observacao: textoOpcional(400),
    motivo,
    versao,
  })
  .strict();
export type CorrigirParticipacaoEntrada = z.infer<typeof esquemaCorrigirParticipacao>;

export const esquemaEncerrarTurma = z.object({ treinamento: id, versao }).strict();
export type EncerrarTurmaEntrada = z.infer<typeof esquemaEncerrarTurma>;

export const esquemaCancelarTurma = z.object({ treinamento: id, motivo, versao }).strict();
export type CancelarTurmaEntrada = z.infer<typeof esquemaCancelarTurma>;

export const esquemaFiltroTurmas = z
  .object({
    situacao: z.enum(['aberta', 'encerrada', 'cancelada', 'todas']).default('aberta'),
    curso: z.coerce.number().int().positive().optional(),
    de: data.optional(),
    ate: data.optional(),
  })
  .strict();
export type FiltroTurmasEntrada = z.infer<typeof esquemaFiltroTurmas>;

export const esquemaFiltroSituacaoTreinamento = z
  .object({
    unidade: z.coerce.number().int().min(0).max(32_767).optional(),
    curso: z.coerce.number().int().positive().optional(),
    situacao: z
      .enum([...chaves<SituacaoTreinamentoCodigo>(SITUACOES_TREINAMENTO), 'comPendencia', 'todas'] as [
        string,
        ...string[],
      ])
      .default('comPendencia'),
    termo: textoCp1252(60).optional(),
  })
  .strict();
export type FiltroSituacaoTreinamentoEntrada = z.infer<typeof esquemaFiltroSituacaoTreinamento>;

// ── POP versionado e ciência ──────────────────────────────────────────────────────────────────────────────────

export const esquemaVersaoPop = z
  .object({
    codigo,
    titulo: textoCp1252(120).pipe(z.string().min(3, 'Informe o título.')),
    /** Unidade assistencial do POP (código); sem unidade, o estabelecimento inteiro. */
    unidade: smallint.nullable().default(null),
    vigencia: data,
    resumo: textoCp1252(2000).pipe(z.string().min(10, 'Resuma o procedimento (10 caracteres ou mais).')),
    /** Onde está o documento completo (gestão de documentos, intranet), sem link para fora. */
    referencia: textoOpcional(200),
    /** O que mudou em relação à versão anterior (obrigatório da 2ª versão em diante). */
    alteracoes: textoOpcional(1000),
  })
  .strict();
export type VersaoPopEntrada = z.infer<typeof esquemaVersaoPop>;

export const esquemaRevogarPop = z.object({ pop: id, motivo }).strict();
export type RevogarPopEntrada = z.infer<typeof esquemaRevogarPop>;

export const esquemaCienciaPop = z.object({ pop: id, vinculo: id.nullable().default(null) }).strict();
export type CienciaPopEntrada = z.infer<typeof esquemaCienciaPop>;

// ── Autosserviço ──────────────────────────────────────────────────────────────────────────────────────────────

export const esquemaMeuEspaco = z.object({ vinculo: z.coerce.number().int().positive().optional() }).strict();
export type MeuEspacoEntrada = z.infer<typeof esquemaMeuEspaco>;

// ── Plantão realizado e repasse ───────────────────────────────────────────────────────────────────────────────

export const esquemaRegistrarRealizado = z
  .object({
    plantao: id,
    inicio: instante,
    fim: instante,
    origem: z.enum(['informado', 'ponto']).default('informado'),
    observacao: textoOpcional(400),
  })
  .strict();
export type RegistrarRealizadoEntrada = z.infer<typeof esquemaRegistrarRealizado>;

export const esquemaDecidirRealizado = z
  .object({
    realizado: id,
    decisao: z.enum(['aprovar', 'recusar']),
    motivo: motivo.nullable().default(null),
    versao,
  })
  .strict()
  .refine((d) => d.decisao === 'aprovar' || d.motivo !== null, {
    message: 'A recusa pede o motivo.',
    path: ['motivo'],
  });
export type DecidirRealizadoEntrada = z.infer<typeof esquemaDecidirRealizado>;

/**
 * W0-06: estorno do realizado aprovado, com o motivo. O já lançado no repasse leva o lançamento negativo na
 * competência seguinte; o de competência já apurada é recusado (devolução da apuração).
 */
export const esquemaEstornarRealizado = z.object({ realizado: id, motivo, versao }).strict();
export type EstornarRealizadoEntrada = z.infer<typeof esquemaEstornarRealizado>;

export const esquemaFiltroRealizado = z
  .object({
    competencia,
    unidade: z.coerce.number().int().min(0).max(32_767).optional(),
    situacao: z
      .enum([...chaves<SituacaoRealizadoCodigo>(SITUACOES_REALIZADO), 'semRealizado', 'todos'] as [
        string,
        ...string[],
      ])
      .default('todos'),
  })
  .strict();
export type FiltroRealizadoEntrada = z.infer<typeof esquemaFiltroRealizado>;

export const esquemaTarifaPlantao = z
  .object({
    tipo: z.enum(['presencial', 'sobreaviso', 'diarista']),
    unidade: smallint.nullable().default(null),
    inicio: data,
    fim: data.nullable().default(null),
    valorHora: z.number().positive().max(100_000),
  })
  .strict()
  .refine((t) => t.fim === null || t.fim >= t.inicio, {
    message: 'O fim da vigência vem antes do início.',
    path: ['fim'],
  });
export type TarifaPlantaoEntrada = z.infer<typeof esquemaTarifaPlantao>;

export const esquemaEncerrarTarifa = z.object({ tarifa: id, fim: data }).strict();
export type EncerrarTarifaEntrada = z.infer<typeof esquemaEncerrarTarifa>;

export const esquemaRelatorioRepasse = z.object({ competencia }).strict();
export type RelatorioRepasseEntrada = z.infer<typeof esquemaRelatorioRepasse>;

/** O lançamento de um grupo (prestador × competência) do relatório: os realizados aprovados ainda não lançados. */
export const esquemaLancarPlantoesRepasse = z
  .object({
    competencia,
    prestador: id,
    /** O registro do profissional (id da inscrição no conselho): o mesmo prestador com dois registros tem dois grupos. */
    registro: id,
    realizados: z.array(id).min(1).max(200),
  })
  .strict();
export type LancarPlantoesRepasseEntrada = z.infer<typeof esquemaLancarPlantoesRepasse>;
