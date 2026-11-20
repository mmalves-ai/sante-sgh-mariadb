// Leitor das expressões Pascal-script dos componentes do formulário de origem (ExpressionEnabled = habilitar e
// ExpressionValue = calcular; regra 5 da ficha do M22; cap-11 §11.1; ref 04 §3.3). É o subconjunto que os 67
// modelos usam (inventário do M09: 146 de habilitar e 124 de calcular): atribuição `x := e`, `if … then …
// [else …]`, `begin … end`, `;`; números, textos ('…' ou "…"), identificadores (componentes `cmpNNN`, o índice
// escolhido `cmpNNNItemIndex`, PacienteIdade, PacienteSexo, variáveis locais, `result`) e chamadas (Date(),
// DateToStr, StrToDate, int, Sum, Round, Trunc, Abs). Comentários `//`, `{ }` e `(* *)` são descartados.
//
// Precedência: `not` e `-` unários; `* / div mod`; `+ -`; comparações; `and`; `or`. A escrita dos formulários
// pressupõe `and`/`or` abaixo da comparação (ex.: `cmp757 <> 0 and cmp758 <> 0`), como em C; em Pascal estrito
// `and` ligaria antes e a expressão não faria sentido (decisão D-REG-1 nas evidências do M22).

export type No =
  | { readonly t: 'num'; readonly v: number }
  | { readonly t: 'txt'; readonly v: string }
  | { readonly t: 'bool'; readonly v: boolean }
  | { readonly t: 'id'; readonly nome: string }
  | { readonly t: 'un'; readonly op: 'not' | '-'; readonly a: No }
  | { readonly t: 'bin'; readonly op: OperadorBinario; readonly a: No; readonly b: No }
  | { readonly t: 'chamada'; readonly nome: string; readonly args: readonly No[] };

export type OperadorBinario =
  '+' | '-' | '*' | '/' | 'div' | 'mod' | '=' | '<>' | '<' | '<=' | '>' | '>=' | 'and' | 'or';

export type Comando =
  | { readonly t: 'atrib'; readonly alvo: string; readonly e: No }
  | { readonly t: 'se'; readonly c: No; readonly entao: Comando; readonly senao: Comando | null }
  | { readonly t: 'bloco'; readonly cmds: readonly Comando[] }
  | { readonly t: 'vazio' };

export class ErroExpressao extends Error {
  override readonly name = 'ErroExpressao';
}

/** Funções conhecidas (nome normalizado em minúsculas → aridade mínima e máxima). */
export const FUNCOES: Readonly<Record<string, readonly [number, number]>> = {
  date: [0, 0],
  datetostr: [1, 1],
  strtodate: [1, 1],
  int: [1, 1],
  trunc: [1, 1],
  round: [1, 1],
  abs: [1, 1],
  sum: [1, 30],
};

/** Remove comentários (`//` até o fim da linha, `{ … }`, `(* … *)`), preservando os textos entre aspas. */
export function semComentarios(fonte: string): string {
  let s = '';
  let i = 0;
  while (i < fonte.length) {
    const c = fonte[i]!;
    if (c === "'" || c === '"') {
      const fim = fonte.indexOf(c, i + 1);
      const j = fim < 0 ? fonte.length : fim + 1;
      s += fonte.slice(i, j);
      i = j;
    } else if (c === '/' && fonte[i + 1] === '/') {
      const fim = fonte.indexOf('\n', i);
      i = fim < 0 ? fonte.length : fim;
      s += ' ';
    } else if (c === '{') {
      const fim = fonte.indexOf('}', i);
      i = fim < 0 ? fonte.length : fim + 1;
      s += ' ';
    } else if (c === '(' && fonte[i + 1] === '*') {
      const fim = fonte.indexOf('*)', i + 2);
      i = fim < 0 ? fonte.length : fim + 2;
      s += ' ';
    } else {
      s += c;
      i++;
    }
  }
  return s;
}

type Token =
  | { k: 'num'; v: number }
  | { k: 'txt'; v: string }
  | { k: 'id'; v: string }
  | { k: 'op'; v: string }
  | { k: 'fim' };

const PALAVRAS = new Set([
  'if',
  'then',
  'else',
  'begin',
  'end',
  'and',
  'or',
  'not',
  'div',
  'mod',
  'true',
  'false',
]);

