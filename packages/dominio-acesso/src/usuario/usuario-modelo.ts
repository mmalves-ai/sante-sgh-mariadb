// W1-01 (parte 12a; mercado n: "Aplicar acessos de…" a partir de um usuário-modelo, mostrando a diferença antes de
// gravar e respeitando a segregação). Puro: quem chama lê as duas contas ao vivo e grava cada passo pela via de
// sempre (grupo e papel SBIS pelo executor do legado; perfil do Sante em SGH_ACESSO_PERFIL_USUARIO).
//
// Acessos copiados: o grupo do usuário, os papéis SBIS ativos e as concessões nominais
// vigentes dos perfis do Sante (com o mesmo fim, se a do modelo for temporária). Modos:
//   - 'somar': só acrescenta o que falta ao alvo;
//   - 'igualar': também retira do alvo o papel e o perfil que o modelo não tem.
// Segregação (D-W101-47): o modelo NUNCA propaga nem retira privilégio de gestão (grupo de acesso total, papéis
// SBIS 0 e 1, perfis gestor-acessos e administrador-sistema): isso só por decisão nominal, na ficha. O perfil que vem
// do conselho não se copia (vem da conferência do registro). O auditor (perfil ou papel 2) não se acumula com o
// gestor de acessos nem com o administrador. O que fica de fora aparece em `ignorados`, com o motivo, na prévia.
// Ninguém aplica no próprio acesso; o auditor só consulta; modelo e alvo são contas diferentes, ativas e não
// bloqueadas.
import { PERFIL_DO_PAPEL } from '../concessao.js';
import { chaveGrupo } from '../mapa-grupos.js';
import { mesmoLogin } from './login.js';
import { conferirGestao, type OperadorGestao } from './segregacao-gestao.js';
import { GRUPO_ACESSO_TOTAL, PERFIL_GESTOR_ACESSOS } from './ultimo-gestor.js';

export const MOTIVO_MODELO_MINIMO = 10;

/** Perfis de gestão que só se concedem ou retiram nominalmente (nunca por modelo). */
export const PERFIS_PRIVILEGIADOS_MODELO: readonly string[] = [
  PERFIL_GESTOR_ACESSOS,
  'administrador-sistema',
];
/** Perfis que vêm de outra fonte (o conselho) e não se copiam. */
export const PERFIS_NAO_COPIAVEIS_MODELO: readonly string[] = ['assistencial-com-conselho'];
/** Pares que a segregação de funções não deixa acumular. */
export const PARES_SEGREGADOS_MODELO: readonly (readonly [string, string])[] = [
  ['auditor', PERFIL_GESTOR_ACESSOS],
  ['auditor', 'administrador-sistema'],
];

export type ModoModelo = 'somar' | 'igualar';

export interface PapelDaConta {
  readonly papel: number;
  readonly nome: string;
  readonly ativo: boolean;
}

/** Concessão nominal vigente (ou futura) de um perfil do Sante. `fim` em ISO ou null. */
export interface PerfilDaConta {
  readonly id: string;
  readonly perfil: string;
  readonly fim: string | null;
}

export interface ContaModelo {
  readonly login: string;
  readonly ativo: boolean;
  readonly bloqueado: boolean;
  readonly grupo: string | null;
  readonly papeis: readonly PapelDaConta[];
  readonly perfis: readonly PerfilDaConta[];
}

export type MotivoIgnoradoModelo = 'privilegio-nominal' | 'vem-do-conselho' | 'grupo-inativo' | 'segregacao';

export interface IgnoradoModelo {
  readonly tipo: 'grupo' | 'papel' | 'perfil';
  readonly item: string;
  readonly motivo: MotivoIgnoradoModelo;
}

export interface PlanoModelo {
  readonly grupo: { readonly de: string | null; readonly para: string } | null;
  readonly papeisConceder: readonly { readonly papel: number; readonly nome: string }[];
  readonly papeisReativar: readonly { readonly papel: number; readonly nome: string }[];
  readonly papeisRetirar: readonly { readonly papel: number; readonly nome: string }[];
  readonly perfisConceder: readonly { readonly perfil: string; readonly fim: string | null }[];
  readonly perfisRetirar: readonly { readonly id: string; readonly perfil: string }[];
  /** Quantos acessos o alvo já tem igual ao modelo (grupo, papéis e perfis). */
  readonly iguais: number;
  readonly ignorados: readonly IgnoradoModelo[];
}

export type CodigoRecusaModelo =
  'a-si-mesmo' | 'auditor-nao-altera' | 'modelo-e-o-alvo' | 'modelo-indisponivel' | 'alvo-indisponivel';

