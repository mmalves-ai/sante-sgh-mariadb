// Fato contábil do repasse médico (C2-093; ADR 0003): o lançamento do repasse publica, na mesma transação, o fato
// `repasse` (custo do honorário a pagar ao profissional) e o estorno do lançamento estorna o fato. O estorno do repasse
// pode ser parcial; o fato estorna sempre o efeito inteiro, então o estorno parcial estorna o fato vivo e publica o saldo
// ainda não estornado do original como fato novo, na data do estorno (o original fica, o estorno aponta para ele). O
// lançamento negativo que não é estorno (desconto no repasse) publica o fato `descontoRepasse` pelo valor absoluto.
import { estornarFatosDaOrigem, publicarFatos } from '../contabil/publicacao-fato.js';
import type { TxOperacao } from '@sgh/nucleo';

const ENTIDADE = 'lancamento_repasse';

const dataIso = (v: unknown): string =>
  v instanceof Date ? v.toISOString().slice(0, 10) : String(v ?? '').slice(0, 10);
const centavosDe = (v: unknown): number => Math.round(Number(v ?? 0) * 100);
const tipoDoValor = (centavos: number) =>
  centavos < 0 ? ('descontoRepasse' as const) : ('repasse' as const);

/** Publica o fato de cada lançamento gravado agora (os ids da mesma transação); o estorno, o estorno do fato e o saldo. */
export async function publicarFatosDoRepasse(
  tx: TxOperacao,
  estabelecimento: number,
  lancamentos: readonly number[],
): Promise<void> {
  if (lancamentos.length === 0) return;
  const marcas = lancamentos.map(() => '?').join(',');
  const linhas = await tx.consultar(
    `SELECT l.id, l.valor, l.data_lancamento, l.tipo_lancamento, l.tipo_favorecido, l.evento_repasse_id,
            l.estornado_lancamento_repasse_id AS original
       FROM lancamento_repasse l
      WHERE l.estabelecimento_id = ? AND l.id IN (${marcas}) AND l.excluido_em IS NULL
      ORDER BY l.id`,
    [estabelecimento, ...lancamentos],
  );
  for (const l of linhas) {
    const id = Number(l['id']);
    const data = dataIso(l['data_lancamento']);
    if (l['original'] === null || l['original'] === undefined) {
      const centavos = centavosDe(l['valor']);
      await publicarFatos(tx, estabelecimento, [
        {
          tipo: tipoDoValor(centavos),
          entidade: ENTIDADE,
          entidadeId: id,
          data,
          valorCentavos: Math.abs(centavos),
          centroCusto: null,
          documento: `repasse lançamento ${id}`,
          campos: {
            tipoLancamento: String(l['tipo_lancamento']),
            tipoFavorecido: String(l['tipo_favorecido']),
            evento: Number(l['evento_repasse_id']),
          },
        },
      ]);
      continue;
    }
    const original = Number(l['original']);
    await estornarFatosDaOrigem(
      tx,
      estabelecimento,
      ENTIDADE,
      [original],
      data,
      `estorno do repasse no lançamento ${id}`,
    );
    const o = await tx.uma(
      `SELECT l.valor, l.tipo_lancamento, l.tipo_favorecido, l.evento_repasse_id,
              (SELECT COALESCE(SUM(-x.valor), 0) FROM lancamento_repasse x
                WHERE x.estornado_lancamento_repasse_id = l.id AND x.excluido_em IS NULL AND x.situacao <> 'cancelado')
                AS estornado
         FROM lancamento_repasse l WHERE l.id = ? AND l.estabelecimento_id = ?`,
      [original, estabelecimento],
    );
    if (!o) continue;
    // O estorno tem o sinal oposto ao do original: o saldo é o original mais a soma dos estornos (o SQL devolve a soma
    // com o sinal trocado). Saldo zero: o estorno foi total e não sobra fato vivo (valor zero não gera fato).
    const saldo = centavosDe(o['valor']) - centavosDe(o['estornado']);
    await publicarFatos(tx, estabelecimento, [
      {
        tipo: tipoDoValor(saldo),
        entidade: ENTIDADE,
        entidadeId: original,
        data,
        valorCentavos: Math.abs(saldo),
        centroCusto: null,
        documento: `repasse lançamento ${original} saldo`,
        campos: {
          tipoLancamento: String(o['tipo_lancamento']),
          tipoFavorecido: String(o['tipo_favorecido']),
          evento: Number(o['evento_repasse_id']),
        },
      },
    ]);
  }
}
