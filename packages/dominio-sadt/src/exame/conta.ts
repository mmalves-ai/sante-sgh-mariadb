// Cobrança do exame pedido na conta do paciente (F3.5, 05-SADT linha 4). Regras puras: o pedido nunca espera a
// cobrança (o exame é pedido mesmo sem conta, sem item cobrável ou sem preço; a falta vira pendência visível para o
// faturamento, lançada depois sem redigitar o pedido), e o cancelamento estorna o item da conta quando o motivo manda.
// O exame que veio de um orçamento aprovado já entrou na conta pelo valor aprovado: não se cobra de novo.
import { RecusaPedido } from './pedido.js';

export const PENDENCIAS_COBRANCA_EXAME = [
  'do-orcamento',
  'sem-item-cobravel',
  'sem-conta',
  'sem-preco',
] as const;
export type PendenciaCobrancaExame = (typeof PENDENCIAS_COBRANCA_EXAME)[number];

export interface PrecoDoExame {
  readonly unitario: number;
  readonly honorario: number;
  readonly custoOperacional: number;
  readonly filme: number;
}

export interface EntradaCobrancaExame {
  readonly quantidade: number;
  /** Percentual de cobrança do exame no pedido (100 = integral). */
  readonly percentual: number;
  /** O item cobrável ligado ao exame no catálogo. */
  readonly itemCobravel: number | null;
  /** Há conta do atendimento aberta para lançamento na data. */
  readonly contaAberta: boolean;
  /** O preço vigente do item nas tabelas da conta (nulo: sem preço na data). */
  readonly preco: PrecoDoExame | null;
  /** A requisição nasceu da conversão de um orçamento (cobrado pelo valor aprovado). */
  readonly doOrcamento: boolean;
}

export type CobrancaDoExame =
  | {
      readonly lanca: true;
      readonly quantidade: number;
      readonly percentual: number;
      readonly unitario: number;
      readonly honorario: number;
      readonly custoOperacional: number;
      readonly filme: number;
      readonly total: number;
    }
  | { readonly lanca: false; readonly pendencia: PendenciaCobrancaExame; readonly mensagem: string };

const r2 = (x: number) => Math.round(x * 100) / 100;

const MENSAGENS: Readonly<Record<PendenciaCobrancaExame, string>> = {
  'do-orcamento': 'Exame de orçamento aprovado: já está na conta pelo valor aprovado.',
  'sem-item-cobravel': 'O exame não tem item cobrável no catálogo: ligue o item ao exame para cobrar.',
  'sem-conta': 'O atendimento não tem conta aberta para lançamento na data do pedido.',
  'sem-preco': 'O exame não tem preço vigente nas tabelas da conta.',
};

/** Decide o lançamento do exame pedido na conta: o que entra (quantidade, valores) ou a pendência que fica. */
export function cobrancaDoExame(e: EntradaCobrancaExame): CobrancaDoExame {
  const falta = (pendencia: PendenciaCobrancaExame): CobrancaDoExame => ({
    lanca: false,
    pendencia,
    mensagem: MENSAGENS[pendencia],
  });
  if (e.doOrcamento) return falta('do-orcamento');
  if (e.itemCobravel === null) return falta('sem-item-cobravel');
  if (!e.contaAberta) return falta('sem-conta');
  if (!e.preco) return falta('sem-preco');
  const quantidade = Math.max(1, Math.trunc(e.quantidade));
  const percentual = Math.min(100, Math.max(0, e.percentual));
  const parte = (v: number) => r2((v * quantidade * percentual) / 100);
  return {
    lanca: true,
    quantidade,
    percentual,
    unitario: e.preco.unitario,
    honorario: parte(e.preco.honorario),
    custoOperacional: parte(e.preco.custoOperacional),
    filme: parte(e.preco.filme),
    total: parte(e.preco.unitario),
  };
}

const CONTA_LANCAVEL = ['aberta', 'em_conferencia', 'em_auditoria'];
const ITEM_ESTORNAVEL = ['lancado', 'conferido', 'sem_cobranca'];

export interface EntradaEstornoExame {
  /** O motivo do cancelamento tira o exame da conta. */
  readonly removeDaConta: boolean;
  /** O lançamento do exame na conta (nulo: o exame nunca foi lançado). */
  readonly lancamento: { readonly situacaoItem: string; readonly situacaoConta: string } | null;
}

export type EstornoDoExame = 'estornar' | 'manter' | 'nada';

/**
 * O destino da cobrança do exame cancelado: estorna, mantém (o motivo não tira da conta, como o paciente que faltou
 * depois do preparo) ou nada a fazer. Conta que não aceita mais lançamento recusa o cancelamento com estorno: a
 * cobrança de um exame não feito não fica na conta fechada sem alguém decidir.
 */
export function estornoDoExameNaConta(e: EntradaEstornoExame): EstornoDoExame {
  if (!e.lancamento) return 'nada';
  if (e.lancamento.situacaoItem === 'estornado' || e.lancamento.situacaoItem === 'transferido') return 'nada';
  if (!e.removeDaConta) return 'manter';
  if (!CONTA_LANCAVEL.includes(e.lancamento.situacaoConta))
    throw new RecusaPedido(
      'conta-fechada',
      'O exame já está numa conta fechada: reabra a conta para cancelar com estorno ou use um motivo que mantém a cobrança.',
    );
  if (!ITEM_ESTORNAVEL.includes(e.lancamento.situacaoItem))
    throw new RecusaPedido(
      'item-nao-estornavel',
      'O exame já foi glosado na conta: o acerto da cobrança é pelo faturamento.',
    );
  return 'estornar';
}
