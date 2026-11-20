// Regra 14 do M54 (manual m23, orçamento empresarial): o orçamento anual por centro de custo e item gerencial, com
// versões e aprovação, comparado com o realizado (MFLANGSI pela competência, saídas de estoque por centro de destino)
// com o desvio absoluto e percentual e as parcelas de cada total. Regras puras: sem banco, sem HTTP. Tudo em centavos
// inteiros (nenhuma soma em ponto flutuante).
//   - validarLinhas: a natureza manda na chave (consumo: centro de custo e sem item; despesa e receita: item gerencial
//     cadastrado com a natureza do grupo); centro 0 = o hospital inteiro; chave repetida na mesma gravação é recusada.
//   - planejarGravacao: o que muda na versão (incluir, alterar, tirar a linha zerada, deixar a igual), com o teto.
//   - motivoSemAprovar: só a versão em elaboração, com linhas, e por outra pessoa (nem quem criou, nem quem gravou por
//     último: segregação de funções, D-SEGREGA-547).
//   - distribuirPorPercentual: o realizado de um documento repartido pelo rateio do novo, maiores restos, as parcelas
//     somam o valor do documento exatamente.
//   - comparar: orçado × realizado acumulado até o mês, por linha, centro ou item; o realizado sem linha entra como
//     "não orçado"; os totais por natureza com as parcelas.
//   - gerarDoRealizado: a versão nova a partir do realizado do ano anterior com um ajuste percentual, mês a mês.
import {
  CENTRO_SEM_CENTRO_ORCAMENTO,
  type ChaveLinhaOrcamento,
  type LinhaComparativo,
  type LinhaOrcamento,
  type LinhaOrcamentoEntrada,
  MESES_ORCAMENTO,
  type NaturezaOrcamento,
  NATUREZAS_ORCAMENTO,
  type RealizadoOrcamentoLido,
  type SituacaoVersaoOrcamento,
  TETO_LINHAS_ORCAMENTO,
  type TotalComparativo,
} from '@sgh/contratos';

export function chaveDaLinha(k: ChaveLinhaOrcamento): string {
  return `${k.natureza}|${k.centro}|${k.grupo}|${k.subgrupo}|${k.item}`;
}

export function chaveDoItem(grupo: number, subgrupo: number, item: number): string {
  return `${grupo}.${subgrupo}.${item}`;
}

/** Soma dos 12 meses (ou dos `ate` primeiros), em centavos. */
export function somaMeses(meses: readonly number[], ate: number = MESES_ORCAMENTO): number {
  let s = 0;
  for (let i = 0; i < Math.min(ate, meses.length); i++) s += meses[i] ?? 0;
  return s;
}

export function mesesZerados(): number[] {
  return Array.from({ length: MESES_ORCAMENTO }, () => 0);
}

export interface ContextoValidacao {
  /** IDs dos centros de custo do cadastro (TBCENCUS.ID). */
  readonly centros: ReadonlySet<number>;
  /** Itens gerenciais do cadastro, pela chave `grupo.subgrupo.item`, com a natureza do grupo. */
  readonly itens: ReadonlyMap<string, 'despesa' | 'receita'>;
}

export interface ProblemaLinha {
  readonly indice: number;
  readonly mensagem: string;
}

/** Confere cada linha de uma gravação (a forma já passou pelo esquema). */
export function validarLinhas(
  linhas: readonly ChaveLinhaOrcamento[],
  ctx: ContextoValidacao,
): ProblemaLinha[] {
  const problemas: ProblemaLinha[] = [];
  const vistas = new Set<string>();
  linhas.forEach((l, indice) => {
    const chave = chaveDaLinha(l);
    if (vistas.has(chave)) {
      problemas.push({ indice, mensagem: 'A mesma linha (centro, natureza e item) veio duas vezes.' });
      return;
    }
    vistas.add(chave);
    if (l.centro !== CENTRO_SEM_CENTRO_ORCAMENTO && !ctx.centros.has(l.centro)) {
      problemas.push({ indice, mensagem: `Centro de custo ${l.centro} não existe no cadastro.` });
      return;
    }
    if (l.natureza === 'consumo') {
      if (l.centro === CENTRO_SEM_CENTRO_ORCAMENTO)
        problemas.push({ indice, mensagem: 'O consumo de estoque é orçado por centro de custo de destino.' });
      else if (l.grupo !== 0 || l.subgrupo !== 0 || l.item !== 0)
        problemas.push({
          indice,
          mensagem: 'O consumo de estoque não tem item gerencial (grupo, subgrupo e item 0).',
        });
      return;
    }
    const natureza = ctx.itens.get(chaveDoItem(l.grupo, l.subgrupo, l.item));
    if (natureza === undefined)
      problemas.push({
        indice,
        mensagem: `Item gerencial ${chaveDoItem(l.grupo, l.subgrupo, l.item)} não existe no cadastro.`,
      });
    else if (natureza !== l.natureza)
      problemas.push({
        indice,
        mensagem: `O item ${chaveDoItem(l.grupo, l.subgrupo, l.item)} é de ${natureza}, não de ${l.natureza}.`,
      });
  });
  return problemas;
}

