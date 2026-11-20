// Menu gerado da árvore e filtrado (regra 12; cap-04 §4.1): item sem rota ou sem permissão não aparece.
// Apresentação hierárquica (pedido do dono, 22/10/2026): área > níveis intermediários do caminho > item, cada
// nível recolhível, com o estado aberto/fechado lembrado por usuário e um filtro sem acento nem maiúsculas.
import type { ItemMenu } from '@sgh/contratos';

export interface AreaMenu {
  readonly area: string;
  readonly itens: readonly ItemMenu[];
}

export function itensVisiveis(arvore: readonly ItemMenu[], permissoes: ReadonlySet<string>): ItemMenu[] {
  return arvore.filter((i) => i.rota !== null && i.permissao !== null && permissoes.has(i.permissao));
}

/** Agrupa por área, na ordem da árvore. */
export function menuPorArea(itens: readonly ItemMenu[]): AreaMenu[] {
  const areas = new Map<string, ItemMenu[]>();
  for (const i of itens) {
    const lista = areas.get(i.area) ?? [];
    lista.push(i);
    areas.set(i.area, lista);
  }
  return [...areas].map(([area, lista]) => ({ area, itens: lista }));
}

/** Sem acento, sem diferença de maiúsculas e com espaços normalizados (busca e comparação de rótulos). */
export function normalizar(texto: string): string {
  return texto.normalize('NFD').replace(/\p{M}/gu, '').toLocaleLowerCase('pt-BR').replace(/\s+/g, ' ').trim();
}

// ---------------------------------------------------------------------------------------------------------
// Hierarquia

export interface NoItem {
  readonly tipo: 'item';
  readonly item: ItemMenu;
}

export interface NoRamo {
  readonly tipo: 'ramo';
  /** Chave estável do nível ("ÁREA/Nível/Nível"): é o que se lembra aberto. */
  readonly chave: string;
  readonly rotulo: string;
  /** Itens (folhas) abaixo deste nível, em qualquer profundidade. */
  readonly total: number;
  readonly filhos: readonly NoMenu[];
}

export type NoMenu = NoItem | NoRamo;

export interface AreaHierarquica {
  readonly chave: string;
  readonly area: string;
  /** Nome em capitalização normal ("Relatórios e BI"), do caminho quando a árvore o traz. */
  readonly rotulo: string;
  readonly total: number;
  readonly filhos: readonly NoMenu[];
}

/** "ATENDIMENTO AO PACIENTE" -> "Atendimento ao paciente" (quando o caminho não traz o nome da área). */
export function capitalizar(area: string): string {
  const minusculas = area.toLocaleLowerCase('pt-BR');
  return minusculas.charAt(0).toLocaleUpperCase('pt-BR') + minusculas.slice(1);
}

/**
 * Níveis intermediários do item, abaixo da área: o caminho sem o título (o último) e sem a raiz quando ela
 * repete a área ("Cadastros > Pacientes > X" -> ["Pacientes"]). Nas áreas com grupo, a raiz do caminho é o grupo
 * com o rótulo de produto ("PEP", "Agenda") e vira o segundo nível.
 */
export function niveisDoItem(item: ItemMenu): string[] {
  const meio = item.caminho.slice(0, -1);
  if (meio.length > 0 && normalizar(meio[0]!) === normalizar(item.area)) meio.shift();
  return meio;
}

interface RamoMontado {
  readonly chave: string;
  readonly rotulo: string;
  readonly filhos: (NoItem | RamoMontado)[];
  readonly ramos: Map<string, RamoMontado>;
}

function contar(n: NoMenu): number {
  return n.tipo === 'item' ? 1 : n.total;
}

/** Fecha a montagem; um nível com um item só não vale um clique: o item sobe para o nível de cima. */
function concluir(filhos: readonly (NoItem | RamoMontado)[]): NoMenu[] {
  return filhos.map((f): NoMenu => {
    if ('tipo' in f) return f;
    const netos = concluir(f.filhos);
    if (netos.length === 1 && netos[0]!.tipo === 'item') return netos[0]!;
    const total = netos.reduce((s, n) => s + contar(n), 0);
    return { tipo: 'ramo', chave: f.chave, rotulo: f.rotulo, filhos: netos, total };
  });
}

/** Monta área > níveis do caminho > item, na ordem da árvore. */
export function menuHierarquico(itens: readonly ItemMenu[]): AreaHierarquica[] {
  const areas = new Map<string, { raiz: RamoMontado; rotulo: string | null }>();
  for (const item of itens) {
    let a = areas.get(item.area);
    if (!a) {
      a = { raiz: { chave: item.area, rotulo: item.area, filhos: [], ramos: new Map() }, rotulo: null };
      areas.set(item.area, a);
    }
    const raiz = item.caminho[0];
    if (a.rotulo === null && raiz !== undefined && normalizar(raiz) === normalizar(item.area))
      a.rotulo = raiz;
    let ramo = a.raiz;
    for (const nivel of niveisDoItem(item)) {
      let filho = ramo.ramos.get(nivel);
      if (!filho) {
        filho = { chave: `${ramo.chave}/${nivel}`, rotulo: nivel, filhos: [], ramos: new Map() };
        ramo.ramos.set(nivel, filho);
        ramo.filhos.push(filho);
      }
      ramo = filho;
    }
    ramo.filhos.push({ tipo: 'item', item });
  }
  return [...areas].map(([area, { raiz, rotulo }]) => {
    const filhos = concluir(raiz.filhos);
    return {
      chave: area,
      area,
      rotulo: rotulo ?? capitalizar(area),
      total: filhos.reduce((s, n) => s + contar(n), 0),
      filhos,
    };
  });
}

