// Impressão digital dos metadados do legado (convencoes.md §9; cap-10 §10.9): tabelas, colunas e tipos,
// código de triggers e procedures, generators pelo nome (nunca o valor), índices, restrições, domínios,
// exceções e funções externas; sem objetos SGH_. Nomes gerados pelo Firebird (RDB$nnn, INTEG_nnn) não
// entram: o objeto é identificado pela tabela e pelas colunas, para comparar dois bancos diferentes.
// O arquivo guarda só nome de objeto e hash: nenhum dado de linha, nenhuma fonte.
import { createHash } from 'node:crypto';
import { type CatalogoLegado, nomeAutomatico } from './catalogo.js';

export const CATEGORIAS = [
  'tabelas',
  'visoes',
  'triggers',
  'procedimentos',
  'generators',
  'indices',
  'restricoes',
  'dominios',
  'excecoes',
  'funcoes',
] as const;
export type Categoria = (typeof CATEGORIAS)[number];

/** Divergência nestas categorias bloqueia todas as escritas do estabelecimento (não se sabe o alcance). */
export const CATEGORIAS_GLOBAIS: ReadonlySet<Categoria> = new Set([
  'procedimentos',
  'generators',
  'dominios',
  'excecoes',
  'funcoes',
]);

/** [hash, tabela afetada ou null] */
export type ObjetoDigital = readonly [string, string | null];

export interface CategoriaDigital {
  readonly resumo: string;
  readonly objetos: Readonly<Record<string, ObjetoDigital>>;
}

export interface ImpressaoDigital {
  readonly formato: 1;
  readonly estabelecimento: string;
  readonly geradaEm: string;
  readonly charset: string;
  readonly versaoMotor: string;
  readonly resumo: string;
  readonly contagens: Readonly<Record<Categoria, number>>;
  readonly categorias: Readonly<Record<Categoria, CategoriaDigital>>;
}

const sha = (texto: string | Uint8Array): string => createHash('sha256').update(texto).digest('hex');
const curto = (texto: string | Uint8Array): string => sha(texto).slice(0, 16);

function hashFonte(cabecalho: string, fonte: Uint8Array): string {
  return curto(Buffer.concat([Buffer.from(cabecalho + '\n', 'latin1'), Buffer.from(fonte)]));
}

/** Objetos por chave estável; repetição de chave automática recebe sufixo #2, #3… */
function montar(entradas: readonly (readonly [string, string, string | null])[]): CategoriaDigital {
  const objetos: Record<string, ObjetoDigital> = {};
  for (const [chave, hash, tabela] of [...entradas].sort((a, b) =>
    (a[0] + a[1]).localeCompare(b[0] + b[1]),
  )) {
    let k = chave;
    for (let i = 2; k in objetos; i++) k = `${chave}#${i}`;
    objetos[k] = [hash, tabela];
  }
  const linhas = Object.keys(objetos)
    .sort()
    .map((k) => `${k}=${(objetos[k] as ObjetoDigital)[0]}`);
  return { resumo: sha(linhas.join('\n')), objetos };
}

