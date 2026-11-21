// Árvore de opções de menu do legado para a TELA de permissões (ficha do M10, regra 5; cap-08 §8.6): o cadastro de opções do menu de origem não
// tem a chave do pai. O pai de uma opção é a última opção ANTERIOR do mesmo MODULO, na ordem de INDICE, com
// NIVEL uma unidade menor. Salto de nível (a opção anterior está dois ou mais níveis acima) vira AVISO e a opção
// fica sem pai na árvore (pendurada na raiz do módulo, marcada): o pai nunca é adivinhado. Opção inativa entra
// na árvore marcada (a tela mostra, mas não oferece para conceder; regra das receitas do ADR 0022).
// Diferente do catálogo de permissões (catalogo.ts), que gera os códigos e usa o ancestral mais próximo para
// nomear a permissão; aqui a árvore é só para a pessoa escolher as opções pelo título.

export interface OpcaoMenu {
  readonly id: number;
  readonly modulo: number;
  readonly indice: number;
  readonly nivel: number;
  readonly ativo: boolean;
  readonly titulo: string;
}

export interface NoOpcao {
  readonly id: number;
  readonly modulo: number;
  readonly nivel: number;
  readonly titulo: string;
  readonly ativo: boolean;
  readonly pai: number | null;
  /** Salto de nível: a opção ficou sem pai (aviso), em vez de um pai adivinhado. */
  readonly salto: boolean;
  readonly filhos: readonly number[];
}

export interface AvisoArvore {
  readonly opcao: number;
  readonly modulo: number;
  readonly nivel: number;
  /** Nível da opção anterior do módulo (o pai esperado teria nível − 1). */
  readonly nivelAnterior: number | null;
}

export interface ArvoreOpcoes {
  readonly nos: ReadonlyMap<number, NoOpcao>;
  /** Raízes por módulo (nível 0 e as opções com salto), na ordem de INDICE. */
  readonly raizes: ReadonlyMap<number, readonly number[]>;
  readonly avisos: readonly AvisoArvore[];
}

/** Monta a árvore de cada módulo sem adivinhar pai (regra 5). */
export function reconstruirArvoreOpcoes(opcoes: readonly OpcaoMenu[]): ArvoreOpcoes {
  const porModulo = new Map<number, OpcaoMenu[]>();
  for (const o of opcoes) porModulo.set(o.modulo, [...(porModulo.get(o.modulo) ?? []), o]);
  const mutaveis = new Map<number, { no: Omit<NoOpcao, 'filhos'>; filhos: number[] }>();
  const raizes = new Map<number, number[]>();
  const avisos: AvisoArvore[] = [];
  for (const [modulo, lista] of [...porModulo].sort((a, b) => a[0] - b[0])) {
    const ordenadas = [...lista].sort((a, b) => a.indice - b.indice || a.id - b.id);
    // Última opção vista em cada nível (a pilha do caminho atual).
    const pilha: (OpcaoMenu | undefined)[] = [];
    let anterior: OpcaoMenu | undefined;
    const rz: number[] = [];
    for (const o of ordenadas) {
      let pai: number | null = null;
      let salto = false;
      if (o.nivel > 0) {
        const candidato = pilha[o.nivel - 1];
        const anteriorNivel = anterior?.nivel ?? null;
        // O pai é a última anterior com nível − 1, desde que não haja salto: a anterior imediata tem de estar
        // no nível − 1 (filho direto) ou num nível ≥ ao da opção (irmão ou sobrinho que voltou).
        if (candidato && anteriorNivel !== null && anteriorNivel >= o.nivel - 1) pai = candidato.id;
        else {
          salto = true;
          avisos.push({ opcao: o.id, modulo, nivel: o.nivel, nivelAnterior: anteriorNivel });
        }
      }
      mutaveis.set(o.id, {
        no: { id: o.id, modulo, nivel: o.nivel, titulo: o.titulo, ativo: o.ativo, pai, salto },
        filhos: [],
      });
      if (pai !== null) mutaveis.get(pai)?.filhos.push(o.id);
      else rz.push(o.id);
      pilha[o.nivel] = o;
      pilha.length = o.nivel + 1;
      anterior = o;
    }
    raizes.set(modulo, rz);
  }
  const nos = new Map<number, NoOpcao>([...mutaveis].map(([id, m]) => [id, { ...m.no, filhos: m.filhos }]));
  return { nos, raizes, avisos };
}

/** Caminho de títulos da opção até a raiz do módulo (para mostrar onde a opção fica no menu). */
export function caminhoDaOpcao(a: ArvoreOpcoes, id: number): string[] {
  const r: string[] = [];
  let atual = a.nos.get(id);
  const vistos = new Set<number>();
  while (atual && !vistos.has(atual.id)) {
    vistos.add(atual.id);
    r.unshift(atual.titulo);
    atual = atual.pai === null ? undefined : a.nos.get(atual.pai);
  }
  return r;
}

/** Todas as descendentes de uma opção (conceder um ramo inteiro de uma vez). */
export function descendentes(a: ArvoreOpcoes, id: number): number[] {
  const r: number[] = [];
  const fila = [...(a.nos.get(id)?.filhos ?? [])];
  while (fila.length > 0) {
    const x = fila.shift() as number;
    r.push(x);
    fila.push(...(a.nos.get(x)?.filhos ?? []));
  }
  return r;
}
