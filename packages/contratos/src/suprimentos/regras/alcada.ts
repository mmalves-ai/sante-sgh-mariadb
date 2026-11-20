// Aprovação de pedido por alçada (ficha do M28, `suprimentos.aprovarPedido`, só no novo): as faixas de valor do
// parâmetro do novo; quem aprova tem a marca de autorizar pedido do usuário do estoque e a faixa do valor. Nunca grava
// situação de pedido que o outro sistema não usa (autorizado parcialmente ou autorizado não aparecem na distribuição).
import { recusa, type RecusaSuprimentos } from './recusa.js';

export interface FaixaAlcada {
  /** Até este valor (inclusive); a última faixa é sem teto (Infinity). */
  readonly ate: number;
  /** Nível exigido (1, 2, 3…): o aprovador precisa de nível maior ou igual. */
  readonly nivel: number;
}

/** Faixas padrão (a propor; o parâmetro do novo troca): até 5 mil nível 1, até 50 mil nível 2, acima nível 3. */
export const FAIXAS_PADRAO: readonly FaixaAlcada[] = [
  { ate: 5_000, nivel: 1 },
  { ate: 50_000, nivel: 2 },
  { ate: Number.POSITIVE_INFINITY, nivel: 3 },
];

export function faixaDoValor(valor: number, faixas: readonly FaixaAlcada[] = FAIXAS_PADRAO): FaixaAlcada {
  const ordenadas = [...faixas].sort((a, b) => a.ate - b.ate);
  return ordenadas.find((f) => valor <= f.ate) ?? ordenadas[ordenadas.length - 1]!;
}

export type DecisaoAprovacao = 'aprovado' | 'reprovado';

export function conferirAprovacaoPedido(o: {
  valor: number;
  faixas?: readonly FaixaAlcada[];
  aprovador: { podeAutorizar: boolean; nivel: number; login: string };
  solicitante: string;
  decisao: DecisaoAprovacao;
  justificativa: string;
  jaDecidido: boolean;
}): RecusaSuprimentos | null {
  if (o.jaDecidido) return recusa('pedido-ja-decidido', 'O pedido já foi aprovado ou reprovado.');
  if (!o.aprovador.podeAutorizar)
    return recusa('sem-alcada', 'Seu usuário do estoque não tem a marca de autorizar pedido.');
  const f = faixaDoValor(o.valor, o.faixas);
  if (o.aprovador.nivel < f.nivel)
    return recusa('fora-da-alcada', `O valor do pedido exige a alçada de nível ${f.nivel}.`);
  if (o.aprovador.login === o.solicitante)
    return recusa('aprovador-solicitante', 'Quem fez o pedido não o aprova.');
  if (o.decisao === 'reprovado' && o.justificativa.trim().length < 10)
    return recusa('sem-justificativa', 'Escreva a justificativa da reprovação (10 letras ou mais).', [
      'justificativa',
    ]);
  return null;
}

/** Situações do pedido vistas na distribuição do outro sistema (as demais são recusadas sem decisão registrada). */
export const SITUACOES_PEDIDO_VISTAS = [1, 2, 3, 8, 9] as const;

export function situacaoGravavel(id: number): boolean {
  return (SITUACOES_PEDIDO_VISTAS as readonly number[]).includes(id);
}
