// Regras CASL (RBAC + ABAC) iguais no servidor e na tela (ficha do M06, regra 5; cap-08 §8.4): uma regra por
// permissão concedida (`acao` sobre `modulo.recurso`) com as condições dos escopos do legado que a
// permissão aceita (lista vazia no legado = sem restrição naquele escopo). O servidor usa na guarda e no
// filtro das consultas; a tela (`v-pode`) usa a mesma função sobre a mesma sessão. O vínculo assistencial
// não é condição CASL: é o passo 5 da decisão (decisao.ts), por porta.
import { createMongoAbility, type MongoAbility, type RawRuleOf, subject } from '@casl/ability';
import type { EscopoPermissao, EscoposSessao } from '@sgh/contratos';

export type AbilitySgh = MongoAbility;
export type RegraSgh = RawRuleOf<AbilitySgh>;

/** Escopos que cada módulo do novo aceita (os mesmos do catálogo gerado; o vínculo fica fora do CASL). */
export const ESCOPOS_DO_MODULO: Readonly<Record<string, readonly EscopoPermissao[]>> = {
  pep: ['unidade', 'vinculo'],
  sadt: ['unidade', 'vinculo'],
  cirurgia: ['unidade', 'vinculo'],
  recepcao: ['unidade', 'local'],
  agenda: ['unidade', 'tipoAgenda'],
  faturamento: ['convenio'],
  suprimentos: ['localEstoque', 'centroCusto'],
  financeiro: ['contaBancaria'],
};

const LISTA_DO_ESCOPO: Readonly<Record<Exclude<EscopoPermissao, 'vinculo'>, keyof EscoposSessao>> = {
  unidade: 'unidades',
  local: 'locais',
  convenio: 'convenios',
  centroCusto: 'centrosCusto',
  localEstoque: 'locaisEstoque',
  contaBancaria: 'contasBancarias',
  tipoAgenda: 'tiposAgenda',
  tipoProntuario: 'tiposProntuario',
};

export function escoposDaPermissao(codigo: string): readonly EscopoPermissao[] {
  return ESCOPOS_DO_MODULO[codigo.split('.')[0] ?? ''] ?? [];
}

/** `pep.evolucao.ler` → ação `ler`, sujeito `pep.evolucao`. */
export function partesDaPermissao(codigo: string): { acao: string; sujeito: string } {
  const i = codigo.lastIndexOf('.');
  return { acao: codigo.slice(i + 1), sujeito: codigo.slice(0, i) };
}

export function regrasDeAcesso(
  permissoes: Iterable<string>,
  escopos: EscoposSessao | null | undefined,
): RegraSgh[] {
  const regras: RegraSgh[] = [];
  for (const codigo of [...new Set(permissoes)].sort()) {
    const { acao, sujeito } = partesDaPermissao(codigo);
    const condicoes: Record<string, { $in: string[] }> = {};
    for (const e of escoposDaPermissao(codigo)) {
      if (e === 'vinculo') continue;
      const lista = escopos?.[LISTA_DO_ESCOPO[e]] ?? [];
      if (lista.length > 0) condicoes[e] = { $in: [...lista] };
    }
    regras.push(
      Object.keys(condicoes).length > 0
        ? { action: acao, subject: sujeito, conditions: condicoes }
        : { action: acao, subject: sujeito },
    );
  }
  return regras;
}

export function criarAbility(regras: readonly RegraSgh[]): AbilitySgh {
  return createMongoAbility([...regras]);
}

/** Atributos do registro para as condições (valores comparados como texto, como vêm do legado). */
export type RegistroComEscopo = Readonly<Record<string, string | number | null | undefined>>;

/**
 * A pessoa tem a permissão; com `registro`, também sobre aquele registro (escopo). Sem registro, responde
 * se a permissão existe (tipo), como a guarda da rota.
 */
export function pode(ability: AbilitySgh, codigo: string, registro?: RegistroComEscopo): boolean {
  const { acao, sujeito } = partesDaPermissao(codigo);
  if (!registro) return ability.can(acao, sujeito);
  const objeto: Record<string, string | null> = {};
  for (const [k, v] of Object.entries(registro)) objeto[k] = v === null || v === undefined ? null : String(v);
  return ability.can(acao, subject(sujeito, objeto));
}

/**
 * Filtro da consulta (regra 6): os valores aceitos em cada escopo da permissão; `null` = sem restrição. O
 * adaptador aplica em toda lista (nenhuma lista sai do escopo).
 */
export function filtroDeEscopo(
  codigo: string,
  escopos: EscoposSessao | null | undefined,
): Partial<Record<Exclude<EscopoPermissao, 'vinculo'>, readonly string[] | null>> {
  const r: Partial<Record<Exclude<EscopoPermissao, 'vinculo'>, readonly string[] | null>> = {};
  for (const e of escoposDaPermissao(codigo)) {
    if (e === 'vinculo') continue;
    const lista = escopos?.[LISTA_DO_ESCOPO[e]] ?? [];
    r[e] = lista.length > 0 ? [...lista] : null;
  }
  return r;
}
