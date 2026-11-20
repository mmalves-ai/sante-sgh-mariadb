// Credencial forte e retirada da senha antiga (M59-F2, regras 1 e 2; cap-08 §8.16; SBIS-03, SBIS-04). Regras puras:
//   - No login, quem tem credencial forte (SGH_ACESSO_CREDENCIAL) confere SÓ ela; quem não tem confere a senha do
//     legado no formato do legado e, se casar, a senha digitada é regravada no esquema forte (Argon2id, sal
//     individual: cifrarSenha de cifra-plataforma.ts, o mesmo esquema da plataforma, ADR 0021).
//   - Coexistência: se a senha antiga mudou no legado DEPOIS da credencial forte (DATA_ULTIMA_ALTERACAO_SENHA do
//     mesmo dia civil ou mais nova: a coluna é DATE), a credencial forte está velha: o login volta a conferir a do legado e regrava (nunca vale uma senha
//     que o legado já trocou). Senha antiga já retirada: só a forte, sempre.
//   - Retirar a senha antiga (acesso.retirarSenhaLegado) só com a contingência desligada, com credencial forte,
//     fora do usuário de integração, e quando ainda há senha antiga a retirar.
//   - Situação de cada usuário em classe, contagens só em faixa.
import type { FaixaContagem, SituacaoCredencial } from '@sgh/contratos';

/** O que se sabe da credencial forte, sem o hash. */
export interface CredencialForteLida {
  readonly criadaEm: Date;
  readonly algoritmo: string;
}

/** O que se sabe da senha do legado, sem valor nenhum. */
export interface SenhaLegadoLida {
  /** Há senha guardada (SENHA não nula nem vazia). */
  readonly presente: boolean;
  readonly criptografada: boolean;
  readonly comSalt: boolean;
  readonly alteradaEm: Date | null;
}

/** Algoritmos aceitos como credencial forte (só o nome; os parâmetros vão no próprio texto PHC). */
export const ALGORITMOS_FORTES = ['argon2id'] as const;

export type CaminhoLogin =
  /** Conferir a credencial forte (e nada do legado). */
  | 'forte'
  /** Conferir a do legado e, se casar, regravar a forte. */
  | 'legado-e-regravar';

const UM_DIA_MS = 86_400_000;

/**
 * A senha do legado pode ter mudado depois da credencial forte? DATA_ULTIMA_ALTERACAO_SENHA é DATE (sem hora:
 * chega como a meia-noite do dia), e a troca pode ter sido a qualquer hora desse dia. Por isso a comparação é
 * pelo dia civil: troca no mesmo dia da forte (ou depois) conta como posterior, e o login volta a conferir a do
 * legado e regravar (no mesmo dia, as duas conferem a mesma senha se nada mudou).
 */
export function legadoMudouDepoisDaForte(alteradaEm: Date | null, criadaEm: Date): boolean {
  return !!alteradaEm && alteradaEm.getTime() + UM_DIA_MS > criadaEm.getTime();
}

/** Regra 2: qual credencial o login confere. */
export function caminhoDoLogin(forte: CredencialForteLida | null, legado: SenhaLegadoLida): CaminhoLogin {
  if (!forte || !(ALGORITMOS_FORTES as readonly string[]).includes(forte.algoritmo))
    return 'legado-e-regravar';
  if (!legado.presente) return 'forte';
  if (legadoMudouDepoisDaForte(legado.alteradaEm, forte.criadaEm)) return 'legado-e-regravar';
  return 'forte';
}

/** Classe da situação da senha (a tela de usuários e o resumo). */
export function situacaoCredencial(
  forte: CredencialForteLida | null,
  legado: SenhaLegadoLida,
): SituacaoCredencial {
  if (forte && caminhoDoLogin(forte, legado) === 'forte') return 'forte';
  if (!legado.presente) return 'sem-senha';
  if (!legado.criptografada) return 'legado-texto-puro';
  return legado.comSalt ? 'legado-cifrada' : 'legado-sem-salt';
}

/** Faixa de uma contagem: 0, "<5" ou o número a partir de 5 (nenhum número pequeno identifica alguém). */
export function faixaContagemCredencial(n: number): FaixaContagem {
  if (!Number.isFinite(n) || n <= 0) return 0;
  return n < 5 ? '<5' : Math.trunc(n);
}

/** Contagem por classe, em faixa, com todas as classes presentes (zero inclusive). */
export function contarEmFaixa<K extends string>(
  classes: readonly K[],
  valores: Iterable<K>,
): Record<K, FaixaContagem> {
  const n = new Map<K, number>();
  for (const v of valores) n.set(v, (n.get(v) ?? 0) + 1);
  return Object.fromEntries(classes.map((c) => [c, faixaContagemCredencial(n.get(c) ?? 0)])) as Record<
    K,
    FaixaContagem
  >;
}

/** Por que a retirada da senha antiga é recusada (null: pode). */
export type RecusaRetirada =
  | 'contingencia-ativa'
  | 'sem-credencial-forte'
  | 'credencial-forte-desatualizada'
  | 'usuario-integracao'
  | 'sem-senha-legado';

export const MENSAGENS_RECUSA_RETIRADA: Readonly<Record<RecusaRetirada, string>> = {
  'contingencia-ativa':
    'O período de contingência do estabelecimento está ligado: a senha antiga só é retirada depois do fim dele.',
  'sem-credencial-forte':
    'O usuário ainda não entrou com a credencial forte: a senha antiga não pode ser retirada.',
  'credencial-forte-desatualizada':
    'A senha antiga mudou depois da credencial forte: o usuário precisa entrar uma vez para regravá-la.',
  'usuario-integracao': 'O usuário de integração não tem senha a retirar.',
  'sem-senha-legado': 'O usuário não tem senha antiga guardada.',
};

/** Regra 1 e condição da operação (ficha, seção 5): pode retirar a senha antiga? */
export function recusaRetiradaSenha(c: {
  readonly contingencia: boolean;
  readonly integracao: boolean;
  readonly forte: CredencialForteLida | null;
  readonly legado: SenhaLegadoLida;
}): RecusaRetirada | null {
  if (c.contingencia) return 'contingencia-ativa';
  if (c.integracao) return 'usuario-integracao';
  if (!c.forte) return 'sem-credencial-forte';
  if (!c.legado.presente) return 'sem-senha-legado';
  if (caminhoDoLogin(c.forte, c.legado) !== 'forte') return 'credencial-forte-desatualizada';
  return null;
}

/** Algoritmo de um texto PHC ("$argon2id$v=19$..."), ou null fora do formato. */
export function algoritmoDoPhc(phc: string): string | null {
  const m = /^\$([a-z0-9-]+)\$/.exec(phc);
  return m ? (m[1] ?? null) : null;
}
