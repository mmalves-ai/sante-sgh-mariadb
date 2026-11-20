// Gerador de packages/legado/src/tipos (pnpm legado:tipos), a partir de RDB$RELATIONS,
// RDB$RELATION_FIELDS e RDB$FIELDS: tipo TypeScript por tabela (tabelas.ts), metadados por coluna
// (catalogo.json: tipo, tamanho, nulidade, domínio, CHECK, padrão e PK), de onde sai o schema Zod de cada
// tabela (esquemas.ts, sob demanda), e a lista das tabelas legadas (insumo do guardas:legado no M04).
import { decodificarCp1252 } from '../cp1252.js';
import type { CatalogoLegado, ColunaCatalogo, TipoBase } from './catalogo.js';

/** O código PSQL do procedimento grava, avança generator ou sai da transação (efeito colateral)? */
export function procedimentoComEfeito(fonte: string): boolean {
  const f = fonte
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/--[^\n]*/g, ' ')
    .replace(/'(?:[^']|'')*'/g, "''");
  return (
    /\b(?:INSERT\s+INTO|UPDATE\s+[A-Z0-9_$"]+\s+SET|DELETE\s+FROM|MERGE\s+INTO|UPDATE\s+OR\s+INSERT|EXECUTE\s+(?:PROCEDURE|STATEMENT)|IN\s+AUTONOMOUS\s+TRANSACTION|NEXT\s+VALUE\s+FOR|POST_EVENT)\b/i.test(
      f,
    ) || /\bGEN_ID\s*\(\s*[^,()]+,(?!\s*0\s*\))/i.test(f)
  );
}

export const AVISO_GERADO =
  'Gerado por `pnpm legado:tipos` a partir do catálogo RDB$ do banco do legado. NÃO EDITAR À MÃO.';

const TIPO_TS: Record<TipoBase, string> = {
  texto: 'string',
  inteiro: 'number',
  decimal: 'number',
  double: 'number',
  data: 'Date',
  hora: 'Date',
  timestamp: 'Date',
  'blob-texto': 'BlobLegado',
  blob: 'BlobLegado',
  booleano: 'boolean',
};

const IDENT = /^[A-Za-z_$][A-Za-z0-9_$]*$/;
const prop = (nome: string): string => (IDENT.test(nome) ? nome : JSON.stringify(nome));

/** [nome, tipo SQL, anulável (1/0), domínio, CHECK, padrão] */
export type ColunaCompacta = readonly [string, string, 0 | 1, string | null, string | null, string | null];

export interface CatalogoTipos {
  readonly formato: 1;
  readonly geradoDe: string;
  readonly totalTabelas: number;
  readonly tabelas: Readonly<
    Record<string, { readonly pk: readonly string[]; readonly colunas: readonly ColunaCompacta[] }>
  >;
}

const compactar = (c: ColunaCatalogo): ColunaCompacta => [
  c.nome,
  c.tipo,
  c.anulavel ? 1 : 0,
  c.dominio,
  c.check,
  c.padrao,
];

