// Correção da ficha aberta e do procedimento extra da recepção (F3.2, 02-REC linha 30), regras puras (sem banco).
// As portas leem os fatos (versão da ficha, conta, item) e perguntam aqui; a recusa volta com o código e a mensagem.
// Melhoria: a correção nunca apaga: o estorno marca o item da conta como estornado e encerra o procedimento da ficha
// (exclusão lógica), com a justificativa na trilha; a troca de convênio com conta lançada vai ao faturamento.
import type { Recusa } from './fluxo-atendimento.js';

const r = (codigo: string, mensagem: string): Recusa => ({ codigo, mensagem });

/** A versão que a tela leu ("v3" ou "3") contra a versão gravada: outra pessoa alterou a ficha no meio. */
export function recusaVersaoDaFicha(lida: string, gravada: number): Recusa | null {
  const n = Number(String(lida).replace(/^v/i, ''));
  if (Number.isInteger(n) && n === gravada) return null;
  return r(
    'conflito-versao',
    'A ficha foi alterada por outra pessoa desde a leitura. Releia e confira antes de salvar.',
  );
}

/** Fatos da correção ou do estorno do procedimento extra. */
export interface FatosProcedimentoExtra {
  /** O procedimento extra existe na ficha (não principal, não estornado). */
  readonly existe: boolean;
  /** A conta do atendimento aceita mudança (aberta). */
  readonly contaAceita: boolean;
}

const ENCAMINHA_FATURAMENTO =
  'A conta do atendimento não está aberta: a correção do item é do faturamento. Encaminhe ao faturamento.';

/** O estorno do extra lançado por engano: só existente e com a conta aberta. */
export function recusaEstornoExtra(f: FatosProcedimentoExtra): Recusa | null {
  if (!f.existe)
    return r('procedimento-inexistente', 'O procedimento extra não existe mais neste atendimento.');
  if (!f.contaAceita) return r('conta-fechada', ENCAMINHA_FATURAMENTO);
  return null;
}

/** A correção da quantidade e/ou da data de realização do extra. Datas em AAAA-MM-DD. */
export function recusaCorrecaoExtra(
  f: FatosProcedimentoExtra & {
    readonly quantidadeAtual: number;
    readonly dataAtual: string;
    readonly dataAtendimento: string;
    readonly hoje: string;
  },
  pedido: { readonly quantidade?: number | undefined; readonly data?: string | undefined },
): Recusa | null {
  const base = recusaEstornoExtra(f);
  if (base) return base;
  if (pedido.data !== undefined && (pedido.data < f.dataAtendimento || pedido.data > f.hoje))
    return r('data-fora-do-atendimento', 'A data de realização fica entre a data do atendimento e hoje.');
  const quantidade = pedido.quantidade ?? f.quantidadeAtual;
  const data = pedido.data ?? f.dataAtual;
  if (quantidade === f.quantidadeAtual && data === f.dataAtual)
    return r('nada-a-corrigir', 'A quantidade e a data são as já gravadas.');
  return null;
}

/** O valor de uma parcela do item (total, honorário, custo, filme) na nova quantidade, em centavos exatos. */
export function valorNaQuantidade(valor: number, quantidadeAntes: number, quantidadeDepois: number): number {
  if (quantidadeAntes <= 0) return 0;
  return Math.round(((valor * quantidadeDepois) / quantidadeAntes) * 100) / 100;
}

/** Fatos da correção da ficha. */
export interface FatosAlteracaoFicha {
  /** Algum campo informado difere do gravado. */
  readonly mudaAlgo: boolean;
  readonly mudaConvenio: boolean;
  /** O atendimento tem conta (não cancelada). */
  readonly temConta: boolean;
}

/** A correção da ficha: algo tem de mudar; a troca de convênio com conta aberta é transferência do faturamento. */
export function recusaAlteracaoFicha(f: FatosAlteracaoFicha): Recusa | null {
  if (!f.mudaAlgo) return r('nada-a-alterar', 'Os valores informados são os já gravados.');
  if (f.mudaConvenio && f.temConta)
    return r(
      'troca-de-conta',
      'A troca do convênio muda a conta do atendimento: o faturamento transfere a conta (ou exclua a ficha sem atos e abra de novo).',
    );
  return null;
}
