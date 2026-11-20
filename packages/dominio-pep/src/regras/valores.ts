// Semântica dos valores das expressões do formulário (variantes do Pascal-script do formulário de origem),
// compartilhada pelo interpretador de referência e pelo avaliador de JSON Logic: os dois chamam AS MESMAS funções
// primitivas, e o teste de regressão confere a tradução da estrutura (atribuições, if/else, variáveis locais).
//   - número: double; data: TDateTime (dias desde 30/12/1899; 0 = data vazia, que vira '30/12/1899');
//   - texto 'DD/MM/AAAA' em conta vira data; texto numérico vira número; '+' entre textos concatena;
//   - divisão por zero e operação sem sentido dão `null` (o campo calculado fica sem valor, sem erro);
//   - `Round` arredonda como o Delphi (ao par, "banker's rounding").

export type Valor = number | string | boolean | null;

const UM_DIA_MS = 86_400_000;
const BASE_TDATETIME = Date.UTC(1899, 11, 30);

/** AAAA-MM-DD → TDateTime (dias desde 30/12/1899). */
export function dataParaDias(iso: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return null;
  const t = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return Number.isFinite(t) ? Math.round((t - BASE_TDATETIME) / UM_DIA_MS) : null;
}

/** TDateTime → 'DD/MM/AAAA' (como DateToStr no formato do Brasil). */
export function diasParaTexto(dias: number): string {
  const d = new Date(BASE_TDATETIME + Math.trunc(dias) * UM_DIA_MS);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(d.getUTCDate())}/${p(d.getUTCMonth() + 1)}/${d.getUTCFullYear()}`;
}

/** 'DD/MM/AAAA' → TDateTime, ou null. */
export function textoParaDias(s: string): number | null {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(s.trim());
  if (!m) return null;
  return dataParaDias(`${m[3]}-${m[2]}-${m[1]}`);
}

/** Valor em número (texto de data vira TDateTime; lógico vira 0/1); null quando não converte. */
export function comoNumero(v: Valor): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v === 'boolean') return v ? 1 : 0;
  if (v === null) return null;
  const s = v.trim().replace(',', '.');
  if (/^-?\d+(\.\d+)?$/.test(s)) return Number(s);
  return textoParaDias(v);
}

export function verdadeiro(v: Valor): boolean {
  if (typeof v === 'boolean') return v;
  if (typeof v === 'number') return v !== 0;
  if (typeof v === 'string') return v !== '';
  return false;
}

/** Banker's rounding (Round do Delphi). */
export function arredondarPar(x: number): number {
  const f = Math.floor(x);
  const d = x - f;
  if (Math.abs(d - 0.5) < 1e-12) return f % 2 === 0 ? f : f + 1;
  return Math.round(x);
}

export type OpAritmetica = '+' | '-' | '*' | '/' | 'div' | 'mod';

export function aritmetica(op: OpAritmetica, a: Valor, b: Valor): Valor {
  if (
    op === '+' &&
    typeof a === 'string' &&
    typeof b === 'string' &&
    (comoNumero(a) === null || comoNumero(b) === null)
  )
    return a + b;
  const x = comoNumero(a);
  const y = comoNumero(b);
  if (x === null || y === null) return null;
  switch (op) {
    case '+':
      return x + y;
    case '-':
      return x - y;
    case '*':
      return x * y;
    case '/':
      return y === 0 ? null : x / y;
    case 'div':
      return y === 0 ? null : Math.trunc(x / y);
    case 'mod':
      return y === 0 ? null : Math.trunc(x) % Math.trunc(y);
  }
}

export type OpComparacao = '=' | '<>' | '<' | '<=' | '>' | '>=';

export function comparar(op: OpComparacao, a: Valor, b: Valor): boolean {
  let x: number | string;
  let y: number | string;
  const na = comoNumero(a);
  const nb = comoNumero(b);
  if (typeof a === 'string' && typeof b === 'string') {
    x = a;
    y = b;
  } else if (na !== null && nb !== null) {
    x = na;
    y = nb;
  } else {
    x = a === null ? '' : String(a);
    y = b === null ? '' : String(b);
  }
  switch (op) {
    case '=':
      return x === y;
    case '<>':
      return x !== y;
    case '<':
      return x < y;
    case '<=':
      return x <= y;
    case '>':
      return x > y;
    case '>=':
      return x >= y;
  }
}

export function negativo(a: Valor): Valor {
  const x = comoNumero(a);
  return x === null ? null : -x;
}

export interface ContextoRegras {
  /** Valores do formulário e do paciente (cmpNNN, cmpNNNItemIndex, PacienteIdade, PacienteSexo). */
  readonly valores: Readonly<Record<string, Valor>>;
  /** Hoje (AAAA-MM-DD) no fuso do estabelecimento (Date()). */
  readonly hoje: string;
}

/** Funções do formulário (nomes em minúsculas). */
export function chamar(nome: string, args: readonly Valor[], ctx: ContextoRegras): Valor {
  const [a] = args;
  switch (nome) {
    case 'date':
      return dataParaDias(ctx.hoje);
    case 'datetostr': {
      const x = comoNumero(a ?? null);
      return x === null ? null : diasParaTexto(x);
    }
    case 'strtodate':
      return typeof a === 'string' ? textoParaDias(a) : comoNumero(a ?? null);
    case 'int':
    case 'trunc': {
      const x = comoNumero(a ?? null);
      return x === null ? null : Math.trunc(x);
    }
    case 'round': {
      const x = comoNumero(a ?? null);
      return x === null ? null : arredondarPar(x);
    }
    case 'abs': {
      const x = comoNumero(a ?? null);
      return x === null ? null : Math.abs(x);
    }
    case 'sum': {
      let s = 0;
      for (const v of args) {
        const x = comoNumero(v);
        if (x === null) return null;
        s += x;
      }
      return s;
    }
    default:
      return null;
  }
}
