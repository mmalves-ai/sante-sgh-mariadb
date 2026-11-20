// Leitor de XML seguro (regra 4 da ficha do M15; segurança: "XML com entidade externa recusado"). Os XML do
// prontuário (o formulário do registro e o documento como emitido) são lidos por este leitor mínimo, sem
// biblioteca: DOCTYPE e declaração de entidade são RECUSADOS (nenhuma entidade externa, nenhuma expansão);
// só as cinco entidades predefinidas e as referências numéricas são decodificadas; entidade desconhecida
// recusa o documento. Tetos de tamanho, profundidade e elementos impedem abuso.

export const TETO_XML = 32_000_000;
export const TETO_PROFUNDIDADE = 64;
export const TETO_ELEMENTOS = 200_000;

export interface ElementoXml {
  readonly nome: string;
  readonly atributos: Readonly<Record<string, string>>;
  readonly filhos: readonly (ElementoXml | string)[];
}

export class ErroXml extends Error {
  override readonly name = 'ErroXml';
}

const PREDEFINIDAS: Readonly<Record<string, string>> = {
  lt: '<',
  gt: '>',
  amp: '&',
  quot: '"',
  apos: "'",
};

/** Decodifica as entidades predefinidas e numéricas; qualquer outra recusa. */
export function decodificarEntidades(s: string): string {
  if (!s.includes('&')) return s;
  return s.replace(/&(#x[0-9a-fA-F]{1,6}|#\d{1,7}|[A-Za-z][A-Za-z0-9]{0,30});/g, (_m, ref: string) => {
    if (ref.startsWith('#x') || ref.startsWith('#X')) return codigo(parseInt(ref.slice(2), 16));
    if (ref.startsWith('#')) return codigo(parseInt(ref.slice(1), 10));
    const v = PREDEFINIDAS[ref];
    if (v === undefined) throw new ErroXml(`Entidade não permitida: &${ref.slice(0, 20)};`);
    return v;
  });
}

function codigo(n: number): string {
  if (!Number.isFinite(n) || n < 0 || n > 0x10ffff || (n >= 0xd800 && n <= 0xdfff))
    throw new ErroXml('Referência de caractere inválida.');
  return String.fromCodePoint(n);
}

const NOME = /^[A-Za-z_][\w.:-]*/;

