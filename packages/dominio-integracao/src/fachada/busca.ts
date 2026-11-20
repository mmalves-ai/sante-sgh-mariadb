// M58-F4: a busca por relevância da API de integração da Hal-AI (utils/busca.js e utils/sgh.js da versão 0.23.0),
// para as rotas servidas pela fachada responderem a mesma lista na mesma ordem. Catálogo disjuntivo (prioriza
// recall): casa por palavra, com prefixo nos dois sentidos (4 letras ou mais) e palavras coladas; peso IDF ×
// 1/(1 + 0,5·posição); corte relativo de 35% do melhor; similaridade (Dice sobre bigramas) só desempata.

/** NFD sem acento, maiúsculas, o que não for letra ou dígito vira espaço. */
export function normalizarChave(valor: unknown): string {
  return String(valor ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, ' ')
    .trim();
}

function bigramas(chave: string): string[] {
  const s = ` ${chave} `;
  const out: string[] = [];
  for (let i = 0; i < s.length - 1; i++) out.push(s.slice(i, i + 2));
  return out;
}

/** Coeficiente de Dice sobre os bigramas das chaves normalizadas (0 a 1). */
export function similaridade(a: unknown, b: unknown): number {
  const ka = normalizarChave(a);
  const kb = normalizarChave(b);
  if (!ka || !kb) return 0;
  if (ka === kb) return 1;
  const ba = bigramas(ka);
  const restantes = bigramas(kb);
  let comuns = 0;
  for (const bg of ba) {
    const i = restantes.indexOf(bg);
    if (i !== -1) {
      comuns++;
      restantes.splice(i, 1);
    }
  }
  return (2 * comuns) / (bigramas(ka).length + bigramas(kb).length);
}

/** "PROCEDIMENTO - DR(A) FULANO": corta no primeiro hífen. */
export function parseAgendaNome(nome: unknown): { procedimento: string; medico: string | null } {
  const raw = String(nome ?? '').trim();
  const idx = raw.indexOf('-');
  if (idx === -1) return { procedimento: raw, medico: null };
  const procedimento = raw.slice(0, idx).trim();
  const medico = raw.slice(idx + 1).trim() || null;
  return { procedimento: procedimento || raw, medico };
}

export const FRACAO_DO_MELHOR = 0.35;
const LIMIAR_SUGESTAO = 0.55;
const PREFIXO_MINIMO_SUGESTAO = 4;
const FRACAO_DA_MELHOR_SUGESTAO = 0.85;
export const PALAVRAS_IGNORADAS: ReadonlySet<string> = new Set([
  'DR',
  'DRA',
  'DRS',
  'DOUTOR',
  'DOUTORA',
  'DE',
  'DA',
  'DO',
  'DAS',
  'DOS',
  'E',
]);

function prefixoComum(a: string, b: string): number {
  const x = normalizarChave(a);
  const y = normalizarChave(b);
  let i = 0;
  while (i < x.length && i < y.length && x[i] === y[i]) i++;
  return i;
}

const pesoPosicao = (i: number) => 1 / (1 + 0.5 * i);

export function pesosIdf(nomes: readonly string[]): (palavra: string) => number {
  const frequencia = new Map<string, number>();
  for (const nome of nomes)
    for (const p of new Set(normalizarChave(nome).split(' ').filter(Boolean)))
      frequencia.set(p, (frequencia.get(p) ?? 0) + 1);
  const total = nomes.length || 1;
  return (palavra) =>
    PALAVRAS_IGNORADAS.has(palavra) ? 0 : Math.log((total + 1) / ((frequencia.get(palavra) ?? 0) + 1)) + 1;
}

export function casaPalavra(palavra: string, palavrasNome: readonly string[]): boolean {
  const MIN_PREFIXO = 4;
  for (const w of palavrasNome) {
    if (w === palavra) return true;
    if (palavra.length >= MIN_PREFIXO && w.startsWith(palavra)) return true;
    if (w.length >= MIN_PREFIXO && palavra.startsWith(w)) return true;
  }
  for (let i = 0; i < palavrasNome.length - 1; i++) {
    let colado = palavrasNome[i]!;
    for (let j = i + 1; j < palavrasNome.length; j++) {
      colado += palavrasNome[j]!;
      if (colado === palavra || colado.startsWith(palavra)) return true;
    }
  }
  return false;
}

export function pontuar(termo: string, nome: string, peso: (p: string) => number = () => 1): number {
  const chaveTermo = normalizarChave(termo);
  const chaveNome = normalizarChave(nome);
  if (!chaveTermo) return 1;
  const palavras = chaveTermo.split(' ').filter(Boolean);
  const palavrasNome = chaveNome.split(' ').filter(Boolean);
  let pontos = 0;
  palavras.forEach((p, i) => {
    if (casaPalavra(p, palavrasNome)) pontos += peso(p) * pesoPosicao(i);
  });
  if (pontos === 0) return 0;
  return pontos + similaridade(chaveTermo, chaveNome);
}

export function filtrarPorRelevancia<T>(
  itens: readonly T[],
  termo: string | null | undefined,
  nomeDe: (t: T) => string,
  { limite }: { limite?: number } = {},
): T[] {
  const teto = Number(limite) > 0 ? Number(limite) : itens.length;
  if (!termo || !String(termo).trim()) return itens.slice(0, teto);
  const peso = pesosIdf(itens.map(nomeDe));
  const pontuados = itens
    .map((item) => ({ item, score: pontuar(termo, nomeDe(item), peso) }))
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score || nomeDe(a.item).localeCompare(nomeDe(b.item)));
  if (!pontuados.length) return [];
  const corte = pontuados[0]!.score * FRACAO_DO_MELHOR;
  return pontuados
    .filter((x) => x.score >= corte)
    .slice(0, teto)
    .map((x) => x.item);
}

/** Nomes parecidos para a busca que voltou vazia (prefixo comum de 4 e similaridade ≥ 0,55; corte de 85%). */
export function sugerirAgendas(
  termo: string | null | undefined,
  nomes: readonly string[],
  { max = 3, minimo = LIMIAR_SUGESTAO }: { max?: number; minimo?: number } = {},
): string[] {
  if (!termo || !String(termo).trim()) return [];
  const a = parseAgendaNome(termo).procedimento;
  const pontuados = nomes
    .map((nome) => {
      const b = parseAgendaNome(nome).procedimento;
      return { nome, score: prefixoComum(a, b) >= PREFIXO_MINIMO_SUGESTAO ? similaridade(a, b) : 0 };
    })
    .filter((x) => x.score >= minimo)
    .sort((x, y) => y.score - x.score);
  if (!pontuados.length) return [];
  const corte = pontuados[0]!.score * FRACAO_DA_MELHOR_SUGESTAO;
  return pontuados
    .filter((x) => x.score >= corte)
    .slice(0, max)
    .map((x) => x.nome);
}
