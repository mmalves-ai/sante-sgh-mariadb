// Consignados (ficha do M46, etapa 4; seções 4, 5 e 7; regra 10): o material que o fornecedor deixa no hospital e só é
// faturado quando usado. O saldo por fornecedor e item vem dos movimentos do novo (remessa, reposição, devolução ao
// fornecedor) menos o consumo em sala do OPME consignado (o rastreio da etapa 3); o faturamento liga a nota fiscal de
// entrada do estoque (registrada pela entrada por nota, sem mudança) ao consumo. Vocabulário do produto (nada aqui fala
// do sistema anterior). Validadas na tela, na API e na gravação (o mesmo Zod).
import { z } from 'zod';
import { esquemaChaveAto } from '../enfermagem/entradas.js';
import { textoCp1252 } from '../texto-cp1252.js';
import { idBanco } from '../validacao/id-banco.js';

/** Os movimentos do consignado (SGH_SUP_CONSIGNADO.TIPO) e o efeito no saldo do fornecedor. */
export const TIPOS_MOVIMENTO_CONSIGNADO = [
  { codigo: 'remessa', rotulo: 'Remessa do fornecedor', efeito: 1 },
  { codigo: 'reposicao', rotulo: 'Reposição do consumido', efeito: 1 },
  { codigo: 'faturamento', rotulo: 'Faturamento do consumido (nota fiscal)', efeito: 0 },
  { codigo: 'devolucao', rotulo: 'Devolução ao fornecedor', efeito: -1 },
] as const;
export type TipoMovimentoConsignado = (typeof TIPOS_MOVIMENTO_CONSIGNADO)[number]['codigo'];
export const CODIGOS_MOVIMENTO_CONSIGNADO = TIPOS_MOVIMENTO_CONSIGNADO.map((t) => t.codigo) as [
  TipoMovimentoConsignado,
  ...TipoMovimentoConsignado[],
];
/** Os movimentos de `suprimentos.reporConsignado` (a remessa tem a operação própria). */
export const TIPOS_REPOSICAO_CONSIGNADO = ['reposicao', 'faturamento', 'devolucao'] as const;
export type TipoReposicaoConsignado = (typeof TIPOS_REPOSICAO_CONSIGNADO)[number];

/** Os dias, depois do consumo, em que o consumo ainda sem reposição ou sem faturamento vira alerta na tela. */
export const DIAS_ALERTA_CONSIGNADO = 7;
/** Quantos consumos uma reposição ou um faturamento liga de uma vez. */
export const MAXIMO_CONSUMOS_REPOSICAO = 50;

const id = idBanco;
const idSgh = idBanco;
const smallint = z.number().int().min(1).max(32_767);
const dataIso = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Data no formato AAAA-MM-DD.');
const livre = (max: number) => textoCp1252(max).overwrite((t) => t.replace(/\s+/g, ' ').trim());
const opcional = (max: number) =>
  livre(max)
    .nullable()
    .default(null)
    .transform((t) => (t ? t : null));
const quantidade = z
  .number()
  .positive('A quantidade tem de ser maior que zero.')
  .max(9_999)
  .refine((n) => Math.abs(n * 1000 - Math.round(n * 1000)) < 1e-6, {
    message: 'No máximo 3 casas decimais.',
  });
const numeroNota = z
  .string()
  .trim()
  .regex(/^\d{1,20}$/, 'O número da nota fiscal tem só dígitos (até 20).');

// ── suprimentos.registrarRemessaConsignado ──────────────────────────────────────────────────────────────────────

export const esquemaRegistrarRemessaConsignado = z
  .object({
    chave: esquemaChaveAto,
    fornecedor: id,
    item: id,
    quantidade,
    /** A nota fiscal de remessa em consignação do fornecedor (número, série e emissão). */
    nfNumero: numeroNota,
    nfSerie: opcional(5),
    nfEmissao: dataIso,
    /** O lote ou a série (ao menos um: o consumo em sala rastreia por eles) e a validade. */
    lote: opcional(30),
    serie: opcional(40),
    validade: dataIso.nullable().default(null),
  })
  .strict()
  .refine((r) => r.lote !== null || r.serie !== null, {
    message: 'Informe o lote ou o número de série do material.',
    path: ['lote'],
  });
export type RegistrarRemessaConsignadoEntrada = z.infer<typeof esquemaRegistrarRemessaConsignado>;

// ── suprimentos.reporConsignado ─────────────────────────────────────────────────────────────────────────────────

