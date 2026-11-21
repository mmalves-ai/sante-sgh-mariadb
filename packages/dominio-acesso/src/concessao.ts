// Concessão direta (ficha do M06, regra 1; cap-08 §8.6): o usuário tem a permissão P se a origem lhe concede
// uma opção do menu que o mapa do conector liga a P (pelo grupo ou pelo papel de segurança) ou uma marca de usuário
// ligada a P (ADR 0007, item 8: a correspondência é dado do conector, não da declaração da permissão). Recurso
// novo (sem opção legada) só por perfil complementar (regra 3): os perfis vêm dos papéis SBIS do legado,
// da categoria com conselho e das concessões de SGH_ACESSO_PERFIL_USUARIO, e o que cada perfil concede
// vem do catálogo e do mapa SGH_ACESSO_MAPA_OPCAO. Depois, a segregação (regra 9) retira o que
// conflita e veio só de perfil do novo; o que o legado concede fica, e o conflito vai à revisão (regra 4).
import type { DeclaracaoPermissao, PerfilComplementar } from '@sgh/contratos';
import { CATEGORIAS_COM_CONSELHO, type DestinoGrupo, destinoDoGrupo } from './mapa-grupos.js';
import type { CorrespondenciaOrigem } from './mapa-origem.js';
import { aplicarSegregacao, type Conflito, type Retirada } from './segregacao.js';

/** Papéis SBIS (código do papel de segurança) → perfil complementar do novo (cap-08 §8.3.4). */
export const PERFIL_DO_PAPEL: Readonly<Record<number, PerfilComplementar>> = {
  0: 'gestor-acessos',
  1: 'administrador-sistema',
  2: 'auditor',
  3: 'operador-backup',
  // 4 Operador de sistema: não é usado como papel no novo (todo usuário comum).
};

export interface ConcessoesLegado {
  readonly grupo: string | null;
  readonly opcoesGrupo: readonly number[];
  readonly opcoesPapel: readonly number[];
  readonly papeis: readonly number[];
  readonly flags: readonly string[];
  readonly conselho: boolean;
}

/** Concessão de perfil complementar vigente (SGH_ACESSO_PERFIL_USUARIO). */
export interface PerfilConcedido {
  readonly perfil: string;
  readonly inicio: Date;
  readonly fim: Date | null;
}

/** Linha do mapa SGH_ACESSO_MAPA_OPCAO do tipo perfil → permissão (recursos novos). */
export interface PermissaoDoPerfil {
  readonly perfil: string;
  readonly permissao: string;
}

export type OrigemConcessao =
  | { readonly tipo: 'opcao-grupo'; readonly opcao: number }
  | { readonly tipo: 'opcao-papel'; readonly opcao: number }
  | { readonly tipo: 'flag'; readonly flag: string }
  | { readonly tipo: 'perfil'; readonly perfil: string }
  | { readonly tipo: 'todos-os-perfis-de-pessoa' }
  /** ADR 0022: sessão de acesso total da plataforma (todas as permissões, sem segregação). */
  | { readonly tipo: 'acesso-total' };

/** De onde veio o perfil do Sante SGH (a tela "Perfis e permissões" mostra). */
export type OrigemPerfil = 'papel' | 'conselho' | 'concessao' | 'grupo';

export interface ResultadoConcessao {
  readonly permissoes: ReadonlySet<string>;
  /** Por que cada permissão foi concedida (o simulador do M10 mostra). */
  readonly origens: ReadonlyMap<string, readonly OrigemConcessao[]>;
  readonly perfis: readonly string[];
  /** ADR 0022: por que o usuário tem cada perfil. */
  readonly origensPerfis: ReadonlyMap<string, readonly OrigemPerfil[]>;
  readonly destino: DestinoGrupo;
  readonly retiradas: readonly Retirada[];
  /** Conflitos de segregação mantidos (o legado concede ou é autosserviço): revisão do dono e das áreas. */
  readonly conflitos: readonly Conflito[];
}

