// Catálogo completo de permissões no servidor (M06): as geradas da árvore do legado mais as declaradas pelos
// módulos, e o índice opção/flag/perfil → permissão, montados uma vez por processo.
import { CATALOGO_DECLARADO, type DeclaracaoPermissao, type FlagLegado } from '@sgh/contratos';
import { CATALOGO_LEGADO } from '@sgh/contratos/catalogo-legado';
import { indexarCatalogo, type IndiceCatalogo, type PermissaoDoPerfil } from '@sgh/dominio-acesso';

export const CATALOGO_COMPLETO: readonly DeclaracaoPermissao[] = [...CATALOGO_LEGADO, ...CATALOGO_DECLARADO];

/** Marcas do usuário na origem que alguma permissão declara (só elas são lidas). */
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