/** A linha que chega para gravar (os meses podem vir só para leitura). */
export type LinhaParaGravar = Omit<LinhaOrcamentoEntrada, 'meses'> & { readonly meses: readonly number[] };

export interface PlanoGravacao {
  readonly incluir: readonly LinhaParaGravar[];
  readonly alterar: readonly LinhaParaGravar[];
  /** Linhas que saem (vieram com os 12 meses zerados e existiam). */
  readonly remover: readonly ChaveLinhaOrcamento[];
  readonly iguais: number;
  /** Quantas linhas a versão terá depois. */
  readonly linhasDepois: number;
  readonly totalAntes: number;
  readonly totalDepois: number;
}

/** O que a gravação muda na versão. Lança se passar do teto de linhas. */
export function planejarGravacao(
  atuais: readonly LinhaOrcamento[],
  novas: readonly LinhaParaGravar[],
): PlanoGravacao {
  const porChave = new Map(atuais.map((l) => [chaveDaLinha(l), l]));
  const incluir: LinhaParaGravar[] = [];
  const alterar: LinhaParaGravar[] = [];
  const remover: ChaveLinhaOrcamento[] = [];
  let iguais = 0;
  let totalDepois = atuais.reduce((s, l) => s + somaMeses(l.meses), 0);
  const totalAntes = totalDepois;
  for (const n of novas) {
    const atual = porChave.get(chaveDaLinha(n));
    const zerada = n.meses.every((v) => v === 0);
    if (!atual) {
      if (zerada) iguais++;
      else {
        incluir.push(n);
        totalDepois += somaMeses(n.meses);
      }
      continue;
    }
    if (zerada) {
      remover.push(n);
      totalDepois -= somaMeses(atual.meses);
      continue;
    }
    const mesmo =
      atual.meses.every((v, i) => v === n.meses[i]) && (atual.observacao ?? null) === (n.observacao ?? null);
    if (mesmo) iguais++;
    else {
      alterar.push(n);
      totalDepois += somaMeses(n.meses) - somaMeses(atual.meses);
    }
  }
  const linhasDepois = atuais.length + incluir.length - remover.length;
  if (linhasDepois > TETO_LINHAS_ORCAMENTO)
    throw new RangeError(`A versão passaria de ${TETO_LINHAS_ORCAMENTO} linhas (${linhasDepois}).`);
  return { incluir, alterar, remover, iguais, linhasDepois, totalAntes, totalDepois };
}

export interface VersaoParaAprovar {
  readonly situacao: SituacaoVersaoOrcamento;
  readonly linhas: number;
  readonly criadoPor: string;
  readonly alteradoPor: string;
}

const mesmoLogin = (a: string, b: string): boolean => a.trim().toUpperCase() === b.trim().toUpperCase();

/** Por que esta pessoa não pode aprovar a versão (null: pode). */
export function motivoSemAprovar(v: VersaoParaAprovar, login: string): string | null {
  if (v.situacao !== 'rascunho') return 'Só a versão em elaboração pode ser aprovada.';
  if (v.linhas === 0) return 'A versão não tem nenhuma linha orçada.';
  if (mesmoLogin(v.criadoPor, login) || mesmoLogin(v.alteradoPor, login))
    return 'Quem montou ou alterou por último a versão não a aprova: peça a outra pessoa com a permissão de aprovar.';
  return null;
}

/**
 * Reparte um valor em centavos pelos percentuais (somando 100 ou menos), pelo método dos maiores restos: as parcelas
 * somam exatamente o valor × soma dos percentuais ÷ 100; a sobra (percentuais abaixo de 100) volta em `resto`.
 */
