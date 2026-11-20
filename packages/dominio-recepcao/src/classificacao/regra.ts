// Regras dos discriminadores em JSON Logic (cap-11 §11.1; ficha do M44, regra 3), no subconjunto que o editor de
// protocolo oferece: `var` sobre as variáveis da classificação, comparações, `and`/`or`/`!`, `in` (lista) e
// `missing`. Puro e sem dependência: roda na tela (marca o discriminador enquanto se digita) e no servidor (a mesma
// proposta ao gravar). Valor ausente (null) nunca satisfaz comparação: discriminador por sinal não medido não é
// marcado sozinho (o enfermeiro marca à mão). Operação desconhecida ou variável fora do vocabulário é erro de
// publicação (a versão não publica), nunca silêncio.
import { CODIGOS_VARIAVEL_CLASSIFICACAO } from '@sgh/contratos';

export type ValorRegra = number | string | boolean | null;
export type RegraClassificacao =
  | ValorRegra
  | readonly RegraClassificacao[]
  | { readonly [op: string]: RegraClassificacao | readonly RegraClassificacao[] };

export class ErroRegraClassificacao extends Error {
  override readonly name = 'ErroRegraClassificacao';
}

const COMPARACOES = new Set(['==', '!=', '<', '<=', '>', '>=']);
export const OPERACOES_REGRA_CLASSIFICACAO: ReadonlySet<string> = new Set([
  'var',
  'and',
  'or',
  '!',
  'in',
  'missing',
  ...COMPARACOES,
]);
const VARIAVEIS: ReadonlySet<string> = new Set(CODIGOS_VARIAVEL_CLASSIFICACAO);

/** Profundidade máxima da regra (um protocolo não precisa de mais; trava contra regra patológica). */
export const PROFUNDIDADE_MAXIMA_REGRA = 12;

function args(
  x: RegraClassificacao | readonly RegraClassificacao[] | undefined,
): readonly RegraClassificacao[] {
  if (x === undefined) return [];
  return Array.isArray(x) ? (x as readonly RegraClassificacao[]) : [x as RegraClassificacao];
}

function eObjeto(r: unknown): r is Record<string, RegraClassificacao> {
  return r !== null && typeof r === 'object' && !Array.isArray(r);
}

/** Os problemas da regra (vazio: válida). Confere operações, variáveis, aridade e profundidade. */
export function problemasDaRegra(regra: unknown, profundidade = 0): string[] {
  if (profundidade > PROFUNDIDADE_MAXIMA_REGRA) return ['regra profunda demais'];
  if (regra === null || ['number', 'string', 'boolean'].includes(typeof regra)) return [];
  if (Array.isArray(regra)) return regra.flatMap((r) => problemasDaRegra(r, profundidade + 1));
  if (!eObjeto(regra)) return ['valor inválido na regra'];
  const chaves = Object.keys(regra);
  if (chaves.length !== 1) return ['cada nó da regra tem uma operação só'];
  const op = chaves[0]!;
  if (!OPERACOES_REGRA_CLASSIFICACAO.has(op)) return [`operação não permitida: ${op}`];
  const a = args(regra[op]);
  if (op === 'var' || op === 'missing') {
    const nomes = op === 'var' ? a.slice(0, 1) : a;
    if (nomes.length === 0) return [`${op} sem variável`];
    return nomes.flatMap((n) =>
      typeof n === 'string' && VARIAVEIS.has(n) ? [] : [`variável desconhecida: ${String(n)}`],
    );
  }
  if (COMPARACOES.has(op) && a.length !== 2) return [`${op} compara dois valores`];
  if (op === '!' && a.length !== 1) return ['! nega um valor'];
  if (op === 'in' && (a.length !== 2 || !Array.isArray(a[1]))) return ['in compara um valor com uma lista'];
  if ((op === 'and' || op === 'or') && a.length < 1) return [`${op} sem termos`];
  return a.flatMap((r) => problemasDaRegra(r, profundidade + 1));
}

/** Valores da classificação lidos pela regra (os sinais e a idade). */
export type ValoresClassificacao = Readonly<Partial<Record<string, number | null>>>;

/** Verdade como no JSON Logic: lista vazia, zero, texto vazio e nulo são falsos. */
function verdadeiro(v: unknown): boolean {
  if (Array.isArray(v)) return v.length > 0;
  return v !== null && v !== undefined && v !== false && v !== 0 && v !== '';
}

function avaliar(r: RegraClassificacao, valores: ValoresClassificacao): unknown {
  if (r === null || typeof r !== 'object') return r;
  if (Array.isArray(r)) return r.map((x) => avaliar(x as RegraClassificacao, valores));
  const o = r as Record<string, RegraClassificacao>;
  const op = Object.keys(o)[0]!;
  const a = args(o[op]);
  const av = (i: number) => avaliar(a[i] ?? null, valores);
  switch (op) {
    case 'var':
      return valores[a[0] as string] ?? null;
    case 'missing':
      return a.filter((n) => (valores[n as string] ?? null) === null);
    case 'and':
      return a.every((_, i) => verdadeiro(av(i)));
    case 'or':
      return a.some((_, i) => verdadeiro(av(i)));
    case '!':
      return !verdadeiro(av(0));
    case 'in': {
      const v = av(0);
      const lista = av(1);
      return v !== null && Array.isArray(lista) && lista.includes(v);
    }
  }
  const x = av(0);
  const y = av(1);
  if (x === null || y === null || x === undefined || y === undefined) return false;
  switch (op) {
    case '==':
      return x === y;
    case '!=':
      return x !== y;
    case '<':
      return (x as number) < (y as number);
    case '<=':
      return (x as number) <= (y as number);
    case '>':
      return (x as number) > (y as number);
    case '>=':
      return (x as number) >= (y as number);
  }
  throw new ErroRegraClassificacao(`operação não permitida: ${op}`);
}

/** A regra está satisfeita pelos valores? Regra inválida é erro (o protocolo publicado nunca a tem). */
export function regraSatisfeita(regra: unknown, valores: ValoresClassificacao): boolean {
  const p = problemasDaRegra(regra);
  if (p.length > 0) throw new ErroRegraClassificacao(p.join('; '));
  return verdadeiro(avaliar(regra as RegraClassificacao, valores));
}
