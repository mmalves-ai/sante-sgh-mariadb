// Política do segundo fator (M59-F2, regra 3; cap-08 §8.16; SBIS-08). Regra pura: dadas as linhas da política do
// estabelecimento (SGH_ACESSO_POLITICA_2FA), o perfil e o grupo do usuário e o dia, diz o que se exige dele agora.
//   - Onda 1: administradores, gestores de acesso, auditores, faturamento e financeiro; onda 2: todos.
//   - Cada linha alcança um perfil (o principal ou um complementar), um grupo do legado ou todos.
//   - A partir do início da linha, o usuário sem segundo fator ativo tem `prazoAdesaoDias` para cadastrar: dentro
//     do prazo, entra e é levado ao cadastro ("adesao"); depois, não entra sem ele ("obrigatorio").
//   - Usuário com segundo fator ativo confere o código no login sempre (opcional ou não: M05, regra 10).
//   - TOTP é o único fator por ora (DP-45: WebAuthn com biometria no dispositivo, depois da decisão do DPO).
// Linha encerrada (recolher, ficha seção 12) não conta; duas linhas que alcançam o mesmo usuário: vale a que exige
// mais (a de início mais antigo).
import type { Exigencia2fa, SituacaoSegundoFator } from '@sgh/contratos';

export interface LinhaPolitica2fa {
  readonly id: string;
  readonly alvo: 'perfil' | 'grupo' | 'todos';
  readonly valor: string | null;
  readonly onda: 1 | 2;
  /** AAAA-MM-DD (dia civil do estabelecimento). */
  readonly inicio: string;
  readonly prazoAdesaoDias: number;
  readonly ativa: boolean;
}

export interface Alcance2fa {
  /** Perfil principal (mapa grupo → perfil) ou null. */
  readonly perfil: string | null;
  readonly complementares: readonly string[];
  /** Nome do grupo do usuário ou null. */
  readonly grupo: string | null;
}

export interface Avaliacao2fa {
  readonly exigencia: Exigencia2fa;
  /** A linha que decidiu (null quando opcional). */
  readonly linha: string | null;
  /** Último dia do prazo de adesão (AAAA-MM-DD) quando a exigência é "adesao". */
  readonly prazoAdesaoAte: string | null;
}

/** Perfis da onda 1 (ficha, regra 3): administradores, gestão de acessos, auditoria, faturamento e financeiro. */
export const PERFIS_ONDA_1_2FA: readonly string[] = [
  'administrador-sistema',
  'gestor-acessos',
  'auditor',
  'auditor-contas',
  'faturista',
  'faturista-assistencial',
  'supervisor-faturamento',
  'financeiro',
  'financeiro-contas-a-receber',
  'financeiro-consulta',
  'supervisor-financeiro',
  'diretoria-administrativa-financeira',
];

/** Grupos administradores do legado na onda 1 (os MASTER: acesso a tudo enquanto o saneamento da F4 não chega). */
export const GRUPOS_ONDA_1_2FA: readonly string[] = [
  'MASTER',
  'MASTER_SEM_FINANCEIRO',
  'MASTER_CONSULTA_FINANCEIRO',
];

/** As linhas que o gestor cadastra de uma vez para abrir a onda 1 num estabelecimento. */
export function linhasDaOnda1(): { alvo: 'perfil' | 'grupo'; valor: string }[] {
  return [
    ...PERFIS_ONDA_1_2FA.map((valor) => ({ alvo: 'perfil' as const, valor })),
    ...GRUPOS_ONDA_1_2FA.map((valor) => ({ alvo: 'grupo' as const, valor })),
  ];
}

const DIA = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Dia civil válido (AAAA-MM-DD, existente no calendário). */
export function diaValido(dia: string): boolean {
  const m = DIA.exec(dia);
  if (!m) return false;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return d.toISOString().slice(0, 10) === dia;
}

/** Soma dias a um dia civil (aritmética em UTC: sem horário de verão). */
export function somarDias(dia: string, dias: number): string {
  const m = DIA.exec(dia);
  if (!m) throw new Error(`Dia inválido: ${dia}`);
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]) + dias));
  return d.toISOString().slice(0, 10);
}

