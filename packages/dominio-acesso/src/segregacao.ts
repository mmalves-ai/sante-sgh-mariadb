// Segregação de funções nas telas do novo (ficha do M06, regra 9; cap-08 §8.3.4 e §8.15): o Gestor de
// acessos não lê a trilha nem concede a si; o Administrador do sistema não concede perfis a si nem vê dado
// clínico sem perfil assistencial; o Auditor não altera nada; perfil administrativo nunca recebe permissão
// de categoria clínica (SBIS-10). No legado, a revisão é só recomendada (as regras valem aqui).
//
// Regra 4 (ninguém ganha nem perde) vem antes: a segregação só RETIRA o que veio exclusivamente de perfil
// complementar do novo (recurso novo). O que o legado concede (opção do grupo ou do papel, flag) e o
// autosserviço de toda pessoa (trocar a própria senha, segundo fator, preferências) nunca são retirados:
// o conflito vai para `conflitos`, por motivo, para a revisão do dono e das áreas (pendência do M06).
import type { OrigemConcessao } from './concessao.js';
import type { DestinoGrupo } from './mapa-grupos.js';

export type MotivoRetirada =
  | 'gestor-acessos-nao-le-trilha'
  | 'administrador-sem-perfil-assistencial'
  | 'auditor-nao-altera'
  | 'perfil-administrativo-sem-dado-clinico';

export interface Retirada {
  readonly permissao: string;
  readonly motivo: MotivoRetirada;
}

/** Verbos que só leem ou mostram (o Auditor fica com eles). */
export const VERBOS_DE_LEITURA: ReadonlySet<string> = new Set([
  'ler',
  'acessar',
  'imprimir',
  'exportar',
  'listagem',
  'revisar',
]);

export const PERMISSAO_TRILHA = 'auditoria.trilha.ler';

/** Conflito de segregação mantido porque o legado concede (ou é autosserviço): vai à revisão. */
export type Conflito = Retirada;

export interface ContextoSegregacao {
  readonly perfis: readonly string[];
  /** Origens de cada permissão; sem elas, toda permissão conta como vinda só de perfil. */
  readonly origens?: ReadonlyMap<string, readonly OrigemConcessao[]>;
  readonly destino: DestinoGrupo;
  /** Permissão → categoria (do catálogo). */
  readonly categorias: ReadonlyMap<string, string>;
}

export function aplicarSegregacao(
  brutas: ReadonlySet<string>,
  ctx: ContextoSegregacao,
): { permissoes: Set<string>; retiradas: Retirada[]; conflitos: Conflito[] } {
  const categoria = ctx.categorias;
  const perfis = new Set(ctx.perfis);
  const assistencial = ctx.destino.tipo === 'perfil' && ctx.destino.assistencial;
  const administrativo = ctx.destino.tipo === 'perfil' && !ctx.destino.assistencial;
  const permissoes = new Set<string>();
  const retiradas: Retirada[] = [];
  const conflitos: Conflito[] = [];
  const protegida = (p: string) => (ctx.origens?.get(p) ?? []).some((o) => o.tipo !== 'perfil');
  for (const p of [...brutas].sort()) {
    const verbo = p.split('.')[2] ?? '';
    const clinica = categoria.get(p) === 'clinica';
    let motivo: MotivoRetirada | null = null;
    if (perfis.has('gestor-acessos') && p === PERMISSAO_TRILHA) motivo = 'gestor-acessos-nao-le-trilha';
    else if (perfis.has('auditor') && !VERBOS_DE_LEITURA.has(verbo)) motivo = 'auditor-nao-altera';
    else if (clinica && administrativo) motivo = 'perfil-administrativo-sem-dado-clinico';
    else if (clinica && perfis.has('administrador-sistema') && !assistencial)
      motivo = 'administrador-sem-perfil-assistencial';
    if (motivo && !protegida(p)) retiradas.push({ permissao: p, motivo });
    else {
      if (motivo) conflitos.push({ permissao: p, motivo });
      permissoes.add(p);
    }
  }
  return { permissoes, retiradas, conflitos };
}

/** Quem pode conceder um perfil a quem (gestão de acessos do M10): nunca a si mesmo. */
export function podeConceder(
  concedente: { readonly login: string; readonly perfis: readonly string[] },
  alvo: { readonly login: string },
): { pode: boolean; motivo: string | null } {
  if (concedente.login === alvo.login) return { pode: false, motivo: 'ninguem-concede-a-si' };
  if (!concedente.perfis.includes('gestor-acessos')) return { pode: false, motivo: 'so-gestor-de-acessos' };
  return { pode: true, motivo: null };
}