function tokens(fonte: string): Token[] {
  const r: Token[] = [];
  const s = semComentarios(fonte);
  let i = 0;
  while (i < s.length) {
    const c = s[i]!;
    if (/\s/.test(c)) {
      i++;
      continue;
    }
    if (/\d/.test(c)) {
      const m = /^\d+(?:\.\d+)?/.exec(s.slice(i))!;
      r.push({ k: 'num', v: Number(m[0]) });
      i += m[0].length;
      continue;
    }
    if (c === "'" || c === '"') {
      const fim = s.indexOf(c, i + 1);
      if (fim < 0) throw new ErroExpressao('texto sem aspas de fechamento');
      r.push({ k: 'txt', v: s.slice(i + 1, fim) });
      i = fim + 1;
      continue;
    }
    if (/[\p{L}_]/u.test(c)) {
      const m = /^[\p{L}_][\p{L}\p{N}_]*/u.exec(s.slice(i))!;
      r.push({ k: 'id', v: m[0] });
      i += m[0].length;
      continue;
    }
    const dois = s.slice(i, i + 2);
    if ([':=', '<>', '<=', '>='].includes(dois)) {
      r.push({ k: 'op', v: dois });
      i += 2;
      continue;
    }
    if ('+-*/=<>();,'.includes(c)) {
      r.push({ k: 'op', v: c });
      i++;
      continue;
    }
    throw new ErroExpressao(`caractere inesperado "${c}"`);
  }
  r.push({ k: 'fim' });
  return r;
}

class Leitor {
  private i = 0;
  private readonly ts: Token[];
  constructor(ts: Token[]) {
    this.ts = ts;
  }

  private olhar(): Token {
    return this.ts[this.i]!;
  }
  private palavra(t: Token): string | null {
    return t.k === 'id' && PALAVRAS.has(t.v.toLowerCase()) ? t.v.toLowerCase() : null;
  }
  private eh(v: string): boolean {
    const t = this.olhar();
    return (t.k === 'op' && t.v === v) || this.palavra(t) === v;
  }
  private consumir(v: string): void {
    if (!this.eh(v)) throw new ErroExpressao(`esperado "${v}"`);
    this.i++;
  }

  programa(): Comando {
    const cmds = this.lista(['fim']);
    if (this.olhar().k !== 'fim') throw new ErroExpressao('sobra depois do fim da expressão');
    return { t: 'bloco', cmds };
  }

  /** Comandos separados por `;` até um dos terminadores (`end`, fim). */
  private lista(terminadores: readonly string[]): Comando[] {
    const cmds: Comando[] = [];
    const termina = () =>
      (terminadores.includes('fim') && this.olhar().k === 'fim') ||
      terminadores.some((t) => t !== 'fim' && this.eh(t));
    while (!termina()) {
      if (this.olhar().k === 'fim') throw new ErroExpressao('esperado "end"');
      cmds.push(this.comando());
      if (this.eh(';')) {
        while (this.eh(';')) this.i++;
        continue;
      }
      if (!termina())
        throw new ErroExpressao(
          this.olhar().k === 'fim' ? 'esperado "end"' : 'esperado ";" entre os comandos',
        );
    }
    return cmds.filter((c) => c.t !== 'vazio');
  }

  private comando(): Comando {
    if (this.eh(';')) return { t: 'vazio' };
    if (this.eh('if')) {
      this.i++;
      const c = this.expressao();
      this.consumir('then');
      const entao = this.eh('else') || this.eh(';') ? { t: 'vazio' as const } : this.comando();
      let senao: Comando | null = null;
      if (this.eh('else')) {
        this.i++;
        senao = this.eh(';') || this.olhar().k === 'fim' ? { t: 'vazio' } : this.comando();
      }
      return { t: 'se', c, entao, senao };
    }
    if (this.eh('begin')) {
      this.i++;
      const cmds = this.lista(['end']);
      this.consumir('end');
      return { t: 'bloco', cmds };
    }
    const t = this.olhar();
    if (t.k === 'id' && !this.palavra(t)) {
      const prox = this.ts[this.i + 1];
      if (prox?.k === 'op' && prox.v === ':=') {
        this.i += 2;
        return { t: 'atrib', alvo: t.v, e: this.expressao() };
      }
    }
    throw new ErroExpressao('comando desconhecido (só atribuição, if e begin…end)');
  }

