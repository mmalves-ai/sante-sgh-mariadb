// Retrato versionado do acesso do legado (M06): árvore de opções (TBOPCOES, TBMODULO), os 42 grupos
// (TBGRUUSU; usuários ativos só em faixa: 0, "<5" ou o número a partir de 5), permissões grupo × opção
// (TBPERUSU) e papel × opção (TBPAPEL_TBOPCOES). É metadado e configuração do menu, sem pessoa: serve ao
// CI (sem cópia) e ao teste do catálogo. Na VM, `permissoes:verificar -- --atualizar` refaz da cópia.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { ModuloLegado, OpcaoLegado } from '@sgh/legado';

export type FaixaContagem = number | '<5';

export interface RetratoAcessoLegado {
  readonly formato: 1;
  readonly estabelecimento: string;
  readonly modulos: readonly ModuloLegado[];
  readonly opcoes: readonly OpcaoLegado[];
  readonly grupos: readonly { nome: string; ativo: boolean; usuariosAtivos: FaixaContagem }[];
  /** [grupo, opção] */
  readonly permissoesGrupos: readonly (readonly [string, number])[];
  /** [código do papel, opção] */
  readonly permissoesPapeis: readonly (readonly [number, number])[];
}

export const pastaDados = resolve(import.meta.dirname, '../dados');

export function caminhoRetrato(codigo: string): string {
  return resolve(pastaDados, `acesso-legado.${codigo}.json`);
}

/** Contagem sem individualizar: 0, "<5" (1 a 4) ou o número (5 ou mais). */
export function faixaContagem(n: number): FaixaContagem {
  return n === 0 ? 0 : n < 5 ? '<5' : n;
}

export function lerRetrato(codigo: string): RetratoAcessoLegado | null {
  const p = caminhoRetrato(codigo);
  if (!existsSync(p)) return null;
  return JSON.parse(readFileSync(p, 'utf8')) as RetratoAcessoLegado;
}

/** Uma linha por item (diff legível e estável). */
export function gravarRetrato(r: RetratoAcessoLegado): string {
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
