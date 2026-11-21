// Regras 4, 5 e 6 do M43 (cap-15 §15.4.1 e §15.4.2; cap-08 §8.3): os usuários que ainda faltam na onda 5.
// - Regra 5: usuário ativo sem grupo (grupo "SEM GRUPO", vazio ou nulo) é revisto com o gestor de acessos antes de
//   entrar: recebe grupo (pela troca de grupo do M10) ou é bloqueado (bloqueio do M10). Nunca se apaga usuário.
// - Regra 4: login do grupo de painéis só é bloqueado depois que a TV ou o totem que o usava passou ao token do novo e
//   foi conferido no setor; enquanto houver TV sem token, o login fica.
// - Regra 6: plantonistas e turnos; a contagem de trilhas concluídas por turno (o turno da turma, registrado com a
//   conclusão) sai no painel de treinamento do M37 (`concluidasPorTurno`).
// "Ativo" é o critério do M37: STATUS = 'T' e não bloqueado (BLOQUEADO diferente de 'T', nulo conta como livre).
import {
  GRUPO_PAINEIS,
  GRUPO_SEM_GRUPO,
  type SubstituicaoPainel,
  TURNOS_TREINO,
  type TurnoTreino,
} from '@sgh/contratos';

export interface UsuarioLido {
  readonly login: string;
  readonly grupo: string | null;
  /** Situação do usuário ('T' ativo). */
  readonly status: string | null;
  /** Bloqueio do usuário ('T' bloqueado; 'F' ou nulo, livre). */
  readonly bloqueado: string | null;
}

const up = (s: string | null | undefined) => (s ?? '').trim().toUpperCase();

/** Ativo pelo critério do M37. */
export const ehAtivo = (u: Pick<UsuarioLido, 'status' | 'bloqueado'>): boolean =>
  up(u.status) === 'T' && up(u.bloqueado) !== 'T';

/** Sem grupo: o grupo "SEM GRUPO", vazio ou nulo (regra 5: a contagem inclui os dois). */
export const ehSemGrupo = (grupo: string | null): boolean => {
  const g = up(grupo);
  return g === '' || g === GRUPO_SEM_GRUPO;
};

export const ehLoginDePainel = (grupo: string | null): boolean => up(grupo) === GRUPO_PAINEIS;

export type DecisaoSemGrupo =
  { readonly tipo: 'atribuir-grupo'; readonly grupo: string } | { readonly tipo: 'bloquear' };

export interface RevisaoSemGrupo {
  /** Ativos sem grupo ainda sem decisão do gestor de acessos (a lista tem de ficar vazia ao fim). */
  readonly pendentes: readonly string[];
  /** Decisões a executar pelas operações do M10 (troca de grupo ou bloqueio), na ordem dos logins. */
  readonly aExecutar: readonly { readonly login: string; readonly decisao: DecisaoSemGrupo }[];
  /** Decisões recusadas: login que não é ativo sem grupo, ou grupo destino inválido. */
  readonly recusadas: readonly { readonly login: string; readonly motivo: string }[];
  /**
   * Parcelas impressas: grupo "SEM GRUPO", grupo nulo ou vazio e, dentro do total, os de login vazio (existe 1 na cópia
   * de referência: nenhuma operação do Sante age sobre login vazio; fica pendente até o gestor de acessos registrar a
   * decisão no registro do fim, campo `loginVazio`, e então aparece na revisão como exceção).
   */
  readonly parcelas: { readonly semGrupo: number; readonly nulo: number; readonly loginVazio: number };
}

/**
 * Revisão dos ativos sem grupo (regra 5). `gruposAtivos` são os nomes ativos da tabela de grupos; o destino não pode
 * ser o próprio "SEM GRUPO" nem o de painéis (login de pessoa não vira login de TV).
 */