export function distribuirPorPercentual(
  centavos: number,
  percentuais: readonly number[],
): { parcelas: number[]; resto: number } {
  // Percentual com até 4 casas (NUMERIC(7,4)): trabalhar em décimos de milésimo para não errar no ponto flutuante.
  const pesos = percentuais.map((p) => Math.round(p * 10_000));
  const somaPesos = pesos.reduce((s, p) => s + p, 0);
  if (somaPesos > 1_000_000) throw new RangeError('Os percentuais do rateio passam de 100%.');
  const alvo = Math.round((centavos * somaPesos) / 1_000_000);
  const brutas = pesos.map((p) => (centavos * p) / 1_000_000);
  const parcelas = brutas.map((b) => Math.floor(b));
  let falta = alvo - parcelas.reduce((s, p) => s + p, 0);
  const ordem = brutas.map((b, i) => ({ i, r: b - Math.floor(b) })).sort((a, b) => b.r - a.r || a.i - b.i);
  for (let k = 0; falta > 0 && k < ordem.length; k++, falta--) parcelas[ordem[k]!.i]! += 1;
  return { parcelas, resto: centavos - alvo };
}

/** Favorável: despesa e consumo abaixo (ou igual) do orçado; receita acima (ou igual). */
export function favoravel(natureza: NaturezaOrcamento, orcado: number, realizado: number): boolean {
  return natureza === 'receita' ? realizado >= orcado : realizado <= orcado;
}

/** Desvio ÷ orçado × 100, com 2 casas (meio para cima); null com orçado 0. */
export function desvioPercentual(orcado: number, realizado: number): number | null {
  if (orcado === 0) return null;
  const centesimos = ((realizado - orcado) * 10_000) / orcado;
  return (Math.sign(centesimos) * Math.round(Math.abs(centesimos))) / 100;
}

/** Agrupa o realizado lido em meses por chave de linha. */
export function realizadoPorLinha(realizado: readonly RealizadoOrcamentoLido[]): Map<
  string,
  {
    chave: ChaveLinhaOrcamento;
    meses: number[];
  }
> {
  const m = new Map<string, { chave: ChaveLinhaOrcamento; meses: number[] }>();
  for (const r of realizado) {
    if (r.mes < 1 || r.mes > MESES_ORCAMENTO) continue;
    const chave: ChaveLinhaOrcamento = {
      natureza: r.natureza,
      centro: r.centro,
      grupo: r.grupo,
      subgrupo: r.subgrupo,
      item: r.item,
    };
    const k = chaveDaLinha(chave);
    let x = m.get(k);
    if (!x) {
      x = { chave, meses: mesesZerados() };
      m.set(k, x);
    }
    x.meses[r.mes - 1]! += r.centavos;
  }
  return m;
}

export type VisaoComparativo = 'linha' | 'centro' | 'item';

/** O recorte do comparativo: um centro de custo (0 = sem centro) e/ou um item gerencial ("grupo.subgrupo.item"). */
export interface RecorteComparativo {
  readonly centro?: number | null;
  readonly item?: string | null;
}

/**
 * As linhas orçadas e o realizado só do recorte, antes de comparar (os totais e as parcelas saem do recorte). O consumo
 * de estoque não tem item gerencial: com um item no recorte, fica de fora.
 */
export function recortar<L extends ChaveLinhaOrcamento, R extends ChaveLinhaOrcamento>(
  linhas: readonly L[],
  realizado: readonly R[],
  recorte: RecorteComparativo,
): { linhas: L[]; realizado: R[] } {
  const centro = recorte.centro ?? null;
  const item = recorte.item ?? null;
  const dentro = (k: ChaveLinhaOrcamento) =>
    (centro === null || k.centro === centro) &&
    (item === null || (k.natureza !== 'consumo' && chaveDoItem(k.grupo, k.subgrupo, k.item) === item));
  return { linhas: linhas.filter(dentro), realizado: realizado.filter(dentro) };
}

/** A chave da visão: por centro, o item vira 0; por item, o centro vira 0. */
export function chaveNaVisao(k: ChaveLinhaOrcamento, visao: VisaoComparativo): ChaveLinhaOrcamento {
  if (visao === 'centro') return { natureza: k.natureza, centro: k.centro, grupo: 0, subgrupo: 0, item: 0 };
  if (visao === 'item') return { ...k, centro: CENTRO_SEM_CENTRO_ORCAMENTO };
  return k;
}

export interface RotulosComparativo {
  readonly centro: (id: number) => string;
  readonly item: (k: ChaveLinhaOrcamento) => string;
}

export interface EntradaComparativo {
  readonly linhas: readonly LinhaOrcamento[];
  readonly realizado: readonly RealizadoOrcamentoLido[];
  readonly mesAte: number;
  readonly visao: VisaoComparativo;
  readonly rotulos: RotulosComparativo;
}

export interface ResultadoComparativo {
  readonly linhas: LinhaComparativo[];
  readonly totais: TotalComparativo[];
}

const ORDEM_NATUREZA: Readonly<Record<NaturezaOrcamento, number>> = { receita: 0, despesa: 1, consumo: 2 };

