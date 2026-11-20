// Catálogo completo de permissões no servidor (M06): as geradas da árvore do legado mais as declaradas pelos
// módulos, e o índice opção/flag/perfil → permissão, montados uma vez por processo.
import { CATALOGO_DECLARADO, type DeclaracaoPermissao, type FlagLegado } from '@sgh/contratos';
import { CATALOGO_LEGADO } from '@sgh/contratos/catalogo-legado';
import { indexarCatalogo, type IndiceCatalogo, type PermissaoDoPerfil } from '@sgh/dominio-acesso';

export const CATALOGO_COMPLETO: readonly DeclaracaoPermissao[] = [...CATALOGO_LEGADO, ...CATALOGO_DECLARADO];

/** Flags do legado que alguma permissão declara (só elas são lidas de TBUSUCPL, GEUSERS e FCPARUSU). */
export const FLAGS_DECLARADAS: readonly FlagLegado[] = [
  ...new Map(
    CATALOGO_COMPLETO.flatMap((p) => p.flagsLegado ?? []).map((f) => [`${f.tabela}.${f.coluna}`, f]),
  ).values(),
];

let base: IndiceCatalogo | null = null;
const comMapa = new Map<string, IndiceCatalogo>();

/** Índice do catálogo; com o mapa SGH_ACESSO_MAPA_OPCAO aprovado, um índice por versão do mapa. */
export function indiceDoCatalogo(mapa: readonly PermissaoDoPerfil[] = []): IndiceCatalogo {
  if (mapa.length === 0) return (base ??= indexarCatalogo(CATALOGO_COMPLETO));
  const chave = mapa
    .map((m) => `${m.perfil}\u0000${m.permissao}`)
    .sort()
    .join('\u0001');
  let i = comMapa.get(chave);
  if (!i) {
    if (comMapa.size > 16) comMapa.clear();
    i = indexarCatalogo(CATALOGO_COMPLETO, mapa);
    comMapa.set(chave, i);
  }
  return i;
}