// ---------------------------------------------------------------------------------------------------------
// Filtro

/** Itens cujo título ou caminho contém todos os termos digitados (sem acento, sem maiúsculas). */
export function filtrarItens(itens: readonly ItemMenu[], busca: string): ItemMenu[] {
  const termos = normalizar(busca).split(' ').filter(Boolean);
  if (termos.length === 0) return [...itens];
  return itens.filter((i) => {
    const texto = normalizar([...i.caminho, i.titulo].join(' '));
    return termos.every((t) => texto.includes(t));
  });
}

/** Todas as chaves de nível (áreas e ramos): com o filtro ativo, tudo o que sobrou fica aberto. */
export function todasAsChaves(areas: readonly AreaHierarquica[]): string[] {
  const chaves: string[] = [];
  const andar = (nos: readonly NoMenu[]) => {
    for (const n of nos)
      if (n.tipo === 'ramo') {
        chaves.push(n.chave);
        andar(n.filhos);
      }
  };
  for (const a of areas) {
    chaves.push(a.chave);
    andar(a.filhos);
  }
  return chaves;
}

// ---------------------------------------------------------------------------------------------------------
// Tela atual

function semConsulta(rota: string): string {
  const i = rota.indexOf('?');
  return i < 0 ? rota : rota.slice(0, i);
}

/**
 * O item da tela atual: a rota exata (com a consulta), senão o mesmo caminho sem a consulta, senão o item de
 * rota mais longa que é prefixo da tela (detalhe de um cadastro). Um só, para um único `aria-current`.
 */
export function itemDaTela(itens: readonly ItemMenu[], caminhoCompleto: string): ItemMenu | null {
  const exato = itens.find((i) => i.rota === caminhoCompleto);
  if (exato) return exato;
  const caminho = semConsulta(caminhoCompleto);
  const mesmo = itens.find((i) => semConsulta(i.rota ?? '') === caminho);
  if (mesmo) return mesmo;
  let melhor: ItemMenu | null = null;
  let tamanho = 0;
  for (const i of itens) {
    const r = semConsulta(i.rota ?? '');
    if (r.length > tamanho && caminho.startsWith(`${r}/`)) {
      melhor = i;
      tamanho = r.length;
    }
  }
  return melhor;
}

/** Chaves da área e dos níveis acima do item (abrem sozinhas na tela atual). */
export function chavesAcima(item: ItemMenu, areas: readonly AreaHierarquica[]): string[] {
  const area = areas.find((a) => a.area === item.area);
  if (!area) return [];
  const andar = (nos: readonly NoMenu[], acima: readonly string[]): string[] | null => {
    for (const n of nos) {
      if (n.tipo === 'item') {
        if (n.item.id === item.id) return [...acima];
      } else {
        const achou = andar(n.filhos, [...acima, n.chave]);
        if (achou) return achou;
      }
    }
    return null;
  };
  return andar(area.filhos, [area.chave]) ?? [];
}

// ---------------------------------------------------------------------------------------------------------
// Estado lembrado (localStorage, por usuário). Pode faltar ou falhar (janela privada, dados bloqueados): o
// menu só começa recolhido.

export interface Armazenamento {
  getItem(chave: string): string | null;
  setItem(chave: string, valor: string): void;
}

/**
 * Chave do estado lembrado: o resumo do usuário (rede + login), nunca o login em claro (M35, revisão: o E2E do M05
 * confere que nada que identifique a pessoa fica no armazenamento do navegador). FNV-1a de 32 bits, só para separar
 * os usuários do mesmo navegador.
 */
export function chaveDoEstado(usuario: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < usuario.length; i++) {
    h ^= usuario.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return `sgh.menu.abertos:${h.toString(16).padStart(8, '0')}`;
}

function armazenamentoPadrao(): Armazenamento | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

export function lerAbertos(usuario: string, armazenamento = armazenamentoPadrao()): Set<string> {
  try {
    const bruto = armazenamento?.getItem(chaveDoEstado(usuario));
    if (!bruto) return new Set();
    const lido: unknown = JSON.parse(bruto);
    return new Set(Array.isArray(lido) ? lido.filter((c): c is string => typeof c === 'string') : []);
  } catch {
    return new Set();
  }
}

export function gravarAbertos(
  usuario: string,
  abertos: ReadonlySet<string>,
  armazenamento = armazenamentoPadrao(),
): void {
  try {
    armazenamento?.setItem(chaveDoEstado(usuario), JSON.stringify([...abertos]));
  } catch {
    // Sem armazenamento: o estado vale só enquanto a tela estiver aberta.
  }
}
