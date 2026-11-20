// A apuração do mês inteira, pura (M54-F5): das fontes lidas (agregadas no banco por centro de custo, pelo código do
// movimento) e das estatísticas vigentes ao resultado: absorção (regra 7), custo por conta e margem, completude
// (regra 8), pendências e os totais que provam a conservação. A forma canônica do resultado (`formaCanonica`) é o que
// a impressão (SHA-256) assina: reapurar com os mesmos dados dá a mesma impressão.
import type {
  CustoConta,
  GrupoCustoDireto,
  LinhaApuracaoCentro,
  MatrizEstatisticas,
  PendenciaApuracaoCustos,
  SituacaoCompletude,
  TotaisApuracao,
} from '@sgh/contratos';
import { apurarAbsorcao, type CentroParaApuracao, type CustoDiretoLido } from './absorcao.js';
import { custearContas, type ItemContaLido } from './custo-conta.js';
import { avaliarCompletude } from './parcial.js';
import { centesimos } from './estatistica.js';

/** Um grupo agregado no banco pelo código do centro de custo do movimento (TBCENCUS.COD). */
export interface GrupoCustoPorCodigo {
  readonly cdc: number | null;
  readonly centavos: number;
  readonly linhas: number;
}

export interface FontesCusteio {
  /** Saídas de estoque dentro do limite, por centro de destino. */
  readonly materiais: readonly GrupoCustoPorCodigo[];
  /** Saídas acima do limite (fora do custo direto). */
  readonly atipicas: readonly GrupoCustoPorCodigo[];
  /**
   * Devoluções ao estoque da competência, por centro do cabeçalho da devolução, descontadas dos materiais do centro
   * (D-DEVOLUCAO-545); as das saídas atípicas vêm à parte e ficam fora, como a saída.
   */
  readonly devolucoes?: readonly GrupoCustoPorCodigo[];
  readonly devolucoesAtipicas?: readonly GrupoCustoPorCodigo[];
  /** Despesas do financeiro (sem as notas de entrada de estoque e sem a folha), pelo CDC gravado (0: sem centro). */
  readonly despesas: readonly GrupoCustoPorCodigo[];
  /** Proventos da folha da competência pela lotação (já pelo TBCENCUS.ID; null: sem lotação). */
  readonly pessoal: readonly {
    readonly centro: number | null;
    readonly centavos: number;
    readonly linhas: number;
  }[];
  /** O que cada conta fechada da competência faturou por centro de custo do item (pelo código). */
  readonly itensConta: readonly (Omit<ItemContaLido, 'centro'> & { readonly cdc: number | null })[];
  readonly contasFechadas: number;
}

export interface EntradaApuracao {
  readonly centros: readonly CentroParaApuracao[];
  readonly fontes: FontesCusteio;
  /** A matriz vigente da competência (etapa 4), para as bases do rateio e a produção. */
  readonly matriz: Pick<MatrizEstatisticas, 'linhas'>;
}

export interface ResultadoApuracao {
  readonly linhas: LinhaApuracaoCentro[];
  readonly contas: CustoConta[];
  readonly pendencias: PendenciaApuracaoCustos[];
  readonly totais: TotaisApuracao;
  readonly completude: SituacaoCompletude;
}

