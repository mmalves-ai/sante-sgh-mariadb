// C2-015 (05-SUP linha 22): devolução de compra ao fornecedor. Regras puras: a devolução parte de uma nota de entrada
// confirmada, devolve no máximo o que entrou menos o que já voltou (por item da nota), sai do estoque pelo valor da
// compra (desfaz a entrada e recalcula o custo médio) e gera o crédito do fornecedor, que abate as parcelas em aberto do
// título a pagar da nota (a de vencimento mais próximo primeiro; o que sobra fica como crédito a compensar). A nota fiscal
// de devolução (modelo 55) é conferida pela chave de acesso: 44 dígitos, modelo 55 e dígito verificador em módulo 11.
import { type RecusaSuprimentos, reais } from './recusa.js';

/** Quantos itens cabem numa devolução. */
export const MAXIMO_ITENS_DEVOLUCAO = 200;
const DATA = /^\d{4}-\d{2}-\d{2}$/;

const r = (codigo: string, mensagem: string, ...campos: string[]): RecusaSuprimentos => ({
  codigo,
  mensagem,
  ...(campos.length ? { campos } : {}),
});
const q4 = (n: number): number => Math.round(n * 10_000) / 10_000;

/** O item da nota de entrada com o quanto entrou e o quanto já voltou, e o que se quer devolver agora. */
export interface ItemDevolucaoParaConferir {
  /** Id do item da nota de entrada. */
  readonly notaItem: number;
  readonly quantidade: number;
  /** Quantidade que entrou no estoque por esse item. */
  readonly recebida: number;
  /** Quantidade já devolvida por outras devoluções não canceladas. */
  readonly jaDevolvida: number;
}

export interface DevolucaoParaConferir {
  /** Situação da nota de entrada de origem. */
  readonly situacaoNota: string;
  /** Data de entrada da nota de origem (AAAA-MM-DD). */
  readonly entradaEm: string;
  readonly hoje: string;
  readonly motivoAtivo: boolean;
  readonly itens: readonly ItemDevolucaoParaConferir[];
  /** Nota fiscal de devolução (opcional no rascunho do fornecedor; quando vem, a chave é conferida). */
  readonly numeroNotaFiscal: string | null;
  readonly chaveAcesso: string | null;
  readonly dataEmissao: string | null;
}

/** Confere a chave de acesso da NF-e: 44 dígitos, modelo 55 (posições 21-22) e dígito verificador em módulo 11. */
export function chaveNfeValida(chave: string): boolean {
  if (!/^\d{44}$/.test(chave)) return false;
  if (chave.slice(20, 22) !== '55') return false;
  let peso = 2;
  let soma = 0;
  for (let i = 42; i >= 0; i--) {
    soma += Number(chave[i]) * peso;
    peso = peso === 9 ? 2 : peso + 1;
  }
  const resto = soma % 11;
  const dv = resto < 2 ? 0 : 11 - resto;
  return dv === Number(chave[43]);
}

/** O quanto ainda pode voltar do item da nota. */
export const disponivelParaDevolver = (i: Pick<ItemDevolucaoParaConferir, 'recebida' | 'jaDevolvida'>) =>
  Math.max(0, q4(i.recebida - i.jaDevolvida));

