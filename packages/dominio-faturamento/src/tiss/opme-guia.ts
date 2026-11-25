// OPME na guia (06-FAT linha 25): a liberação interna do pedido acima do limite do procedimento e a OPME autorizada e
// cobrada na guia. Regras puras; a leitura e a gravação ficam na porta própria (apps/api/src/modulos/tiss).
//
// - Limite de OPME (`limite_opme_procedimento`): a OPME sem valor quando há limite de valor é recusada sempre (não há
//   o que liberar); passar do limite de valor ou de quantidade NÃO é recusa definitiva: o pedido nasce retido, com a
//   justificativa de quem pede, e só segue à operadora depois da liberação na alçada.
// - Liberação por quatro olhos: quem pede nunca libera o próprio pedido (mesmo com a autoaprovação ligada na alçada);
//   a recusa diz o porquê; só quem pediu cancela. A faixa de valor e o nível de cada aprovador vêm da alçada
//   (`etapaDaAlcada`, a mesma dos ajustes da conta).
// - OPME autorizada: cada item de OPME respondido pela operadora vira uma linha da guia de autorização com o valor
//   autorizado (o negado fica registrado como negado, com valor zero).
// - OPME cobrada: a OPME da conta vai à guia de cobrança ligada à OPME autorizada do mesmo item faturável; o valor
//   autorizado limita o cobrado: o que passa fica marcado para revisão, com o valor autorizado e o cobrado, e o lote
//   avisa (o arquivo segue com o que a conta tem; a correção é da conta, nunca silenciosa).
import { dinheiro } from './lote.js';
import type { ItemPedidoAutorizacao, LimiteOpme, Problema } from './autorizacao-previa.js';

export interface AvaliacaoLimiteOpme {
  /** Problemas que nenhuma liberação resolve (OPME sem valor com limite de valor). */
  readonly bloqueios: Problema[];
  /** Passagem do limite: liberável na alçada, com justificativa. */
  readonly excesso: Problema[];
  /** Soma da OPME do pedido (valor que vai à alçada). */
  readonly total: number;
  readonly quantidade: number;
  readonly limiteValor: number | null;
  readonly limiteQuantidade: number | null;
}

const centavos = (v: number) => Math.round(v * 100);

/** Confere a OPME do pedido contra os limites vigentes do procedimento e separa o que bloqueia do que se libera. */
export function avaliarLimiteOpme(
  itens: readonly ItemPedidoAutorizacao[],
  limites: readonly LimiteOpme[],
): AvaliacaoLimiteOpme {
  const opme = itens.filter((i) => i.opme);
  const total = opme.reduce((s, i) => s + centavos(i.valorUnitario ?? 0) * i.quantidade, 0) / 100;
  const quantidade = opme.reduce((s, i) => s + i.quantidade, 0);
  const valores = limites.map((l) => l.valorLimite).filter((v): v is number => v !== null);
  const quantidades = limites.map((l) => l.quantidadeLimite).filter((v): v is number => v !== null);
  const limiteValor = valores.length ? Math.min(...valores) : null;
  const limiteQuantidade = quantidades.length ? Math.min(...quantidades) : null;
  const bloqueios: Problema[] = [];
  const excesso: Problema[] = [];
  if (!opme.length || !limites.length)
    return { bloqueios, excesso, total, quantidade, limiteValor: null, limiteQuantidade: null };
  if (limiteValor !== null)
    for (const i of opme)
      if (i.valorUnitario === null)
        bloqueios.push({
          campo: 'itens',
          mensagem: `Informe o valor da OPME ${i.codigoProcedimento}: o procedimento tem limite de valor nesta fonte pagadora.`,
        });
  if (limiteValor !== null && centavos(total) > centavos(limiteValor))
    excesso.push({
      campo: 'itens',
      mensagem: `A OPME soma ${dinheiro(total)}, acima do limite de ${dinheiro(limiteValor)} do procedimento nesta fonte pagadora.`,
    });
  if (limiteQuantidade !== null && quantidade > limiteQuantidade)
    excesso.push({
      campo: 'itens',
      mensagem: `A OPME soma ${quantidade} unidades, acima do limite de ${limiteQuantidade} do procedimento.`,
    });
  return { bloqueios, excesso, total, quantidade, limiteValor, limiteQuantidade };
}

/**
 * O pedido acima do limite só nasce retido com a justificativa de quem pede (texto de pelo menos 10 letras); sem ela, a
 * passagem do limite é recusada com o caminho da liberação.
 */
