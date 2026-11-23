// Entradas da enfermagem beira-leito (M25; ficha, seções 5 a 8), validadas na tela, na API e na sincronização do
// tablet (o mesmo Zod). O horário é o ID do horário previsto da prescrição; o paciente é o ID do cadastro; o
// atendimento é o ID do atendimento (a internação aparece pelo número dela). A hora gravada no horário é sempre a do
// relógio do banco; a hora real do ato (a do aparelho, no ato sem rede) vai para o registro próprio do novo. Textos em
// CP1252 (o banco do estabelecimento não guarda o que não existe nele).
import { z } from 'zod';
import { textoCp1252 } from '../texto-cp1252.js';
import {
  CODIGOS_MOTIVO_NAO_ADMINISTRACAO,
  EVENTOS_INFUSAO,
  METODOS_SINAL,
  MOTIVOS_SEM_PULSEIRA,
  PENDENCIAS_PLANTAO,
  RESOLUCOES_CONFLITO,
  TIPOS_SINAL_VITAL,
  TURNOS,
} from './vocabulario.js';
import { idBanco } from '../validacao/id-banco.js';

const id = idBanco;
const livre = (max: number) => textoCp1252(max).overwrite((t) => t.replace(/\s+/g, ' ').trim());
/** Data e hora local (AAAA-MM-DDTHH:mm[:ss]); o servidor confere contra o relógio do banco. */
export const esquemaDataHoraLocal = z
  .string()
  .regex(
    /^\d{4}-\d{2}-\d{2}T([01]\d|2[0-3]):[0-5]\d(?::[0-5]\d)?$/,
    'Data e hora no formato AAAA-MM-DDTHH:mm.',
  );
const dataIso = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Data no formato AAAA-MM-DD.');

/** Chave de idempotência do ato (a mesma do cabeçalho Idempotency-Key; o tablet gera uma por ato). */
export const esquemaChaveAto = z.string().regex(/^[A-Za-z0-9._:-]{8,80}$/, 'Chave do ato inválida.');

/** Leitura da pulseira: o código lido pelo leitor ou pela câmera, ou o motivo de não ler (regra 5). */
export const esquemaLeituraPulseira = z.union([
  z.object({ lida: z.literal(true), codigo: z.string().trim().min(3).max(64) }).strict(),
  z
    .object({
      lida: z.literal(false),
      motivo: z.enum(Object.keys(MOTIVOS_SEM_PULSEIRA) as [string, ...string[]]),
      observacao: livre(200).optional(),
    })
    .strict(),
]);
export type LeituraPulseira = z.infer<typeof esquemaLeituraPulseira>;

/** Leitura da dose (código do medicamento: GTIN, lote e validade; regra 4). */
export const esquemaLeituraDose = z
  .object({
    /** O código lido (GS1 DataMatrix ou código de barras do item), interpretado no servidor. */
    codigo: z.string().trim().min(3).max(120).optional(),
    gtin: z
      .string()
      .regex(/^\d{8,14}$/)
      .optional(),
    lote: livre(20).optional(),
    validade: dataIso.optional(),
  })
  .strict();
export type LeituraDose = z.infer<typeof esquemaLeituraDose>;

/** Segundo profissional da dupla checagem (regra 7): login próprio e a senha dele, conferidos na hora. */
export const esquemaConferente = z
  .object({
    login: z.string().trim().min(2).max(31),
    senha: z.string().min(1).max(100),
  })
  .strict();

/** Checar a administração de um horário (enfermagem.checarAdministracao). */
export const esquemaChecarHorario = z
  .object({
    desfecho: z.enum(['administrado', 'naoAdministrado']),
    /** Situação que a tela leu (controle otimista: mudou, não grava e abre o conflito). */
    situacaoLida: z.string().length(1),
    motivo: z
      .enum(CODIGOS_MOTIVO_NAO_ADMINISTRACAO as [string, ...string[]])
      .nullable()
      .default(null),
    /** Complemento do motivo e a condição do "se necessário" (regra 9 do M24: administrado com motivo). */
    observacao: livre(200).nullable().default(null),
    /** Quantidade administrada (padrão: a dose prescrita; a menor avisa, a maior bloqueia). */
    quantidade: z.number().nonnegative().max(1_000_000).nullable().default(null),
    pulseira: esquemaLeituraPulseira,
    dose: esquemaLeituraDose.nullable().default(null),
    conferente: esquemaConferente.nullable().default(null),
    /** Glicemia capilar medida (regra 12): mg/dL. */
    glicemia: z.number().min(10).max(900).nullable().default(null),
    /** Divergência menor conferida pelo profissional (aviso dos nove certos). */
    avisosConferidos: z.boolean().default(false),
    /** Hora real do ato (a do aparelho); o servidor confere que não é do futuro nem de antes de 24 h. */
    horaReal: esquemaDataHoraLocal.nullable().default(null),
    origemOffline: z.boolean().default(false),
    dispositivo: z.string().trim().max(64).nullable().default(null),
  })
  .strict();