/**
 * Índice do catálogo (montado uma vez por processo): opção do menu e marca de usuário de origem (do mapa do
 * conector) e perfil → permissões.
 */
export interface IndiceCatalogo {
  readonly porOpcao: ReadonlyMap<number, readonly string[]>;
  readonly porFlag: ReadonlyMap<string, readonly string[]>;
  readonly porPerfil: ReadonlyMap<string, readonly string[]>;
  readonly todosOsPerfisDePessoa: readonly string[];
  readonly categorias: ReadonlyMap<string, string>;
}

export function indexarCatalogo(
  catalogo: readonly DeclaracaoPermissao[],
  mapaPerfis: readonly PermissaoDoPerfil[] = [],
  mapaOrigem: readonly CorrespondenciaOrigem[] = [],
): IndiceCatalogo {
  const porOpcao = new Map<number, string[]>();
  const porFlag = new Map<string, string[]>();
  const porPerfil = new Map<string, string[]>();
  const todos: string[] = [];
  const categorias = new Map<string, string>();
  const juntar = <K>(m: Map<K, string[]>, k: K, v: string) => m.set(k, [...(m.get(k) ?? []), v]);
  for (const p of catalogo) {
    categorias.set(p.codigo, p.categoria ?? 'administrativa');
    if (p.concessaoPorPerfil === 'todos-os-perfis-de-pessoa') todos.push(p.codigo);
    if (p.concessaoPorPerfil === 'por-perfil')
      for (const perfil of p.perfis ?? []) juntar(porPerfil, perfil, p.codigo);
  }
  // Mapa SGH_ACESSO_MAPA_OPCAO (perfil → permissão de recurso novo): só permissão que existe e é por perfil.
  const porPerfilDoCatalogo = new Set(
    catalogo.filter((p) => p.concessaoPorPerfil !== null).map((p) => p.codigo),
  );
  for (const m of mapaPerfis)
    if (porPerfilDoCatalogo.has(m.permissao)) juntar(porPerfil, m.perfil, m.permissao);
  // Mapa do conector (origem → permissão): só permissão que existe no catálogo (falha fechada).
  for (const c of mapaOrigem) {
    if (!categorias.has(c.permissao)) continue;
    if (c.tipo === 'opcao_menu') juntar(porOpcao, Number(c.chave), c.permissao);
    else juntar(porFlag, c.chave, c.permissao);
  }
  return { porOpcao, porFlag, porPerfil, todosOsPerfisDePessoa: todos, categorias };
}

export interface EntradaConcessao {
  readonly legado: ConcessoesLegado;
  readonly catalogo: readonly DeclaracaoPermissao[];
  readonly perfisConcedidos?: readonly PerfilConcedido[];
  readonly mapaPerfis?: readonly PermissaoDoPerfil[];
  /** Mapa do conector (opção do menu e marca de usuário de origem → permissão). */
  readonly mapaOrigem?: readonly CorrespondenciaOrigem[];
  /**
   * ADR 0022: perfis do mapa grupo → perfil APROVADOS (SGH_ACESSO_MAPA_OPCAO, TIPO grupo-perfil) para o grupo
   * do usuário: todo usuário do grupo recebe o perfil (a proposta não aprovada não concede nada).
   */
  readonly perfisDoGrupo?: readonly string[];
  /** Índice já montado (o servidor monta uma vez; sem ele, é montado do catálogo e do mapa). */
  readonly indice?: IndiceCatalogo;
  readonly agora?: Date;
}

/**
 * Perfis complementares do usuário, com a origem: papéis SBIS, categoria com conselho, concessões vigentes
 * (SGH_ACESSO_PERFIL_USUARIO) e o mapa grupo → perfil aprovado (ADR 0022).
 */