/** A linha alcança o usuário? Perfil compara o principal e os complementares; grupo compara sem espaços à direita. */
export function alcanca(l: LinhaPolitica2fa, u: Alcance2fa): boolean {
  if (l.alvo === 'todos') return true;
  const v = (l.valor ?? '').trim();
  if (!v) return false;
  if (l.alvo === 'perfil') return u.perfil === v || u.complementares.includes(v);
  return (u.grupo ?? '').trimEnd() === v;
}

/**
 * O que se exige do usuário no dia `hoje` (AAAA-MM-DD). Linha com início no futuro ainda não vale; o prazo de
 * adesão conta o dia do início (prazo 0: obrigatório já no início). Linha com dia inválido é ignorada (falha
 * aberta para o opcional não tranca ninguém por erro de cadastro; o cadastro já valida o dia).
 */
export function avaliarPolitica2fa(
  linhas: readonly LinhaPolitica2fa[],
  usuario: Alcance2fa,
  hoje: string,
): Avaliacao2fa {
  const vigentes = linhas
    .filter((l) => l.ativa && diaValido(l.inicio) && l.inicio <= hoje && alcanca(l, usuario))
    .sort((a, b) => a.inicio.localeCompare(b.inicio) || a.id.localeCompare(b.id));
  // A que exige mais: a primeira com o prazo de adesão já vencido; senão, a de prazo que acaba primeiro.
  let melhor: { linha: LinhaPolitica2fa; ate: string } | null = null;
  for (const l of vigentes) {
    const ate = somarDias(l.inicio, Math.max(0, l.prazoAdesaoDias) - 1);
    if (l.prazoAdesaoDias <= 0 || ate < hoje) {
      return { exigencia: 'obrigatorio', linha: l.id, prazoAdesaoAte: null };
    }
    if (!melhor || ate < melhor.ate) melhor = { linha: l, ate };
  }
  if (melhor) return { exigencia: 'adesao', linha: melhor.linha.id, prazoAdesaoAte: melhor.ate };
  return { exigencia: 'opcional', linha: null, prazoAdesaoAte: null };
}

/** Desfecho do segundo fator no login (o serviço de sessão aplica). */
export type Desfecho2faLogin =
  /** Conferir o código (o usuário tem segundo fator ativo). */
  | { readonly tipo: 'conferir-codigo' }
  /** Entrar sem código e levar ao cadastro (prazo de adesão). */
  | { readonly tipo: 'entrar-e-cadastrar'; readonly prazoAdesaoAte: string | null }
  /** Entrar sem código (opcional e sem cadastro). */
  | { readonly tipo: 'entrar' }
  /** Recusar: obrigatório e sem segundo fator ativo. */
  | { readonly tipo: 'recusar' };

/** Regra 3 aplicada ao login: a situação do cadastro do usuário com a exigência da política. */
export function desfecho2faNoLogin(
  situacao: SituacaoSegundoFator,
  avaliacao: Avaliacao2fa,
): Desfecho2faLogin {
  if (situacao === 'ativo') return { tipo: 'conferir-codigo' };
  if (avaliacao.exigencia === 'obrigatorio') return { tipo: 'recusar' };
  if (avaliacao.exigencia === 'adesao') {
    return { tipo: 'entrar-e-cadastrar', prazoAdesaoAte: avaliacao.prazoAdesaoAte };
  }
  return { tipo: 'entrar' };
}

/** Remover o próprio segundo fator só quando a política não o exige (opcional). */
export function podeRemoverSegundoFator(avaliacao: Avaliacao2fa): boolean {
  return avaliacao.exigencia === 'opcional';
}

/** Problemas de uma linha nova antes de gravar (o esquema já validou o formato). */
export function conferirNovaLinha2fa(
  nova: Pick<LinhaPolitica2fa, 'alvo' | 'valor' | 'inicio' | 'onda'>,
  existentes: readonly LinhaPolitica2fa[],
  hoje: string,
): string[] {
  const p: string[] = [];
  if (!diaValido(nova.inicio)) p.push('Dia de início inválido.');
  else if (nova.inicio < hoje) p.push('O início não pode ser no passado.');
  if (nova.alvo === 'todos' && nova.onda !== 2) p.push('A obrigatoriedade para todos é a onda 2.');
  const v = (nova.valor ?? '').trim();
  if (
    existentes.some(
      (l) => l.ativa && l.alvo === nova.alvo && (l.valor ?? '').trim() === (nova.alvo === 'todos' ? '' : v),
    )
  ) {
    p.push('Já existe uma linha ativa para este alvo; encerre-a antes.');
  }
  return p;
}
