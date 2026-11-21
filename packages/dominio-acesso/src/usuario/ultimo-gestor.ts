// W1-01 (parte 3c; matriz de governança, linha "Profissional / usuário do sistema": sempre ≥1 administrador ativo;
// mercado: "inativar sem excluir e garantir um administrador mínimo"): nenhuma operação deixa o estabelecimento sem
// gestor de acessos ativo. Gestor de acessos ativo = conta ativa e não bloqueada com pelo menos uma destas fontes:
//   - grupo de acesso total (grupo MASTER, a chave GRUPO_ADMINISTRADORES);
//   - papel SBIS "Gestor de acessos" ativo (papel de segurança 0 do usuário; PERFIL_DO_PAPEL);
//   - concessão nominal vigente do perfil `gestor-acessos` (SGH_ACESSO_PERFIL_USUARIO).
// Recusa bloquear, rebaixar (trocar de grupo para fora do acesso total ou retirar o papel 0) ou retirar o perfil
// quando a ação zeraria o conjunto. Puro: quem chama lê o conjunto ao vivo, sem cache (falha fechada se não ler).
import { chaveGrupo } from '../mapa-grupos.js';
import { mesmoLogin } from './login.js';

/** A chave do grupo de acesso total (igual a GRUPO_ADMINISTRADORES dos contratos do saneamento). */
export const GRUPO_ACESSO_TOTAL = 'MASTER';
/** Código do papel de segurança SBIS "Gestor de acessos" (PERFIL_DO_PAPEL[0] = 'gestor-acessos'). */
export const PAPEL_GESTOR_ACESSOS = 0;
export const PERFIL_GESTOR_ACESSOS = 'gestor-acessos';

export interface GestorAcessoAtivo {
  readonly login: string;
  /** No grupo de acesso total. */
  readonly grupoAcessoTotal: boolean;
  /** Com o papel SBIS 0 ativo. */
  readonly papelGestor: boolean;
  /** IDs das concessões vigentes do perfil gestor-acessos (SGH_ACESSO_PERFIL_USUARIO). */
  readonly concessoes: readonly string[];
}

export type AcaoSobreGestor =
  | { readonly tipo: 'bloquear'; readonly login: string }
  | { readonly tipo: 'trocar-grupo'; readonly login: string; readonly grupoNovo: string }
  | { readonly tipo: 'retirar-papel'; readonly login: string; readonly papel: number }
  | { readonly tipo: 'retirar-perfil'; readonly concessao: string };

export type RecusaUltimoGestor = 'ultimo-gestor-acessos';

function ehGestor(g: GestorAcessoAtivo): boolean {
  return g.grupoAcessoTotal || g.papelGestor || g.concessoes.length > 0;
}

function depois(g: GestorAcessoAtivo, a: AcaoSobreGestor): GestorAcessoAtivo | null {
  if (a.tipo === 'retirar-perfil')
    return g.concessoes.includes(a.concessao)
      ? { ...g, concessoes: g.concessoes.filter((c) => c !== a.concessao) }
      : g;
  if (!mesmoLogin(g.login, a.login)) return g;
  switch (a.tipo) {
    case 'bloquear':
      return null;
    case 'trocar-grupo':
      return { ...g, grupoAcessoTotal: chaveGrupo(a.grupoNovo) === GRUPO_ACESSO_TOTAL };
    case 'retirar-papel':
      return a.papel === PAPEL_GESTOR_ACESSOS ? { ...g, papelGestor: false } : g;
  }
}

/**
 * Confere a ação contra os gestores de acessos ativos do estabelecimento (só as contas ativas e não bloqueadas).
 * Recusa quando havia gestor e a ação deixaria nenhum. Sem gestor hoje (estabelecimento novo ou dado já
 * inconsistente), não recusa: a ação não piora o que existe e o painel de saneamento mostra a falta.
 */
export function conferirUltimoGestor(
  gestores: readonly GestorAcessoAtivo[],
  acao: AcaoSobreGestor,
): RecusaUltimoGestor | null {
  const antes = gestores.filter(ehGestor);
  if (antes.length === 0) return null;
  const restam = antes.flatMap((g) => {
    const d = depois(g, acao);
    return d && ehGestor(d) ? [d] : [];
  });
  return restam.length === 0 ? 'ultimo-gestor-acessos' : null;
}

export function mensagemUltimoGestor(acao: AcaoSobreGestor): string {
  const o =
    acao.tipo === 'bloquear'
      ? 'bloquear este usuário'
      : acao.tipo === 'trocar-grupo'
        ? 'tirar este usuário do grupo de acesso total'
        : acao.tipo === 'retirar-papel'
          ? 'retirar o papel de gestor de acessos'
          : 'retirar o perfil de gestor de acessos';
  return `Não é possível ${o}: é o último gestor de acessos ativo do estabelecimento. Dê o papel ou o perfil de gestor de acessos a outra pessoa antes.`;
}
