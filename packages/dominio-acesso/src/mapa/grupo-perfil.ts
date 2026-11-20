// Proposta do mapa grupo → perfil para a tela "Grupos de usuários e perfis" (ficha do M10, regra 6; cap-08 §8.2,
// §8.7, §8.15): a proposta automática sai das permissões que o grupo USA (as opções do legado concedidas ao
// grupo, traduzidas para o catálogo) e do mapa dos 42 grupos (mapa-grupos.ts). Os grupos de acesso amplo
// (MASTER, com 3.807 permissões; MASTER_SEM_FINANCEIRO, 2.540; SEM GRUPO, 1.016) e todo grupo acima do teto de
// permissões NÃO recebem perfil assistencial automático: ficam marcados para revisão individual. A revisão por
// área é RECOMENDADA, não exigida: até ela, o acesso do legado continua valendo (concessão provisória).
import type { CategoriaPermissao } from '@sgh/contratos';
import { chaveGrupo, destinoDoGrupo, type DestinoGrupo } from '../mapa-grupos.js';

/** Acima disto o grupo é "de acesso amplo" (o maior grupo de área no pc tem 520 permissões). */
export const TETO_ACESSO_AMPLO = 1000;

/** Grupos de acesso amplo nomeados pela ficha (sempre revisão individual). */
export const GRUPOS_ACESSO_AMPLO = new Set([
  'MASTER',
  'MASTER_SEM_FINANCEIRO',
  'MASTER_CONSULTA_FINANCEIRO',
  'SEM GRUPO',
]);

export interface PermissoesDoGrupo {
  readonly grupo: string;
  /** Permissões do catálogo que o grupo usa, com a categoria de cada uma. */
  readonly permissoes: readonly { readonly codigo: string; readonly categoria: CategoriaPermissao | null }[];
  readonly usuariosAtivos: number;
}

export type SituacaoRevisao = 'recomendada' | 'individual' | 'sem-usuarios';

export interface PropostaGrupo {
  readonly grupo: string;
  /** Perfil proposto (ou null: revisão individual, painel ou grupo sem usuário). */
  readonly perfil: string | null;
  readonly origem: 'mapa-dos-grupos' | 'permissoes-usadas' | 'nenhuma';
  readonly assistencial: boolean;
  readonly revisao: SituacaoRevisao;
  readonly motivo: string;
  /** Contagem por categoria das permissões usadas (o que embasa a proposta). */
  readonly porCategoria: Readonly<Record<CategoriaPermissao | 'sem-categoria', number>>;
  readonly total: number;
}

/** Perfil de área proposto pela categoria dominante (só quando o grupo não está no mapa). */
const PERFIL_DA_CATEGORIA: Readonly<Record<CategoriaPermissao, string | null>> = {
  // Clínica dominante sem o mapa: não se adivinha a profissão (conselho, categoria): revisão da área.
  clinica: null,
  administrativa: 'administrativo-area',
  financeira: 'financeiro',
  tecnica: null,
};

function contar(p: PermissoesDoGrupo['permissoes']): PropostaGrupo['porCategoria'] {
  const r = { clinica: 0, administrativa: 0, financeira: 0, tecnica: 0, 'sem-categoria': 0 };
  for (const x of p) r[x.categoria ?? 'sem-categoria']++;
  return r;
}

/** Proposta automática de um grupo (regra 6). */
export function proporPerfilDoGrupo(g: PermissoesDoGrupo): PropostaGrupo {
  const porCategoria = contar(g.permissoes);
  const total = g.permissoes.length;
  const base = { grupo: g.grupo, porCategoria, total };
  const chave = chaveGrupo(g.grupo);
  if (GRUPOS_ACESSO_AMPLO.has(chave) || total > TETO_ACESSO_AMPLO)
    return {
      ...base,
      perfil: null,
      origem: 'nenhuma',
      assistencial: false,
      revisao: 'individual',
      motivo: `Acesso amplo (${total} permissões): revisão individual de cada usuário; nenhum perfil assistencial automático. O acesso atual continua valendo até a revisão.`,
    };
  const d: DestinoGrupo = destinoDoGrupo(g.grupo);
  if (d.tipo === 'perfil')
    return {
      ...base,
      perfil: d.perfil,
      origem: 'mapa-dos-grupos',
      assistencial: d.assistencial,
      revisao: g.usuariosAtivos > 0 ? 'recomendada' : 'sem-usuarios',
      motivo: `Proposta pelo mapa dos grupos (${d.nivel}, ${d.categoria}). A revisão da área é recomendada; até ela, a concessão é provisória.`,
    };
  if (d.tipo === 'painel' || d.tipo === 'continua-no-legado')
    return {
      ...base,
      perfil: null,
      origem: 'nenhuma',
      assistencial: false,
      revisao: g.usuariosAtivos > 0 ? 'individual' : 'sem-usuarios',
      motivo: d.motivo,
    };
  // Fora do mapa (grupo criado depois): pela categoria dominante, nunca assistencial por adivinhação.
  const dominante = (['administrativa', 'financeira', 'clinica', 'tecnica'] as const)
    .map((c) => [c, porCategoria[c]] as const)
    .sort((a, b) => b[1] - a[1])[0];
  const perfil = dominante && dominante[1] > 0 ? PERFIL_DA_CATEGORIA[dominante[0]] : null;
  return {
    ...base,
    perfil,
    origem: perfil ? 'permissoes-usadas' : 'nenhuma',
    assistencial: false,
    revisao: g.usuariosAtivos > 0 ? (perfil ? 'recomendada' : 'individual') : 'sem-usuarios',
    motivo: perfil
      ? `Proposta pelas permissões usadas (maioria ${dominante?.[0]}: ${dominante?.[1]} de ${total}). Revisão da área recomendada.`
      : 'Sem categoria que permita propor um perfil sem adivinhar: revisão da área.',
  };
}