export const esquemaReporConsignado = z
  .object({
    chave: esquemaChaveAto,
    tipo: z.enum(TIPOS_REPOSICAO_CONSIGNADO),
    fornecedor: id,
    item: id,
    /** Reposição e faturamento: os consumos em sala ligados (cada um reposto e faturado uma vez). */
    consumos: z.array(idSgh).max(MAXIMO_CONSUMOS_REPOSICAO).default([]),
    /** Devolução ao fornecedor: a quantidade devolvida. */
    quantidade: quantidade.nullable().default(null),
    /** Reposição: a nota de remessa da reposição do fornecedor (opcional). */
    nfNumero: numeroNota.nullable().default(null),
    nfSerie: opcional(5),
    nfEmissao: dataIso.nullable().default(null),
    /** Faturamento: a nota fiscal registrada na entrada por nota do estoque (ano, mês e documento). */
    nfEntrada: z
      .object({ ano: smallint, mes: z.number().int().min(1).max(12), doc: id })
      .strict()
      .nullable()
      .default(null),
    lote: opcional(30),
    serie: opcional(40),
    motivo: opcional(400),
  })
  .strict()
  .refine((r) => r.tipo === 'devolucao' || r.consumos.length > 0, {
    message: 'Escolha os consumos em sala que esta reposição ou este faturamento cobre.',
    path: ['consumos'],
  })
  .refine((r) => r.tipo !== 'devolucao' || (r.quantidade !== null && r.consumos.length === 0), {
    message: 'A devolução ao fornecedor leva a quantidade (sem consumos).',
    path: ['quantidade'],
  })
  .refine((r) => r.tipo !== 'devolucao' || (r.motivo?.length ?? 0) >= 10, {
    message: 'Escreva o motivo da devolução ao fornecedor (ao menos 10 caracteres).',
    path: ['motivo'],
  })
  .refine((r) => r.tipo !== 'faturamento' || r.nfEntrada !== null, {
    message: 'Informe a nota fiscal registrada na entrada do estoque.',
    path: ['nfEntrada'],
  })
  .refine((r) => r.tipo !== 'reposicao' || r.nfNumero === null || r.nfEmissao !== null, {
    message: 'Informe a emissão da nota de remessa da reposição.',
    path: ['nfEmissao'],
  });
export type ReporConsignadoEntrada = z.infer<typeof esquemaReporConsignado>;

// ── Respostas ───────────────────────────────────────────────────────────────────────────────────────────────────

/** Um movimento gravado do consignado. */
export interface MovimentoConsignado {
  readonly id: number;
  readonly grupo: number;
  readonly tipo: TipoMovimentoConsignado;
  readonly fornecedor: number;
  readonly fornecedorNome: string | null;
  readonly item: number;
  readonly itemNome: string | null;
  readonly quantidade: number;
  readonly consumo: number | null;
  readonly nfNumero: string | null;
  readonly nfSerie: string | null;
  readonly nfEmissao: string | null;
  readonly nfEntrada: { readonly ano: number; readonly mes: number; readonly doc: number } | null;
  readonly lote: string | null;
  readonly serie: string | null;
  readonly validade: string | null;
  readonly motivo: string | null;
  readonly usuario: string;
  /** AAAA-MM-DDTHH:mm */
  readonly em: string;
}

/** Um consumo em sala de material consignado (o rastreio da etapa 3), com a reposição e o faturamento ligados. */
/** A nota da entrada do estoque do fornecedor com o item (a escolha do faturamento; revisão do M46.4). */
export interface NotaEntradaConsignado {
  readonly ano: number;
  readonly mes: number;
  readonly doc: number;
  readonly numero: string | null;
  readonly serie: string | null;
  readonly emissao: string | null;
}

export interface ConsumoConsignado {
  readonly consumo: number;
  readonly agendamento: number;
  readonly atendimento: number;
  readonly fornecedor: number | null;
  readonly item: number;
  readonly itemNome: string | null;
  /** A quantidade consumida menos a devolvida ao estoque. */
  readonly quantidade: number;
  readonly lote: string | null;
  readonly serie: string | null;
  /** AAAA-MM-DDTHH:mm */
  readonly em: string;
  readonly reposicao: { readonly movimento: number; readonly em: string } | null;
  readonly faturamento: {
    readonly movimento: number;
    readonly em: string;
    readonly nf: { readonly ano: number; readonly mes: number; readonly doc: number } | null;
  } | null;
}

/** O saldo do consignado por fornecedor e item (regra 10), com as parcelas impressas. */
export interface SaldoConsignado {
  readonly fornecedor: number;
  readonly fornecedorNome: string | null;
  readonly item: number;
  readonly itemNome: string | null;
  readonly remessas: number;
  readonly reposicoes: number;
  readonly consumidos: number;
  readonly devolvidos: number;
  /** remessas + reposições − consumidos − devolvidos. */
  readonly saldo: number;
  readonly aRepor: number;
  readonly aFaturar: number;
  /** O saldo de consignado do cadastro de estoque para o fornecedor e o item (só consulta), quando há. */
  readonly saldoCadastro: number | null;
}

/** O indicador "consumo consignado sem faturamento" com o numerador e o denominador impressos. */
export interface IndicadorConsignado {
  readonly consumos: number;
  readonly semReposicao: number;
  readonly semFaturamento: number;
  readonly atrasados: number;
  readonly diasAlerta: number;
}
