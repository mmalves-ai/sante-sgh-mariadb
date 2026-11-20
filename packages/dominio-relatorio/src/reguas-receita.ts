// Réguas da receita e a glosa dos relatórios do catálogo (M34; ficha, regra 6; cap-14 §14.4.2; ref 01 §0, achados 10
// e 11): todo relatório ou indicador de receita DECLARA a régua — competência da conta (o mês e o ano de produção) ou
// data do item —, e a glosa é VALOR_C − VLR_PG só dos itens com GLOSADO = 'T' (a marca de item baixado, não de
// "glosado": cerca de 88% dos itens de 2025 têm a marca). O mês sem baixa mostra "sem baixa", nunca 0% de glosa. O
// relatório só é publicado (a chave do estabelecimento) depois de conferido contra o número do relatório de origem no
// mesmo período (o pré-requisito "aprovação" da liberação). Regras puras sobre linhas já agregadas no banco.
import type { RelatorioCatalogo } from '@sgh/contratos';
import { glosaDosBaixados } from './paineis.js';

export type Regua = 'competencia' | 'data-do-item';
export const REGUA_PADRAO: Regua = 'competencia';

/** Itens agregados por convênio (somas do banco: cobrado, pago e os mesmos só dos baixados). */
export interface SomaItens {
  readonly convenio: number;
  readonly contas: number;
  readonly itens: number;
  readonly cobrado: number;
  readonly pago: number;
  readonly itensBaixados: number;
  readonly cobradoBaixado: number;
  readonly pagoBaixado: number;
}

const centavos = (v: number) => Math.round(v * 100) / 100;

/**
 * Glosa dos baixados e o percentual sobre o cobrado dos baixados (null sem baixa: nunca "0% de glosa"); a mesma fórmula
 * do painel financeiro do M16 (`glosaDosBaixados`).
 */
export function glosaDosItensBaixados(s: Pick<SomaItens, 'cobradoBaixado' | 'pagoBaixado'>): {
  glosa: number;
  percentual: number | null;
} {
  const g = glosaDosBaixados(s.cobradoBaixado, s.pagoBaixado);
  return { glosa: centavos(g.valor), percentual: g.percentual };
}

/** A régua escolhida (ou a padrão, competência); outra coisa é recusada. */
export function reguaDoParametro(v: unknown): Regua {
  if (v === undefined || v === null || v === '') return REGUA_PADRAO;
  if (v === 'competencia' || v === 'data-do-item') return v;
  throw new Error('Régua inválida: use competência ou data do item.');
}

/** Meses AAAA-MM de um intervalo (inclusive), para a competência (ANOPRO e MESPRO da conta). */
export function mesesDoIntervalo(de: string, ate: string): string[] {
  const r: string[] = [];
  let [a, m] = de.split('-').map(Number) as [number, number];
  const [a2, m2] = ate.split('-').map(Number) as [number, number];
  while (a < a2 || (a === a2 && m <= m2)) {
    r.push(`${a}-${String(m).padStart(2, '0')}`);
    m++;
    if (m > 12) {
      m = 1;
      a++;
    }
    if (r.length > 240) throw new Error('Intervalo de meses longo demais.');
  }
  return r;
}

/** Primeiro e último dia de um intervalo de meses (a régua da data do item). */
export function diasDoIntervalo(de: string, ate: string): { inicio: string; fim: string } {
  const [a2, m2] = ate.split('-').map(Number) as [number, number];
  const ultimo = new Date(Date.UTC(a2, m2, 0)).getUTCDate();
  return { inicio: `${de}-01`, fim: `${ate}-${String(ultimo).padStart(2, '0')}` };
}

/** Linhas da glosa por convênio (as colunas do relatório glosasPorConvenio), com o total. */
export function linhasDeGlosa(
  somas: readonly SomaItens[],
  nomes: ReadonlyMap<number, string>,
): Record<string, string | number | null>[] {
  return [...somas]
    .sort((a, b) => b.cobradoBaixado - a.cobradoBaixado || a.convenio - b.convenio)
    .map((s) => {
      const g = glosaDosItensBaixados(s);
      return {
        convenio: s.convenio,
        nomeConvenio: nomes.get(s.convenio) ?? null,
        itensBaixados: s.itensBaixados,
        cobradoBaixado: centavos(s.cobradoBaixado),
        pagoBaixado: centavos(s.pagoBaixado),
        glosa: g.glosa,
        percentualGlosa: g.percentual,
      };
    });
}

/** Linhas do faturamento por convênio (cobrado e pago de todos os itens da régua). */
export function linhasDeFaturamento(
  somas: readonly SomaItens[],
  nomes: ReadonlyMap<number, string>,
): Record<string, string | number | null>[] {
  return [...somas]
    .sort((a, b) => b.cobrado - a.cobrado || a.convenio - b.convenio)
    .map((s) => ({
      convenio: s.convenio,
      nomeConvenio: nomes.get(s.convenio) ?? null,
      contas: s.contas,
      itens: s.itens,
      cobrado: centavos(s.cobrado),
      pago: centavos(s.pago),
    }));
}

/** Regra 6: todo relatório com coluna de dinheiro declara a régua e a fórmula; nenhum fica sem. */
export function reguaDeclarada(r: Pick<RelatorioCatalogo, 'colunas' | 'regua' | 'formula'>): boolean {
  const temDinheiro = r.colunas.some((c) => c.tipo === 'dinheiro');
  return r.formula.trim().length >= 20 && (!temDinheiro || r.regua !== null);
}

/**
 * Conferência contra o número do relatório de origem no mesmo período: a diferença aceita é de até um centavo por
 * linha (arredondamento) e nenhuma linha a mais ou a menos.
 */
export function conferirContraOrigem(
  novo: ReadonlyMap<string, number>,
  origem: ReadonlyMap<string, number>,
  tolerancia = 0.01,
): { igual: boolean; diferencas: { chave: string; novo: number | null; origem: number | null }[] } {
  const chaves = new Set([...novo.keys(), ...origem.keys()]);
  const diferencas = [...chaves]
    .sort()
    .map((chave) => ({ chave, novo: novo.get(chave) ?? null, origem: origem.get(chave) ?? null }))
    .filter((d) => d.novo === null || d.origem === null || Math.abs(d.novo - d.origem) > tolerancia);
  return { igual: diferencas.length === 0, diferencas };
}
