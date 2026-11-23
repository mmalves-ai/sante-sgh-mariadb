// Entradas da fatia F3 da gestão de pessoas (M52.3; ficha do M52, seções 6 a 8; regras 8 a 10): a troca de plantão
// (pedido, resposta do colega, decisão da coordenação, cancelamento), "quem está de plantão agora", o acionamento do
// sobreaviso e o dimensionamento de enfermagem (COFEN 543/2017). O mesmo Zod vale na tela e no servidor; as regras que
// dependem do estado (escala publicada, plantão futuro, troca aberta, conselho, interjornada, limite e sobreposição do
// colega) ficam em @sgh/dominio-pessoas e o servidor relê o estado na transação.
import { z } from 'zod';
import { textoCp1252 } from '../texto-cp1252.js';
import { esquemaInstanteEscala } from './escala-entradas.js';
import {
  CODIGOS_TIPO_PLANTAO,
  CODIGOS_TURNO_ESCALA,
  type TipoPlantao,
  type TurnoEscala,
} from './escala-vocabulario.js';
import {
  CODIGOS_ESTADO_TROCA,
  CODIGOS_FONTE_DIMENSIONAMENTO,
  CODIGOS_TIPO_TROCA,
  type EstadoTroca,
  type FonteDimensionamento,
  IST_MINIMO,
  JORNADA_SEMANAL_MAXIMA,
  JORNADA_SEMANAL_MINIMA,
  type TipoTroca,
} from './plantao-vocabulario.js';
import { idBanco } from '../validacao/id-banco.js';

const id = z.number().int().positive();
const versao = z.number().int().min(0);
const data = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/, 'Data no formato AAAA-MM-DD.');
const motivo = textoCp1252(400).pipe(z.string().min(10, 'Explique com pelo menos 10 caracteres.'));
const pacientes = z.number().int().min(0, 'Informe zero ou mais pacientes.').max(999);

// ── Troca de plantão ───────────────────────────────────────────────────────────────────────────────────────────

/**
 * Pedido de troca: o plantão de quem pede, o colega (vínculo) e, na troca, o plantão do colega que volta para quem
 * pede. O motivo vai à trilha da escala na aprovação (regra 8: a escala publicada só muda com motivo).
 */
export const esquemaPedirTroca = z
  .object({
    tipo: z.enum(CODIGOS_TIPO_TROCA as [TipoTroca, ...TipoTroca[]]),
    plantao: id,
    versao,
    colega: id,
    plantaoColega: id.nullable().default(null),
    versaoColega: versao.nullable().default(null),
    motivo,
  })
  .strict()
  .refine((t) => (t.tipo === 'troca') === (t.plantaoColega !== null), {
    message: 'Na troca, escolha o plantão do colega; na cessão, não.',
    path: ['plantaoColega'],
  })
  .refine((t) => (t.plantaoColega === null) === (t.versaoColega === null), {
    message: 'Informe a versão do plantão do colega.',
    path: ['versaoColega'],
  });
export type PedirTrocaEntrada = z.infer<typeof esquemaPedirTroca>;

/**
 * Resposta do colega: aceite ou recusa. Quando o colega não tem acesso ao sistema, a coordenação registra a resposta
 * dele com a forma de confirmação (D-ACEITE-52.3); o próprio colega responde sem ela.
 */
export const esquemaResponderTroca = z
  .object({
    troca: id,
    versao,
    aceite: z.boolean(),
    confirmacao: textoCp1252(200)
      .pipe(z.string().min(10, 'Diga como o colega confirmou (pelo menos 10 caracteres).'))
      .nullable()
      .default(null),
  })
  .strict();
export type ResponderTrocaEntrada = z.infer<typeof esquemaResponderTroca>;

/** Decisão da coordenação (só a troca aceita pelo colega); a reprovação pede o motivo. */
export const esquemaDecidirTroca = z
  .object({
    troca: id,
    versao,
    aprovar: z.boolean(),
    motivo: motivo.nullable().default(null),
  })
  .strict()
  .refine((d) => d.aprovar || d.motivo !== null, {
    message: 'Explique o motivo da reprovação.',
    path: ['motivo'],
  });
export type DecidirTrocaEntrada = z.infer<typeof esquemaDecidirTroca>;

/** Cancelamento por quem pediu (antes da decisão). */
export const esquemaCancelarTroca = z.object({ troca: id, versao, motivo }).strict();
export type CancelarTrocaEntrada = z.infer<typeof esquemaCancelarTroca>;

export const esquemaFiltroTrocas = z
  .object({
    estado: z.enum(CODIGOS_ESTADO_TROCA as [EstadoTroca, ...EstadoTroca[]]).optional(),
    escala: z.coerce.number().int().positive().optional(),
    /** Só as trocas em que a pessoa da sessão é parte (quem pede ou o colega). */
    minhas: z
      .enum(['sim', 'nao'])
      .optional()
      .transform((v) => v === 'sim'),
  })
  .strict();
export type FiltroTrocasEntrada = z.infer<typeof esquemaFiltroTrocas>;

