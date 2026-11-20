// Editor estruturado do protocolo de classificação (ficha do M44, seção 7: "editor versionado com simulador"; cap-11
// §11.1: a regra montada por campo, operador e valor gera o JSON Logic). Puro: a tela monta a regra por condições e
// mostra a diferença em relação à versão vigente antes de publicar; o JSON fica só como visão avançada.
//   - regraDasCondicoes: condições (variável, operador, valor) unidas por "todas" (and) ou "qualquer uma" (or) →
//     JSON Logic do subconjunto que o motor avalia (null: sem condição, o enfermeiro marca à mão);
//   - condicoesDaRegra: o caminho inverso, para editar a regra já publicada; a regra fora dessa forma (negação,
//     lista, `missing`, aninhada) é "avançada" e só se edita pela visão avançada;
//   - diferencaDoProtocolo: o que muda da vigente para a versão nova (cores, fluxogramas, discriminadores, geral).
import {
  CODIGOS_VARIAVEL_CLASSIFICACAO,
  type ConteudoProtocolo,
  type CorProtocolo,
  type Discriminador,
  type VariavelClassificacao,
} from '@sgh/contratos';
import type { RegraClassificacao } from './regra.js';

export const OPERADORES_CONDICAO = [
  { codigo: '<', rotulo: 'menor que' },
  { codigo: '<=', rotulo: 'menor ou igual a' },
  { codigo: '>', rotulo: 'maior que' },
  { codigo: '>=', rotulo: 'maior ou igual a' },
  { codigo: '==', rotulo: 'igual a' },
  { codigo: '!=', rotulo: 'diferente de' },
] as const;
export type OperadorCondicao = (typeof OPERADORES_CONDICAO)[number]['codigo'];
const OPERADORES: ReadonlySet<string> = new Set(OPERADORES_CONDICAO.map((o) => o.codigo));
const VARIAVEIS: ReadonlySet<string> = new Set(CODIGOS_VARIAVEL_CLASSIFICACAO);

export interface CondicaoRegra {
  readonly variavel: VariavelClassificacao;
  readonly operador: OperadorCondicao;
  readonly valor: number;
}

export interface RegraMontada {
  /** `and`: todas as condições; `or`: qualquer uma. */
  readonly juncao: 'and' | 'or';
  readonly condicoes: readonly CondicaoRegra[];
}

function comparacao(c: CondicaoRegra): RegraClassificacao {
  return { [c.operador]: [{ var: c.variavel }, c.valor] };
}

/** As condições em JSON Logic: nenhuma → null (marcado à mão); uma → a comparação; mais → and/or delas. */
export function regraDasCondicoes(m: RegraMontada): RegraClassificacao | null {
  if (m.condicoes.length === 0) return null;
  if (m.condicoes.length === 1) return comparacao(m.condicoes[0]!);
  return { [m.juncao]: m.condicoes.map(comparacao) };
}

function condicaoDe(r: unknown): CondicaoRegra | null {
  if (r === null || typeof r !== 'object' || Array.isArray(r)) return null;
  const chaves = Object.keys(r);
  if (chaves.length !== 1 || !OPERADORES.has(chaves[0]!)) return null;
  const a = (r as Record<string, unknown>)[chaves[0]!];
  if (!Array.isArray(a) || a.length !== 2) return null;
  const [v, n] = a as [unknown, unknown];
  if (v === null || typeof v !== 'object' || Array.isArray(v)) return null;
  const nome = (v as Record<string, unknown>)['var'];
  if (Object.keys(v).length !== 1 || typeof nome !== 'string' || !VARIAVEIS.has(nome)) return null;
  if (typeof n !== 'number' || !Number.isFinite(n)) return null;
  return { variavel: nome as VariavelClassificacao, operador: chaves[0] as OperadorCondicao, valor: n };
}

/**
 * A regra publicada como condições do editor. null/ausente → nenhuma condição; a comparação simples ou o and/or de
 * comparações simples → as condições; qualquer outra forma → 'avancada' (fica como está, editável só na visão
 * avançada).
 */
