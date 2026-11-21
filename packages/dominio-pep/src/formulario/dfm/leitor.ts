// Leitor do formato texto do DFM do Delphi (cap-11 §11.1; ref 04 §3). O formulário de origem guarda cada
// componente do layout do modelo como texto DFM (já decodificado do CP1252 pelo adaptador).
// Gramática coberta: objetos `object|inherited|inline Nome: Classe [indice]` aninhados até `end`;
// propriedades `Nome(.Sub)* = valor`; valores texto ('…' com '' e #NNN, concatenados por +), número,
// identificador, conjunto [a, b], lista ( … ), binário { … } e coleção < item … end >.
// Regra pura: sem banco, sem Nest, sem HTTP.

export type ValorDfm =
  | { readonly tipo: 'texto'; readonly valor: string }
  | { readonly tipo: 'numero'; readonly valor: number }
  | { readonly tipo: 'identificador'; readonly valor: string }
  | { readonly tipo: 'conjunto'; readonly valor: readonly string[] }
  | { readonly tipo: 'lista'; readonly valor: readonly ValorDfm[] }
  | { readonly tipo: 'binario'; readonly bytes: number }
  | { readonly tipo: 'colecao'; readonly valor: readonly Readonly<Record<string, ValorDfm>>[] };

export interface ObjetoDfm {
  readonly especie: 'object' | 'inherited' | 'inline';
  readonly nome: string;
  readonly classe: string;
  readonly propriedades: Readonly<Record<string, ValorDfm>>;
  readonly filhos: readonly ObjetoDfm[];
}

export class ErroDfm extends Error {
  override readonly name = 'ErroDfm';
}

type Simbolo = '=' | ':' | '[' | ']' | '(' | ')' | '<' | '>' | '+' | ',';
type Token =
  | { readonly t: 'id'; readonly v: string; readonly linha: number }
  | { readonly t: 'num'; readonly v: number; readonly linha: number }
  | { readonly t: 'txt'; readonly v: string; readonly linha: number }
  | { readonly t: 'bin'; readonly v: number; readonly linha: number }
  | { readonly t: 'sim'; readonly v: Simbolo; readonly linha: number };

const SIMBOLOS = new Set(['=', ':', '[', ']', '(', ')', '<', '>', '+', ',']);

/** Quebra o texto em tokens. Texto: trechos '…' e #NNN colados formam um só token. */
export function tokenizar(fonte: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  let linha = 1;
  const n = fonte.length;
  while (i < n) {
    const c = fonte[i]!;
    if (c === '\n') {
      linha++;
      i++;
      continue;
    }
    if (c === ' ' || c === '\t' || c === '\r') {
      i++;
      continue;
    }
    if (c === "'" || c === '#') {
      let texto = '';
      while (i < n && (fonte[i] === "'" || fonte[i] === '#')) {
        if (fonte[i] === '#') {
          i++;
          const m = /^(\$[0-9a-fA-F]+|\d+)/.exec(fonte.slice(i, i + 12));
          if (!m) throw new ErroDfm(`Linha ${linha}: código de caractere inválido depois de #.`);
          const codigo = m[1]!.startsWith('$') ? parseInt(m[1]!.slice(1), 16) : parseInt(m[1]!, 10);
          texto += String.fromCodePoint(codigo);
          i += m[1]!.length;
        } else {
          i++; // abre aspas
          for (;;) {
            if (i >= n || fonte[i] === '\n') throw new ErroDfm(`Linha ${linha}: texto sem fechar aspas.`);
            if (fonte[i] === "'") {
              if (fonte[i + 1] === "'") {
                texto += "'";
                i += 2;
                continue;
              }
              i++;
              break;
            }
            texto += fonte[i];
            i++;
          }
        }
      }
      tokens.push({ t: 'txt', v: texto, linha });
      continue;
    }
    if (c === '{') {
      const fim = fonte.indexOf('}', i);
      if (fim < 0) throw new ErroDfm(`Linha ${linha}: binário sem fechar chaves.`);
      const hex = fonte.slice(i + 1, fim).replace(/\s+/g, '');
      if (!/^[0-9a-fA-F]*$/.test(hex))
        throw new ErroDfm(`Linha ${linha}: binário com caractere não hexadecimal.`);
      linha += (fonte.slice(i, fim).match(/\n/g) ?? []).length;
      tokens.push({ t: 'bin', v: hex.length / 2, linha });
      i = fim + 1;
      continue;
    }
    if (SIMBOLOS.has(c)) {
      tokens.push({ t: 'sim', v: c as Simbolo, linha });
      i++;
      continue;
    }
    const num = /^-?(?:\d+\.?\d*(?:[eE][-+]?\d+)?|\$[0-9a-fA-F]+)/.exec(fonte.slice(i, i + 40));
    if (num && (c === '-' || /\d|\$/.test(c))) {
      const bruto = num[0];
      const valor = bruto.includes('$') ? parseInt(bruto.replace('$', ''), 16) : Number(bruto);
      tokens.push({ t: 'num', v: valor, linha });
      i += bruto.length;
      continue;
    }
    const id = /^[A-Za-z_][A-Za-z0-9_.]*/.exec(fonte.slice(i, i + 200));
    if (id) {
      tokens.push({ t: 'id', v: id[0], linha });
      i += id[0].length;
      continue;
    }
    throw new ErroDfm(`Linha ${linha}: caractere inesperado "${c}".`);
  }
  return tokens;
}

