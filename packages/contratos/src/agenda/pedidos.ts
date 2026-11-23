// Pedidos das telas da agenda de consultas (M17) que não são a entrada de uma operação do executor: prévia e
// gravação da grade, escala planejada, bloqueio por período, confirmação com resultado, lista de espera, remarcação
// em lote e a ligação da agenda. Validados na tela e na API (o mesmo Zod).
import { z } from 'zod';
import { esquemaDataIso } from '../preco/entradas.js';
import { textoCp1252 } from '../texto-cp1252.js';
import { esquemaCanal, esquemaHoraAgenda, esquemaMotivoCancelamento, MODOS_REMARCACAO } from './entradas.js';
import { MOTIVOS_BLOQUEIO, PRIORIDADES_ESPERA, RESULTADOS_CONFIRMACAO } from './vocabulario.js';
import { idBanco } from '../validacao/id-banco.js';

const id = idBanco;
const texto200 = textoCp1252(200)
  .overwrite((t) => t.replace(/\s+/g, ' ').trim())
  .nullable()
  .optional();

export const esquemaFaixaPedido = z
  .object({
    semana: z.number().int().min(1).max(7),
    inicio: esquemaHoraAgenda,
    fim: esquemaHoraAgenda,
    intervaloInicio: esquemaHoraAgenda.nullable().optional(),
    intervaloFim: esquemaHoraAgenda.nullable().optional(),
  })
  .strict();
export type FaixaPedido = z.infer<typeof esquemaFaixaPedido>;

/** Prévia (e gravação) da grade: as faixas informadas, ou a escala planejada vigente, ou o modelo atual. */
export const esquemaPedidoGrade = z
  .object({
    agenda: id,
    de: esquemaDataIso,
    ate: esquemaDataIso,
    duracaoMinutos: z.number().int().min(5).max(240).nullable().optional(),
    faixas: z.array(esquemaFaixaPedido).max(21).nullable().optional(),
    incluirFeriados: z.boolean().default(false),
  })
  .strict();
export type PedidoGrade = z.infer<typeof esquemaPedidoGrade>;

export const esquemaPedidoGerarGrade = esquemaPedidoGrade.extend({
  /** A impressão da prévia aprovada: a gravação recusa se a lista mudou. */
  assinatura: z.string().regex(/^[0-9a-f]{32}$/),
});
export type PedidoGerarGrade = z.infer<typeof esquemaPedidoGerarGrade>;

export const esquemaPedidoEscala = z
  .object({
    vigenteDesde: esquemaDataIso,
    duracaoMinutos: z.number().int().min(5).max(240),
    faixas: z.array(esquemaFaixaPedido).min(1).max(21),
  })
  .strict();
export type PedidoEscala = z.infer<typeof esquemaPedidoEscala>;

const codigosBloqueio = MOTIVOS_BLOQUEIO.map((m) => m.codigo) as [string, ...string[]];

export const esquemaPedidoPeriodoBloqueio = z
  .object({
    agenda: id,
    inicio: esquemaDataIso,
    fim: esquemaDataIso,
    horaInicio: esquemaHoraAgenda.nullable().optional(),
    horaFim: esquemaHoraAgenda.nullable().optional(),
  })
  .strict()
  .refine((p) => p.fim >= p.inicio, { message: 'O fim vem antes do início.', path: ['fim'] })
  .refine((p) => (p.horaInicio ? Boolean(p.horaFim) && (p.horaFim ?? '') > p.horaInicio : !p.horaFim), {
    message: 'Informe o início e o fim das horas, com o fim depois do início.',
    path: ['horaFim'],
  });
export type PedidoPeriodoBloqueio = z.infer<typeof esquemaPedidoPeriodoBloqueio>;

export const esquemaPedidoBloqueio = z
  .object({
    agenda: id,
    inicio: esquemaDataIso,
    fim: esquemaDataIso,
    horaInicio: esquemaHoraAgenda.nullable().optional(),
    horaFim: esquemaHoraAgenda.nullable().optional(),
    motivo: z.enum(codigosBloqueio),
    complemento: texto200,
    previsaoRetorno: esquemaDataIso.nullable().optional(),
  })
  .strict()
  .refine((p) => p.fim >= p.inicio, { message: 'O fim vem antes do início.', path: ['fim'] })
  .refine((p) => (p.horaInicio ? Boolean(p.horaFim) && (p.horaFim ?? '') > p.horaInicio : !p.horaFim), {
    message: 'Informe o início e o fim das horas, com o fim depois do início.',
    path: ['horaFim'],
  })
  .refine((p) => p.motivo !== 'OUTRO' || (p.complemento ?? '').length >= 5, {
    message: 'Em "Outro motivo", descreva o motivo.',
    path: ['complemento'],
  });
export type PedidoBloqueio = z.infer<typeof esquemaPedidoBloqueio>;

const codigosResultado = RESULTADOS_CONFIRMACAO.map((r) => r.codigo) as [string, ...string[]];

export const esquemaPedidoConfirmacao = z
  .object({ resultado: z.enum(codigosResultado), canal: esquemaCanal, observacao: texto200 })
  .strict();
export type PedidoConfirmacao = z.infer<typeof esquemaPedidoConfirmacao>;

export const esquemaPedidoEspera = z
  .object({
    paciente: id,
    agenda: id.nullable().optional(),
    especialidade: z.number().int().min(0).max(99).nullable().optional(),
    prioridade: z.enum(PRIORIDADES_ESPERA),
    observacao: textoCp1252(500)
      .overwrite((t) => t.replace(/\s+/g, ' ').trim())
      .nullable()
      .optional(),
  })
  .strict()
  .refine((p) => Boolean(p.agenda) || (p.especialidade !== null && p.especialidade !== undefined), {
    message: 'Informe a agenda ou a especialidade.',
    path: ['agenda'],
  });
export type PedidoEspera = z.infer<typeof esquemaPedidoEspera>;

export const esquemaPedidoOfertaEspera = z
  .object({ agenda: id, data: esquemaDataIso, hora: esquemaHoraAgenda })
  .strict();
export type PedidoOfertaEspera = z.infer<typeof esquemaPedidoOfertaEspera>;

export const esquemaPedidoMarcarEspera = z
  .object({
    agenda: id,
    data: esquemaDataIso,
    hora: esquemaHoraAgenda,
    convenio: z.number().int().min(0).max(32767),
    canal: esquemaCanal,
  })
  .strict();
export type PedidoMarcarEspera = z.infer<typeof esquemaPedidoMarcarEspera>;

export const esquemaPedidoEncerrarEspera = z
  .object({ situacao: z.enum(['cancelado', 'aguardando']) })
  .strict();

export const esquemaPedidoRemarcarLote = z
  .object({
    itens: z
      .array(
        z
          .object({
            marcacao: id,
            destino: z.object({ agenda: id, data: esquemaDataIso, hora: esquemaHoraAgenda }).strict(),
          })
          .strict(),
      )
      .min(1)
      .max(100),
    modo: z.enum(MODOS_REMARCACAO),
    canal: esquemaCanal,
    motivo: esquemaMotivoCancelamento.default('PROF-AUSENTE'),
  })
  .strict();
export type PedidoRemarcarLote = z.infer<typeof esquemaPedidoRemarcarLote>;

export const esquemaPedidoLigacao = z
  .object({
    profissional: id.nullable(),
    especialidade: z.number().int().min(0).max(99).nullable(),
    local: id.nullable().default(null),
    unidade: z.number().int().min(1).max(32_767).nullable().default(null),
  })
  .strict();
export type PedidoLigacao = z.infer<typeof esquemaPedidoLigacao>;