/** Orçado × realizado acumulado até `mesAte`, com o desvio e as parcelas de cada total por natureza. */
export function comparar(e: EntradaComparativo): ResultadoComparativo {
  if (!Number.isInteger(e.mesAte) || e.mesAte < 1 || e.mesAte > MESES_ORCAMENTO)
    throw new RangeError('Mês inválido (1 a 12).');
  type Acumulado = { chave: ChaveLinhaOrcamento; orcado: number[]; realizado: number[]; orcada: boolean };
  const acc = new Map<string, Acumulado>();
  const pegar = (k: ChaveLinhaOrcamento): Acumulado => {
    const v = chaveNaVisao(k, e.visao);
    const c = chaveDaLinha(v);
    let a = acc.get(c);
    if (!a) {
      a = { chave: v, orcado: mesesZerados(), realizado: mesesZerados(), orcada: false };
      acc.set(c, a);
    }
    return a;
  };
  for (const l of e.linhas) {
    const a = pegar(l);
    a.orcada = true;
    l.meses.forEach((v, i) => {
      a.orcado[i]! += v;
    });
  }
  for (const r of realizadoPorLinha(e.realizado).values()) {
    const a = pegar(r.chave);
    r.meses.forEach((v, i) => {
      a.realizado[i]! += v;
    });
  }
  const linhas: LinhaComparativo[] = [...acc.values()]
    .map((a) => {
      const orcado = somaMeses(a.orcado, e.mesAte);
      const realizado = somaMeses(a.realizado, e.mesAte);
      return {
        ...a.chave,
        rotuloCentro: e.visao === 'item' ? 'Todos os centros' : e.rotulos.centro(a.chave.centro),
        rotuloItem: e.visao === 'centro' ? 'Todos os itens' : e.rotulos.item(a.chave),
        orcadoCentavos: orcado,
        realizadoCentavos: realizado,
        desvioCentavos: realizado - orcado,
        desvioPercentual: desvioPercentual(orcado, realizado),
        favoravel: favoravel(a.chave.natureza, orcado, realizado),
        naoOrcado: !a.orcada,
        orcadoMeses: a.orcado.slice(0, e.mesAte),
        realizadoMeses: a.realizado.slice(0, e.mesAte),
      };
    })
    // Sem orçado e sem realizado no período (linha orçada só depois do mês): fica fora da tabela, não do total.
    .filter((l) => l.orcadoCentavos !== 0 || l.realizadoCentavos !== 0 || !l.naoOrcado)
    .sort(
      (a, b) =>
        ORDEM_NATUREZA[a.natureza] - ORDEM_NATUREZA[b.natureza] ||
        a.centro - b.centro ||
        a.grupo - b.grupo ||
        a.subgrupo - b.subgrupo ||
        a.item - b.item,
    );
  const totais: TotalComparativo[] = NATUREZAS_ORCAMENTO.filter((n) => linhas.some((l) => l.natureza === n))
    .sort((a, b) => ORDEM_NATUREZA[a] - ORDEM_NATUREZA[b])
    .map((natureza) => {
      const da = linhas.filter((l) => l.natureza === natureza);
      const orcado = da.reduce((s, l) => s + l.orcadoCentavos, 0);
      const realizado = da.reduce((s, l) => s + l.realizadoCentavos, 0);
      const rotulo = (l: LinhaComparativo) =>
        e.visao === 'centro'
          ? l.rotuloCentro
          : e.visao === 'item'
            ? l.rotuloItem
            : `${l.rotuloCentro} · ${l.rotuloItem}`;
      return {
        natureza,
        orcadoCentavos: orcado,
        realizadoCentavos: realizado,
        desvioCentavos: realizado - orcado,
        desvioPercentual: desvioPercentual(orcado, realizado),
        favoravel: favoravel(natureza, orcado, realizado),
        parcelasOrcado: da.map((l) => ({ rotulo: rotulo(l), centavos: l.orcadoCentavos })),
        parcelasRealizado: da.map((l) => ({ rotulo: rotulo(l), centavos: l.realizadoCentavos })),
      };
    });
  return { linhas, totais };
}

/** Aplica um ajuste em centésimos de ponto percentual (500 = +5,00%) a um valor em centavos, meio para cima. */
export function ajustar(centavos: number, ajusteCentesimos: number): number {
  const v = (centavos * (10_000 + ajusteCentesimos)) / 10_000;
  return Math.max(0, Math.round(v));
}

/**
 * As linhas de uma versão nova a partir do realizado do ano anterior: mês a mês, com o ajuste. O realizado sem centro
 * (despesa e receita sem rateio) vira linha do hospital inteiro; o valor negativo do mês (estorno) vira zero.
 */
