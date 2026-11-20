// Conversor das expressões Pascal-script do formulário para JSON Logic (regra 5 da ficha do M22; cap-11 §11.1):
// o programa (atribuições a variáveis locais e a `result`, if/else, blocos) é traduzido por EXECUÇÃO SIMBÓLICA:
// cada variável vira a expressão que a calcula; o `if` junta os dois ramos num `if` do JSON Logic por variável.
// O resultado é a expressão de `result`. O formulário só habilita/desabilita e calcula (o Delphi não apaga valor):
// uma regra que não converte fica pendente (campo habilitado, sem cálculo) e vai ao relatório do conversor.
import type { RegraLogica } from './json-logic.js';
import { type Comando, ehContexto, ErroExpressao, lerPrograma, type No, nomeCanonico } from './pascal.js';

export interface ExpressaoConvertida {
  readonly convertida: boolean;
  /** JSON Logic de `result` (null: o programa não atribui `result`). */
  readonly regra: RegraLogica;
  readonly motivo: string | null;
}

const FUNCAO_REGRA: Readonly<Record<string, string>> = {
  date: 'hoje',
  datetostr: 'data_texto',
  strtodate: 'texto_data',
  int: 'int',
  trunc: 'int',
  round: 'arredondar',
  abs: 'abs',
  sum: 'soma',
};
const COMPARACAO: Readonly<Record<string, string>> = {
  '=': '==',
  '<>': '!=',
  '<': '<',
  '<=': '<=',
  '>': '>',
  '>=': '>=',
};

type Ambiente = Map<string, RegraLogica>;

/** Teto do tamanho da regra convertida (nós): a execução simbólica de ifs em sequência pode crescer. */
export const TETO_REGRA = 20_000;

const tamanhos = new WeakMap<object, number>();
/** Nós da regra contados como árvore (com cache por nó: a regra é um grafo com partes repetidas). */
function tamanho(r: RegraLogica | readonly RegraLogica[]): number {
  if (r === null || typeof r !== 'object') return 1;
  const c = tamanhos.get(r);
  if (c !== undefined) return c;
  let n = 1;
  for (const v of Array.isArray(r) ? r : Object.values(r)) n += tamanho(v as RegraLogica);
  tamanhos.set(r, n);
  if (n > TETO_REGRA) throw new ErroExpressao('regra convertida grande demais');
  return n;
}

function expressao(n: No, amb: Ambiente): RegraLogica {
  switch (n.t) {
    case 'num':
    case 'txt':
    case 'bool':
      return n.v;
    case 'id': {
      const nome = nomeCanonico(n.nome);
      if (ehContexto(nome)) return { var: nome };
      return amb.has(nome) ? amb.get(nome)! : null;
    }
    case 'un':
      return n.op === 'not' ? { '!': [expressao(n.a, amb)] } : { neg: [expressao(n.a, amb)] };
    case 'bin': {
      const a = expressao(n.a, amb);
      const b = expressao(n.b, amb);
      if (n.op === 'and' || n.op === 'or') return { [n.op]: [a, b] };
      const c = COMPARACAO[n.op];
      return { [c ?? n.op]: [a, b] };
    }
    case 'chamada': {
      const f = FUNCAO_REGRA[n.nome];
      if (!f) throw new ErroExpressao(`função sem tradução: ${n.nome}`);
      return { [f]: n.args.map((x) => expressao(x, amb)) };
    }
  }
}

function igual(a: RegraLogica, b: RegraLogica): boolean {
  if (a === b) return true;
  if (a === null || b === null || typeof a !== 'object' || typeof b !== 'object') return false;
  return tamanho(a) === tamanho(b) && tamanho(a) < 2_000 && JSON.stringify(a) === JSON.stringify(b);
}

function executar(c: Comando, amb: Ambiente): Ambiente {
  switch (c.t) {
    case 'vazio':
      return amb;
    case 'atrib': {
      const novo = new Map(amb);
      novo.set(nomeCanonico(c.alvo), expressao(c.e, amb));
      return novo;
    }
    case 'bloco': {
      let a = amb;
      for (const x of c.cmds) a = executar(x, a);
      return a;
    }
    case 'se': {
      const cond = expressao(c.c, amb);
      const entao = executar(c.entao, amb);
      const senao = c.senao ? executar(c.senao, amb) : amb;
      const novo = new Map(amb);
      for (const v of new Set([...entao.keys(), ...senao.keys()])) {
        const x = entao.has(v) ? entao.get(v)! : (amb.get(v) ?? null);
        const y = senao.has(v) ? senao.get(v)! : (amb.get(v) ?? null);
        const r: RegraLogica = x === y || igual(x, y) ? x : { if: [cond, x, y] };
        tamanho(r);
        novo.set(v, r);
      }
      return novo;
    }
  }
}

/** Converte a fonte de uma expressão do formulário. Nunca lança: o que não converte volta com o motivo. */
export function converterExpressao(fonte: string): ExpressaoConvertida {
  if (fonte.trim() === '') return { convertida: true, regra: null, motivo: null };
  try {
    const amb = executar(lerPrograma(fonte), new Map());
    const regra = amb.has('result') ? amb.get('result')! : null;
    tamanho(regra);
    return { convertida: true, regra, motivo: null };
  } catch (e) {
    return {
      convertida: false,
      regra: null,
      motivo: e instanceof ErroExpressao ? e.message : 'expressão ilegível',
    };
  }
}