// ── Quem está de plantão agora ─────────────────────────────────────────────────────────────────────────────────

/** Consulta no instante (padrão: agora, em Brasília), com os filtros da ficha: especialidade e setor (seção 4). */
export const esquemaFiltroPlantaoAgora = z
  .object({
    instante: esquemaInstanteEscala.optional(),
    unidade: z.coerce.number().int().positive().max(32_767).optional(),
    setor: textoCp1252(60).optional(),
    /** CBO do registro do conselho (ex.: 225125, médico clínico). */
    especialidade: z
      .string()
      .regex(/^\d{4,6}$/, 'Especialidade inválida.')
      .optional(),
    tipo: z.enum(CODIGOS_TIPO_PLANTAO as [TipoPlantao, ...TipoPlantao[]]).optional(),
  })
  .strict();
export type FiltroPlantaoAgoraEntrada = z.infer<typeof esquemaFiltroPlantaoAgora>;

/** Acionamento do sobreaviso (regra 10): o plantão de sobreaviso em curso, o motivo e o atendimento, se houver. */
export const esquemaAcionarSobreaviso = z
  .object({
    plantao: id,
    motivo,
    /** Número do atendimento (REG) que motivou o acionamento, se houver; nenhum dado do paciente vai junto. */
    atendimento: idBanco.nullable().default(null),
  })
  .strict();
export type AcionarSobreavisoEntrada = z.infer<typeof esquemaAcionarSobreaviso>;

/** Chegada do profissional acionado (ou o cancelamento do acionamento feito por engano, com o motivo). */
export const esquemaRegistrarChegadaSobreaviso = z
  .object({
    acionamento: id,
    versao,
    chegouEm: esquemaInstanteEscala,
  })
  .strict();
export type RegistrarChegadaSobreavisoEntrada = z.infer<typeof esquemaRegistrarChegadaSobreaviso>;

export const esquemaCancelarAcionamento = z.object({ acionamento: id, versao, motivo }).strict();
export type CancelarAcionamentoEntrada = z.infer<typeof esquemaCancelarAcionamento>;

// ── Dimensionamento de enfermagem ──────────────────────────────────────────────────────────────────────────────

const turnos = z.enum(CODIGOS_TURNO_ESCALA as [TurnoEscala, ...TurnoEscala[]]);
const unidadeInternacao = z
  .string()
  .trim()
  .regex(/^[A-Za-z0-9 ._-]{1,5}$/, 'Unidade de internação inválida.');

/** Pacientes por categoria do SCP (regra 9; COFEN 543/2017, art. 3º). */
export const esquemaPacientesScp = z
  .object({
    minimos: pacientes,
    intermediarios: pacientes,
    altaDependencia: pacientes,
    semiIntensivos: pacientes,
    intensivos: pacientes,
  })
  .strict();
export type PacientesScp = z.infer<typeof esquemaPacientesScp>;

/**
 * Cálculo do dimensionamento da unidade e do turno da escala: a jornada semanal da equipe (a constante de Marinho), o
 * índice de segurança técnica (≥ 15%) e os pacientes por categoria, informados pela coordenação ou lidos da
 * classificação de pacientes do turno (a unidade de internação da classificação).
 */
export const esquemaCalcularDimensionamento = z
  .object({
    unidade: z.number().int().positive().max(32_767),
    setor: textoCp1252(60).default(''),
    data,
    turno: turnos,
    jornadaSemanalHoras: z
      .number()
      .min(JORNADA_SEMANAL_MINIMA, `A jornada semanal vai de ${JORNADA_SEMANAL_MINIMA} h…`)
      .max(JORNADA_SEMANAL_MAXIMA, `…a ${JORNADA_SEMANAL_MAXIMA} h.`),
    ist: z
      .number()
      .min(IST_MINIMO, 'O índice de segurança técnica é de pelo menos 15%.')
      .max(0.5, 'O índice de segurança técnica vai até 50%.'),
    fonte: z.enum(CODIGOS_FONTE_DIMENSIONAMENTO as [FonteDimensionamento, ...FonteDimensionamento[]]),
    unidadeInternacao: unidadeInternacao.nullable().default(null),
    pacientes: esquemaPacientesScp.nullable().default(null),
  })
  .strict()
  .refine((d) => d.fonte !== 'informada' || d.pacientes !== null, {
    message: 'Informe os pacientes por categoria.',
    path: ['pacientes'],
  })
  .refine((d) => d.fonte !== 'classificacao' || d.unidadeInternacao !== null, {
    message: 'Escolha a unidade de internação da classificação.',
    path: ['unidadeInternacao'],
  });
export type CalcularDimensionamentoEntrada = z.infer<typeof esquemaCalcularDimensionamento>;

export const esquemaFiltroDimensionamentos = z
  .object({
    unidade: z.coerce.number().int().positive().max(32_767).optional(),
  })
  .strict();
export type FiltroDimensionamentosEntrada = z.infer<typeof esquemaFiltroDimensionamentos>;