export function revisarSemGrupo(
  usuarios: readonly UsuarioLido[],
  decisoes: ReadonlyMap<string, DecisaoSemGrupo>,
  gruposAtivos: readonly string[],
): RevisaoSemGrupo {
  const ativosSemGrupo = usuarios
    .filter((u) => ehAtivo(u) && ehSemGrupo(u.grupo))
    .sort((a, b) => a.login.localeCompare(b.login));
  const alvos = new Map(ativosSemGrupo.map((u) => [up(u.login), u]));
  const grupos = new Set(gruposAtivos.map(up));
  const pendentes: string[] = [];
  const aExecutar: { login: string; decisao: DecisaoSemGrupo }[] = [];
  const recusadas: { login: string; motivo: string }[] = [];
  const decisoesNorm = new Map([...decisoes].map(([k, v]) => [up(k), v]));
  for (const u of ativosSemGrupo) {
    const d = up(u.login) === '' ? undefined : decisoesNorm.get(up(u.login));
    if (!d) {
      pendentes.push(u.login);
      continue;
    }
    if (d.tipo === 'atribuir-grupo') {
      const g = up(d.grupo);
      if (g === GRUPO_SEM_GRUPO || g === GRUPO_PAINEIS || g === '') {
        recusadas.push({ login: u.login, motivo: 'grupo de destino não é de trabalho' });
        continue;
      }
      if (!grupos.has(g)) {
        recusadas.push({ login: u.login, motivo: 'grupo de destino inexistente ou inativo' });
        continue;
      }
    }
    aExecutar.push({ login: u.login, decisao: d });
  }
  for (const k of decisoesNorm.keys())
    if (!alvos.has(k)) recusadas.push({ login: k, motivo: 'não é usuário ativo sem grupo' });
  const nulo = ativosSemGrupo.filter((u) => up(u.grupo) === '').length;
  return {
    pendentes,
    aExecutar,
    recusadas,
    parcelas: {
      semGrupo: ativosSemGrupo.length - nulo,
      nulo,
      loginVazio: ativosSemGrupo.filter((x) => up(x.login) === '').length,
    },
  };
}

/** O que se sabe do dispositivo do M19 que substitui a TV ou o totem. */
export interface DispositivoLido {
  readonly id: number;
  readonly hospital: string;
  readonly tipo: 'totem' | 'painel' | 'paineltv';
  /** Válido até (ISO); revogado quando `revogadoEm` não é nulo. */
  readonly validoAte: string;
  readonly revogadoEm: string | null;
}

export type SituacaoLoginPainel =
  'bloqueado' | 'sem-substituicao' | 'dispositivo-invalido' | 'pode-bloquear' | 'bloqueado-sem-substituicao';

export interface LoginPainelAvaliado {
  readonly login: string;
  readonly situacao: SituacaoLoginPainel;
  readonly dispositivo: number | null;
  readonly conferidoEm: string | null;
}

/**
 * Situação de cada login do grupo de painéis (regra 4). Pode bloquear só com substituição registrada, conferida, e o
 * dispositivo do mesmo hospital, válido em `agora` e não revogado. Login já bloqueado sem substituição registrada é
 * mostrado à parte (a TV dele pode ter ficado sem tela).
 */
export function avaliarLoginsDePainel(
  usuarios: readonly UsuarioLido[],
  substituicoes: readonly SubstituicaoPainel[],
  dispositivos: readonly DispositivoLido[],
  hospital: string,
  agora: string,
): LoginPainelAvaliado[] {
  const subs = new Map(substituicoes.map((s) => [up(s.login), s]));
  const disp = new Map(dispositivos.map((d) => [d.id, d]));
  return usuarios
    .filter((u) => ehLoginDePainel(u.grupo))
    .sort((a, b) => a.login.localeCompare(b.login))
    .map((u) => {
      const s = subs.get(up(u.login));
      const base = {
        login: u.login,
        dispositivo: s?.dispositivo ?? null,
        conferidoEm: s?.conferidoEm ?? null,
      };
      const bloqueado = up(u.bloqueado) === 'T';
      if (!s) return { ...base, situacao: bloqueado ? 'bloqueado-sem-substituicao' : 'sem-substituicao' };
      if (bloqueado) return { ...base, situacao: 'bloqueado' };
      const d = disp.get(s.dispositivo);
      const valido =
        d !== undefined &&
        d.hospital === hospital &&
        d.revogadoEm === null &&
        Date.parse(d.validoAte) > Date.parse(agora);
      return { ...base, situacao: valido ? 'pode-bloquear' : 'dispositivo-invalido' };
    });
}

/**
 * Critério de aceite ("logins de painel sem TV ativa bloqueados"): nenhum login com a TV já no token esperando o
 * bloqueio ('pode-bloquear') nem com substituição apontando para dispositivo inválido. Login sem substituição é o de
 * uma TV que ainda o usa (cap-08 §8.3: as TVs continuam com esses logins enquanto existirem).
 */
export const loginsDePainelResolvidos = (a: readonly LoginPainelAvaliado[]): boolean =>
  a.every((x) => x.situacao !== 'pode-bloquear' && x.situacao !== 'dispositivo-invalido');