export function gerarTipos(estabelecimento: string, cat: CatalogoLegado): Record<string, string> {
  const ordenadas = [...cat.tabelas].sort((a, b) => a.nome.localeCompare(b.nome));

  const ts: string[] = [
    `// ${AVISO_GERADO}`,
    `// Origem: estabelecimento "${estabelecimento}", ${ordenadas.length} tabelas. Linha bruta do driver, antes do codec.`,
    '/* eslint-disable */',
    '',
    '/** Identificador de BLOB devolvido pelo driver (o conteúdo se lê pelo Leitor). */',
    'export type BlobLegado = unknown;',
    '',
  ];
  for (const t of ordenadas) {
    ts.push(
      `export interface ${IDENT.test(t.nome) ? t.nome : `T_${t.nome.replace(/[^A-Za-z0-9_]/g, '_')}`} {`,
    );
    for (const c of t.colunas) {
      ts.push(`  readonly ${prop(c.nome)}: ${TIPO_TS[c.base]}${c.anulavel ? ' | null' : ''};`);
    }
    ts.push('}');
  }
  ts.push('', '/** Todas as tabelas legadas, pelo nome. */', 'export interface TabelasLegado {');
  for (const t of ordenadas) {
    ts.push(
      `  readonly ${prop(t.nome)}: ${IDENT.test(t.nome) ? t.nome : `T_${t.nome.replace(/[^A-Za-z0-9_]/g, '_')}`};`,
    );
  }
  ts.push('}', '', 'export type NomeTabelaLegado = keyof TabelasLegado;', '');

  // catalogo.json: uma linha por tabela (diferença legível no git).
  const linhas = ordenadas.map(
    (t, i) =>
      `    ${JSON.stringify(t.nome)}: ${JSON.stringify({ pk: t.pk, colunas: t.colunas.map(compactar) })}${i < ordenadas.length - 1 ? ',' : ''}`,
  );
  const json = [
    '{',
    `  "formato": 1,`,
    `  "geradoDe": ${JSON.stringify(estabelecimento)},`,
    `  "totalTabelas": ${ordenadas.length},`,
    '  "tabelas": {',
    ...linhas,
    '  }',
    '}',
    '',
  ].join('\n');

  const lista = `${JSON.stringify(
    {
      aviso: AVISO_GERADO,
      tabelas: ordenadas.map((t) => t.nome),
      visoes: cat.visoes.map((v) => v.nome).sort(),
    },
    null,
    1,
  )}\n`;

  const indice = [
    `// ${AVISO_GERADO}`,
    "import { readFileSync } from 'node:fs';",
    "import { esquemaDaTabela } from '../nucleo/schema/esquemas.js';",
    "import type { CatalogoTipos } from '../nucleo/schema/gerar-tipos.js';",
    "import type { NomeTabelaLegado } from './tabelas.js';",
    '',
    "export type * from './tabelas.js';",
    '',
    `export const TOTAL_TABELAS_LEGADAS = ${ordenadas.length};`,
    '',
    'let cache: CatalogoTipos | null = null;',
    '',
    '/** Metadados gerados (lidos do arquivo ao lado, sob demanda: o JSON é grande). */',
    'export function catalogoGerado(): CatalogoTipos {',
    "  cache ??= JSON.parse(readFileSync(new URL('./catalogo.json', import.meta.url), 'utf8')) as CatalogoTipos;",
    '  return cache;',
    '}',
    '',
    '/** Schema Zod da linha da tabela legada (tamanho, nulidade e tipo; domínio, CHECK e PK na descrição). */',
    'export function esquemaZod(tabela: NomeTabelaLegado) {',
    '  return esquemaDaTabela(catalogoGerado(), tabela);',
    '}',
    '',
  ].join('\n');

  // M04 (guardas:legado, regra g): colunas que abrem índice ativo (primeiro segmento), por tabela.
  const indexadas = new Map<string, Set<string>>();
  for (const i of cat.indices) {
    if (i.inativo || i.expressao || i.segmentos.length === 0) continue;
    let s = indexadas.get(i.tabela);
    if (!s) indexadas.set(i.tabela, (s = new Set()));
    s.add(i.segmentos[0] as string);
  }
  const indices = `${JSON.stringify(
    {
      aviso: AVISO_GERADO,
      colunasIndexadas: Object.fromEntries(
        [...indexadas.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([t, c]) => [t, [...c].sort()]),
      ),
    },
    null,
    1,
  )}\n`;
  // M04 (guardas:legado, pendência 12b do M02): procedimento selecionável com efeito colateral.
  const procedimentos = `${JSON.stringify(
    {
      aviso: AVISO_GERADO,
      procedimentos: Object.fromEntries(
        [...cat.procedimentos]
          .sort((a, b) => a.nome.localeCompare(b.nome))
          .map((p) => [p.nome, { efeito: procedimentoComEfeito(decodificarCp1252(p.fonte)) }]),
      ),
    },
    null,
    1,
  )}\n`;

  return {
    'indices-legados.json': indices,
    'procedimentos-legados.json': procedimentos,
    'tabelas.ts': ts.join('\n'),
    'catalogo.json': json,
    'tabelas-legadas.json': lista,
    'index.ts': indice,
  };
}
