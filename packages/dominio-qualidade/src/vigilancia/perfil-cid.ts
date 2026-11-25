// Hierarquia da CID-10 (capítulo, grupo e subgrupo, da fonte oficial) e o perfil epidemiológico do estabelecimento por
// capítulo (F7, 09-AREA linha 83). Regra pura: a porta lê as tabelas capitulo_cid10 e agrupamento_cid10 e as contagens
// de diagnóstico por categoria (3 caracteres); aqui se localiza o código na hierarquia e se somam as ocorrências em
// cada nível. Só contagens (nenhum dado de pessoa).

export interface CapituloCid {
  /** Número romano oficial (ex.: IX). */
  readonly codigo: string;
  readonly numero: number;
  readonly inicial: string;
  readonly final: string;
  readonly descricao: string;
}

export interface AgrupamentoCid {
  /** Faixa oficial (ex.: I20-I25). */
  readonly codigo: string;
  readonly capitulo: string;
  /** Faixa do agrupamento que contém este (subgrupo), ou null (grupo). */
  readonly pai: string | null;
  readonly nivel: 'grupo' | 'subgrupo';
  readonly inicial: string;
  readonly final: string;
  readonly descricao: string;
}

export interface HierarquiaCid {
  readonly capitulos: readonly CapituloCid[];
  readonly agrupamentos: readonly AgrupamentoCid[];
}

export interface LocalizacaoCid {
  readonly cid: string;
  readonly categoria: string;
  readonly capitulo: CapituloCid;
  /** Do mais largo (grupo) ao mais estreito (último subgrupo); vazio se a categoria não tem agrupamento. */
  readonly agrupamentos: readonly AgrupamentoCid[];
}

export interface ContagemCategoriaCid {
  /** Categoria da CID-10 (3 caracteres, ex.: I21). */
  readonly categoria: string;
  readonly diagnosticos: number;
}

export interface NoPerfilCid {
  readonly codigo: string;
  readonly descricao: string;
  readonly nivel: 'capitulo' | 'grupo' | 'subgrupo';
  readonly diagnosticos: number;
  /** Percentual do total do período, com uma casa. */
  readonly percentual: number;
  readonly filhos: readonly NoPerfilCid[];
}

export interface PerfilCid {
  readonly total: number;
  readonly capitulos: readonly NoPerfilCid[];
  /** Ocorrências cuja categoria não cai em nenhum capítulo da edição vigente (código fora da fonte oficial). */
  readonly semCapitulo: number;
}

export const MENSAGENS_PERFIL_CID = {
  cidInvalido: 'Informe um código da CID-10 (letra e dois dígitos, com subcategoria opcional, ex.: I21.9).',
  cidForaDaHierarquia: 'O código não está em nenhum capítulo da CID-10 vigente.',
  periodoInvalido: 'Informe o período com a data inicial até a final, em no máximo 366 dias.',
} as const;

const FORMATO_CID = /^[A-Z]\d{2}[0-9A-Z]?$/;
export const DIAS_MAXIMOS_PERFIL_CID = 366;

/** `i21.9` → `I219`; `I21` → `I21`; inválido → null. */
export function normalizarCid(v: string | null | undefined): string | null {
  const c = (v ?? '')
    .trim()
    .toUpperCase()
    .replace(/[.\s-]/g, '');
  return FORMATO_CID.test(c) ? c : null;
}

const contem = (ini: string, fim: string, categoria: string) => ini <= categoria && categoria <= fim;
const largura = (a: { inicial: string; final: string }) => {
  const n = (c: string) => (c.charCodeAt(0) - 65) * 100 + Number(c.slice(1, 3));
  return n(a.final) - n(a.inicial);
};

/** O capítulo e os agrupamentos (do grupo ao subgrupo mais estreito) que contêm o código; null se fora da CID. */
export function localizarCid(h: HierarquiaCid, valor: string): LocalizacaoCid | null {
  const cid = normalizarCid(valor);
  if (!cid) return null;
  const categoria = cid.slice(0, 3);
  const capitulo = h.capitulos.find((c) => contem(c.inicial, c.final, categoria));
  if (!capitulo) return null;
  const agrupamentos = h.agrupamentos
    .filter((a) => contem(a.inicial, a.final, categoria))
    .sort((a, b) => largura(b) - largura(a) || a.codigo.localeCompare(b.codigo));
  return { cid, categoria, capitulo, agrupamentos };
}

const pct = (n: number, total: number) => (total ? Math.round((n * 1000) / total) / 10 : 0);

/**
 * Soma as ocorrências por capítulo, grupo e subgrupo (uma categoria conta em todos os níveis que a contêm). Só entram os
 * níveis com ocorrência; capítulos por número, agrupamentos pela faixa.
 */
export function perfilPorCapitulo(h: HierarquiaCid, contagens: readonly ContagemCategoriaCid[]): PerfilCid {
  const porCategoria = new Map<string, number>();
  for (const c of contagens) {
    const cat = c.categoria.trim().toUpperCase().slice(0, 3);
    porCategoria.set(cat, (porCategoria.get(cat) ?? 0) + c.diagnosticos);
  }
  const total = [...porCategoria.values()].reduce((s, n) => s + n, 0);
  const soma = (ini: string, fim: string) =>
    [...porCategoria].reduce((s, [cat, n]) => (contem(ini, fim, cat) ? s + n : s), 0);
  const filhosDe = (capitulo: string, pai: string | null): NoPerfilCid[] =>
    h.agrupamentos
      .filter((a) => a.capitulo === capitulo && a.pai === pai)
      .map((a) => ({ a, n: soma(a.inicial, a.final) }))
      .filter((x) => x.n > 0)
      .sort((x, y) => x.a.inicial.localeCompare(y.a.inicial) || largura(y.a) - largura(x.a))
      .map(({ a, n }) => ({
        codigo: a.codigo,
        descricao: a.descricao,
        nivel: a.nivel,
        diagnosticos: n,
        percentual: pct(n, total),
        filhos: filhosDe(capitulo, a.codigo),
      }));
  const capitulos = [...h.capitulos]
    .sort((a, b) => a.numero - b.numero)
    .map((c) => ({ c, n: soma(c.inicial, c.final) }))
    .filter((x) => x.n > 0)
    .map(({ c, n }) => ({
      codigo: c.codigo,
      descricao: c.descricao,
      nivel: 'capitulo' as const,
      diagnosticos: n,
      percentual: pct(n, total),
      filhos: filhosDe(c.codigo, null),
    }));
  const noCapitulo = capitulos.reduce((s, c) => s + c.diagnosticos, 0);
  return { total, capitulos, semCapitulo: total - noCapitulo };
}

/** Período do perfil: datas `AAAA-MM-DD`, início até o fim, no máximo 366 dias. Devolve null se inválido. */
export function periodoDoPerfilCid(desde: string, ate: string): { desde: string; ate: string } | null {
  const D = /^\d{4}-\d{2}-\d{2}$/;
  if (!D.test(desde) || !D.test(ate)) return null;
  const a = Date.parse(`${desde}T00:00:00Z`);
  const b = Date.parse(`${ate}T00:00:00Z`);
  if (Number.isNaN(a) || Number.isNaN(b) || a > b) return null;
  if (new Date(a).toISOString().slice(0, 10) !== desde || new Date(b).toISOString().slice(0, 10) !== ate)
    return null;
  if ((b - a) / 86_400_000 + 1 > DIAS_MAXIMOS_PERFIL_CID) return null;
  return { desde, ate };
}
