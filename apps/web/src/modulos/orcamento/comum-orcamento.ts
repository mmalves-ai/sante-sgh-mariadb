// Regras de tela do orçamento empresarial (M54, etapa 7): dinheiro em centavos (inteiros) lido e escrito em reais sem
// ponto flutuante, chave da linha, a grade editável (rascunho local das linhas, o que mudou, o total por mês e no ano) e
// o texto da conta dos totais com as parcelas. Tudo puro, testado em orcamento-telas.spec.ts.
import {
  type ChaveLinhaOrcamento,
  type LinhaOrcamento,
  type LinhaOrcamentoEntrada,
  MESES_ORCAMENTO,
  type NaturezaOrcamento,
  type ParcelaTotalOrcamento,
  TETO_CENTAVOS_MES,
} from '@sgh/contratos';

export const NOMES_MESES = [
  'jan',
  'fev',
  'mar',
  'abr',
  'mai',
  'jun',
  'jul',
  'ago',
  'set',
  'out',
  'nov',
  'dez',
] as const;

/** 123456 → "1.234,56"; negativo com o sinal de menos simples. */
export function reais(centavos: number): string {
  const neg = centavos < 0;
  const abs = Math.abs(Math.trunc(centavos));
  const inteiro = Math.floor(abs / 100)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/gu, '.');
  const cent = String(abs % 100).padStart(2, '0');
  return `${neg ? '-' : ''}${inteiro},${cent}`;
}

/**
 * Lê o valor digitado em reais ("1.234,56", "1234,5", "1234.56", "1234", vazio = 0) e devolve centavos inteiros, sem
 * passar por ponto flutuante; null quando não é um valor válido (negativo, mais de 2 casas, letras, acima do teto).
 */
export function lerReais(texto: string): number | null {
  const s = texto.trim().replace(/^R\$\s*/u, '');
  if (s === '') return 0;
  let inteiro: string;
  let fracao: string;
  if (/^\d{1,3}(\.\d{3})+(,\d{1,2})?$/u.test(s) || /^\d+(,\d{1,2})?$/u.test(s)) {
    const [i, f = ''] = s.split(',');
    inteiro = i!.replace(/\./gu, '');
    fracao = f;
  } else if (/^\d+\.\d{1,2}$/u.test(s)) {
    const [i, f = ''] = s.split('.');
    inteiro = i!;
    fracao = f;
  } else return null;
  if (inteiro.length > 14) return null;
  const v = Number(inteiro) * 100 + Number(fracao.padEnd(2, '0'));
  return Number.isSafeInteger(v) && v <= TETO_CENTAVOS_MES ? v : null;
}

/** Percentual com 2 casas e o sinal ("+12,50%", "-3,00%"); "—" quando não há (orçado zero). */
export function percentual(p: number | null): string {
  if (p === null) return '—';
  const s = Math.abs(p).toFixed(2).replace('.', ',');
  return `${p > 0 ? '+' : p < 0 ? '-' : ''}${s}%`;
}

export const chaveLinha = (k: ChaveLinhaOrcamento): string =>
  `${k.centro}|${k.natureza}|${k.grupo}.${k.subgrupo}.${k.item}`;

export const chaveItem = (grupo: number, subgrupo: number, item: number): string =>
  `${grupo}.${subgrupo}.${item}`;

/** Linha da grade em edição: os 12 meses como texto digitado e os centavos da linha como foi lida (null: linha nova). */
export interface LinhaGrade extends ChaveLinhaOrcamento {
  readonly textos: string[];
  readonly lidos: readonly number[] | null;
  observacao: string | null;
  readonly observacaoLida: string | null;
}

export function gradeDasLinhas(linhas: readonly LinhaOrcamento[]): LinhaGrade[] {
  return linhas.map((l) => ({
    centro: l.centro,
    natureza: l.natureza,
    grupo: l.grupo,
    subgrupo: l.subgrupo,
    item: l.item,
    textos: l.meses.map((m) => reais(m)),
    lidos: [...l.meses],
    observacao: l.observacao,
    observacaoLida: l.observacao,
  }));
}

export function novaLinhaGrade(k: ChaveLinhaOrcamento): LinhaGrade {
  return {
    ...k,
    textos: Array.from({ length: MESES_ORCAMENTO }, () => ''),
    lidos: null,
    observacao: null,
    observacaoLida: null,
  };
}

/** Os centavos dos 12 meses da linha (null se algum mês não é válido). */
export function mesesDaLinha(l: LinhaGrade): number[] | null {
  const v = l.textos.map(lerReais);
  return v.some((x) => x === null) ? null : (v as number[]);
}

/** Mês com valor inválido (índices). */
export const mesesInvalidos = (l: LinhaGrade): number[] =>
  l.textos.flatMap((t, i) => (lerReais(t) === null ? [i] : []));

export function linhaMudou(l: LinhaGrade): boolean {
  const m = mesesDaLinha(l);
  if (!m) return true;
  if (l.lidos === null) return m.some((x) => x > 0);
  return m.some((x, i) => x !== l.lidos![i]) || (l.observacao ?? null) !== (l.observacaoLida ?? null);
}