const soma = (xs: readonly { centavos: number }[]) => xs.reduce((s, x) => s + x.centavos, 0);
const brl = (c: number) =>
  (c / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', minimumFractionDigits: 2 });

/** Estatísticas da matriz por centro, em centésimos. */
export function estatisticasDaMatriz(
  matriz: Pick<MatrizEstatisticas, 'linhas'>,
): Map<number, Partial<Record<string, number>>> {
  const m = new Map<number, Partial<Record<string, number>>>();
  for (const l of matriz.linhas) {
    const v: Partial<Record<string, number>> = {};
    for (const [k, x] of Object.entries(l.valores)) if (x) v[k] = centesimos(x.quantidade);
    m.set(l.centro, v);
  }
  return m;
}

export function apurarCompetencia(e: EntradaApuracao): ResultadoApuracao {
  const idDoCodigo = new Map(e.centros.map((c) => [c.codigo, c.id]));
  // CDC 0 (ou nulo) no movimento: sem centro de custo.
  const id = (cdc: number | null): number | null =>
    cdc === null || cdc === 0 ? null : (idDoCodigo.get(cdc) ?? -cdc);
  const diretos: CustoDiretoLido[] = [];
  const add = (grupo: GrupoCustoDireto, centro: number | null, centavos: number) =>
    diretos.push({ centro, grupo, centavos });
  for (const g of e.fontes.materiais) add('materiais', id(g.cdc), g.centavos);
  for (const g of e.fontes.devolucoes ?? []) add('materiais', id(g.cdc), -g.centavos);
  for (const g of e.fontes.despesas) add('despesas', id(g.cdc), g.centavos);
  for (const g of e.fontes.pessoal) add('pessoal', g.centro, g.centavos);

  const est = estatisticasDaMatriz(e.matriz);
  const abs = apurarAbsorcao(e.centros, diretos, est);
  const itens: ItemContaLido[] = e.fontes.itensConta.map(({ cdc, ...i }) => {
    const c = id(cdc);
    return { ...i, centro: c !== null && c > 0 ? c : null };
  });
  const cc = custearContas(abs.linhas, itens);
  const linhas = abs.linhas.map((l) => ({ ...l, receita: cc.receitaPorCentro.get(l.centro) ?? 0 }));

  const pendencias = [...abs.pendencias, ...cc.pendencias];
  const atipicas = {
    linhas: e.fontes.atipicas.reduce((s, g) => s + g.linhas, 0),
    centavos: soma(e.fontes.atipicas),
  };
  const devolucoes = {
    linhas: (e.fontes.devolucoes ?? []).reduce((s, g) => s + g.linhas, 0),
    centavos: soma(e.fontes.devolucoes ?? []),
    linhasAtipicas: (e.fontes.devolucoesAtipicas ?? []).reduce((s, g) => s + g.linhas, 0),
    centavosAtipicas: soma(e.fontes.devolucoesAtipicas ?? []),
  };
  if (atipicas.linhas > 0)
    pendencias.push({
      tipo: 'linhas-atipicas',
      bloqueia: false,
      centros: [],
      centavos: atipicas.centavos,
      mensagem: `${atipicas.linhas} linha(s) de saída de estoque acima do limite por linha somam ${brl(atipicas.centavos)} e ficaram fora do custo direto: confira a quantidade e o preço médio dessas saídas.`,
    });
  const completude = avaliarCompletude({
    saidas: e.fontes.materiais.reduce((s, g) => s + g.linhas, 0) + atipicas.linhas,
    despesas: e.fontes.despesas.reduce((s, g) => s + g.linhas, 0),
    contas: e.fontes.contasFechadas,
    folha: e.fontes.pessoal.reduce((s, g) => s + g.linhas, 0),
  });
  if (completude.parcial)
    pendencias.push({
      tipo: 'parcial',
      bloqueia: false,
      centros: [],
      centavos: 0,
      mensagem: `Apuração ${completude.rotulo}: ${completude.fontes
        .filter((f) => !f.presente)
        .map((f) => f.detalhe)
        .join('; ')}.`,
    });

  const receitaBruta = cc.contas.reduce((s, c) => s + c.receitaBruta, 0);
  const receitaLiquida = cc.contas.reduce((s, c) => s + c.receitaLiquida, 0);
  return {
    linhas,
    contas: cc.contas,
    pendencias,
    completude,
    totais: {
      ...abs.totais,
      atipicas,
      devolucoes,
      custoNasContas: cc.custoNasContas,
      custoSemConta: cc.custoSemConta,
      receitaBruta,
      receitaLiquida,
      contas: cc.contas.length,
    },
  };
}

/** A conferência da conservação: o custo direto lido é o que ficou nos produtivos, parado ou não distribuído. */
export function conservacaoConfere(t: TotaisApuracao): boolean {
  return (
    t.diretoTotal === t.custoFinalProdutivos + t.naoRateado + t.despesasNaoDistribuidas &&
    t.custoFinalProdutivos === t.custoNasContas + t.custoSemConta
  );
}

/** A forma canônica (JSON com as chaves em ordem) do que a impressão assina: linhas, contas e totais. */
export function formaCanonica(r: Pick<ResultadoApuracao, 'linhas' | 'contas' | 'totais'>): string {
  const ordenar = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(ordenar);
    if (v && typeof v === 'object')
      return Object.fromEntries(
        Object.keys(v as Record<string, unknown>)
          .sort()
          .map((k) => [k, ordenar((v as Record<string, unknown>)[k])]),
      );
    return v;
  };
  return JSON.stringify(ordenar({ linhas: r.linhas, contas: r.contas, totais: r.totais }));
}