export interface RecusaModelo {
  readonly codigo: CodigoRecusaModelo;
  readonly mensagem: string;
}

/** Recusa antes de calcular (null: pode). */
export function conferirAplicarModelo(
  operador: OperadorGestao,
  modelo: Pick<ContaModelo, 'login' | 'ativo' | 'bloqueado'>,
  alvo: Pick<ContaModelo, 'login' | 'ativo' | 'bloqueado'>,
): RecusaModelo | null {
  const g = conferirGestao(operador, 'alterar-escopo', alvo.login);
  if (g === 'auditor-nao-altera')
    return { codigo: g, mensagem: 'O perfil de auditoria só consulta: não altera dado nem acesso.' };
  if (g === 'a-si-mesmo')
    return { codigo: g, mensagem: 'Ninguém altera o próprio acesso (segregação de funções).' };
  if (mesmoLogin(modelo.login, alvo.login))
    return { codigo: 'modelo-e-o-alvo', mensagem: 'Escolha como modelo outro usuário, diferente do alvo.' };
  if (!modelo.ativo || modelo.bloqueado)
    return {
      codigo: 'modelo-indisponivel',
      mensagem: 'O usuário-modelo está inativo ou bloqueado: escolha uma conta em uso.',
    };
  if (!alvo.ativo || alvo.bloqueado)
    return {
      codigo: 'alvo-indisponivel',
      mensagem: 'A conta está inativa ou bloqueada: desbloqueie antes de aplicar acessos.',
    };
  return null;
}

const privilegiado = (perfil: string) => PERFIS_PRIVILEGIADOS_MODELO.includes(perfil);
/** Papel SBIS de gestão (0 Gestor de acessos, 1 Administrador): pelo perfil equivalente. */
const papelPrivilegiado = (papel: number) => privilegiado(PERFIL_DO_PAPEL[papel] ?? '');
const grupoTotal = (g: string | null) => g !== null && chaveGrupo(g) === GRUPO_ACESSO_TOTAL;

/**
 * A diferença entre o modelo e o alvo. `gruposAtivos`: nomes dos grupos ativos do estabelecimento (o grupo inativo do
 * modelo não se copia). Determinística: mesma entrada, mesmo plano (a prévia e a gravação conferem a mesma).
 */