/** Copia o valor de um mês para os 12 (o atalho da linha). */
export function repetirMes(l: LinhaGrade, mes: number): void {
  const t = l.textos[mes] ?? '';
  for (let i = 0; i < MESES_ORCAMENTO; i++) l.textos[i] = t;
}

/** Reparte um total anual em 12 meses iguais (a sobra em centavos nos primeiros meses). */
export function repartirAno(l: LinhaGrade, totalCentavos: number): void {
  const base = Math.floor(totalCentavos / MESES_ORCAMENTO);
  const sobra = totalCentavos - base * MESES_ORCAMENTO;
  for (let i = 0; i < MESES_ORCAMENTO; i++) l.textos[i] = reais(base + (i < sobra ? 1 : 0));
}

/** O que vai ao servidor: só as linhas que mudaram e são válidas (a linha zerada sai da versão). */
export function entradaDaGrade(grade: readonly LinhaGrade[]): {
  linhas: LinhaOrcamentoEntrada[];
  invalidas: number;
} {
  const linhas: LinhaOrcamentoEntrada[] = [];
  let invalidas = 0;
  for (const l of grade) {
    if (!linhaMudou(l)) continue;
    const meses = mesesDaLinha(l);
    if (!meses) {
      invalidas++;
      continue;
    }
    linhas.push({
      centro: l.centro,
      natureza: l.natureza,
      grupo: l.grupo,
      subgrupo: l.subgrupo,
      item: l.item,
      meses,
      observacao: l.observacao?.trim() ? l.observacao.trim() : null,
    });
  }
  return { linhas, invalidas };
}

export const somaCentavos = (v: readonly number[]): number => v.reduce((s, x) => s + x, 0);

/** Total da linha no ano (os meses inválidos contam 0; a tela marca o mês). */
export const totalDaLinha = (l: LinhaGrade): number => somaCentavos(l.textos.map((t) => lerReais(t) ?? 0));

/** Totais da grade por natureza e por mês (as parcelas da conta impressa). */
export function totaisDaGrade(
  grade: readonly LinhaGrade[],
): Record<NaturezaOrcamento, { meses: number[]; ano: number; linhas: number }> {
  const r = {
    despesa: { meses: Array<number>(12).fill(0), ano: 0, linhas: 0 },
    receita: { meses: Array<number>(12).fill(0), ano: 0, linhas: 0 },
    consumo: { meses: Array<number>(12).fill(0), ano: 0, linhas: 0 },
  };
  for (const l of grade) {
    const t = r[l.natureza];
    t.linhas++;
    l.textos.forEach((x, i) => {
      const c = lerReais(x) ?? 0;
      t.meses[i]! += c;
      t.ano += c;
    });
  }
  return r;
}

/** "R$ 1,00 (A) + R$ 2,00 (B) = R$ 3,00": a conta de um total com as parcelas impressas. */
export function contaComParcelas(parcelas: readonly ParcelaTotalOrcamento[], total: number): string {
  if (parcelas.length === 0) return `R$ ${reais(total)}`;
  const p = parcelas.map((x) => `R$ ${reais(x.centavos)} (${x.rotulo})`).join(' + ');
  return `${p} = R$ ${reais(total)}`;
}

/** Busca sem acento e sem caixa (rótulo do centro ou do item). */
export function normalizar(t: string): string {
  return t
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase();
}

/** Ordena a grade: centro (0 primeiro), natureza, item. */
export function ordenarGrade(grade: LinhaGrade[], codigoCentro: (id: number) => number): LinhaGrade[] {
  const ordemNat: Record<NaturezaOrcamento, number> = { receita: 0, despesa: 1, consumo: 2 };
  return grade.sort(
    (a, b) =>
      codigoCentro(a.centro) - codigoCentro(b.centro) ||
      a.centro - b.centro ||
      ordemNat[a.natureza] - ordemNat[b.natureza] ||
      a.grupo - b.grupo ||
      a.subgrupo - b.subgrupo ||
      a.item - b.item,
  );
}

/** Lê o ajuste em pontos percentuais ("5", "-2,5", "+10,25") como centésimos de ponto (500, -250, 1025); null se inválido. */
export function lerAjuste(texto: string): number | null {
  const s = texto.trim().replace(/%$/u, '').trim();
  if (s === '') return 0;
  const m = /^([+-]?)(\d{1,4})(?:[,.](\d{1,2}))?$/u.exec(s);
  if (!m) return null;
  const v = (Number(m[2]) * 100 + Number((m[3] ?? '').padEnd(2, '0'))) * (m[1] === '-' ? -1 : 1);
  return v >= -10_000 && v <= 100_000 ? v : null;
}

/** Os anos oferecidos: do próximo ao de 6 anos atrás (o mais novo primeiro). */
export function anosDoOrcamento(hoje: string): number[] {
  const a = Number(hoje.slice(0, 4)) || new Date().getFullYear();
  return Array.from({ length: 8 }, (_, i) => a + 1 - i);
}
