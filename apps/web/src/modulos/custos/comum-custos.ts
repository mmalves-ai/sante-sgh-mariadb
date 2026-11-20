// Regras de apresentação da tela da estrutura de custos (M54, etapa 4), puras e testadas: competências, quantidades com
// as casas da estatística, filtro dos centros, a conta do total com as parcelas e a ordem das linhas da matriz.
import type {
  CentroCustoEstrutura,
  ClasseCentroCusto,
  LinhaMatrizEstatisticas,
  ValorEstatistica,
} from '@sgh/contratos';

/** As `n` competências (AAAA-MM) até a do dia, da mais recente para a mais antiga. */
export function competenciasAte(hoje: string, n: number): string[] {
  const [a, m] = hoje.split('-').map(Number);
  let ano = a!;
  let mes = m!;
  const r: string[] = [];
  for (let i = 0; i < n; i++) {
    r.push(`${ano}-${String(mes).padStart(2, '0')}`);
    mes -= 1;
    if (mes === 0) {
      mes = 12;
      ano -= 1;
    }
  }
  return r;
}

const MESES = [
  'janeiro',
  'fevereiro',
  'março',
  'abril',
  'maio',
  'junho',
  'julho',
  'agosto',
  'setembro',
  'outubro',
  'novembro',
  'dezembro',
];
/** 2026-03 → "março de 2026". */
export function rotuloCompetencia(c: string): string {
  const [a, m] = c.split('-');
  const nome = MESES[Number(m) - 1];
  return nome && a ? `${nome} de ${a}` : c;
}

const FORMATOS = {
  0: new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 0 }),
  2: new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
} as const;
/** Quantidade com as casas da estatística (0 ou 2), no formato brasileiro. */
export function quantidade(v: number, casas: 0 | 2): string {
  return FORMATOS[casas].format(v);
}

/** "12,5" ou "12.5" → 12.5; vazio ou inválido → null (até duas casas). */
export function lerQuantidade(texto: string): number | null {
  const bruto = texto.trim();
  // Com vírgula, o ponto é separador de milhar (1.234,5); sem vírgula, o ponto é o decimal (12.5).
  const t = bruto.includes(',') ? bruto.replace(/\./g, '').replace(',', '.') : bruto;
  if (!/^\d+(\.\d{1,2})?$/.test(t)) return null;
  return Number(t);
}

export type FiltroClasse = ClasseCentroCusto | 'semClasse' | 'todas';

/** Os centros da lista pela classe (a classificada; "sem classe" quando não há) e pelo termo (código, nome ou sigla). */
export function filtrarCentros(
  centros: readonly CentroCustoEstrutura[],
  classe: FiltroClasse,
  termo: string,
): CentroCustoEstrutura[] {
  const t = normalizar(termo.trim());
  return centros.filter((c) => {
    if (classe === 'semClasse' && c.classificacao) return false;
    if (classe !== 'todas' && classe !== 'semClasse' && c.classificacao?.classe !== classe) return false;
    if (!t) return true;
    return (
      String(c.codigo) === t ||
      normalizar(c.nome).includes(t) ||
      (c.sigla !== null && normalizar(c.sigla).includes(t))
    );
  });
}

function normalizar(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

export interface ParcelaEstatistica {
  readonly centro: number;
  readonly valor: ValorEstatistica;
}

/** As parcelas de uma estatística (uma por centro com valor), em ordem de código do centro, e a soma delas. */
export function parcelasDaEstatistica(
  linhas: readonly LinhaMatrizEstatisticas[],
  codigo: string,
  codigoDoCentro: (id: number) => number,
): { parcelas: ParcelaEstatistica[]; soma: number } {
  const parcelas: ParcelaEstatistica[] = [];
  for (const l of linhas) {
    const v = (l.valores as Readonly<Record<string, ValorEstatistica | undefined>>)[codigo];
    if (v) parcelas.push({ centro: l.centro, valor: v });
  }
  parcelas.sort((a, b) => codigoDoCentro(a.centro) - codigoDoCentro(b.centro) || a.centro - b.centro);
  // Soma em centésimos (a quantidade é guardada assim): sem o erro de ponto flutuante da soma direta.
  const centesimos = parcelas.reduce((s, p) => s + Math.round(p.valor.quantidade * 100), 0);
  return { parcelas, soma: centesimos / 100 };
}

/** "pc: 2026-10-28T13:05:00Z" → "28/10/2026 13:05" (hora local). */
export function dataHora(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()} ${p(d.getHours())}:${p(d.getMinutes())}`;
}
