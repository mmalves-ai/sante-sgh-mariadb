// Resultados de exames (ficha do M23, regra 12; cap-05b §5.10 Valor crítico): destaque fora da faixa, tendência por
// elemento e valor crítico com ciência obrigatória, venha a liberação do novo ou do outro sistema. A faixa de
// referência do legado é texto livre (ex.: "12,0 a 16,0", "< 5", "até 200", "> 40"): a leitura extrai os limites
// quando dá; o que não dá fica sem destaque (nunca inventa faixa). Crítico: a marca do laboratório ou a lista de
// limites críticos do estabelecimento (parâmetro; lista de valores críticos é dúvida de processo da validação).
export interface Faixa {
  readonly min: number | null;
  readonly max: number | null;
}

const NUM = String.raw`(-?\d+(?:[.,]\d+)?)`;

export function numeroDoTexto(s: string | null | undefined): number | null {
  if (s === null || s === undefined) return null;
  const t = s.trim().replace(/\s/g, '');
  if (!/^-?\d+(?:[.,]\d+)?$/.test(t)) return null;
  return Number(t.replace(',', '.'));
}

/** Limites da faixa de referência em texto (só quando a forma é reconhecida). */
export function faixaDoTexto(s: string | null | undefined): Faixa | null {
  if (!s) return null;
  const t = s.toLowerCase().replace(/\s+/g, ' ').trim();
  let m = new RegExp(`^${NUM} ?(?:a|-|até|ate) ?${NUM}`).exec(t);
  if (m) return { min: Number(m[1]!.replace(',', '.')), max: Number(m[2]!.replace(',', '.')) };
  m = new RegExp(`^(?:<|<=|até|ate|inferior a|menor que) ?${NUM}`).exec(t);
  if (m) return { min: null, max: Number(m[1]!.replace(',', '.')) };
  m = new RegExp(`^(?:>|>=|superior a|maior que|acima de) ?${NUM}`).exec(t);
  if (m) return { min: Number(m[1]!.replace(',', '.')), max: null };
  return null;
}

export function foraDaFaixa(valor: number | null, faixa: Faixa | null): 'abaixo' | 'acima' | null {
  if (valor === null || faixa === null) return null;
  if (faixa.min !== null && valor < faixa.min) return 'abaixo';
  if (faixa.max !== null && valor > faixa.max) return 'acima';
  return null;
}

export interface LimiteCritico {
  /** Elemento (comparado sem acento e sem caixa). */
  readonly elemento: string;
  readonly abaixoDe: number | null;
  readonly acimaDe: number | null;
}

const normal = (s: string) =>
  s.normalize('NFD').replace(/\p{M}/gu, '').toUpperCase().replace(/\s+/g, ' ').trim();

/** Crítico pela lista de limites do estabelecimento (parâmetro) ou pela marca vinda do laboratório. */
export function ehCritico(
  elemento: string,
  valor: number | null,
  limites: readonly LimiteCritico[],
  marcadoPeloLaboratorio = false,
): boolean {
  if (marcadoPeloLaboratorio) return true;
  if (valor === null) return false;
  const l = limites.find((x) => normal(x.elemento) === normal(elemento));
  if (!l) return false;
  return (l.abaixoDe !== null && valor < l.abaixoDe) || (l.acimaDe !== null && valor > l.acimaDe);
}

/** Lista padrão de valores críticos (a confirmar com a diretoria clínica e o laboratório: dúvida de processo). */
export const LIMITES_CRITICOS_PADRAO: readonly LimiteCritico[] = [
  { elemento: 'POTASSIO', abaixoDe: 2.5, acimaDe: 6.5 },
  { elemento: 'SODIO', abaixoDe: 120, acimaDe: 160 },
  { elemento: 'GLICOSE', abaixoDe: 40, acimaDe: 500 },
  { elemento: 'HEMOGLOBINA', abaixoDe: 7, acimaDe: 20 },
  { elemento: 'PLAQUETAS', abaixoDe: 20000, acimaDe: 1000000 },
  { elemento: 'TROPONINA', abaixoDe: null, acimaDe: 0.04 },
  { elemento: 'LACTATO', abaixoDe: null, acimaDe: 4 },
];

/** Série por elemento (tendência), em ordem de data, só valores numéricos. */
export function tendencias(
  valores: readonly { elemento: string; em: string; numero: number | null; unidade: string | null }[],
): { elemento: string; unidade: string | null; pontos: { em: string; valor: number }[] }[] {
  const m = new Map<
    string,
    { elemento: string; unidade: string | null; pontos: { em: string; valor: number }[] }
  >();
  for (const v of valores) {
    if (v.numero === null) continue;
    const k = normal(v.elemento);
    const s = m.get(k) ?? { elemento: v.elemento.trim(), unidade: v.unidade, pontos: [] };
    s.pontos.push({ em: v.em, valor: v.numero });
    m.set(k, s);
  }
  return [...m.values()]
    .filter((s) => s.pontos.length >= 2)
    .map((s) => ({ ...s, pontos: s.pontos.sort((a, b) => a.em.localeCompare(b.em)) }))
    .sort((a, b) => a.elemento.localeCompare(b.elemento));
}

/** Chave natural de 7 colunas do exame (DATA|REG|CONTA|ATEND|ATO|EXAME|SEQUENCIA), para a ciência. */
export function chaveDoExame(k: {
  readonly data: string;
  readonly reg: number;
  readonly conta: number | string;
  readonly atend: number | string;
  readonly ato: number;
  readonly exame: number | string;
  readonly sequencia: number;
}): string {
  return [k.data.slice(0, 10), k.reg, k.conta, k.atend, k.ato, k.exame, k.sequencia]
    .map((x) => String(x).trim())
    .join('|');
}
