// Leitura de XML do transmissor do eSocial (M53.6, achado do corretor): um leitor pequeno e estrito para dois usos, o
// evento que o próprio Sante SGH gerou (para a forma canônica da assinatura) e a resposta do serviço do eSocial (envio e
// consulta do lote). Aceita a declaração, comentários, instruções de processamento, CDATA, elementos vazios
// (`<a/>`), prefixos de namespace e as entidades do XML (as cinco nomeadas e as numéricas). Recusa DOCTYPE (nenhuma
// entidade externa) e XML malformado (marca sem fechamento, fechamento trocado).

export interface NoLido {
  /** Nome qualificado, como veio (`ds:Signature`, `eSocial`). */
  readonly nome: string;
  /** Atributos na ordem do documento (as declarações `xmlns` incluídas). */
  readonly atributos: readonly (readonly [string, string])[];
  readonly filhos: readonly NoLido[];
  /** O texto do elemento (concatenado; os espaços entre elementos são descartados). */
  readonly texto: string;
}

export class ErroXml extends Error {}

const ENTIDADES: Readonly<Record<string, string>> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };

function decodificar(t: string): string {
  return t.replace(/&(#x[0-9a-fA-F]+|#\d+|[a-z]+);/g, (m, e: string) => {
    if (e.startsWith('#x')) return String.fromCodePoint(parseInt(e.slice(2), 16));
    if (e.startsWith('#')) return String.fromCodePoint(parseInt(e.slice(1), 10));
    const v = ENTIDADES[e];
    if (v === undefined) throw new ErroXml(`Entidade desconhecida: ${m}.`);
    return v;
  });
}

const NOME = /^[A-Za-z_][\w.\-:]*/;

/** Lê o documento e devolve o elemento raiz. */
export function lerXml(texto: string): NoLido {
  let i = 0;
  const s = texto.replace(/^\uFEFF/, '');
  type Aberto = { nome: string; atributos: [string, string][]; filhos: NoLido[]; texto: string };
  const pilha: Aberto[] = [];
  let raiz: NoLido | null = null;
  const fechar = (a: Aberto) => {
    const no: NoLido = {
      nome: a.nome,
      atributos: a.atributos,
      filhos: a.filhos,
      texto: a.filhos.length ? '' : a.texto,
    };
    const pai = pilha[pilha.length - 1];
    if (pai) pai.filhos.push(no);
    else if (raiz) throw new ErroXml('Mais de um elemento raiz.');
    else raiz = no;
  };
  while (i < s.length) {
    const lt = s.indexOf('<', i);
    const trecho = lt < 0 ? s.slice(i) : s.slice(i, lt);
    if (trecho.length) {
      const topo = pilha[pilha.length - 1];
      if (topo) topo.texto += decodificar(trecho);
      else if (trecho.trim() !== '') throw new ErroXml('Texto fora do elemento raiz.');
    }
    if (lt < 0) break;
    i = lt;
    if (s.startsWith('<?', i)) {
      const f = s.indexOf('?>', i);
      if (f < 0) throw new ErroXml('Instrução de processamento sem fim.');
      i = f + 2;
    } else if (s.startsWith('<!--', i)) {
      const f = s.indexOf('-->', i);
      if (f < 0) throw new ErroXml('Comentário sem fim.');
      i = f + 3;
    } else if (s.startsWith('<![CDATA[', i)) {
      const f = s.indexOf(']]>', i);
      if (f < 0) throw new ErroXml('CDATA sem fim.');
      const topo = pilha[pilha.length - 1];
      if (!topo) throw new ErroXml('CDATA fora do elemento raiz.');
      topo.texto += s.slice(i + 9, f);
      i = f + 3;
    } else if (s.startsWith('<!', i)) {
      throw new ErroXml('DOCTYPE não é aceito.');
    } else if (s.startsWith('</', i)) {
      const f = s.indexOf('>', i);
      if (f < 0) throw new ErroXml('Marca de fechamento sem fim.');
      const nome = s.slice(i + 2, f).trim();
      const a = pilha.pop();
      if (!a || a.nome !== nome) throw new ErroXml(`Fechamento inesperado: ${nome}.`);
      fechar(a);
      i = f + 1;
    } else {
      i += 1;
      const m = NOME.exec(s.slice(i));
      if (!m) throw new ErroXml('Nome de elemento inválido.');
      const nome = m[0];
      i += nome.length;
      const atributos: [string, string][] = [];
      for (;;) {
        while (/\s/.test(s[i] ?? '')) i += 1;
        if (s[i] === '/' && s[i + 1] === '>') {
          i += 2;
          pilha.push({ nome, atributos, filhos: [], texto: '' });
          fechar(pilha.pop()!);
          break;
        }
        if (s[i] === '>') {
          i += 1;
          pilha.push({ nome, atributos, filhos: [], texto: '' });
          break;
        }
        const an = NOME.exec(s.slice(i));
        if (!an) throw new ErroXml(`Atributo inválido em ${nome}.`);
        i += an[0].length;
        while (/\s/.test(s[i] ?? '')) i += 1;
        if (s[i] !== '=') throw new ErroXml(`Atributo sem valor em ${nome}.`);
        i += 1;
        while (/\s/.test(s[i] ?? '')) i += 1;
        const aspa = s[i];
        if (aspa !== '"' && aspa !== "'") throw new ErroXml(`Valor de atributo sem aspas em ${nome}.`);
        const f = s.indexOf(aspa, i + 1);
        if (f < 0) throw new ErroXml(`Valor de atributo sem fim em ${nome}.`);
        atributos.push([an[0], decodificar(s.slice(i + 1, f))]);
        i = f + 1;
      }
    }
  }
  if (pilha.length) throw new ErroXml(`Elemento sem fechamento: ${pilha[pilha.length - 1]!.nome}.`);
  if (!raiz) throw new ErroXml('Documento sem elemento raiz.');
  return raiz;
}

/** O nome sem o prefixo. */
export const nomeLocal = (n: string): string => n.slice(n.indexOf(':') + 1);

/** O primeiro descendente (em profundidade) com o nome local dado. */
export function buscar(no: NoLido, nome: string): NoLido | null {
  for (const f of no.filhos) {
    if (nomeLocal(f.nome) === nome) return f;
    const r = buscar(f, nome);
    if (r) return r;
  }
  return null;
}

/** Os filhos diretos com o nome local dado. */
export const filhosChamados = (no: NoLido, nome: string): NoLido[] =>
  no.filhos.filter((f) => nomeLocal(f.nome) === nome);

/** O texto do primeiro descendente com o nome local dado (aparado), ou null. */
export function textoDe(no: NoLido, nome: string): string | null {
  const r = buscar(no, nome);
  const t = r?.texto.trim();
  return t ? t : null;
}

export const atributo = (no: NoLido, nome: string): string | null =>
  no.atributos.find(([k]) => k === nome)?.[1] ?? null;