export function gerarDoRealizado(
  realizado: readonly RealizadoOrcamentoLido[],
  ajusteCentesimos: number,
): LinhaOrcamentoEntrada[] {
  return [...realizadoPorLinha(realizado).values()]
    .map((r) => ({
      ...r.chave,
      meses: r.meses.map((v) => ajustar(Math.max(0, v), ajusteCentesimos)),
      observacao: null,
    }))
    .filter((l) => l.meses.some((v) => v > 0))
    .sort((a, b) => chaveDaLinha(a).localeCompare(chaveDaLinha(b)));
}

/** Totais orçados de uma versão por natureza (o total geral é a soma das três parcelas). */
export function totaisDaVersao(linhas: readonly LinhaOrcamento[]): {
  total: number;
  porNatureza: Record<NaturezaOrcamento, number>;
} {
  const porNatureza: Record<NaturezaOrcamento, number> = { despesa: 0, receita: 0, consumo: 0 };
  for (const l of linhas) porNatureza[l.natureza] += somaMeses(l.meses);
  return { total: porNatureza.despesa + porNatureza.receita + porNatureza.consumo, porNatureza };
}

/** O realizado agregado como o banco devolve (centro pelo código; null: sem centro). */
export interface RealizadoBruto {
  readonly natureza: NaturezaOrcamento;
  readonly codigoCentro: number | null;
  readonly grupo: number;
  readonly subgrupo: number;
  readonly item: number;
  readonly mes: number;
  readonly centavos: number;
}

/** Um documento a pagar com rateio no novo (por centro pelo código e percentual). */
export interface DocumentoRateadoBruto {
  readonly grupo: number;
  readonly subgrupo: number;
  readonly item: number;
  readonly mes: number;
  readonly centavos: number;
  readonly centros: readonly { readonly codigoCentro: number; readonly percentual: number }[];
}

export interface RealizadoConvertido {
  readonly realizado: RealizadoOrcamentoLido[];
  /** Grupos com o centro de custo fora do cadastro (vão ao "sem centro"). */
  readonly centroSemCadastro: number;
  /** Documentos com rateio que não fecha 100% (a sobra vai ao "sem centro"). */
  readonly rateioIncompleto: number;
  /** Realizado de despesa e receita que ficou sem centro (sem rateio no novo), em centavos. */
  readonly semCentro: { readonly despesa: number; readonly receita: number };
}

/**
 * Leva o realizado do banco à chave do orçamento: o código do centro (CDC = TBCENCUS.COD) vira o ID; o documento com
 * rateio é repartido pelos percentuais (maiores restos), a sobra fica sem centro. Nada se perde: a soma do convertido
 * é a soma do bruto.
 */
export function converterRealizado(
  agregado: readonly RealizadoBruto[],
  rateados: readonly DocumentoRateadoBruto[],
  idDoCodigo: (codigo: number) => number | null,
): RealizadoConvertido {
  const realizado: RealizadoOrcamentoLido[] = [];
  let centroSemCadastro = 0;
  let rateioIncompleto = 0;
  const centro = (codigo: number | null): number => {
    if (codigo === null || codigo === 0) return CENTRO_SEM_CENTRO_ORCAMENTO;
    const id = idDoCodigo(codigo);
    if (id === null) {
      centroSemCadastro++;
      return CENTRO_SEM_CENTRO_ORCAMENTO;
    }
    return id;
  };
  for (const a of agregado) {
    const { codigoCentro, ...resto } = a;
    realizado.push({ ...resto, centro: centro(codigoCentro) });
  }
  for (const d of rateados) {
    const base = {
      natureza: 'despesa' as const,
      grupo: d.grupo,
      subgrupo: d.subgrupo,
      item: d.item,
      mes: d.mes,
    };
    const r = distribuirPorPercentual(
      d.centavos,
      d.centros.map((c) => c.percentual),
    );
    d.centros.forEach((c, i) => {
      realizado.push({ ...base, centro: centro(c.codigoCentro), centavos: r.parcelas[i] ?? 0 });
    });
    if (r.resto !== 0) {
      rateioIncompleto++;
      realizado.push({ ...base, centro: CENTRO_SEM_CENTRO_ORCAMENTO, centavos: r.resto });
    }
  }
  const semCentro = { despesa: 0, receita: 0 };
  for (const x of realizado)
    if (x.centro === CENTRO_SEM_CENTRO_ORCAMENTO && x.natureza !== 'consumo')
      semCentro[x.natureza] += x.centavos;
  return { realizado, centroSemCadastro, rateioIncompleto, semCentro };
}
