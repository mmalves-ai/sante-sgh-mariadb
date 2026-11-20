// Entradas das telas da escala de plantão e dos regimes, fatia F2 (M52.2; ficha do M52, seções 6 a 8; regras 3 e 5 a
// 8). O mesmo Zod vale na tela e no servidor; as regras que dependem do estado (conselho no dia, interjornada, limite
// do contrato, sobreposição na Rede, motivo na escala publicada) ficam em @sgh/dominio-pessoas e o servidor relê o
// estado na transação. Instantes em hora local de Brasília, sem fuso no texto (`AAAA-MM-DDTHH:MM`).
import { z } from 'zod';
import { textoCp1252 } from '../texto-cp1252.js';
import {
  CODIGOS_ESTADO_ESCALA,
  CODIGOS_TIPO_ESCALA,
  CODIGOS_TIPO_PLANTAO,
  DURACAO_MAXIMA_PLANTAO_MIN,
  DURACAO_MINIMA_PLANTAO_MIN,
  type EstadoEscala,
  type TipoEscala,
  type TipoPlantao,
} from './escala-vocabulario.js';

const id = z.number().int().positive();
const versao = z.number().int().min(0);
const data = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/, 'Data no formato AAAA-MM-DD.');
/** Instante local (hora de Brasília) com minutos: `2026-11-02T19:00`. */
export const esquemaInstanteEscala = z
  .string()
  .regex(
    /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])T([01]\d|2[0-3]):[0-5]\d$/,
    'Data e hora no formato AAAA-MM-DDTHH:MM.',
  );
/** Competência da escala (mês): `2026-11`. */
export const esquemaCompetenciaEscala = z
  .string()
  .regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'Competência no formato AAAA-MM.');
const motivo = textoCp1252(400).pipe(z.string().min(10, 'Explique com pelo menos 10 caracteres.'));

const tiposEscala = z.enum(CODIGOS_TIPO_ESCALA as [TipoEscala, ...TipoEscala[]]);
const tiposPlantao = z.enum(CODIGOS_TIPO_PLANTAO as [TipoPlantao, ...TipoPlantao[]]);
const estadosEscala = z.enum(CODIGOS_ESTADO_ESCALA as [EstadoEscala, ...EstadoEscala[]]);

// ── Regimes ────────────────────────────────────────────────────────────────────────────────────────────────────

const camposRegime = {
  /** Sigla do modelo, única no estabelecimento (`12x36`, `6x1-6h`). */
  codigo: textoCp1252(20).pipe(
    z
      .string()
      .min(2, 'Informe a sigla do regime.')
      .regex(/^[A-Za-z0-9][A-Za-z0-9 x/.-]*$/, 'Use letras, números, espaço, x, barra, ponto ou hífen.'),
  ),
  nome: textoCp1252(60).pipe(z.string().min(3, 'Informe o nome do regime.')),
  /** Tipo de jornada do domínio do ramo (POTPJORNADA.ID: 1 normal, 2 escalonada, 3 a 6 horista). */
  jornada: z.number().int().min(1).max(9),
  /** Contrato em tempo parcial (POTPCONTTEMP.ID: 0 não é; 1 a 3 com o limite semanal; regra 6). */
  contratoParcial: z.number().int().min(0).max(9).default(0),
  /** Folga padrão do domínio de trabalho/folga do ramo (POTPTRABFOLGA.ID), se houver. */
  folgaPadrao: z.number().int().min(1).max(99).nullable().default(null),
  /** Duração padrão do plantão no regime (a grade sugere o fim), em minutos. */
  minutosPlantao: z.number().int().min(DURACAO_MINIMA_PLANTAO_MIN).max(DURACAO_MAXIMA_PLANTAO_MIN),
  /** Descanso mínimo entre duas jornadas, em minutos (regra 5: 11 h, salvo acordo registrado). */
  descansoMinimoMin: z
    .number()
    .int()
    .min(0)
    .max(72 * 60),
  /** Limite semanal de horas do regime quando não é tempo parcial (o parcial usa o limite do domínio). */
  limiteSemanalHoras: z.number().int().min(1).max(60),
  /**
   * Acordo ou convenção coletiva que autoriza a exceção da interjornada (12x36; regra 5): número e data do registro.
   * Sem ele, o descanso mínimo nunca fica abaixo de 11 h.
   */
  acordo: textoCp1252(120).nullable().default(null),
  ativo: z.boolean().default(true),
};

export const esquemaIncluirRegime = z.object(camposRegime).strict();
export type IncluirRegimeEntrada = z.infer<typeof esquemaIncluirRegime>;

export const esquemaAlterarRegime = z.object({ ...camposRegime, id, versao }).strict();
export type AlterarRegimeEntrada = z.infer<typeof esquemaAlterarRegime>;

/** Regime do vínculo a partir de uma data (SGH_PES_REGIME_VINCULO; só inclusão: a vigência anterior fica). */
export const esquemaAtribuirRegime = z
  .object({
    vinculo: id,
    regime: id,
    desde: data,
  })
  .strict();
export type AtribuirRegimeEntrada = z.infer<typeof esquemaAtribuirRegime>;

