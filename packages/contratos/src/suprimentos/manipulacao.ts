// Manipulação e capelas (ficha do M46, etapa 4; seções 4, 5 e 7; regra 11): a ordem de manipulação nasce do item
// prescrito que a farmácia validou (a avaliação farmacêutica do M29), com a capela e o grupo do cadastro, o insumo do
// estoque com o lote e a validade, a validade da sobra e a dupla conferência por outro farmacêutico; a baixa do insumo é
// a saída do estoque do M28 (suprimentos.registrarSaida com o bloco `manipulacao`, gravado na mesma transação).
// Vocabulário do produto. Validadas na tela, na API e na gravação (o mesmo Zod).
import { z } from 'zod';
import { esquemaChaveAto, esquemaDataHoraLocal } from '../enfermagem/entradas.js';
import { textoCp1252 } from '../texto-cp1252.js';
import { idBanco } from '../validacao/id-banco.js';

/** As situações da ordem (SGH_SUP_MANIPULACAO.SITUACAO). */
export const SITUACOES_MANIPULACAO = [
  { codigo: 'aberta', rotulo: 'Preparada, aguardando a conferência' },
  { codigo: 'conferida', rotulo: 'Conferida, aguardando a baixa do insumo' },
  { codigo: 'reprovada', rotulo: 'Reprovada na conferência' },
  { codigo: 'baixada', rotulo: 'Insumo baixado do estoque' },
] as const;
export type SituacaoManipulacao = (typeof SITUACOES_MANIPULACAO)[number]['codigo'];

/**
 * A regra versionada da validade da sobra (o que sobra do insumo depois da manipulação): no máximo estas horas depois
 * do preparo e nunca depois da validade do lote do insumo (D-SOBRA-464).
 */
export const REGRA_SOBRA_MANIPULACAO = { versao: '2026-10-26', horasMaximas: 24 } as const;

const id = idBanco;
const idSgh = idBanco;
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
  .max(99_999)
  .refine((n) => Math.abs(n * 1000 - Math.round(n * 1000)) < 1e-6, {
    message: 'No máximo 3 casas decimais.',
  });

// ── suprimentos.abrirOrdemManipulacao ───────────────────────────────────────────────────────────────────────────

export const esquemaAbrirOrdemManipulacao = z
  .object({
    chave: esquemaChaveAto,
    /** O item prescrito (o lançamento da prescrição) já validado pela farmácia. */
    itemPrescrito: id,
    capela: id,
    grupo: id.nullable().default(null),
    /** O insumo do estoque, o local de onde sai e o lote usado. */
    insumo: id,
    local: z.number().int().min(1).max(99),
    loteInsumo: livre(30).pipe(z.string().min(1, 'Informe o lote do insumo.')),
    validadeInsumo: dataIso,
    quantidade,
    dose: opcional(60),
    /** A validade da sobra (sem sobra: nulo). */
    validadeSobra: esquemaDataHoraLocal.nullable().default(null),
  })
  .strict();
export type AbrirOrdemManipulacaoEntrada = z.infer<typeof esquemaAbrirOrdemManipulacao>;

// ── suprimentos.conferirManipulacao ─────────────────────────────────────────────────────────────────────────────

export const esquemaConferirManipulacao = z
  .object({
    chave: esquemaChaveAto,
    ordem: idSgh,
    versaoVista: z.number().int().min(1),
    resultado: z.enum(['aprovada', 'reprovada']),
    observacao: opcional(400),
  })
  .strict()
  .refine((c) => c.resultado === 'aprovada' || (c.observacao?.length ?? 0) >= 10, {
    message: 'Escreva o motivo da reprovação (ao menos 10 caracteres).',
    path: ['observacao'],
  });
export type ConferirManipulacaoEntrada = z.infer<typeof esquemaConferirManipulacao>;

// ── A baixa do insumo (suprimentos.registrarSaida com o bloco `manipulacao`) ───────────────────────────────────

/** O pedido da tela: a API monta a saída do estoque a paciente internado com o insumo e o lote da ordem. */
export const esquemaBaixarManipulacao = z
  .object({
    chave: esquemaChaveAto,
    ordem: idSgh,
    versaoVista: z.number().int().min(1),
    /** O centro de custo da unidade do paciente (o destino da saída). */
    centroCusto: id,
  })
  .strict();
export type BaixarManipulacaoEntrada = z.infer<typeof esquemaBaixarManipulacao>;

/** O bloco da saída do estoque que liga a baixa à ordem (gravado na mesma transação da saída). */
export const esquemaManipulacaoNaSaida = z
  .object({
    ordem: idSgh,
    versaoVista: z.number().int().min(1),
  })
  .strict();
export type ManipulacaoNaSaida = z.infer<typeof esquemaManipulacaoNaSaida>;

// ── Respostas ───────────────────────────────────────────────────────────────────────────────────────────────────

/** Um item prescrito validado pela farmácia, à espera da manipulação (a fila). */
export interface ItemAManipular {
  readonly itemPrescrito: number;
  readonly avaliacao: number;
  readonly atendimento: number;
  /** O leito e as iniciais do paciente (o nome fica no prontuário). */
  readonly leito: string | null;
  readonly iniciais: string | null;
  readonly produto: number | null;
  readonly produtoNome: string | null;
  /** automatica (regra) ou o farmacêutico que validou. */
  readonly validadoPor: string | null;
  /** AAAA-MM-DDTHH:mm */
  readonly validadoEm: string;
  /** A ordem já aberta para o item (aberta ou conferida), quando há. */
  readonly ordem: number | null;
}

/** Uma capela do cadastro com os grupos de manipulação dela. */
export interface CapelaManipulacao {
  readonly id: number;
  readonly nome: string;
  readonly funcionando: boolean;
  readonly manipulando: boolean;
  readonly grupos: readonly { readonly id: number; readonly nome: string }[];
}

/** Uma ordem de manipulação gravada. */
export interface OrdemManipulacao {
  readonly id: number;
  readonly versao: number;
  readonly situacao: SituacaoManipulacao;
  readonly itemPrescrito: number;
  readonly avaliacao: number;
  readonly atendimento: number;
  readonly produto: number | null;
  readonly capela: number;
  readonly capelaNome: string | null;
  readonly grupo: number | null;
  readonly insumo: number;
  readonly insumoNome: string | null;
  readonly local: number;
  readonly loteInsumo: string;
  readonly validadeInsumo: string;
  readonly quantidade: number;
  readonly dose: string | null;
  readonly validadeSobra: string | null;
  readonly preparadoPor: string;
  readonly preparadoEm: string;
  readonly conferidoPor: string | null;
  readonly conferidoEm: string | null;
  readonly observacao: string | null;
  readonly saida: { readonly ano: number; readonly mes: number; readonly doc: number } | null;
  readonly lancamento: number | null;
}
