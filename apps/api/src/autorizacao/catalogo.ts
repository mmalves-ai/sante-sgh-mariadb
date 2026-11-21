// Catálogo completo de permissões no servidor (M06): o catálogo-base do produto mais as permissões declaradas pelos
// módulos, e o índice opção/marca/perfil → permissão, montados uma vez por processo. A correspondência com a origem
// (opção do menu e marca de usuário) não fica na declaração da permissão (ADR 0007, item 8): vem do mapa do conector,
// conector/mapa/permissoes.tsv, lido uma vez e só quando se lê a origem (fonte sintética e de memória). Sem o arquivo,
// nenhuma permissão vem da origem (falha fechada).
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { CATALOGO_DECLARADO, type DeclaracaoPermissao } from '@sgh/contratos';
import { CATALOGO_BASE } from '@sgh/contratos/catalogo-base';
import {
  type CorrespondenciaOrigem,
  indexarCatalogo,
  type IndiceCatalogo,
  lerMapaOrigem,
  marcasDoMapa,
  type MarcaUsuarioOrigem,
  opcoesPorPermissao,
  type PermissaoDoPerfil,
} from '@sgh/dominio-acesso';

export const CATALOGO_COMPLETO: readonly DeclaracaoPermissao[] = [...CATALOGO_BASE, ...CATALOGO_DECLARADO];

/** Arquivo do mapa do conector; `SGH_MAPA_PERMISSOES` troca o caminho (implantação fora do repositório). */
export function arquivoMapaOrigem(): string {
  return (
    process.env['SGH_MAPA_PERMISSOES'] ??
    resolve(import.meta.dirname, '../../../../conector/mapa/permissoes.tsv')
  );
}

let mapa: readonly CorrespondenciaOrigem[] | null = null;

/** Mapa do conector (origem → permissão), lido uma vez por processo. */
export function mapaDeOrigem(): readonly CorrespondenciaOrigem[] {
  if (mapa) return mapa;
  const arquivo = arquivoMapaOrigem();
  mapa = existsSync(arquivo) ? lerMapaOrigem(readFileSync(arquivo, 'utf8')) : [];
  return mapa;
}

let opcoes: ReadonlyMap<string, readonly number[]> | null = null;

/** Opções do menu de origem ligadas às permissões dadas (ordenadas, sem repetição). */
export function opcoesDasPermissoes(...codigos: readonly string[]): number[] {
  opcoes ??= opcoesPorPermissao(mapaDeOrigem());
  const r = new Set<number>();
  for (const c of codigos) for (const o of opcoes.get(c) ?? []) r.add(o);
  return [...r].sort((a, b) => a - b);
}

/** Marcas do usuário na origem que o mapa liga a alguma permissão (só elas são lidas). */
export function marcasDeclaradas(): readonly MarcaUsuarioOrigem[] {
  return marcasDoMapa(mapaDeOrigem());
}

let base: IndiceCatalogo | null = null;
const comMapa = new Map<string, IndiceCatalogo>();

/** Índice do catálogo; com o mapa SGH_ACESSO_MAPA_OPCAO aprovado, um índice por versão do mapa. */
export function indiceDoCatalogo(mapa: readonly PermissaoDoPerfil[] = []): IndiceCatalogo {
  if (mapa.length === 0) return (base ??= indexarCatalogo(CATALOGO_COMPLETO, [], mapaDeOrigem()));
  const chave = mapa
    .map((m) => `${m.perfil}\u0000${m.permissao}`)
    .sort()
    .join('\u0001');
  let i = comMapa.get(chave);
  if (!i) {
    if (comMapa.size > 16) comMapa.clear();
    i = indexarCatalogo(CATALOGO_COMPLETO, mapa, mapaDeOrigem());
    comMapa.set(chave, i);
  }
  return i;
}

const doCliente = new Map<string, IndiceCatalogo>();

/**
 * F2-L (fonte própria): índice com o que cada perfil do banco do cliente concede direto (perfil_acao × acao_sistema).
 * Só código que existe no catálogo do produto (o resto é ignorado: falha fechada). As concessões gerais do catálogo
 * (as de toda pessoa) e as categorias seguem as do produto; opções e flags do banco de origem não existem aqui.
 */
export function indiceDoCliente(acoes: readonly PermissaoDoPerfil[]): IndiceCatalogo {
  const chave = acoes
    .map((m) => `${m.perfil}\u0000${m.permissao}`)
    .sort()
    .join('\u0001');
  let i = doCliente.get(chave);
  if (!i) {
    const base = indiceDoCatalogo();
    const porPerfil = new Map<string, string[]>();
    for (const a of acoes) {
      if (!base.categorias.has(a.permissao)) continue;
      const l = porPerfil.get(a.perfil) ?? [];
      if (!l.includes(a.permissao)) l.push(a.permissao);
      porPerfil.set(a.perfil, l);
    }
    i = {
      porOpcao: new Map(),
      porFlag: new Map(),
      porPerfil,
      todosOsPerfisDePessoa: base.todosOsPerfisDePessoa,
      categorias: base.categorias,
    };
    if (doCliente.size > 16) doCliente.clear();
    doCliente.set(chave, i);
  }
  return i;
}