/** As recusas da devolução, na ordem em que a tela as mostra (vazia: pode gravar). */
export function conferirDevolucaoFornecedor(d: DevolucaoParaConferir): RecusaSuprimentos[] {
  const out: RecusaSuprimentos[] = [];
  if (d.situacaoNota !== 'confirmada')
    out.push(r('nota-nao-confirmada', 'Só a nota de entrada confirmada pode ser devolvida.', 'nota'));
  if (!d.motivoAtivo) out.push(r('motivo-invalido', 'Escolha um motivo de devolução ativo.', 'motivo'));
  if (d.itens.length === 0) out.push(r('sem-itens', 'Informe ao menos um item a devolver.', 'itens'));
  if (d.itens.length > MAXIMO_ITENS_DEVOLUCAO)
    out.push(r('itens-demais', `A devolução aceita até ${MAXIMO_ITENS_DEVOLUCAO} itens.`, 'itens'));
  const vistos = new Set<number>();
  for (const i of d.itens) {
    if (vistos.has(i.notaItem))
      out.push(r('item-repetido', 'O mesmo item da nota aparece duas vezes na devolução.', 'itens'));
    vistos.add(i.notaItem);
    if (!(i.quantidade > 0))
      out.push(r('quantidade-invalida', 'A quantidade devolvida tem de ser maior que zero.', 'itens'));
    else if (q4(i.quantidade) > disponivelParaDevolver(i))
      out.push(
        r(
          'quantidade-acima-do-recebido',
          `A quantidade devolvida passa do que entrou pela nota menos o que já voltou (disponível: ${disponivelParaDevolver(i)}).`,
          'itens',
        ),
      );
  }
  const chave = d.chaveAcesso?.replace(/\s/g, '') ?? '';
  if (chave && !chaveNfeValida(chave))
    out.push(
      r(
        'chave-acesso-invalida',
        'A chave de acesso da NF-e de devolução não confere (44 dígitos, modelo 55).',
        'chaveAcesso',
      ),
    );
  if (chave && !d.numeroNotaFiscal?.trim())
    out.push(
      r('numero-nota-obrigatorio', 'Com a chave de acesso, informe o número da nota.', 'numeroNotaFiscal'),
    );
  if (d.dataEmissao !== null) {
    if (!DATA.test(d.dataEmissao))
      out.push(r('data-invalida', 'A data de emissão é inválida.', 'dataEmissao'));
    else if (d.dataEmissao > d.hoje)
      out.push(r('emissao-futura', 'A nota de devolução não pode ter emissão no futuro.', 'dataEmissao'));
    else if (d.dataEmissao < d.entradaEm.slice(0, 10))
      out.push(
        r(
          'emissao-antes-da-entrada',
          'A nota de devolução não pode ser anterior à entrada da compra.',
          'dataEmissao',
        ),
      );
  }
  return out;
}

export interface ItemValorDevolucao {
  readonly quantidade: number;
  /** Custo por unidade de estoque pago na compra. */
  readonly valorUnitario: number;
}

/** Valor de cada item (quantidade × custo da compra, em centavos) e o total da devolução. */
export function valoresDevolucao(itens: readonly ItemValorDevolucao[]): {
  readonly itens: readonly number[];
  readonly total: number;
} {
  const v = itens.map((i) => reais(q4(i.quantidade) * i.valorUnitario));
  return { itens: v, total: reais(v.reduce((s, x) => s + x, 0)) };
}

/** Total quando todo item da nota volta por inteiro; parcial nos demais casos. */
export function tipoDaDevolucao(
  itensDaNota: readonly Pick<ItemDevolucaoParaConferir, 'notaItem' | 'recebida' | 'jaDevolvida'>[],
  devolvidos: readonly Pick<ItemDevolucaoParaConferir, 'notaItem' | 'quantidade'>[],
): 'total' | 'parcial' {
  const agora = new Map(devolvidos.map((d) => [d.notaItem, d.quantidade]));
  return itensDaNota.every((i) => q4(i.jaDevolvida + (agora.get(i.notaItem) ?? 0)) >= q4(i.recebida))
    ? 'total'
    : 'parcial';
}

export interface ParcelaParaAbater {
  readonly parcela: number;
  readonly saldo: number;
  /** Vencimento (AAAA-MM-DD). */
  readonly vencimento: string;
}

/**
 * Distribui o crédito da devolução nas parcelas em aberto: a de vencimento mais próximo primeiro (é a que o hospital
 * pagaria antes), cada uma até o saldo dela. O que sobra fica como crédito pendente do fornecedor.
 */
export function distribuirAbatimento(
  valor: number,
  parcelas: readonly ParcelaParaAbater[],
): { readonly abatimentos: readonly { parcela: number; valor: number }[]; readonly pendente: number } {
  let resta = reais(valor);
  const abatimentos: { parcela: number; valor: number }[] = [];
  const ordem = [...parcelas]
    .filter((p) => p.saldo > 0)
    .sort((a, b) => a.vencimento.localeCompare(b.vencimento) || a.parcela - b.parcela);
  for (const p of ordem) {
    if (resta <= 0) break;
    const v = reais(Math.min(resta, p.saldo));
    abatimentos.push({ parcela: p.parcela, valor: v });
    resta = reais(resta - v);
  }
  return { abatimentos, pendente: Math.max(0, resta) };
}
