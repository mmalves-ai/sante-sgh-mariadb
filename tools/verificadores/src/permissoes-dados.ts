// Retrato versionado do acesso do sistema de origem (M06): árvore de opções e módulos, os grupos (usuários ativos só
// em faixa: 0, "<5" ou o número a partir de 5), permissões grupo × opção e papel × opção. É metadado e configuração do
// menu, sem pessoa: serve ao CI e ao teste do catálogo de permissões.
// Melhoria: os tipos do retrato são próprios (sem tipo do núcleo antigo).
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

export type FaixaContagem = number | '<5';

/** Módulo do menu de origem. */
export interface ModuloMenuOrigem {
  readonly id: number;
  readonly sistema: string;
  readonly executavel: string;
  readonly nome: string;
}

/** Opção do menu de origem. */
export interface OpcaoMenuOrigem {
  readonly id: number;
  readonly modulo: number;
  readonly indice: number;
  readonly nivel: number;
  readonly ativo: boolean;
  readonly avulsa: boolean;
  readonly nome: string;
  readonly titulo: string;
}

export interface RetratoAcessoOrigem {
  readonly formato: 1;
  readonly estabelecimento: string;
  readonly modulos: readonly ModuloMenuOrigem[];
  readonly opcoes: readonly OpcaoMenuOrigem[];
  readonly grupos: readonly { nome: string; ativo: boolean; usuariosAtivos: FaixaContagem }[];
  /** [grupo, opção] */
  readonly permissoesGrupos: readonly (readonly [string, number])[];
  /** [código do papel, opção] */
  readonly permissoesPapeis: readonly (readonly [number, number])[];
}

/** Nome antigo, mantido para quem ainda o importa. */
export type RetratoAcessoLegado = RetratoAcessoOrigem;

export const pastaDados = resolve(import.meta.dirname, '../dados');

export function caminhoRetrato(codigo: string): string {
  return resolve(pastaDados, `acesso-legado.${codigo}.json`);
}

/** Contagem sem individualizar: 0, "<5" (1 a 4) ou o número (5 ou mais). */
export function faixaContagem(n: number): FaixaContagem {
  return n === 0 ? 0 : n < 5 ? '<5' : n;
}

export function lerRetrato(codigo: string): RetratoAcessoOrigem | null {
  const p = caminhoRetrato(codigo);
  if (!existsSync(p)) return null;
  return JSON.parse(readFileSync(p, 'utf8')) as RetratoAcessoOrigem;
}

/** Uma linha por item (diff legível e estável). */
export function gravarRetrato(r: RetratoAcessoOrigem): string {
  const p = caminhoRetrato(r.estabelecimento);
  const linhas = (xs: readonly unknown[]) => xs.map((x) => `    ${JSON.stringify(x)}`).join(',\n');
  const texto =
    `{\n  "formato": 1,\n  "estabelecimento": ${JSON.stringify(r.estabelecimento)},\n` +
    `  "modulos": [\n${linhas(r.modulos)}\n  ],\n` +
    `  "opcoes": [\n${linhas(r.opcoes)}\n  ],\n` +
    `  "grupos": [\n${linhas(r.grupos)}\n  ],\n` +
    `  "permissoesGrupos": [\n${linhas(r.permissoesGrupos)}\n  ],\n` +
    `  "permissoesPapeis": [\n${linhas(r.permissoesPapeis)}\n  ]\n}\n`;
  writeFileSync(p, texto, 'utf8');
  return p;
}
