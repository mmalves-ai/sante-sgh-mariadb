// Partes comuns da leitura dos arquivos oficiais: linhas (sem o BOM e as linhas em branco), CSV com aspas e
// separador escolhido, cabeçalho por nome (sem acento e sem diferenciar maiúsculas) e o item lido.

/** Item lido de uma linha do arquivo, no vocabulário do novo (campos da entidade do catálogo). */
export interface ItemLido {
  readonly entidade: string;
  /** Linha do arquivo (1 = primeira). */
  readonly linha: number;
  readonly campos: Readonly<Record<string, string | number | null>>;
  /** Erros de leiaute da linha (a linha não é publicada). */
  readonly erros: readonly string[];
}

export interface ErroArquivo {
  readonly linha: number | null;
  readonly mensagem: string;
}

export interface LeituraArquivo {
  readonly itens: readonly ItemLido[];
  /** Erros do arquivo inteiro (cabeçalho, leiaute): com qualquer um, nada é publicado. */
  readonly erros: readonly ErroArquivo[];
  /** Edição, competência ou versão que o próprio arquivo traz (null: a tela informa). */
  readonly edicao: string | null;
}

export function linhasDoTexto(texto: string): { linha: number; texto: string }[] {
  const semBom = texto.charCodeAt(0) === 0xfeff ? texto.slice(1) : texto;
  return semBom
    .split(/\r?\n/)
    .map((t, i) => ({ linha: i + 1, texto: t }))
    .filter((l) => l.texto.trim() !== '');
}

/** Campos de uma linha CSV (aspas duplas, aspas escapadas por duplicação, separador escolhido). */
export function camposCsv(linha: string, separador: string): string[] {
  const r: string[] = [];
  let atual = '';
  let aspas = false;
  for (let i = 0; i < linha.length; i++) {
    const c = linha[i] as string;
    if (aspas) {
      if (c === '"' && linha[i + 1] === '"') {
        atual += '"';
        i++;
      } else if (c === '"') aspas = false;
      else atual += c;
    } else if (c === '"' && atual.trim() === '') {
      aspas = true;
      atual = '';
    } else if (c === separador) {
      r.push(atual.trim());
      atual = '';
    } else atual += c;
  }
  r.push(atual.trim());
  return r;
}

/** Nome de coluna comparável: sem acento, sem símbolos, minúsculo. */
export function nomeComparavel(nome: string): string {
  return nome
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '');
}

/**
 * Índice das colunas pedidas no cabeçalho (por nome comparável; aceita sinônimos). Falta coluna obrigatória:
 * erro do arquivo (leiaute errado: nada é publicado).
 */
export function indicesDoCabecalho(
  cabecalho: readonly string[],
  pedidas: Readonly<Record<string, readonly string[]>>,
  obrigatorias: readonly string[],
): { indices: Record<string, number>; faltam: string[] } {
  const nomes = cabecalho.map(nomeComparavel);
  const indices: Record<string, number> = {};
  for (const [campo, sinonimos] of Object.entries(pedidas)) {
    const i = nomes.findIndex((n) => sinonimos.map(nomeComparavel).includes(n));
    if (i >= 0) indices[campo] = i;
  }
  return { indices, faltam: obrigatorias.filter((c) => !(c in indices)) };
}

/** Separador mais provável da linha de cabeçalho (; , | ou tabulação). */
export function separadorProvavel(cabecalho: string): string {
  const candidatos = [';', '|', '\t', ','];
  let melhor = ';';
  let max = 0;
  for (const s of candidatos) {
    const n = cabecalho.split(s).length;
    if (n > max) {
      max = n;
      melhor = s;
    }
  }
  return melhor;
}

/** Trecho de posições fixas (1-based, inclusivo), sem os espaços das pontas. */
export function trecho(linha: string, inicio: number, fim: number): string {
  return linha.slice(inicio - 1, fim).trim();
}