export function conferirPedidoDeLiberacao(
  a: AvaliacaoLimiteOpme,
  justificativa: string | null,
): { retido: boolean; problemas: Problema[] } {
  if (a.bloqueios.length) return { retido: false, problemas: [...a.bloqueios, ...a.excesso] };
  if (!a.excesso.length) return { retido: false, problemas: [] };
  if ((justificativa ?? '').trim().length >= 10) return { retido: true, problemas: [] };
  return {
    retido: false,
    problemas: [
      ...a.excesso,
      {
        campo: 'justificativaLimite',
        mensagem:
          'Para pedir acima do limite, escreva a justificativa (pelo menos 10 letras): o pedido fica retido até a liberação na alçada.',
      },
    ],
  };
}

export type DecisaoLiberacaoOpme = 'aprovar' | 'recusar' | 'cancelar';
export type SituacaoLiberacaoOpme =
  'pendente' | 'em_aprovacao' | 'aprovado' | 'reprovado' | 'devolvido' | 'cancelado' | 'expirado';

/** Quatro olhos: quem pediu não libera nem recusa; só quem pediu cancela; recusa com motivo; só o pedido aberto. */
export function conferirDecisaoLiberacaoOpme(d: {
  readonly situacao: SituacaoLiberacaoOpme;
  readonly solicitante: number;
  readonly decisor: number | null;
  readonly decisao: DecisaoLiberacaoOpme;
  readonly justificativa: string | null;
}): string | null {
  if (d.situacao !== 'pendente' && d.situacao !== 'em_aprovacao') return 'A liberação já foi decidida.';
  if (d.decisor === null) return 'Decisão sem usuário identificado.';
  if (d.decisao === 'cancelar')
    return d.decisor === d.solicitante ? null : 'Só quem pediu cancela o pedido de liberação.';
  if (d.decisor === d.solicitante)
    return 'Quem pediu acima do limite não libera o próprio pedido: a liberação é de outra pessoa da alçada.';
  if (d.decisao === 'recusar' && (d.justificativa ?? '').trim().length < 5)
    return 'Diga por que a liberação foi recusada.';
  return null;
}

/** Situação da linha de OPME da guia de autorização pela situação do item na resposta da operadora. */
export function situacaoOpmeAutorizada(
  situacaoItem: string,
): 'autorizado' | 'autorizado_parcial' | 'negado' | 'enviado' | 'cancelado' {
  if (situacaoItem === 'autorizado' || situacaoItem === 'autorizado_parcial' || situacaoItem === 'negado')
    return situacaoItem;
  if (situacaoItem === 'cancelado') return 'cancelado';
  return 'enviado';
}

export interface OpmeAutorizadaDaGuia {
  readonly id: number;
  readonly itemFaturavel: number;
  readonly valorAutorizado: number;
  readonly quantidadeAutorizada: number;
}

export interface OpmeCobradaDaConta {
  readonly contaItem: number;
  readonly itemFaturavel: number;
  readonly codigo: string;
  readonly descricao: string;
  readonly quantidade: number;
  readonly valorTotal: number;
  readonly registroAnvisa: string | null;
}

export interface LinhaOpmeCobranca extends OpmeCobradaDaConta {
  readonly sequencia: number;
  readonly valorUnitario: number;
  readonly opmeAutorizada: number | null;
  /** Texto de revisão quando o cobrado passa do autorizado ou não há autorização; nulo quando confere. */
  readonly revisao: string | null;
}

/**
 * A OPME cobrada na conta, item a item, ligada à OPME autorizada do mesmo item faturável. O autorizado de um item
 * faturável é consumido na ordem da conta; o que passa do autorizado (ou não tem autorização) leva a revisão.
 */
export function opmeDaGuiaCobranca(
  cobradas: readonly OpmeCobradaDaConta[],
  autorizadas: readonly OpmeAutorizadaDaGuia[],
): LinhaOpmeCobranca[] {
  const saldo = new Map<number, { id: number; centavos: number }>();
  for (const a of autorizadas) {
    const s = saldo.get(a.itemFaturavel);
    if (s) s.centavos += centavos(a.valorAutorizado);
    else saldo.set(a.itemFaturavel, { id: a.id, centavos: centavos(a.valorAutorizado) });
  }
  return cobradas.map((c, k) => {
    const s = saldo.get(c.itemFaturavel) ?? null;
    const cobrado = centavos(c.valorTotal);
    let revisao: string | null = null;
    if (!s) revisao = `OPME cobrada sem autorização da operadora para o item ${c.codigo}.`;
    else if (cobrado > s.centavos) {
      revisao = `Cobrado ${dinheiro(cobrado / 100)} acima do autorizado ${dinheiro(Math.max(s.centavos, 0) / 100)} pela operadora.`;
      s.centavos = 0;
    } else s.centavos -= cobrado;
    return {
      ...c,
      sequencia: k + 1,
      valorUnitario: c.quantidade > 0 ? Math.round((c.valorTotal / c.quantidade) * 100) / 100 : 0,
      opmeAutorizada: s?.id ?? null,
      revisao,
    };
  });
}
