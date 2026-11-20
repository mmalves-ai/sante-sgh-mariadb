// Ponto de pedido e sugestão de compra (ficha do M28, regra 15; novo): consumo médio mensal, desvio, estoque de
// segurança pelo nível de serviço, ponto de pedido pelo prazo de entrega, curva ABC pelo valor consumido e XYZ pela
// variação do consumo. Os parâmetros (meses da média, nível de serviço, cortes das curvas) vêm do parâmetro do novo.
import { qtd3, reais } from './recusa.js';

export interface ParametrosPontoPedido {
  /** Meses de histórico para a média (ex.: 6). */
  readonly meses: number;
  /** Fator z do nível de serviço (ex.: 1,65 para 95%). */
  readonly fatorServico: number;
  /** Cortes da curva ABC em % acumulado do valor (ex.: 80 e 95). */
  readonly corteA: number;
  readonly corteB: number;
  /** Cortes da XYZ pelo coeficiente de variação (ex.: 0,5 e 1). */
  readonly corteX: number;
  readonly corteY: number;
}

export const PARAMETROS_PADRAO: ParametrosPontoPedido = {
  meses: 6,
  fatorServico: 1.65,
  corteA: 80,
  corteB: 95,
  corteX: 0.5,
  corteY: 1,
};

export interface ConsumoItem {
  readonly item: number;
  /** Consumo de cada mês (do mais antigo ao mais recente), quantidades. */
  readonly consumos: readonly number[];
  /** Valor consumido no período. */
  readonly valor: number;
  readonly saldo: number;
  /** Prazo de entrega em dias. */
  readonly prazoDias: number;
  /** Já pedido e não recebido. */
  readonly emPedido: number;
  /** Estoque de segurança definido pelo usuário (substitui o calculado no ponto e na sugestão). */
  readonly estoqueSegurancaDefinido?: number | null;
}

/** A chave do ponto de pedido definido (item e local), a mesma nas duas portas. */
export function chavePonto(item: number, local: number): string {
  return `${item}:${local}`;
}

export interface PontoDefinido {
  readonly prazoDias: number;
  readonly estoqueSeguranca: number | null;
}

/**
 * O ponto definido de um item: no local pedido, ou, sem local, agregado pelos locais (o maior prazo e a soma dos
 * estoques de segurança definidos). Sem definição, null.
 */
export function pontoDefinidoDoItem(
  definidos: ReadonlyMap<string, PontoDefinido>,
  item: number,
  local?: number | null,
): PontoDefinido | null {
  if (local) return definidos.get(chavePonto(item, local)) ?? null;
  const prefixo = `${item}:`;
  let achou = false;
  let prazo = 0;
  let seguranca: number | null = null;
  for (const [k, v] of definidos) {
    if (!k.startsWith(prefixo)) continue;
    achou = true;
    prazo = Math.max(prazo, v.prazoDias);
    if (v.estoqueSeguranca !== null) seguranca = qtd3((seguranca ?? 0) + v.estoqueSeguranca);
  }
  return achou ? { prazoDias: prazo, estoqueSeguranca: seguranca } : null;
}

export interface PontoDoItem {
  readonly item: number;
  readonly mediaMensal: number;
  readonly desvio: number;
  readonly coeficienteVariacao: number;
  readonly estoqueSeguranca: number;
  readonly pontoPedido: number;
  readonly sugestao: number;
  readonly curvaAbc: 'A' | 'B' | 'C';
  readonly curvaXyz: 'X' | 'Y' | 'Z';
}

export function media(v: readonly number[]): number {
  return v.length ? v.reduce((s, x) => s + x, 0) / v.length : 0;
}

export function desvioPadrao(v: readonly number[]): number {
  if (v.length < 2) return 0;
  const m = media(v);
  return Math.sqrt(v.reduce((s, x) => s + (x - m) ** 2, 0) / (v.length - 1));
}

/** Curva ABC: ordena pelo valor e corta pelo acumulado. */
export function curvaAbc(
  itens: readonly { item: number; valor: number }[],
  p: ParametrosPontoPedido,
): Map<number, 'A' | 'B' | 'C'> {
  const total = itens.reduce((s, i) => s + Math.max(0, i.valor), 0);
  const r = new Map<number, 'A' | 'B' | 'C'>();
  let acumulado = 0;
  for (const i of [...itens].sort((a, b) => b.valor - a.valor || a.item - b.item)) {
    const antes = total > 0 ? (acumulado / total) * 100 : 100;
    acumulado += Math.max(0, i.valor);
    r.set(i.item, antes < p.corteA ? 'A' : antes < p.corteB ? 'B' : 'C');
  }
  return r;
}

export function curvaXyz(cv: number, p: ParametrosPontoPedido): 'X' | 'Y' | 'Z' {
  return cv <= p.corteX ? 'X' : cv <= p.corteY ? 'Y' : 'Z';
}

/** O ponto de pedido e a sugestão de cada item (sugestão: o que leva o saldo projetado ao ponto mais um mês). */
export function calcularPontos(
  itens: readonly ConsumoItem[],
  p: ParametrosPontoPedido = PARAMETROS_PADRAO,
): PontoDoItem[] {
  const abc = curvaAbc(itens, p);
  return itens.map((i) => {
    const serie = i.consumos.slice(-p.meses);
    const m = media(serie);
    const d = desvioPadrao(serie);
    const cv = m > 0 ? d / m : serie.some((x) => x > 0) ? 99 : 0;
    const diaria = m / 30;
    const prazoMeses = i.prazoDias / 30;
    const seguranca =
      i.estoqueSegurancaDefinido !== undefined && i.estoqueSegurancaDefinido !== null
        ? qtd3(i.estoqueSegurancaDefinido)
        : qtd3(p.fatorServico * d * Math.sqrt(Math.max(prazoMeses, 0)));
    const ponto = qtd3(diaria * i.prazoDias + seguranca);
    const projetado = i.saldo + i.emPedido;
    const sugestao = projetado <= ponto ? Math.ceil(ponto + m - projetado) : 0;
    return {
      item: i.item,
      mediaMensal: qtd3(m),
      desvio: qtd3(d),
      coeficienteVariacao: Math.round(cv * 100) / 100,
      estoqueSeguranca: seguranca,
      pontoPedido: ponto,
      sugestao: Math.max(0, sugestao),
      curvaAbc: abc.get(i.item) ?? 'C',
      curvaXyz: curvaXyz(cv, p),
    };
  });
}

/** Itens a pedir (sugestão > 0), da curva A para a C, para o pedido de compra. */
export function itensASugerir(pontos: readonly PontoDoItem[]): PontoDoItem[] {
  return pontos
    .filter((x) => x.sugestao > 0)
    .sort((a, b) => a.curvaAbc.localeCompare(b.curvaAbc) || b.sugestao - a.sugestao);
}

/** Valor estimado da sugestão pelo custo médio (com as parcelas). */
export function valorDaSugestao(s: readonly { quantidade: number; custo: number }[]): {
  total: number;
  parcelas: number[];
} {
  const parcelas = s.map((x) => reais(x.quantidade * x.custo));
  return { total: reais(parcelas.reduce((a, b) => a + b, 0)), parcelas };
}