export type ChecarHorario = z.infer<typeof esquemaChecarHorario>;

/** W1-08: o motivo do estorno da checagem (lista fechada; o texto vai ao histórico com a justificativa). */
export const MOTIVOS_ESTORNO_CHECAGEM = ['nao-administrado', 'checado-por-engano'] as const;
export type MotivoEstornoChecagem = (typeof MOTIVOS_ESTORNO_CHECAGEM)[number];

/**
 * Estorno da checagem (enfermagem.estornarChecagem, W1-08): o horário volta a não checado no banco e o estorno é fato
 * novo com o motivo. Se a dose já baixou estoque, o estorno só segue com a devolução registrada como pendente.
 */
export const esquemaEstornarChecagem = z
  .object({
    motivo: z.enum(MOTIVOS_ESTORNO_CHECAGEM),
    justificativa: livre(200).pipe(z.string().min(10, 'Justifique o estorno (10 caracteres ou mais).')),
    devolucaoPendente: z.boolean().default(false),
  })
  .strict();
export type EstornarChecagem = z.infer<typeof esquemaEstornarChecagem>;

/** Aprazamento: confirmação em lote da proposta, reaprazar ou suprimir (os dois exigem motivo; regra 2). */
export const esquemaAprazamento = z
  .object({
    itens: z
      .array(
        z
          .object({
            horario: id,
            acao: z.enum(['aprazar', 'reaprazar', 'suprimir']),
            proposto: esquemaDataHoraLocal,
            confirmado: esquemaDataHoraLocal.nullable(),
            motivo: livre(200).nullable().default(null),
          })
          .strict(),
      )
      .min(1)
      .max(300),
  })
  .strict();
export type Aprazamento = z.infer<typeof esquemaAprazamento>;

/** Sinal vital estruturado (regra 13). */
export const esquemaSinalVital = z
  .object({
    atendimento: id.nullable().default(null),
    tipo: z.enum(TIPOS_SINAL_VITAL as [string, ...string[]]),
    valor: z.number().min(0).max(10_000),
    metodo: z.enum(METODOS_SINAL).nullable().default(null),
    /** Fora da faixa de alerta: a tela pede a confirmação (regra 13). */
    confirmadoForaDaFaixa: z.boolean().default(false),
    horaReal: esquemaDataHoraLocal.nullable().default(null),
    origemOffline: z.boolean().default(false),
    observacao: livre(200).nullable().default(null),
  })
  .strict();
export type SinalVitalEntrada = z.infer<typeof esquemaSinalVital>;

export const esquemaSinaisVitais = z.object({ sinais: z.array(esquemaSinalVital).min(1).max(20) }).strict();

/** Retificação de um sinal vital: versão nova com a justificativa (a anterior fica guardada). */
export const esquemaRetificarSinal = z
  .object({
    valor: z.number().min(0).max(10_000),
    confirmadoForaDaFaixa: z.boolean().default(false),
    justificativa: livre(200).pipe(z.string().min(10, 'Justifique a retificação (10 caracteres ou mais).')),
  })
  .strict();

/** Evento de infusão contínua (regra 11). */
export const esquemaEventoInfusao = z
  .object({
    evento: z.enum(Object.keys(EVENTOS_INFUSAO) as [string, ...string[]]),
    velocidadeMlH: z.number().positive().max(2_000).nullable().default(null),
    volumeInfundidoMl: z.number().nonnegative().max(20_000).nullable().default(null),
    observacao: livre(200).nullable().default(null),
    horaReal: esquemaDataHoraLocal.nullable().default(null),
  })
  .strict();
export type EventoInfusaoEntrada = z.infer<typeof esquemaEventoInfusao>;

/** Nota SBAR de um paciente na passagem de plantão. */
export const esquemaNotaSbar = z
  .object({
    atendimento: id,
    paciente: id,
    situacao: livre(1000).nullable().default(null),
    historia: livre(1000).nullable().default(null),
    avaliacao: livre(1000).nullable().default(null),
    recomendacao: livre(1000).nullable().default(null),
    pendencias: z
      .array(
        z
          .object({
            tipo: z.enum(Object.keys(PENDENCIAS_PLANTAO) as [string, ...string[]]),
            descricao: livre(200),
            horario: id.nullable().default(null),
          })
          .strict(),
      )
      .max(50)
      .default([]),
  })
  .strict();

