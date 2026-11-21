// Saída de estoque (ficha do M28, regras 3, 4 e 5): o novo confere antes de gravar o que os gatilhos recusariam e
// avisa em português; o valor é do gatilho (custo médio do item e da empresa: `TOTAL / ESTOQUE`; a saída que leva todo o
// saldo leva todo o valor). O novo só mostra a previsão; nunca envia valor.
import { qtd3, recusa, reais, type RecusaSuprimentos } from './recusa.js';

/** Unitário máximo aceito pelo gatilho na consolidação (`e_vlrmed_lansai`). */
export const UNITARIO_MAXIMO = 100_000;

export interface ItemParaSaida {
  readonly item: number;
  readonly quantidade: number;
  /** Saldo do item no local (o que a tela leu). */
  readonly saldoLocal: number;
  /** O saldo e o valor do insumo na empresa. */
  readonly estoque: number;
  readonly total: number;
  /** O custo médio do insumo: item de custo zero (abaixo de 0,01) sai sem valor. */
  readonly custoMedio?: number;
  /** Item de fornecedor consignado: o gatilho não confere saldo nem valor. */
  readonly consignado?: boolean;
}

/** Regra 3: sem centro de custo ou sem local, recusa. */
export function conferirCabecalhoSaida(c: {
  centroCusto: number | null;
  local: number | null;
}): RecusaSuprimentos[] {
  const r: RecusaSuprimentos[] = [];
  if (!c.centroCusto || c.centroCusto <= 0)
    r.push(recusa('sem-centro-custo', 'Informe o centro de custo da saída.', ['centroCusto']));
  if (!c.local || c.local <= 0)
    r.push(recusa('sem-local', 'Informe o local de estoque da saída.', ['local']));
  return r;
}

/** Previsão do valor que o gatilho dará ao item (só para mostrar). */
export function valorPrevisto(i: Pick<ItemParaSaida, 'quantidade' | 'estoque' | 'total'>): number {
  if (i.quantidade === i.estoque) return reais(i.total);
  return i.estoque > 0 ? reais((i.total / i.estoque) * i.quantidade) : 0;
}

/** Regra 4: saldo, valor em estoque, valor negativo e unitário acima do limite (antes de gravar). */
export function conferirItemSaida(i: ItemParaSaida): RecusaSuprimentos[] {
  const r: RecusaSuprimentos[] = [];
  const campo = [`itens.${i.item}`];
  if (!(i.quantidade > 0))
    return [recusa('quantidade-invalida', 'A quantidade tem de ser maior que zero.', campo)];
  if (i.consignado) return r;
  if (qtd3(i.quantidade) > qtd3(i.saldoLocal) || qtd3(i.quantidade) > qtd3(i.estoque))
    r.push(
      recusa(
        'saldo-insuficiente',
        `Saldo insuficiente: há ${fmt(Math.min(i.saldoLocal, i.estoque))} e a saída pede ${fmt(i.quantidade)}.`,
        campo,
      ),
    );
  if (i.total < 0) r.push(recusa('valor-negativo', 'O valor do item em estoque está negativo.', campo));
  else if (i.total === 0 && (i.custoMedio ?? 1) >= 0.01)
    r.push(
      recusa(
        'sem-valor-estoque',
        'O item está sem valor em estoque: a saída não pode ser valorizada.',
        campo,
      ),
    );
  else if (i.total > 0 && valorPrevisto(i) / i.quantidade > UNITARIO_MAXIMO)
    r.push(recusa('unitario-acima-limite', 'O valor unitário passa do limite aceito (100.000).', campo));
  return r;
}

/**
 * Regra 3: trocar o paciente de uma saída gravada é recusado quando muda o prontuário (o gatilho recusa com
 * `e_gecadsai5`); trocar o atendimento do mesmo prontuário é aceito.
 */
export function conferirTrocaPaciente(
  antes: { prontuario: number },
  depois: { prontuario: number },
): RecusaSuprimentos | null {
  return antes.prontuario !== depois.prontuario
    ? recusa('troca-de-prontuario', 'A saída já gravada não pode passar para outro paciente.', ['paciente'])
    : null;
}

/** Centros de custo técnicos (9901 a 9999): não geram consumo (o gatilho decide; a tela avisa). */
export function centroTecnico(cdc: number): boolean {
  return cdc >= 9901 && cdc <= 9999;
}

const fmt = (n: number) => n.toLocaleString('pt-BR', { maximumFractionDigits: 3 });