export function planoDoModelo(
  modelo: ContaModelo,
  alvo: ContaModelo,
  modo: ModoModelo,
  gruposAtivos: ReadonlySet<string>,
): PlanoModelo {
  const ignorados: IgnoradoModelo[] = [];
  let iguais = 0;

  // Grupo.
  let grupo: PlanoModelo['grupo'] = null;
  if (modelo.grupo !== null) {
    if (modelo.grupo === alvo.grupo) iguais++;
    else if (grupoTotal(modelo.grupo) || grupoTotal(alvo.grupo))
      ignorados.push({ tipo: 'grupo', item: modelo.grupo, motivo: 'privilegio-nominal' });
    else if (!gruposAtivos.has(modelo.grupo))
      ignorados.push({ tipo: 'grupo', item: modelo.grupo, motivo: 'grupo-inativo' });
    else grupo = { de: alvo.grupo, para: modelo.grupo };
  }

  const naoCopiavel = (perfil: string) => PERFIS_NAO_COPIAVEIS_MODELO.includes(perfil);
  const rotuloPapel = (p: { papel: number; nome: string }) => `${p.papel} ${p.nome}`;

  // Papéis SBIS ativos do modelo e perfis nominais do modelo (duas concessões do mesmo perfil: vale a de fim mais
  // longe; sem fim ganha).
  const ativosModelo = modelo.papeis.filter((p) => p.ativo).sort((a, b) => a.papel - b.papel);
  const papeisDoModelo = new Set(ativosModelo.map((p) => p.papel));
  const perfisModelo = new Map<string, string | null>();
  for (const p of [...modelo.perfis].sort((a, b) => a.perfil.localeCompare(b.perfil))) {
    const atual = perfisModelo.get(p.perfil);
    if (atual === undefined || (atual !== null && (p.fim === null || p.fim > atual)))
      perfisModelo.set(p.perfil, p.fim);
  }

  // Retiradas (só no 'igualar'): primeiro, para a segregação olhar o que fica.
  const papeisRetirar: { papel: number; nome: string }[] = [];
  const perfisRetirar: { id: string; perfil: string }[] = [];
  if (modo === 'igualar') {
    for (const a of [...alvo.papeis].sort((x, y) => x.papel - y.papel)) {
      if (!a.ativo || papeisDoModelo.has(a.papel)) continue;
      if (papelPrivilegiado(a.papel))
        ignorados.push({ tipo: 'papel', item: rotuloPapel(a), motivo: 'privilegio-nominal' });
      else papeisRetirar.push({ papel: a.papel, nome: a.nome });
    }
    const ordenados = [...alvo.perfis].sort(
      (x, y) => x.perfil.localeCompare(y.perfil) || x.id.localeCompare(y.id),
    );
    for (const a of ordenados) {
      if (perfisModelo.has(a.perfil)) continue;
      if (privilegiado(a.perfil))
        ignorados.push({ tipo: 'perfil', item: a.perfil, motivo: 'privilegio-nominal' });
      else if (naoCopiavel(a.perfil))
        ignorados.push({ tipo: 'perfil', item: a.perfil, motivo: 'vem-do-conselho' });
      else perfisRetirar.push({ id: a.id, perfil: a.perfil });
    }
  }

  // O que o alvo fica tendo (perfis nominais e os perfis dos papéis ativos), para os pares segregados.
  const ficam = new Set<string>();
  for (const p of alvo.perfis) if (!perfisRetirar.some((r) => r.id === p.id)) ficam.add(p.perfil);
  for (const p of alvo.papeis) {
    const perfil = PERFIL_DO_PAPEL[p.papel];
    if (p.ativo && perfil && !papeisRetirar.some((r) => r.papel === p.papel)) ficam.add(perfil);
  }
  const conflita = (perfil: string | undefined) =>
    perfil !== undefined &&
    PARES_SEGREGADOS_MODELO.some(
      ([a, b]) => (perfil === a && ficam.has(b)) || (perfil === b && ficam.has(a)),
    );

  // Papéis a conceder ou reativar.
  const doAlvo = new Map(alvo.papeis.map((p) => [p.papel, p]));
  const papeisConceder: { papel: number; nome: string }[] = [];
  const papeisReativar: { papel: number; nome: string }[] = [];
  for (const p of ativosModelo) {
    const a = doAlvo.get(p.papel);
    if (a?.ativo) {
      iguais++;
      continue;
    }
    const perfil = PERFIL_DO_PAPEL[p.papel];
    if (papelPrivilegiado(p.papel))
      ignorados.push({ tipo: 'papel', item: rotuloPapel(p), motivo: 'privilegio-nominal' });
    else if (conflita(perfil)) ignorados.push({ tipo: 'papel', item: rotuloPapel(p), motivo: 'segregacao' });
    else {
      (a ? papeisReativar : papeisConceder).push({ papel: p.papel, nome: p.nome });
      if (perfil) ficam.add(perfil);
    }
  }

  // Perfis do Sante a conceder (com o mesmo fim da concessão do modelo).
  const perfisAlvo = new Set(alvo.perfis.map((p) => p.perfil));
  const perfisConceder: { perfil: string; fim: string | null }[] = [];
  for (const [perfil, fim] of perfisModelo) {
    if (perfisAlvo.has(perfil)) {
      iguais++;
      continue;
    }
    if (privilegiado(perfil)) ignorados.push({ tipo: 'perfil', item: perfil, motivo: 'privilegio-nominal' });
    else if (naoCopiavel(perfil)) ignorados.push({ tipo: 'perfil', item: perfil, motivo: 'vem-do-conselho' });
    else if (conflita(perfil)) ignorados.push({ tipo: 'perfil', item: perfil, motivo: 'segregacao' });
    else {
      perfisConceder.push({ perfil, fim });
      ficam.add(perfil);
    }
  }

  return {
    grupo,
    papeisConceder,
    papeisReativar,
    papeisRetirar,
    perfisConceder,
    perfisRetirar,
    iguais,
    ignorados,
  };
}

/** Quantos passos de gravação o plano tem (0: nada a aplicar). */
export function passosDoPlano(p: PlanoModelo): number {
  return (
    (p.grupo ? 1 : 0) +
    p.papeisConceder.length +
    p.papeisReativar.length +
    p.papeisRetirar.length +
    p.perfisConceder.length +
    p.perfisRetirar.length
  );
}

/** Texto canônico do plano (a API resume em sha256: a gravação só aceita o plano que a prévia mostrou). */
export function textoCanonicoDoPlano(modelo: string, alvo: string, modo: ModoModelo, p: PlanoModelo): string {
  return JSON.stringify([
    modelo,
    alvo,
    modo,
    p.grupo,
    p.papeisConceder,
    p.papeisReativar,
    p.papeisRetirar,
    p.perfisConceder,
    p.perfisRetirar,
  ]);
}
