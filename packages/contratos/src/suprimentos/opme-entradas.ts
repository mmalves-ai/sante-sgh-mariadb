// Entradas do OPME (ficha do M46, etapa 3; seções 5 e 7): as operações só do novo (suprimentos.solicitarOpme e
// suprimentos.avancarEtapaOpme), o consumo em sala (a tela manda o rastreio; a API monta a saída do estoque a paciente
// internado, suprimentos.registrarSaida, com o bloco `opme` gravado na mesma transação) e a devolução do não usado
// (suprimentos.registrarDevolucao com o bloco `opme`). Validadas na tela, na API e na gravação (o mesmo Zod). Datas e
// horas locais AAAA-MM-DDTHH:mm (o servidor confere contra o relógio do banco).
import { z } from 'zod';
import { esquemaChaveAto, esquemaDataHoraLocal } from '../enfermagem/entradas.js';
import { textoCp1252 } from '../texto-cp1252.js';
import { ETAPAS_OPME_MANUAIS } from './opme-vocabulario.js';
import { idBanco } from '../validacao/id-banco.js';

const id = idBanco;
/** IDs das tabelas novas (BIGINT; na prática cabem no inteiro seguro). */
const idSgh = idBanco;
const dataIso = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Data no formato AAAA-MM-DD.');
const livre = (max: number) => textoCp1252(max).overwrite((t) => t.replace(/\s+/g, ' ').trim());
const opcional = (max: number) => livre(max).nullable().default(null);
const quantidade = z
  .number()
  .positive('A quantidade tem de ser maior que zero.')
  .max(9_999)
  .refine((n) => Math.abs(n * 1000 - Math.round(n * 1000)) < 1e-6, {
    message: 'No máximo 3 casas decimais.',
  });
const motivo = livre(500).pipe(z.string().min(10, 'Escreva o motivo (ao menos 10 caracteres).'));
const tuss = z
  .string()
  .trim()
  .regex(/^\d{8}$/, 'O código TUSS tem oito dígitos.');
const anvisa = z
  .string()
  .trim()
  .transform((t) => t.replace(/\D/g, ''))
  .pipe(z.string().regex(/^\d{7,13}$/, 'O registro na Anvisa tem de 7 a 13 dígitos.'));
const rastreioTexto = (max: number) =>
  livre(max)
    .nullable()
    .default(null)
    .transform((t) => (t ? t : null));

// ── suprimentos.solicitarOpme ───────────────────────────────────────────────────────────────────────────────────

export const esquemaSolicitarOpme = z
  .object({
    agendamento: id,
    chave: esquemaChaveAto,
    /** O item do cadastro de itens do estoque (classe 50, OPME). */
    item: id,
    tuss,
    quantidade,
    /** O fornecedor sugerido pelo cirurgião (o cadastro de fornecedores), quando há. */
    fornecedor: id.nullable().default(null),
    justificativa: livre(500).pipe(
      z.string().min(10, 'Escreva a justificativa clínica (ao menos 10 caracteres).'),
    ),
  })
  .strict();
export type SolicitarOpmeEntrada = z.infer<typeof esquemaSolicitarOpme>;

// ── suprimentos.avancarEtapaOpme ────────────────────────────────────────────────────────────────────────────────

export const esquemaAvancarEtapaOpme = z
  .object({
    solicitacao: idSgh,
    chave: esquemaChaveAto,
    /** A versão da solicitação que a tela viu; outra gravação no meio recusa (`opme-mudou`). */
    versaoVista: z.number().int().min(1),
    etapa: z.enum(ETAPAS_OPME_MANUAIS),
    em: esquemaDataHoraLocal,
    /** A quantidade autorizada (na autorização). */
    quantidade: quantidade.nullable().default(null),
    /** A autorização da operadora registrada à mão (DP-37): a senha, a guia e a validade da senha. */
    senha: opcional(20),
    guia: opcional(20),
    validade: dataIso.nullable().default(null),
    fornecedor: id.nullable().default(null),
    /** O pedido de compra (ano e número), na etapa do pedido. */
    pedido: z
      .object({ ano: z.number().int().min(2000).max(2100), doc: id })
      .strict()
      .nullable()
      .default(null),
    /** A nota fiscal (ano, mês e número da entrada), na etapa da NF. */
    nf: z
      .object({ ano: z.number().int().min(2000).max(2100), mes: z.number().int().min(1).max(12), doc: id })
      .strict()
      .nullable()
      .default(null),
    observacao: opcional(500),
  })
  .strict();
export type AvancarEtapaOpmeEntrada = z.infer<typeof esquemaAvancarEtapaOpme>;