const ESPECIES = new Set(['object', 'inherited', 'inline']);

class Parser {
  private p = 0;
  private readonly tokens: readonly Token[];
  constructor(tokens: readonly Token[]) {
    this.tokens = tokens;
  }

  private olhar(desloc = 0): Token | undefined {
    return this.tokens[this.p + desloc];
  }

  private proximo(): Token {
    const t = this.tokens[this.p++];
    if (!t) throw new ErroDfm('Fim inesperado do DFM.');
    return t;
  }

  private esperarSimbolo(s: Simbolo): void {
    const t = this.proximo();
    if (t.t !== 'sim' || t.v !== s) throw new ErroDfm(`Linha ${t.linha}: esperado "${s}".`);
  }

  private esperarId(): string {
    const t = this.proximo();
    if (t.t !== 'id') throw new ErroDfm(`Linha ${t.linha}: esperado identificador.`);
    return t.v;
  }

  private ehSimbolo(s: Simbolo, desloc = 0): boolean {
    const t = this.olhar(desloc);
    return t?.t === 'sim' && t.v === s;
  }

  fim(): boolean {
    return this.p >= this.tokens.length;
  }

  objeto(): ObjetoDfm {
    const especie = this.esperarId().toLowerCase();
    if (!ESPECIES.has(especie)) throw new ErroDfm(`Esperado object, inherited ou inline; veio "${especie}".`);
    const primeiro = this.esperarId();
    let nome = '';
    let classe = primeiro;
    if (this.ehSimbolo(':')) {
      this.proximo();
      nome = primeiro;
      classe = this.esperarId();
    }
    if (this.ehSimbolo('[')) {
      this.proximo();
      this.proximo(); // índice do componente herdado
      this.esperarSimbolo(']');
    }
    const propriedades: Record<string, ValorDfm> = {};
    const filhos: ObjetoDfm[] = [];
    for (;;) {
      const t = this.olhar();
      if (!t) throw new ErroDfm(`Objeto ${nome || classe} sem "end".`);
      if (t.t === 'id' && t.v.toLowerCase() === 'end') {
        this.proximo();
        break;
      }
      if (t.t === 'id' && ESPECIES.has(t.v.toLowerCase()) && this.olhar(1)?.t === 'id') {
        filhos.push(this.objeto());
        continue;
      }
      const chave = this.esperarId();
      this.esperarSimbolo('=');
      propriedades[chave] = this.valor();
    }
    return { especie: especie as ObjetoDfm['especie'], nome, classe, propriedades, filhos };
  }

