// Avaliador de JSON Logic (jsonlogic.com) no subconjunto que as regras convertidas usam, sem dependência externa:
// `var`, `if`, comparações, `and`/`or`/`!`, aritmética e as operações próprias do formulário (`data_texto`,
// `texto_data`, `hoje`, `int`, `arredondar`, `abs`, `soma`, `neg`, `div`, `mod`). Puro: roda na tela (habilitar
// e calcular enquanto se digita) e no servidor (o mesmo resultado ao finalizar). Operação desconhecida é erro
// (a regra não é aplicada; o campo fica habilitado e sem cálculo, com aviso ao administrador).
import {
  aritmetica,
  chamar,
  comparar,
  type ContextoRegras,
  type OpAritmetica,
  type OpComparacao,
  negativo,
  type Valor,
  verdadeiro,
} from './valores.js';

export type RegraLogica = Valor | { readonly [op: string]: readonly RegraLogica[] | RegraLogica };

export class ErroRegra extends Error {
  override readonly name = 'ErroRegra';
}

const COMPARACOES: Readonly<Record<string, OpComparacao>> = {
  '==': '=',
  '!=': '<>',
  '<': '<',
  '<=': '<=',
  '>': '>',
  '>=': '>=',
};
const ARITMETICAS: Readonly<Record<string, OpAritmetica>> = {
  '+': '+',
  '-': '-',
  '*': '*',
  '/': '/',
  div: 'div',
  mod: 'mod',
};
const FUNCOES: Readonly<Record<string, string>> = {
  data_texto: 'datetostr',
  texto_data: 'strtodate',
  hoje: 'date',
  int: 'int',
  arredondar: 'round',
  abs: 'abs',
  soma: 'sum',
};

/** Operações aceitas (o conversor só produz estas). */
export const OPERACOES_REGRA: ReadonlySet<string> = new Set([
  'var',
  'if',
  'and',
  'or',
  '!',
  'neg',
  ...Object.keys(COMPARACOES),
  ...Object.keys(ARITMETICAS),
  ...Object.keys(FUNCOES),
]);

function argumentos(x: RegraLogica | readonly RegraLogica[]): readonly RegraLogica[] {
  return Array.isArray(x) ? x : [x as RegraLogica];
}

export function avaliarRegra(regra: RegraLogica, ctx: ContextoRegras): Valor {
  if (regra === null || typeof regra !== 'object') return regra;
  const chaves = Object.keys(regra);
  if (chaves.length !== 1) throw new ErroRegra('regra com mais de uma operação no mesmo nó');
  const op = chaves[0]!;
  const args = argumentos((regra as Record<string, RegraLogica | readonly RegraLogica[]>)[op]!);
  const av = (i: number) => avaliarRegra(args[i] ?? null, ctx);
  switch (op) {
    case 'var': {
      const nome = args[0];
      if (typeof nome !== 'string') throw new ErroRegra('var sem nome');
      return ctx.valores[nome] ?? null;
    }
    case 'if': {
      for (let i = 0; i + 1 < args.length; i += 2) if (verdadeiro(av(i))) return av(i + 1);
      return args.length % 2 === 1 ? av(args.length - 1) : null;
    }
    case 'and':
      return args.every((_, i) => verdadeiro(av(i)));
    case 'or':
      return args.some((_, i) => verdadeiro(av(i)));
    case '!':
      return !verdadeiro(av(0));
    case 'neg':
      return negativo(av(0));
  }
  const c = COMPARACOES[op];
  if (c) return comparar(c, av(0), av(1));
  const a = ARITMETICAS[op];
  if (a) {
    if (args.length === 1 && op === '-') return negativo(av(0));
    let r = av(0);
    for (let i = 1; i < args.length; i++) r = aritmetica(a, r, av(i));
    return r;
  }
  const f = FUNCOES[op];
  if (f)
    return chamar(
      f,
      args.map((_, i) => av(i)),
      ctx,
    );
  throw new ErroRegra(`operação desconhecida: ${op}`);
}

/** Variáveis (`var`) que a regra lê (para recalcular só quando uma delas muda). */
export function variaveisDaRegra(regra: RegraLogica): string[] {
  const vistas = new Set<string>();
  const visitar = (r: RegraLogica | readonly RegraLogica[]) => {
    if (Array.isArray(r)) {
      for (const x of r) visitar(x);
      return;
    }
    if (r === null || typeof r !== 'object') return;
    for (const [op, v] of Object.entries(r)) {
      if (op === 'var') {
        const n = argumentos(v as RegraLogica)[0];
        if (typeof n === 'string') vistas.add(n);
      } else visitar(v as RegraLogica);
    }
  };
  visitar(regra);
  return [...vistas].sort();
}