  expressao(): No {
    return this.ou();
  }
  private ou(): No {
    let a = this.e();
    while (this.eh('or')) {
      this.i++;
      a = { t: 'bin', op: 'or', a, b: this.e() };
    }
    return a;
  }
  private e(): No {
    let a = this.comparacao();
    while (this.eh('and')) {
      this.i++;
      a = { t: 'bin', op: 'and', a, b: this.comparacao() };
    }
    return a;
  }
  private comparacao(): No {
    let a = this.soma();
    for (;;) {
      const t = this.olhar();
      if (t.k === 'op' && ['=', '<>', '<', '<=', '>', '>='].includes(t.v)) {
        this.i++;
        a = { t: 'bin', op: t.v as OperadorBinario, a, b: this.soma() };
      } else return a;
    }
  }
  private soma(): No {
    let a = this.produto();
    for (;;) {
      const t = this.olhar();
      if (t.k === 'op' && (t.v === '+' || t.v === '-')) {
        this.i++;
        a = { t: 'bin', op: t.v, a, b: this.produto() };
      } else return a;
    }
  }
  private produto(): No {
    let a = this.unario();
    for (;;) {
      const t = this.olhar();
      const p = this.palavra(t);
      if ((t.k === 'op' && (t.v === '*' || t.v === '/')) || p === 'div' || p === 'mod') {
        this.i++;
        a = { t: 'bin', op: (p ?? (t as { v: string }).v) as OperadorBinario, a, b: this.unario() };
      } else return a;
    }
  }
  private unario(): No {
    if (this.eh('not')) {
      this.i++;
      return { t: 'un', op: 'not', a: this.unario() };
    }
    if (this.eh('-')) {
      this.i++;
      return { t: 'un', op: '-', a: this.unario() };
    }
    if (this.eh('+')) {
      this.i++;
      return this.unario();
    }
    return this.primario();
  }
  private primario(): No {
    const t = this.olhar();
    if (t.k === 'num') {
      this.i++;
      return { t: 'num', v: t.v };
    }
    if (t.k === 'txt') {
      this.i++;
      return { t: 'txt', v: t.v };
    }
    if (this.eh('(')) {
      this.i++;
      const e = this.expressao();
      this.consumir(')');
      return e;
    }
    const p = this.palavra(t);
    if (p === 'true' || p === 'false') {
      this.i++;
      return { t: 'bool', v: p === 'true' };
    }
    if (t.k === 'id' && !p) {
      this.i++;
      const nome = t.v.toLowerCase();
      if (this.eh('(') || nome === 'date') {
        const args: No[] = [];
        if (this.eh('(')) {
          this.i++;
          if (!this.eh(')')) {
            args.push(this.expressao());
            while (this.eh(',')) {
              this.i++;
              args.push(this.expressao());
            }
          }
          this.consumir(')');
        }
        const ar = FUNCOES[nome];
        if (!ar) throw new ErroExpressao(`função desconhecida ${t.v}`);
        if (args.length < ar[0] || args.length > ar[1]) throw new ErroExpressao(`aridade de ${t.v}`);
        return { t: 'chamada', nome, args };
      }
      return { t: 'id', nome: t.v };
    }
    throw new ErroExpressao('expressão incompleta');
  }
}

/** Lê a expressão de um componente. Lança ErroExpressao quando sai do subconjunto conhecido. */
export function lerPrograma(fonte: string): Comando {
  return new Leitor(tokens(fonte)).programa();
}

/** Nome canônico de identificador: componentes e contexto sem diferença de maiúsculas, locais como escritos. */
export function nomeCanonico(nome: string): string {
  const m = /^cmp(\d+)(itemindex)?$/i.exec(nome);
  if (m) return `cmp${m[1]}${m[2] ? 'ItemIndex' : ''}`;
  if (/^pacienteidade$/i.test(nome)) return 'PacienteIdade';
  if (/^pacientesexo$/i.test(nome)) return 'PacienteSexo';
  if (/^result$/i.test(nome)) return 'result';
  return nome.toLowerCase();
}

/** Variável de contexto (vem do formulário ou do paciente), em oposição a variável local do programa. */
export function ehContexto(nome: string): boolean {
  return /^cmp\d+(ItemIndex)?$/.test(nome) || nome === 'PacienteIdade' || nome === 'PacienteSexo';
}