/** O aparelho do M19 com o vínculo do M43 (script 0430): o login substituído e a conferência no setor. */
export interface DispositivoComSubstituicao {
  readonly id: number;
  readonly loginSubstituido: string | null;
  /** Instante da conferência no setor (AAAA-MM-DD…), ou null. */
  readonly conferidoEm: string | null;
  readonly revogadoEm: string | null;
  readonly validoAte: string;
}

/**
 * As substituições de painel registradas nos aparelhos (regra 4; D-PAINEL-43): uma por login, a do aparelho conferido
 * ainda válido quando houver (o aparelho revogado só vale se não houver outro, e aí a avaliação mostra o token inválido),
 * mais as do registro versionado que não tenham aparelho conferido.
 */
export function substituicoesDosDispositivos(
  dispositivos: readonly DispositivoComSubstituicao[],
  agora: string,
  doRegistro: readonly SubstituicaoPainel[] = [],
): SubstituicaoPainel[] {
  const porLogin = new Map<string, { s: SubstituicaoPainel; valido: boolean }>();
  for (const d of dispositivos) {
    if (!d.loginSubstituido || !d.conferidoEm) continue;
    const valido = d.revogadoEm === null && Date.parse(d.validoAte) > Date.parse(agora);
    const k = up(d.loginSubstituido);
    const atual = porLogin.get(k);
    if (atual && (atual.valido || !valido)) continue;
    porLogin.set(k, {
      valido,
      s: {
        login: d.loginSubstituido.trim(),
        dispositivo: d.id,
        conferidoEm: d.conferidoEm.slice(0, 10),
        papel: 'ti',
      },
    });
  }
  const r = [...porLogin.values()].map((x) => x.s);
  for (const s of doRegistro) if (!porLogin.has(up(s.login))) r.push(s);
  return r.sort((a, b) => a.login.localeCompare(b.login));
}

/**
 * Regra 4 na tela de usuários do M10: o login do grupo de painéis só é bloqueado com o aparelho que o substitui no
 * token, válido e conferido no setor. `doRegistro` são as substituições do registro versionado do fim (as mesmas que a
 * revisão considera; o aparelho continua tendo de existir, ser do hospital e estar válido). Devolve null quando pode, ou
 * o motivo da recusa (texto de produto).
 */
export function motivoBloqueioLoginPainel(
  login: string,
  dispositivos: readonly (DispositivoComSubstituicao & {
    readonly hospital: string;
    readonly tipo: string;
  })[],
  hospital: string,
  agora: string,
  doRegistro: readonly SubstituicaoPainel[] = [],
): string | null {
  const [a] = avaliarLoginsDePainel(
    [{ login, grupo: GRUPO_PAINEIS, status: 'T', bloqueado: 'F' }],
    substituicoesDosDispositivos(dispositivos, agora, doRegistro),
    dispositivos.map((d) => ({
      id: d.id,
      hospital: d.hospital,
      tipo: d.tipo as DispositivoLido['tipo'],
      validoAte: d.validoAte,
      revogadoEm: d.revogadoEm,
    })),
    hospital,
    agora,
  );
  if (!a || a.situacao === 'pode-bloquear') return null;
  return a.situacao === 'dispositivo-invalido'
    ? 'O aparelho que substitui este login está revogado ou fora da validade: emita e confira um aparelho válido antes de bloquear.'
    : 'Este login ainda é o da TV ou do totem: cadastre o aparelho com token, confira no setor e só então bloqueie.';
}

export type TurnoContado = TurnoTreino | 'nao-informado';

/**
 * Regra 6: pessoas com a trilha concluída (aprovada) por turno da turma, na ordem dos turnos e com "nao-informado" por
 * último. A pessoa conta uma vez em cada turno em que concluiu; turno fora da lista conta como não informado.
 */
export function concluidasPorTurno(
  conclusoes: readonly {
    readonly login: string;
    readonly turno?: string | null;
    readonly resultado: string;
  }[],
): { turno: TurnoContado; pessoas: number }[] {
  const ordem: readonly TurnoContado[] = [...TURNOS_TREINO, 'nao-informado'];
  const por = new Map<TurnoContado, Set<string>>(ordem.map((t) => [t, new Set<string>()]));
  for (const c of conclusoes) {
    if (c.resultado !== 'aprovado') continue;
    const t = (TURNOS_TREINO as readonly string[]).includes(c.turno ?? '')
      ? (c.turno as TurnoTreino)
      : 'nao-informado';
    por.get(t)!.add(up(c.login));
  }
  return ordem.map((turno) => ({ turno, pessoas: por.get(turno)!.size }));
}