export function origensDosPerfis(e: EntradaConcessao, destino: DestinoGrupo): Map<string, OrigemPerfil[]> {
  const agora = e.agora ?? new Date();
  const r = new Map<string, OrigemPerfil[]>();
  const anotar = (perfil: string, o: OrigemPerfil) => {
    const l = r.get(perfil) ?? [];
    if (!l.includes(o)) l.push(o);
    r.set(perfil, l);
  };
  for (const p of e.legado.papeis) {
    const perfil = PERFIL_DO_PAPEL[p];
    if (perfil) anotar(perfil, 'papel');
  }
  if (
    destino.tipo === 'perfil' &&
    destino.assistencial &&
    CATEGORIAS_COM_CONSELHO.has(destino.categoria) &&
    e.legado.conselho
  ) {
    anotar('assistencial-com-conselho', 'conselho');
  }
  for (const c of e.perfisConcedidos ?? []) {
    if (c.inicio.getTime() <= agora.getTime() && (c.fim === null || c.fim.getTime() > agora.getTime())) {
      anotar(c.perfil, 'concessao');
    }
  }
  // O mapa aprovado só vale para quem tem grupo (o painel nunca recebe perfil de pessoa).
  if (e.legado.grupo && destino.tipo !== 'painel') for (const p of e.perfisDoGrupo ?? []) anotar(p, 'grupo');
  return r;
}

/** Perfis complementares do usuário: papéis SBIS, categoria com conselho, concessões e mapa do grupo. */
export function perfisDoUsuario(e: EntradaConcessao, destino: DestinoGrupo): string[] {
  return [...origensDosPerfis(e, destino).keys()].sort();
}

export function conceder(e: EntradaConcessao): ResultadoConcessao {
  const destino = destinoDoGrupo(e.legado.grupo);
  const origensPerfis = origensDosPerfis(e, destino);
  const perfis = [...origensPerfis.keys()].sort();
  const indice = e.indice ?? indexarCatalogo(e.catalogo, e.mapaPerfis, e.mapaOrigem);
  const origens = new Map<string, OrigemConcessao[]>();
  const anotar = (codigo: string, o: OrigemConcessao) => {
    const l = origens.get(codigo) ?? [];
    l.push(o);
    origens.set(codigo, l);
  };
  for (const op of new Set(e.legado.opcoesGrupo))
    for (const c of indice.porOpcao.get(op) ?? []) anotar(c, { tipo: 'opcao-grupo', opcao: op });
  for (const op of new Set(e.legado.opcoesPapel))
    for (const c of indice.porOpcao.get(op) ?? []) anotar(c, { tipo: 'opcao-papel', opcao: op });
  for (const f of new Set(e.legado.flags))
    for (const c of indice.porFlag.get(f) ?? []) anotar(c, { tipo: 'flag', flag: f });
  if (destino.tipo !== 'painel')
    for (const c of indice.todosOsPerfisDePessoa) anotar(c, { tipo: 'todos-os-perfis-de-pessoa' });
  for (const perfil of perfis)
    for (const c of new Set(indice.porPerfil.get(perfil) ?? [])) anotar(c, { tipo: 'perfil', perfil });
  const { permissoes, retiradas, conflitos } = aplicarSegregacao(new Set(origens.keys()), {
    perfis,
    destino,
    origens,
    categorias: indice.categorias,
  });
  for (const r of retiradas) origens.delete(r.permissao);
  return { permissoes, origens, perfis, origensPerfis, destino, retiradas, conflitos };
}

/**
 * ADR 0022: acesso total da plataforma. TODAS as permissões do catálogo (as do catálogo-base e as
 * declaradas, inclusive as por perfil e as de categoria clínica), SEM a segregação de funções: o controle é
 * a auditoria e a correção (ADR 0021), não limites. Nada vem do legado do usuário "em nome de".
 */
export function concederAcessoTotal(indice: IndiceCatalogo): ResultadoConcessao {
  const codigos = [...indice.categorias.keys()].sort();
  const origens = new Map<string, OrigemConcessao[]>(codigos.map((c) => [c, [{ tipo: 'acesso-total' }]]));
  return {
    permissoes: new Set(codigos),
    origens,
    perfis: [],
    origensPerfis: new Map(),
    destino: { tipo: 'caso-a-caso', motivo: 'acesso total da plataforma' },
    retiradas: [],
    conflitos: [],
  };
}