export function calcularImpressao(
  estabelecimento: string,
  cat: CatalogoLegado,
  agora: Date = new Date(),
): ImpressaoDigital {
  const tabelas = montar(
    cat.tabelas.map((t) => [
      t.nome,
      curto(
        JSON.stringify([
          t.colunas.map((c) => [c.nome, c.tipo, c.anulavel, c.dominio, c.check, c.padrao, c.calculada]),
          t.pk,
        ]),
      ),
      t.nome,
    ]),
  );
  const visoes = montar(cat.visoes.map((v) => [v.nome, hashFonte('', v.fonte), v.nome]));
  const triggers = montar(
    cat.triggers.map((t) => [
      t.nome,
      hashFonte(`${t.tabela ?? ''}|${t.tipo}|${t.sequencia}|${t.inativo}`, t.fonte),
      t.tabela,
    ]),
  );
  const procedimentos = montar(
    cat.procedimentos.map((p) => [p.nome, hashFonte(p.parametros.join(';'), p.fonte), null]),
  );
  const generators = montar(cat.generators.map((g) => [g, curto(g), null]));
  const indices = montar(
    cat.indices.map((i) => {
      const forma = `${i.tabela}(${i.expressao ?? i.segmentos.join(',')})${i.unico ? '#U' : ''}${i.descendente ? '#D' : ''}`;
      return [nomeAutomatico(i.nome) ? forma : i.nome, curto(`${forma}|${i.inativo}`), i.tabela];
    }),
  );
  // Restrição: a FK cita a única/PK referenciada pela forma (tabela + colunas), não pelo nome gerado.
  const formaRestricao = new Map(
    cat.restricoes.map((r) => [r.nome, `${r.tabela}:${r.tipo}(${r.colunas.join(',')})`]),
  );
  const restricoes = montar(
    cat.restricoes.map((r) => {
      const forma = formaRestricao.get(r.nome) as string;
      const detalhe = (r.detalhe ?? '').replace(
        /ref=([^;]*)/,
        (_, uq: string) => `ref=${formaRestricao.get(uq) ?? uq}`,
      );
      return [nomeAutomatico(r.nome) ? forma : r.nome, curto(`${forma}|${detalhe}`), r.tabela];
    }),
  );
  const dominios = montar(
    cat.dominios.map((d) => [d.nome, curto(JSON.stringify([d.tipo, d.anulavel, d.check, d.padrao])), null]),
  );
  const excecoes = montar(cat.excecoes.map((e) => [e.nome, hashFonte('', e.fonte), null]));
  const funcoes = montar(cat.funcoes.map((f) => [f.nome, hashFonte('', f.fonte), null]));

  const categorias: Record<Categoria, CategoriaDigital> = {
    tabelas,
    visoes,
    triggers,
    procedimentos,
    generators,
    indices,
    restricoes,
    dominios,
    excecoes,
    funcoes,
  };
  const contagens = Object.fromEntries(
    CATEGORIAS.map((c) => [c, Object.keys(categorias[c].objetos).length]),
  ) as Record<Categoria, number>;
  return {
    formato: 1,
    estabelecimento,
    geradaEm: agora.toISOString(),
    charset: cat.charset,
    versaoMotor: cat.versaoMotor,
    resumo: sha([cat.charset, ...CATEGORIAS.map((c) => `${c}=${categorias[c].resumo}`)].join('\n')),
    contagens,
    categorias,
  };
}

export interface DiferencaCategoria {
  readonly ausentes: readonly string[];
  readonly novos: readonly string[];
  readonly alterados: readonly string[];
}

export interface Comparacao {
  readonly iguais: boolean;
  readonly charsetIgual: boolean;
  readonly diferencas: Readonly<Partial<Record<Categoria, DiferencaCategoria>>>;
  /** Tabelas cujas escritas ficam bloqueadas. */
  readonly tabelasAfetadas: readonly string[];
  /** Divergência sem alcance conhecido (procedure, generator, domínio…): bloqueia todas as escritas. */
  readonly global: boolean;
}

/** Compara `atual` com a `referencia` (homologada, ou a do outro banco). */
export function compararImpressoes(referencia: ImpressaoDigital, atual: ImpressaoDigital): Comparacao {
  const diferencas: Partial<Record<Categoria, DiferencaCategoria>> = {};
  const afetadas = new Set<string>();
  let global = false;
  for (const c of CATEGORIAS) {
    const r = referencia.categorias[c]?.objetos ?? {};
    const a = atual.categorias[c]?.objetos ?? {};
    const ausentes = Object.keys(r).filter((k) => !(k in a));
    const novos = Object.keys(a).filter((k) => !(k in r));
    const alterados = Object.keys(a).filter(
      (k) => k in r && (r[k] as ObjetoDigital)[0] !== (a[k] as ObjetoDigital)[0],
    );
    if (ausentes.length + novos.length + alterados.length === 0) continue;
    diferencas[c] = { ausentes: ausentes.sort(), novos: novos.sort(), alterados: alterados.sort() };
    if (CATEGORIAS_GLOBAIS.has(c)) global = true;
    for (const k of ausentes) {
      const t = (r[k] as ObjetoDigital)[1];
      if (t) afetadas.add(t);
      else global = true;
    }
    for (const k of [...novos, ...alterados]) {
      const t = (a[k] as ObjetoDigital)[1];
      if (t) afetadas.add(t);
      else global = true;
    }
  }
  const charsetIgual = referencia.charset === atual.charset;
  if (!charsetIgual) global = true;
  return {
    iguais: Object.keys(diferencas).length === 0 && charsetIgual,
    charsetIgual,
    diferencas,
    tabelasAfetadas: [...afetadas].sort(),
    global,
  };
}

/** Resumo legível por categoria (contagens), para log e para a tela. */
export function resumirComparacao(c: Comparacao): string {
  if (c.iguais) return 'igual';
  const partes = Object.entries(c.diferencas).map(
    ([cat, d]) =>
      `${cat}: ${d.ausentes.length} ausente(s), ${d.novos.length} novo(s), ${d.alterados.length} alterado(s)`,
  );
  if (!c.charsetIgual) partes.unshift('charset diferente');
  return partes.join('; ');
}