/** Passar o plantão da unidade (a responsabilidade só passa com o aceite de quem recebe; regra 14). */
export const esquemaPassarPlantao = z
  .object({
    unidade: z.string().trim().min(1).max(5),
    turno: z.enum(TURNOS),
    data: dataIso,
    /** Login de quem recebe (o aceite é dele, com o login próprio). */
    recebedor: z.string().trim().min(2).max(31),
    notas: z.array(esquemaNotaSbar).min(1).max(80),
  })
  .strict();
export type PassarPlantao = z.infer<typeof esquemaPassarPlantao>;

export const esquemaAceitarPlantao = z
  .object({ aceite: z.boolean(), observacao: livre(200).nullable().default(null) })
  .strict();

/** Resolução do conflito de sincronização (o enfermeiro decide; nunca sobrescreve). */
export const esquemaResolverConflito = z
  .object({
    resolucao: z.enum(Object.keys(RESOLUCOES_CONFLITO) as [string, ...string[]]),
    observacao: livre(200).pipe(z.string().min(5, 'Descreva a resolução.')),
  })
  .strict();

/** Um ato feito sem rede, na ordem em que foi feito (regra 8). */
export const esquemaAtoOffline = z.discriminatedUnion('tipo', [
  z
    .object({
      tipo: z.literal('checagem'),
      chave: esquemaChaveAto,
      horario: id,
      checagem: esquemaChecarHorario,
    })
    .strict(),
  z
    .object({ tipo: z.literal('sinal'), chave: esquemaChaveAto, paciente: id, sinal: esquemaSinalVital })
    .strict(),
  z
    .object({
      tipo: z.literal('anotacao'),
      chave: esquemaChaveAto,
      paciente: id,
      atendimento: id,
      texto: livre(1000).pipe(z.string().min(3)),
      horaReal: esquemaDataHoraLocal,
    })
    .strict(),
]);
export type AtoOffline = z.infer<typeof esquemaAtoOffline>;

export const esquemaSincronizar = z
  .object({ dispositivo: z.string().trim().min(1).max(64), atos: z.array(esquemaAtoOffline).min(1).max(200) })
  .strict();

/** Tablet ou coletor autorizado ao modo beira do leito (sem dado de paciente). */
/** W0-03: o motivo das correções (estorno, cancelamento, exclusão): de 10 a 300 caracteres. */
const motivoCorrecao = (max = 300) =>
  livre(max).pipe(z.string().min(10, 'Descreva o motivo (pelo menos 10 caracteres).'));

/** W0-03: cancelar a passagem de plantão (quem passou, antes do aceite). */
export const esquemaCancelarPassagemPlantao = z.object({ motivo: motivoCorrecao(200) }).strict();

/** W0-03: alterar o aparelho (nome, unidade e a situação). */
export const esquemaAlterarDispositivo = z
  .object({
    nome: livre(60).pipe(z.string().min(3)).optional(),
    unidade: z.string().trim().min(1).max(5).optional(),
    ativo: z.boolean().optional(),
    /**
     * Obrigatório em toda alteração (revisão W0-03: também retirar e reativar). Fica na versão anterior guardada, com
     * quem e quando.
     */
    motivo: motivoCorrecao(200).optional(),
  })
  .strict()
  .refine((x) => x.nome !== undefined || x.unidade !== undefined || x.ativo !== undefined, {
    message: 'Informe o que muda no aparelho.',
  })
  .refine((x) => x.motivo !== undefined, {
    message: 'Descreva o motivo da alteração do aparelho.',
    path: ['motivo'],
  });

/** W0-03: excluir o aparelho cadastrado por engano (só sem leitura vinculada). */
export const esquemaExcluirDispositivo = z.object({ motivo: motivoCorrecao(200) }).strict();

/** W0-03: estornar (lançado errado) ou invalidar (paciente errado, relançado) um escore, classificação ou índice. */
export const esquemaEstornarRegistro = z
  .object({ tipo: z.enum(['estorno', 'invalidacao']).default('estorno'), motivo: motivoCorrecao(300) })
  .strict();
export type EstornarRegistro = z.infer<typeof esquemaEstornarRegistro>;

export const esquemaDispositivoBeiraLeito = z
  .object({
    nome: livre(60).pipe(z.string().min(3)),
    unidade: z.string().trim().min(1).max(5),
    tipo: z.enum(['tablet', 'coletor', 'celular']),
  })
  .strict();