/** Busca dos colaboradores para a escala e os regimes (nome ou matrícula; sem CPF). */
export const esquemaFiltroColaboradoresEscala = z
  .object({
    termo: textoCp1252(70).optional(),
    limite: z.coerce.number().int().min(1).max(200).default(50),
  })
  .strict();
export type FiltroColaboradoresEscalaEntrada = z.infer<typeof esquemaFiltroColaboradoresEscala>;

// ── Escala ─────────────────────────────────────────────────────────────────────────────────────────────────────

/** Cobertura mínima por turno: quantos profissionais presenciais ou diaristas cada turno precisa (regra 9). */
export const esquemaCobertura = z
  .object({
    manha: z.number().int().min(0).max(99),
    tarde: z.number().int().min(0).max(99),
    noite: z.number().int().min(0).max(99),
  })
  .strict();
export type CoberturaEntrada = z.infer<typeof esquemaCobertura>;

/** Nova escala do setor e da competência (uma por unidade, setor, competência e tipo). */
export const esquemaCriarEscala = z
  .object({
    /** Unidade do estabelecimento (TBUNIDAD.COD). */
    unidade: z.number().int().positive().max(32_767),
    setor: textoCp1252(60).default(''),
    competencia: esquemaCompetenciaEscala,
    tipo: tiposEscala,
    cobertura: esquemaCobertura,
  })
  .strict();
export type CriarEscalaEntrada = z.infer<typeof esquemaCriarEscala>;

/** Cobertura mínima alterada (com a versão; na escala publicada, só com motivo). */
export const esquemaAlterarCobertura = z
  .object({
    escala: id,
    versao,
    cobertura: esquemaCobertura,
    motivo: motivo.nullable().default(null),
  })
  .strict();
export type AlterarCoberturaEntrada = z.infer<typeof esquemaAlterarCobertura>;

const camposPlantao = {
  escala: id,
  vinculo: id,
  tipo: tiposPlantao,
  inicio: esquemaInstanteEscala,
  fim: esquemaInstanteEscala,
  /** Sobreaviso: tempo de chegada combinado, em minutos (obrigatório no sobreaviso). */
  chegadaMin: z.number().int().min(5).max(240).nullable().default(null),
  /** Motivo da mudança: obrigatório quando a escala já foi publicada (regra 8). */
  motivo: motivo.nullable().default(null),
};

/** Plantão incluído na escala (montagem). */
export const esquemaIncluirPlantao = z
  .object(camposPlantao)
  .strict()
  .refine((p) => p.tipo !== 'sobreaviso' || p.chegadaMin !== null, {
    message: 'Informe o tempo de chegada do sobreaviso.',
    path: ['chegadaMin'],
  });
export type IncluirPlantaoEntrada = z.infer<typeof esquemaIncluirPlantao>;

/** Plantão alterado (horário, tipo, tempo de chegada), com a versão lida na grade. */
export const esquemaAlterarPlantao = z
  .object({ ...camposPlantao, plantao: id, versao })
  .strict()
  .refine((p) => p.tipo !== 'sobreaviso' || p.chegadaMin !== null, {
    message: 'Informe o tempo de chegada do sobreaviso.',
    path: ['chegadaMin'],
  });
export type AlterarPlantaoEntrada = z.infer<typeof esquemaAlterarPlantao>;

/** Plantão cancelado (nunca apagado). */
export const esquemaCancelarPlantao = z
  .object({
    escala: id,
    plantao: id,
    versao,
    motivo: motivo.nullable().default(null),
  })
  .strict();
export type CancelarPlantaoEntrada = z.infer<typeof esquemaCancelarPlantao>;

/** Publicação: a versão da escala lida na grade e, se houver furo de cobertura, a justificativa (D-FURO-52). */
export const esquemaPublicarEscala = z
  .object({
    escala: id,
    versao,
    justificativaFuro: motivo.nullable().default(null),
  })
  .strict();
export type PublicarEscalaEntrada = z.infer<typeof esquemaPublicarEscala>;

/** W0-06: exclusão da escala em RASCUNHO criada por engano (só sem vínculo; o retrato fica guardado). */
export const esquemaExcluirEscala = z
  .object({
    escala: id,
    versao,
    motivo,
  })
  .strict();
export type ExcluirEscalaEntrada = z.infer<typeof esquemaExcluirEscala>;

/** W0-06: cancelamento da escala PUBLICADA com motivo (os plantões previstos ficam cancelados; nada se apaga). */
export const esquemaCancelarEscala = z
  .object({
    escala: id,
    versao,
    motivo,
  })
  .strict();
export type CancelarEscalaEntrada = z.infer<typeof esquemaCancelarEscala>;

/** W0-06: anulação da vigência de regime lançada por engano (a vigência fica no histórico, anulada). */
export const esquemaAnularVigencia = z
  .object({
    vigencia: id,
    motivo,
  })
  .strict();
export type AnularVigenciaEntrada = z.infer<typeof esquemaAnularVigencia>;

/** Filtro da lista das escalas do estabelecimento. */
export const esquemaFiltroEscalas = z
  .object({
    competencia: esquemaCompetenciaEscala.optional(),
    unidade: z.coerce.number().int().positive().max(32_767).optional(),
    tipo: tiposEscala.optional(),
    estado: estadosEscala.optional(),
  })
  .strict();
export type FiltroEscalasEntrada = z.infer<typeof esquemaFiltroEscalas>;
