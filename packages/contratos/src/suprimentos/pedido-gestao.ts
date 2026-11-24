// Gestão do pedido de compra depois de emitido (F3.6, 05-SUP linha 20): as entradas das gravações (entregas
// programadas, contato com o fornecedor, cancelamento justificado e o cadastro do motivo) e a leitura da tela.
// Vocabulário neutro: ids, datas ISO, booleanos e quantidades.
import { z } from 'zod';
import { idBanco } from '../validacao/id-banco.js';
import {
  SITUACOES_ACOMPANHAMENTO_PEDIDO,
  type SituacaoAcompanhamentoPedido,
} from './regras/pedido-gestao.js';

export {
  conferirAcompanhamentoPedido,
  conferirCancelamentoCompra,
  conferirEntregasProgramadas,
  entregaAtrasada,
  pendenteItem,
  repartirEntregas,
  SITUACOES_ACOMPANHAMENTO_PEDIDO,
  SITUACOES_PEDIDO_FECHADAS,
  situacaoAposCancelamento,
  type SituacaoAcompanhamentoPedido,
} from './regras/pedido-gestao.js';

const id = idBanco;
const data = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Data inválida.');
const quantidade = z.number().positive().max(99_999_999_999);
const pedido = z.object({ ano: z.number().int().min(2000).max(2100), doc: id }).strict();
const textoOuNulo = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullable()
    .transform((t) => (t === null || t === '' ? null : t));

export const esquemaProgramarEntregasPedido = z
  .object({
    pedido,
    /** O item do pedido (id da linha). */
    item: id,
    entregas: z
      .array(z.object({ dataPrevista: data, dataLimite: data.nullable(), quantidade }).strict())
      .min(1, 'Informe ao menos uma entrega.')
      .max(60),
  })
  .strict();
export type ProgramarEntregasPedidoEntrada = z.infer<typeof esquemaProgramarEntregasPedido>;

export const esquemaAcompanharPedido = z
  .object({
    pedido,
    contatoNome: textoOuNulo(150),
    contatoTelefone: textoOuNulo(20),
    contatoEmail: z.string().trim().email().max(254).nullable(),
    previsaoEntrega: data.nullable(),
    situacao: z.enum(SITUACOES_ACOMPANHAMENTO_PEDIDO),
    andamento: z.string().trim().min(3).max(4000),
    /** O contato a que este dá seguimento. */
    anterior: id.nullable(),
  })
  .strict();
export type AcompanharPedidoEntrada = z.infer<typeof esquemaAcompanharPedido>;

export const esquemaCancelarCompra = z
  .object({
    pedido,
    /** Nulo: o pedido inteiro (tudo o que falta chegar). */
    item: id.nullable(),
    /** Nulo: todo o pendente do item. */
    quantidade: quantidade.nullable(),
    motivo: id,
    justificativa: textoOuNulo(500),
  })
  .strict()
  .refine((c) => c.item !== null || c.quantidade === null, {
    message: 'A quantidade vale só para o item.',
    path: ['quantidade'],
  });
export type CancelarCompraEntrada = z.infer<typeof esquemaCancelarCompra>;

export const esquemaGravarMotivoCancelamentoCompra = z
  .object({
    motivo: id.optional(),
    versao: z.number().int().positive().optional(),
    codigo: z
      .string()
      .trim()
      .min(1)
      .max(30)
      .regex(/^[a-z0-9_]+$/, 'Use letras minúsculas, números e sublinhado.'),
    descricao: z.string().trim().min(3).max(150),
    aplicaPedido: z.boolean(),
    aplicaItem: z.boolean(),
    exigeJustificativa: z.boolean(),
    ativo: z.boolean(),
  })
  .strict()
  .refine((m) => (m.motivo === undefined) === (m.versao === undefined), {
    message: 'Alteração exige o motivo e a versão.',
    path: ['versao'],
  })
  .refine((m) => m.aplicaPedido || m.aplicaItem, {
    message: 'O motivo precisa valer para o pedido ou para o item.',
    path: ['aplicaItem'],
  });
export type GravarMotivoCancelamentoCompraEntrada = z.infer<typeof esquemaGravarMotivoCancelamentoCompra>;

export interface EntregaProgramadaLida {
  readonly id: number;
  readonly sequencia: number;
  readonly dataPrevista: string;
  readonly dataLimite: string | null;
  readonly quantidade: number;
  readonly recebida: number;
  readonly cancelada: number;
  readonly atrasada: boolean;
}

/** Um cancelamento do item (evento imutável): parcial, de todo o pendente ou do pedido inteiro. */
export interface CancelamentoItemPedidoLido {
  readonly id: number;
  readonly ocorridoEm: string;
  readonly usuario: string | null;
  readonly abrangencia: 'item' | 'pedido';
  readonly quantidade: number;
  readonly motivo: string;
  readonly justificativa: string | null;
}

export interface ItemGestaoPedido {
  readonly id: number;
  readonly sequencia: number;
  readonly insumo: number | null;
  readonly nome: string;
  readonly quantidade: number;
  readonly recebida: number;
  readonly cancelada: number;
  readonly pendente: number;
  readonly canceladoEm: string | null;
  readonly motivoCancelamento: string | null;
  readonly cancelamentos: readonly CancelamentoItemPedidoLido[];
  readonly entregas: readonly EntregaProgramadaLida[];
}

export interface AcompanhamentoPedidoLido {
  readonly id: number;
  readonly ocorridoEm: string;
  readonly usuario: string | null;
  readonly contatoNome: string | null;
  readonly contatoTelefone: string | null;
  readonly contatoEmail: string | null;
  readonly previsaoEntrega: string | null;
  readonly situacao: SituacaoAcompanhamentoPedido | null;
  readonly andamento: string;
  readonly anterior: number | null;
}

export interface MotivoCancelamentoCompraLido {
  readonly id: number;
  readonly versao: number;
  readonly codigo: string;
  readonly descricao: string;
  readonly aplicaPedido: boolean;
  readonly aplicaItem: boolean;
  readonly exigeJustificativa: boolean;
  readonly ativo: boolean;
}

export interface GestaoPedidoCompra {
  readonly pedido: {
    readonly id: number;
    readonly ano: number;
    readonly doc: number;
    readonly situacao: string;
    readonly dataPedido: string;
    readonly fornecedor: string | null;
    readonly canceladoEm: string | null;
    readonly motivoCancelamento: string | null;
    readonly justificativaCancelamento: string | null;
  };
  readonly hoje: string;
  readonly itens: readonly ItemGestaoPedido[];
  readonly acompanhamentos: readonly AcompanhamentoPedidoLido[];
  readonly motivos: readonly MotivoCancelamentoCompraLido[];
}