/** Lê o documento e devolve o elemento raiz. */
export function lerXml(xml: string): ElementoXml {
  if (xml.length > TETO_XML) throw new ErroXml('Documento acima do teto de tamanho.');
  if (/<!DOCTYPE/i.test(xml)) throw new ErroXml('DOCTYPE não é permitido (entidade externa recusada).');
  if (/<!ENTITY/i.test(xml)) throw new ErroXml('Declaração de entidade não é permitida.');
  let i = 0;
  const n = xml.length;
  let elementos = 0;
  const pilha: { nome: string; atributos: Record<string, string>; filhos: (ElementoXml | string)[] }[] = [];
  let raiz: ElementoXml | null = null;
  const texto = (t: string) => {
    const topo = pilha[pilha.length - 1];
    if (!topo) {
      if (t.trim()) throw new ErroXml('Texto fora do elemento raiz.');
      return;
    }
    topo.filhos.push(t);
  };
  while (i < n) {
    const lt = xml.indexOf('<', i);
    if (lt < 0) {
      texto(decodificarEntidades(xml.slice(i)));
      break;
    }
    if (lt > i) texto(decodificarEntidades(xml.slice(i, lt)));
    if (xml.startsWith('<?', lt)) {
      const fim = xml.indexOf('?>', lt + 2);
      if (fim < 0) throw new ErroXml('Instrução de processamento sem fim.');
      i = fim + 2;
      continue;
    }
    if (xml.startsWith('<!--', lt)) {
      const fim = xml.indexOf('-->', lt + 4);
      if (fim < 0) throw new ErroXml('Comentário sem fim.');
      i = fim + 3;
      continue;
    }
    if (xml.startsWith('<![CDATA[', lt)) {
      const fim = xml.indexOf(']]>', lt + 9);
      if (fim < 0) throw new ErroXml('CDATA sem fim.');
      texto(xml.slice(lt + 9, fim));
      i = fim + 3;
      continue;
    }
    if (xml.startsWith('<!', lt)) throw new ErroXml('Declaração não permitida.');
    if (xml.startsWith('</', lt)) {
      const fim = xml.indexOf('>', lt + 2);
      if (fim < 0) throw new ErroXml('Fechamento sem fim.');
      const nome = xml.slice(lt + 2, fim).trim();
      const topo = pilha.pop();
      if (!topo || topo.nome !== nome) throw new ErroXml(`Fechamento fora de ordem: ${nome.slice(0, 40)}.`);
      const el: ElementoXml = { nome: topo.nome, atributos: topo.atributos, filhos: topo.filhos };
      const pai = pilha[pilha.length - 1];
      if (pai) pai.filhos.push(el);
      else raiz = el;
      i = fim + 1;
      continue;
    }
    // Abertura.
    let j = lt + 1;
    const m = NOME.exec(xml.slice(j, j + 200));
    if (!m) throw new ErroXml('Nome de elemento inválido.');
    const nome = m[0];
    j += nome.length;
    const atributos: Record<string, string> = {};
    for (;;) {
      while (j < n && /\s/.test(xml[j]!)) j++;
      if (xml[j] === '>' || xml.startsWith('/>', j)) break;
      const a = NOME.exec(xml.slice(j, j + 200));
      if (!a) throw new ErroXml('Atributo inválido.');
      j += a[0].length;
      while (j < n && /\s/.test(xml[j]!)) j++;
      if (xml[j] !== '=') throw new ErroXml('Atributo sem valor.');
      j++;
      while (j < n && /\s/.test(xml[j]!)) j++;
      const aspa = xml[j];
      if (aspa !== '"' && aspa !== "'") throw new ErroXml('Valor de atributo sem aspas.');
      const fim = xml.indexOf(aspa, j + 1);
      if (fim < 0) throw new ErroXml('Valor de atributo sem fim.');
      atributos[a[0]] = decodificarEntidades(xml.slice(j + 1, fim));
      j = fim + 1;
    }
    if (++elementos > TETO_ELEMENTOS) throw new ErroXml('Elementos acima do teto.');
    if (pilha.length >= TETO_PROFUNDIDADE) throw new ErroXml('Profundidade acima do teto.');
    if (raiz && pilha.length === 0) throw new ErroXml('Mais de um elemento raiz.');
    if (xml.startsWith('/>', j)) {
      const el: ElementoXml = { nome, atributos, filhos: [] };
      const pai = pilha[pilha.length - 1];
      if (pai) pai.filhos.push(el);
      else raiz = el;
      i = j + 2;
      continue;
    }
    pilha.push({ nome, atributos, filhos: [] });
    i = j + 1;
  }
  if (pilha.length > 0) throw new ErroXml(`Elemento sem fechamento: ${pilha[pilha.length - 1]!.nome}.`);
  if (!raiz) throw new ErroXml('Documento sem elemento raiz.');
  return raiz;
}

export function filhosElemento(el: ElementoXml, nome?: string): ElementoXml[] {
  return el.filhos.filter((f): f is ElementoXml => typeof f !== 'string' && (!nome || f.nome === nome));
}

export function filho(el: ElementoXml, nome: string): ElementoXml | null {
  return filhosElemento(el, nome)[0] ?? null;
}

/** Texto do elemento (concatenação dos nós de texto diretos e dos filhos). */
export function textoXml(el: ElementoXml | null): string {
  if (!el) return '';
  return el.filhos.map((f) => (typeof f === 'string' ? f : textoXml(f))).join('');
}

/** O elemento só tem texto (nenhum filho elemento). */
export function soTexto(el: ElementoXml): boolean {
  return el.filhos.every((f) => typeof f === 'string');
}

/** Primeiro elemento com o nome, em profundidade. */
export function procurar(el: ElementoXml, nome: string): ElementoXml | null {
  for (const f of filhosElemento(el)) {
    if (f.nome === nome) return f;
    const x = procurar(f, nome);
    if (x) return x;
  }
  return null;
}
