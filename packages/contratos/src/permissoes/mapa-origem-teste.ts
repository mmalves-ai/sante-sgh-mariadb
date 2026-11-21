// Apoio dos testes (fora do índice de @sgh/contratos): as opções do menu de origem de cada permissão vêm do mapa do
// conector (conector/mapa/permissoes.tsv), não da declaração da permissão (ADR 0007, item 8).
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const ARQUIVO = resolve(import.meta.dirname, '../../../../conector/mapa/permissoes.tsv');
let porPermissao: Map<string, number[]> | null = null;

function mapa(): Map<string, number[]> {
  if (porPermissao) return porPermissao;
  porPermissao = new Map();
  for (const l of readFileSync(ARQUIVO, 'utf8').split('\n').slice(1)) {
    const [tipo, chave, codigo] = l.split('\t');
    if (tipo !== 'opcao_menu' || !chave || !codigo) continue;
    porPermissao.set(codigo, [...(porPermissao.get(codigo) ?? []), Number(chave)]);
  }
  for (const l of porPermissao.values()) l.sort((a, b) => a - b);
  return porPermissao;
}

/** Opções do menu de origem ligadas à permissão no mapa do conector (ordenadas; vazio quando não há). */
export function opcoesDoMapa(codigo: string | undefined): number[] {
  return codigo === undefined ? [] : [...(mapa().get(codigo) ?? [])];
}
