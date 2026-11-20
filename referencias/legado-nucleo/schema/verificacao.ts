// Verificação de schema por estabelecimento (convencoes.md §9): marca de cada banco e o bloqueio das
// escritas afetadas, que o executor do M04 consulta. Sem marca (não verificado), tudo bloqueado.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { FORMATO_CODIGO } from '../estabelecimentos.js';
import {
  CATEGORIAS,
  type Categoria,
  type Comparacao,
  compararImpressoes,
  type DiferencaCategoria,
  type ImpressaoDigital,
} from './impressao.js';

export type EstadoSchema = 'homologado' | 'divergente' | 'sem-homologacao' | 'indisponivel';

export interface MarcaSchema {
  readonly estabelecimento: string;
  readonly estado: EstadoSchema;
  readonly verificadaEm: string;
  readonly resumo: string | null;
  readonly resumoHomologado: string | null;
  readonly contagens: Readonly<Record<Categoria, number>> | null;
  readonly diferencas: Readonly<Partial<Record<Categoria, DiferencaCategoria>>>;
  /** Escritas bloqueadas nestas tabelas. */
  readonly tabelasBloqueadas: readonly string[];
  /** Escritas bloqueadas em todas as tabelas do estabelecimento. */
  readonly bloqueiaTudo: boolean;
  /** Motivo em português (indisponível, sem homologação). */
  readonly motivo: string | null;
  readonly duracaoMs: number | null;
}

export function marcarSchema(
  estabelecimento: string,
  atual: ImpressaoDigital | null,
  homologada: ImpressaoDigital | null,
  extra: { readonly motivo?: string; readonly duracaoMs?: number; readonly agora?: Date } = {},
): MarcaSchema {
  const base = {
    estabelecimento,
    verificadaEm: (extra.agora ?? new Date()).toISOString(),
    resumo: atual?.resumo ?? null,
    resumoHomologado: homologada?.resumo ?? null,
    contagens: atual?.contagens ?? null,
    duracaoMs: extra.duracaoMs ?? null,
  };
  if (!atual) {
    return {
      ...base,
      estado: 'indisponivel',
      diferencas: {},
      tabelasBloqueadas: [],
      bloqueiaTudo: true,
      motivo: extra.motivo ?? 'Banco indisponível.',
    };
  }
  if (!homologada) {
    return {
      ...base,
      estado: 'sem-homologacao',
      diferencas: {},
      tabelasBloqueadas: [],
      bloqueiaTudo: true,
      motivo: 'Sem impressão digital homologada para este estabelecimento.',
    };
  }
  const c: Comparacao = compararImpressoes(homologada, atual);
  return {
    ...base,
    estado: c.iguais ? 'homologado' : 'divergente',
    diferencas: c.diferencas,
    tabelasBloqueadas: c.tabelasAfetadas,
    bloqueiaTudo: c.global,
    motivo: c.iguais
      ? null
      : c.charsetIgual
        ? 'Schema diferente do homologado.'
        : 'Charset diferente do homologado.',
  };
}

/** A escrita nestas tabelas está bloqueada? Sem marca, sim. */
export function escritaBloqueada(marca: MarcaSchema | undefined, tabelas: readonly string[]): boolean {
  if (!marca) return true;
  if (marca.estado === 'homologado') return false;
  if (marca.bloqueiaTudo) return true;
  const bloqueadas = new Set(marca.tabelasBloqueadas);
  return tabelas.some((t) => bloqueadas.has(t.toUpperCase()));
}

/** Marcas por estabelecimento, em memória do processo (o executor do M04 consulta). */
export class RegistroSchema {
  private readonly marcas = new Map<string, MarcaSchema>();
  registrar(marca: MarcaSchema): void {
    this.marcas.set(marca.estabelecimento, marca);
  }
  marca(codigo: string): MarcaSchema | undefined {
    return this.marcas.get(codigo);
  }
  bloqueada(codigo: string, tabelas: readonly string[]): boolean {
    return escritaBloqueada(this.marcas.get(codigo), tabelas);
  }
  todas(): MarcaSchema[] {
    return [...this.marcas.values()];
  }
}

// ── Arquivo homologado: tools/schema-check/homologado/<codigo>.json ─────────────────────────────

export function caminhoHomologada(pasta: string, codigo: string): string {
  if (!FORMATO_CODIGO.test(codigo)) throw new Error('Código de estabelecimento inválido.');
  return join(pasta, `${codigo}.json`);
}

export function lerHomologada(pasta: string, codigo: string): ImpressaoDigital | null {
  const p = caminhoHomologada(pasta, codigo);
  if (!existsSync(p)) return null;
  return desserializarImpressao(readFileSync(p, 'utf8'), codigo);
}

type CategoriaArquivo = {
  readonly resumo: string;
  readonly objetos: readonly (readonly [string, string, string | null])[];
};

/** Lê o arquivo (objetos como lista de [nome, hash, tabela]) de volta para a impressão em memória. */
export function desserializarImpressao(texto: string, codigo: string): ImpressaoDigital {
  const j = JSON.parse(texto) as Omit<ImpressaoDigital, 'categorias'> & {
    categorias?: Record<string, CategoriaArquivo>;
  };
  if (j.formato !== 1 || j.estabelecimento !== codigo || !j.categorias) {
    throw new Error(`Impressão homologada de "${codigo}" em formato inesperado.`);
  }
  const categorias = Object.fromEntries(
    CATEGORIAS.map((c) => {
      const cat = j.categorias?.[c];
      if (!cat || !Array.isArray(cat.objetos))
        throw new Error(`Impressão homologada de "${codigo}" sem a categoria ${c}.`);
      return [
        c,
        {
          resumo: cat.resumo,
          objetos: Object.fromEntries(cat.objetos.map(([n, h, t]) => [n, [h, t] as const])),
        },
      ];
    }),
  ) as unknown as ImpressaoDigital['categorias'];
  return { ...j, categorias };
}

/**
 * JSON estável: uma linha por objeto (diferença legível no git). Os objetos vão como lista
 * [nome, hash, tabela], e não como "NOME": valor, para nenhum nome de objeto parecer chave de segredo
 * (ex.: CHECK chamado *_SENHA) ao verificadores:segredos.
 */
export function serializarImpressao(i: ImpressaoDigital): string {
  const linhas: string[] = ['{'];
  const cab = { ...i } as Record<string, unknown>;
  delete cab['categorias'];
  for (const [k, v] of Object.entries(cab)) linhas.push(`  ${JSON.stringify(k)}: ${JSON.stringify(v)},`);
  linhas.push('  "categorias": {');
  CATEGORIAS.forEach((c, ci) => {
    const cat = i.categorias[c];
    linhas.push(
      `    ${JSON.stringify(c)}: {`,
      `      "resumo": ${JSON.stringify(cat.resumo)},`,
      '      "objetos": [',
    );
    const chaves = Object.keys(cat.objetos).sort();
    chaves.forEach((k, ki) => {
      const [h, t] = cat.objetos[k] as readonly [string, string | null];
      linhas.push(`        ${JSON.stringify([k, h, t])}${ki < chaves.length - 1 ? ',' : ''}`);
    });
    linhas.push('      ]', `    }${ci < CATEGORIAS.length - 1 ? ',' : ''}`);
  });
  linhas.push('  }', '}', '');
  return linhas.join('\n');
}

export function gravarHomologada(pasta: string, i: ImpressaoDigital): string {
  mkdirSync(pasta, { recursive: true });
  const p = caminhoHomologada(pasta, i.estabelecimento);
  writeFileSync(p, serializarImpressao(i));
  return p;
}
