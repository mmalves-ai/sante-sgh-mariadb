// Inventário (ficha do M28, regra 14): contagem cega (quem conta não vê o saldo); a divergência acima do limite exige
// recontagem por outra pessoa; o ajuste aprovado pelo supervisor vira o balanço do estoque (os gatilhos e o programa
// acertam o saldo). Geral ou cíclico (curva ABC).
import { qtd3, recusa, type RecusaSuprimentos } from './recusa.js';

export type SituacaoInventario = 'aberto' | 'contagem' | 'recontagem' | 'aprovado' | 'cancelado';

export interface ItemContado {
  readonly item: number;
  readonly saldoSistema: number;
  /** Contagens na ordem (1ª, 2ª…); null: ainda não contado. */
  readonly contagens: readonly { quantidade: number; contador: string }[];
}

export interface AvaliacaoItem {
  readonly item: number;
  readonly contado: number | null;
  readonly diferenca: number | null;
  readonly divergenciaPct: number | null;
  readonly situacao: 'pendente' | 'ok' | 'recontar' | 'divergente-confirmado';
}

/** Percentual da divergência sobre o saldo do sistema (saldo zero com contagem: 100%). */
export function divergenciaPct(saldo: number, contado: number): number {
  if (saldo === 0) return contado === 0 ? 0 : 100;
  return Math.round((Math.abs(contado - saldo) / Math.abs(saldo)) * 10_000) / 100;
}

/**
 * A avaliação de um item: na 1ª contagem dentro do limite, ok; acima, recontar (por outra pessoa); na recontagem que
 * confirma a 1ª (mesma quantidade), divergência confirmada (vai ao ajuste); a que não confirma pede nova contagem.
 */
export function avaliarItem(i: ItemContado, limitePct: number): AvaliacaoItem {
  const c = i.contagens;
  if (c.length === 0)
    return { item: i.item, contado: null, diferenca: null, divergenciaPct: null, situacao: 'pendente' };
  const ultima = c[c.length - 1]!;
  const contado = qtd3(ultima.quantidade);
  const pct = divergenciaPct(i.saldoSistema, contado);
  const base = { item: i.item, contado, diferenca: qtd3(contado - i.saldoSistema), divergenciaPct: pct };
  if (pct <= limitePct) return { ...base, situacao: 'ok' };
  if (c.length >= 2 && qtd3(c[c.length - 2]!.quantidade) === contado)
    return { ...base, situacao: 'divergente-confirmado' };
  return { ...base, situacao: 'recontar' };
}

/** A recontagem é de outra pessoa (contagem cega e independente). */
export function conferirRecontagem(i: ItemContado, contador: string): RecusaSuprimentos | null {
  const u = i.contagens[i.contagens.length - 1];
  return u && u.contador === contador
    ? recusa('mesmo-contador', 'A recontagem tem de ser feita por outra pessoa.', ['contador'])
    : null;
}

/** O que o contador vê (cego): o item, nunca o saldo. */
export function visaoCega(i: ItemContado): { item: number; contagens: number } {
  return { item: i.item, contagens: i.contagens.length };
}

/** Linhas do ajuste (balanço): só os itens com diferença, ok ou confirmados; recusa se houver pendente ou a recontar. */
export function ajusteDoInventario(
  itens: readonly ItemContado[],
  limitePct: number,
): { linhas: { item: number; quantidade: number; diferenca: number }[]; recusa: RecusaSuprimentos | null } {
  const av = itens.map((i) => avaliarItem(i, limitePct));
  const abertos = av.filter((a) => a.situacao === 'pendente' || a.situacao === 'recontar');
  if (abertos.length)
    return {
      linhas: [],
      recusa: recusa(
        'inventario-incompleto',
        `Há ${abertos.length} item(ns) sem contagem ou a recontar: o ajuste só sai com todos resolvidos.`,
      ),
    };
  return {
    linhas: av
      .filter((a) => a.diferenca !== null && a.diferenca !== 0)
      .map((a) => ({ item: a.item, quantidade: a.contado as number, diferenca: a.diferenca as number })),
    recusa: null,
  };
}

/** Aprovar: só o supervisor (permissão) e nunca quem contou. */
export function conferirAprovacao(
  itens: readonly ItemContado[],
  aprovador: string,
  podeAprovar: boolean,
): RecusaSuprimentos | null {
  if (!podeAprovar) return recusa('sem-permissao-aprovar', 'Só o supervisor aprova o ajuste do inventário.');
  if (itens.some((i) => i.contagens.some((c) => c.contador === aprovador)))
    return recusa('aprovador-contou', 'Quem contou não aprova o ajuste do mesmo inventário.');
  return null;
}