export function condicoesDaRegra(regra: unknown): RegraMontada | 'avancada' {
  if (regra === null || regra === undefined) return { juncao: 'and', condicoes: [] };
  const uma = condicaoDe(regra);
  if (uma) return { juncao: 'and', condicoes: [uma] };
  if (typeof regra !== 'object' || Array.isArray(regra)) return 'avancada';
  const chaves = Object.keys(regra);
  if (chaves.length !== 1 || (chaves[0] !== 'and' && chaves[0] !== 'or')) return 'avancada';
  const termos = (regra as Record<string, unknown>)[chaves[0]];
  if (!Array.isArray(termos) || termos.length === 0) return 'avancada';
  const cs = termos.map(condicaoDe);
  if (cs.some((c) => c === null)) return 'avancada';
  return { juncao: chaves[0], condicoes: cs as CondicaoRegra[] };
}

export interface MudancaProtocolo {
  readonly parte: 'geral' | 'cor' | 'fluxograma' | 'discriminador';
  readonly acao: 'incluido' | 'removido' | 'alterado';
  readonly codigo: string;
  readonly titulo: string;
  /** Os campos que mudaram (só em `alterado`). */
  readonly campos: readonly string[];
}

const igual = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

function camposMudados<T extends object>(a: T, b: T, campos: readonly (keyof T & string)[]): string[] {
  return campos.filter((k) => !igual(a[k], b[k]));
}

function porCodigo<T, K extends string>(
  antes: readonly T[],
  depois: readonly T[],
  chave: (x: T) => K,
  parte: MudancaProtocolo['parte'],
  titulo: (x: T) => string,
  campos: (a: T, b: T) => string[],
): MudancaProtocolo[] {
  const r: MudancaProtocolo[] = [];
  const a = new Map(antes.map((x) => [chave(x), x]));
  const b = new Map(depois.map((x) => [chave(x), x]));
  for (const [k, x] of b) {
    const y = a.get(k);
    if (!y) r.push({ parte, acao: 'incluido', codigo: k, titulo: titulo(x), campos: [] });
    else {
      const c = campos(y, x);
      if (c.length) r.push({ parte, acao: 'alterado', codigo: k, titulo: titulo(x), campos: c });
    }
  }
  for (const [k, y] of a)
    if (!b.has(k)) r.push({ parte, acao: 'removido', codigo: k, titulo: titulo(y), campos: [] });
  return r;
}

/** O que muda da versão vigente para a nova (sem vigente: tudo é incluído). */
export function diferencaDoProtocolo(
  antes: ConteudoProtocolo | null,
  depois: ConteudoProtocolo,
): MudancaProtocolo[] {
  const base: Pick<ConteudoProtocolo, 'cores' | 'fluxogramas' | 'discriminadores'> = antes ?? {
    cores: [],
    fluxogramas: [],
    discriminadores: [],
  };
  const geral =
    antes === null
      ? []
      : camposMudados(antes, depois, ['tipo', 'nome', 'licenca']).length > 0
        ? [
            {
              parte: 'geral' as const,
              acao: 'alterado' as const,
              codigo: 'geral',
              titulo: depois.nome,
              campos: camposMudados(antes, depois, ['tipo', 'nome', 'licenca']),
            },
          ]
        : [];
  return [
    ...geral,
    ...porCodigo<CorProtocolo, string>(
      base.cores,
      depois.cores,
      (c) => c.cor,
      'cor',
      (c) => c.nome,
      (a, b) => camposMudados(a, b, ['nome', 'tempoAlvoMin', 'opcaoE08', 'corLegado']),
    ),
    ...porCodigo(
      base.fluxogramas,
      depois.fluxogramas,
      (f) => f.codigo,
      'fluxograma',
      (f) => f.titulo,
      (a, b) => camposMudados(a, b, ['titulo']),
    ),
    ...porCodigo<Discriminador, string>(
      base.discriminadores,
      depois.discriminadores,
      (d) => `${d.fluxograma}/${d.codigo}`,
      'discriminador',
      (d) => d.titulo,
      (a, b) => camposMudados(a, b, ['titulo', 'cor', 'regra', 'sugereProtocolo']),
    ),
  ];
}

/** Código a partir do título (minúsculas, sem acento, hífen no lugar do espaço; o esquema exige `^[a-z][a-z0-9-]+`). */
export function codigoDoTitulo(titulo: string, usados: ReadonlySet<string> = new Set()): string {
  const base =
    titulo
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .replace(/^[^a-z]+/, '')
      .slice(0, 50) || 'item';
  const raiz = base.length >= 2 ? base : `${base}x`;
  let c = raiz;
  for (let i = 2; usados.has(c); i++) c = `${raiz}-${i}`;
  return c;
}
