// W0-03 (programa CRUD completo; matriz, linha "Hemoterapia"): as correções da requisição transfusional, do ato
// transfusional e da bolsa recebida, sempre com a informação original legível (RDC 34/2014 art. 15 §1º), por versão ou
// adendo, sem exclusão física:
//   - a requisição se altera (hemocomponente, volume, urgência) só antes do atendimento (requisitada ou com a amostra
//     coletada); depois, 409; a versão anterior fica legível;
//   - o ato recebe adendo para os sinais digitados errado num momento já medido; o ato e a medida original não mudam;
//   - a bolsa se corrige (número da etiqueta, tipagem, validade e volume) só antes do uso (sem ato com o número) e fora
//     da reserva e da baixa; depois do uso, 409; a versão anterior fica legível.
// O motivo vai à versão ou ao adendo, nunca à trilha (a trilha não leva dado clínico).
import { z } from 'zod';
import {
  CODIGOS_URGENCIA_TRANSFUSAO,
  esquemaNumeroBolsa,
  esquemaSinaisTransfusao,
  FATORES_RH,
  GRUPOS_ABO,
  type FatorRh,
  type GrupoAbo,
  type MomentoSinaisTransfusao,
  type SinaisTransfusao,
  type UrgenciaTransfusao,
} from './transfusao.js';

const motivo = z
  .string()
  .trim()
  .min(10, 'Descreva o motivo (pelo menos 10 caracteres).')
  .max(300, 'O motivo tem no máximo 300 caracteres.');
const instante = z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?/, 'Data e hora no formato ISO.');

/** Estados da requisição em que ela ainda se altera (antes do atendimento). */
export const ESTADOS_REQUISICAO_ALTERAVEL = ['requisitada', 'amostraColetada'] as const;

/** Alterar a requisição transfusional antes do atendimento: ao menos um campo muda; o motivo sempre. */
export const esquemaAlterarRequisicaoTransfusao = z
  .object({
    hemocomponente: z.string().trim().toUpperCase().min(1).max(4).optional(),
    volumeMl: z.number().int().min(1).max(5_000).nullable().optional(),
    urgencia: z.enum(CODIGOS_URGENCIA_TRANSFUSAO).optional(),
    /** Só na programada: quando. */
    programadaPara: instante.nullable().optional(),
    motivo,
  })
  .strict()
  .refine(
    (x) =>
      x.hemocomponente !== undefined ||
      x.volumeMl !== undefined ||
      x.urgencia !== undefined ||
      x.programadaPara !== undefined,
    { message: 'Altere ao menos um campo (hemocomponente, volume ou urgência).', path: ['hemocomponente'] },
  );
export type AlterarRequisicaoTransfusaoEntrada = z.infer<typeof esquemaAlterarRequisicaoTransfusao>;

/** O adendo do ato transfusional: os sinais certos de um momento já medido, com o motivo. */
export const esquemaAdendoAtoTransfusional = z
  .object({
    momento: z.enum(['antes', 'durante', 'depois']),
    sinais: esquemaSinaisTransfusao,
    motivo,
  })
  .strict();
export type AdendoAtoTransfusionalEntrada = z.infer<typeof esquemaAdendoAtoTransfusional>;

/** Corrigir a bolsa recebida antes do uso: etiqueta (número e tipagem), validade e volume; ao menos um muda. */
export const esquemaCorrigirBolsa = z
  .object({
    numero: esquemaNumeroBolsa.optional(),
    tipagem: z
      .object({ abo: z.enum(GRUPOS_ABO), rh: z.enum(FATORES_RH) })
      .strict()
      .optional(),
    validade: instante.optional(),
    volumeMl: z.number().int().min(1).max(1_000).optional(),
    /** Versão lida pela tela (controle otimista). */
    versao: z.number().int().min(0),
    motivo,
  })
  .strict()
  .refine(
    (x) =>
      x.numero !== undefined ||
      x.tipagem !== undefined ||
      x.validade !== undefined ||
      x.volumeMl !== undefined,
    { message: 'Corrija ao menos um campo (etiqueta, validade ou volume).', path: ['numero'] },
  );
export type CorrigirBolsaEntrada = z.infer<typeof esquemaCorrigirBolsa>;

// ── Respostas ───────────────────────────────────────────────────────────────────────────────────────

/** Uma versão anterior da requisição (VERSAO 1 é a original), com quem a substituiu, quando e por quê. */
export interface VersaoRequisicaoLida {
  readonly versao: number;
  readonly hemocomponente: string;
  readonly volumeMl: number | null;
  readonly urgencia: UrgenciaTransfusao;
  readonly programadaPara: string | null;
  readonly prazo: string | null;
  readonly motivo: string;
  readonly alteradaPor: string;
  readonly alteradaEm: string;
}

export interface AdendoAtoLido {
  readonly id: number;
  readonly ato: number;
  readonly momento: MomentoSinaisTransfusao;
  readonly sinais: SinaisTransfusao;
  readonly motivo: string;
  readonly usuario: string;
  readonly em: string;
}

export interface VersaoBolsaLida {
  readonly versao: number;
  readonly numero: string;
  readonly tipagem: { readonly abo: GrupoAbo | null; readonly rh: FatorRh | null };
  readonly validade: string;
  readonly volumeMl: number;
  readonly motivo: string;
  readonly corrigidaPor: string;
  readonly corrigidaEm: string;
}

export const MENSAGENS_CORRECAO_HEMO: Readonly<Record<string, string>> = Object.freeze({
  'requisicao-ja-atendida':
    'A requisição já está em atendimento (ou atendida ou cancelada): não se altera mais. Cancele e peça outra, se for o caso.',
  'requisicao-sem-mudanca': 'Nada mudou em relação à versão atual da requisição.',
  'programada-sem-data': 'A transfusão programada exige o dia e a hora.',
  'termo-obrigatorio':
    'A requisição não tem o termo de consentimento: só se mantém como extrema urgência. Cancele e peça outra com o termo.',
  'momento-sem-medida': 'Este momento ainda não tem sinais medidos: registre a medida, não um adendo.',
  'bolsa-usada': 'A bolsa já foi usada numa transfusão: não se corrige mais.',
  'bolsa-reservada': 'A bolsa está reservada: cancele a reserva antes de corrigir a etiqueta.',
  'bolsa-baixada': 'A bolsa já foi descartada ou devolvida: não se corrige mais.',
  'bolsa-sem-mudanca': 'Nada mudou em relação à versão atual da bolsa.',
  'bolsa-numero-existente': 'Já há outra bolsa com este número no estoque ou numa transfusão.',
  'bolsa-alterada': 'Outra pessoa alterou a bolsa: recarregue a tela.',
  'bolsa-com-prova-cruzada':
    'A bolsa tem prova cruzada válida feita com este número e esta tipagem: invalide as provas antes de corrigir a etiqueta ou a tipagem.',
  'requisicao-com-reserva':
    'A requisição tem bolsas reservadas ou provas cruzadas válidas: libere as reservas e invalide as provas antes de trocar o hemocomponente.',
});