  private texto(primeiro: string): string {
    let s = primeiro;
    while (this.ehSimbolo('+') && this.olhar(1)?.t === 'txt') {
      this.proximo();
      s += (this.proximo() as { v: string }).v;
    }
    return s;
  }

  valor(): ValorDfm {
    const t = this.proximo();
    switch (t.t) {
      case 'txt':
        return { tipo: 'texto', valor: this.texto(t.v) };
      case 'num':
        return { tipo: 'numero', valor: t.v };
      case 'bin':
        return { tipo: 'binario', bytes: t.v };
      case 'id':
        return { tipo: 'identificador', valor: t.v };
      case 'sim':
        break;
    }
    if (t.v === '[') {
      const itens: string[] = [];
      while (!this.ehSimbolo(']')) {
        const x = this.proximo();
        if (x.t === 'sim' && x.v === ',') continue;
        if (x.t === 'id' || x.t === 'num' || x.t === 'txt') itens.push(String(x.v));
        else throw new ErroDfm(`Linha ${x.linha}: conjunto inválido.`);
      }
      this.proximo();
      return { tipo: 'conjunto', valor: itens };
    }
    if (t.v === '(') {
      const itens: ValorDfm[] = [];
      while (!this.ehSimbolo(')')) itens.push(this.valor());
      this.proximo();
      return { tipo: 'lista', valor: itens };
    }
    if (t.v === '<') {
      const itens: Record<string, ValorDfm>[] = [];
      while (!this.ehSimbolo('>')) {
        const marca = this.esperarId();
        if (marca.toLowerCase() !== 'item') throw new ErroDfm(`Linha ${t.linha}: coleção sem "item".`);
        const props: Record<string, ValorDfm> = {};
        for (;;) {
          const x = this.olhar();
          if (x?.t === 'id' && x.v.toLowerCase() === 'end') {
            this.proximo();
            break;
          }
          const chave = this.esperarId();
          this.esperarSimbolo('=');
          props[chave] = this.valor();
        }
        itens.push(props);
      }
      this.proximo();
      return { tipo: 'colecao', valor: itens };
    }
    throw new ErroDfm(`Linha ${t.linha}: valor inesperado "${t.v}".`);
  }
}

/** Lê um DFM em texto (um objeto raiz). */
export function lerDfm(fonte: string): ObjetoDfm {
  const parser = new Parser(tokenizar(fonte));
  const raiz = parser.objeto();
  if (!parser.fim()) throw new ErroDfm('Conteúdo depois do "end" do objeto raiz.');
  return raiz;
}

/** Valor como texto (texto, identificador ou número); undefined se ausente ou de outro tipo. */
export function textoDe(v: ValorDfm | undefined): string | undefined {
  if (!v) return undefined;
  if (v.tipo === 'texto' || v.tipo === 'identificador') return v.valor;
  if (v.tipo === 'numero') return String(v.valor);
  return undefined;
}

export function numeroDe(v: ValorDfm | undefined): number | undefined {
  if (v?.tipo === 'numero') return v.valor;
  if (v?.tipo === 'texto' && /^-?\d+$/.test(v.valor.trim())) return Number(v.valor.trim());
  return undefined;
}

export function logicoDe(v: ValorDfm | undefined): boolean | undefined {
  if (v?.tipo !== 'identificador') return undefined;
  if (/^true$/i.test(v.valor)) return true;
  if (/^false$/i.test(v.valor)) return false;
  return undefined;
}

/** Lista de textos (Items.Strings = ( '…' '…' )). */
export function listaTextos(v: ValorDfm | undefined): string[] | undefined {
  if (v?.tipo !== 'lista') return undefined;
  return v.valor.map((x) => textoDe(x) ?? '');
}

/** Primeiro descendente (busca em profundidade) com o nome dado. */
export function filhoPorNome(o: ObjetoDfm, nome: string): ObjetoDfm | undefined {
  for (const f of o.filhos) {
    if (f.nome === nome) return f;
    const achado = filhoPorNome(f, nome);
    if (achado) return achado;
  }
  return undefined;
}