// ── Consumo em sala (a tela) e o bloco `opme` da saída do estoque ───────────────────────────────────────────────

/** O que a circulante registra no consumo em sala (a API monta a saída do estoque e o bloco `opme`). */
export const esquemaConsumirOpme = z
  .object({
    agendamento: id,
    chave: esquemaChaveAto,
    /** A solicitação atendida (null: consumo sem solicitação, só com a justificativa do supervisor). */
    solicitacao: idSgh.nullable().default(null),
    item: id,
    quantidade,
    /** O local de estoque de onde o material sai (o do bloco ou o central). */
    local: z.number().int().min(1).max(99),
    lote: rastreioTexto(30),
    serie: rastreioTexto(40),
    fabricante: livre(80).pipe(z.string().min(2, 'Informe o fabricante.')),
    modelo: opcional(80),
    registroAnvisa: anvisa,
    validade: dataIso.nullable().default(null),
    /** O código lido da embalagem (GS1), como veio do leitor. */
    codigoLido: rastreioTexto(120),
    /** A justificativa do consumo sem a autorização da operadora (o supervisor). */
    justificativa: opcional(400),
  })
  .strict()
  .refine((c) => !!c.lote || !!c.serie, {
    message: 'Informe o lote ou o número de série da embalagem.',
    path: ['lote'],
  });
export type ConsumirOpmeEntrada = z.infer<typeof esquemaConsumirOpme>;

/**
 * O bloco `opme` da saída do estoque (suprimentos.registrarSaida, passo 7 na mesma transação): a chave natural da
 * cirurgia, a solicitação e o rastreio (a etiqueta sai depois, do rastreio gravado). Só na saída a paciente internado
 * de um item.
 */
export const esquemaOpmeNaSaida = z
  .object({
    agendamento: id,
    sala: z.number().int().min(1).max(32_767),
    dataHora: esquemaDataHoraLocal,
    paciente: id.nullable().default(null),
    cirurgiao: id.nullable().default(null),
    solicitacao: idSgh.nullable().default(null),
    /** A versão da solicitação vista (relida na transação; outra gravação no meio recusa). */
    versaoVista: z.number().int().min(1).nullable().default(null),
    lote: rastreioTexto(30),
    serie: rastreioTexto(40),
    fabricante: livre(80).pipe(z.string().min(2)),
    modelo: opcional(80),
    registroAnvisa: anvisa,
    validade: dataIso.nullable().default(null),
    codigoLido: rastreioTexto(120),
    consignado: z.boolean().default(false),
    fornecedor: id.nullable().default(null),
    /** A exceção (sem autorização): quem registrou e a justificativa. */
    semAutorizacao: z
      .object({ por: z.string().min(1).max(31), motivo: livre(400).pipe(z.string().min(10)) })
      .strict()
      .nullable()
      .default(null),
    chave: esquemaChaveAto.nullable().default(null),
  })
  .strict()
  .refine((c) => !!c.lote || !!c.serie, { message: 'Informe o lote ou a série.', path: ['lote'] });
export type OpmeNaSaida = z.infer<typeof esquemaOpmeNaSaida>;

// ── Devolução do não usado ──────────────────────────────────────────────────────────────────────────────────────

export const esquemaDevolverOpme = z
  .object({
    agendamento: id,
    chave: esquemaChaveAto,
    /** O consumo registrado (SGH_SUP_OPME_RASTREIO.ID). */
    consumo: idSgh,
    quantidade,
    motivo,
  })
  .strict();
export type DevolverOpmeEntrada = z.infer<typeof esquemaDevolverOpme>;

/** O bloco `opme` da devolução do estoque (suprimentos.registrarDevolucao): o consumo e o motivo. */
export const esquemaOpmeNaDevolucao = z
  .object({
    consumo: idSgh,
    motivo,
    chave: esquemaChaveAto.nullable().default(null),
  })
  .strict();
export type OpmeNaDevolucao = z.infer<typeof esquemaOpmeNaDevolucao>;

// ── Consultas ───────────────────────────────────────────────────────────────────────────────────────────────────

export const esquemaRastreioReversoOpme = z
  .object({
    /** O item (null: a busca só pelo lote, pela série ou pelo registro Anvisa do alerta de tecnovigilância). */
    item: id.nullable().default(null),
    lote: rastreioTexto(30),
    serie: rastreioTexto(40),
    registroAnvisa: anvisa.nullable().default(null),
  })
  .strict()
  .refine((c) => !!c.lote || !!c.serie || !!c.registroAnvisa, {
    message: 'Informe o lote, a série ou o registro Anvisa.',
    path: ['lote'],
  });
export type RastreioReversoOpmeEntrada = z.infer<typeof esquemaRastreioReversoOpme>;
