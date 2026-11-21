// Forma de uma permissão do catálogo (convencoes.md §12; cap-08 §8.6; ficha do M06). O catálogo é a soma
// das permissões geradas da árvore do legado (catalogo-legado.ts, gerado) e das declaradas à mão pelos
// módulos (recursos novos e as que a ficha nomeia); `pnpm permissoes:verificar` confere que toda permissão
// tem `opcoesLegado`, `flagsLegado` ou concessão por perfil, e que toda rota tem permissão.

/** Categoria (cap-08 §8.6): a "clinica" nunca vai a perfil administrativo (SBIS-10, regra 9 do M06). */
export type CategoriaPermissao = 'clinica' | 'administrativa' | 'financeira' | 'tecnica';

/** normal; sensível (registro reforçado); crítica (reautenticação recente, SBIS-07). */
export type CriticidadePermissao = 'normal' | 'sensivel' | 'critica';

/** Escopos ABAC lidos do legado (cap-08 §8.4). O hospital é a conexão; o vínculo é a regra 7. */
export type EscopoPermissao =
  | 'unidade'
  | 'local'
  | 'convenio'
  | 'centroCusto'
  | 'localEstoque'
  | 'contaBancaria'
  | 'tipoAgenda'
  | 'tipoProntuario'
  | 'vinculo';

export const ESCOPOS_PERMISSAO: readonly EscopoPermissao[] = [
  'unidade',
  'local',
  'convenio',
  'centroCusto',
  'localEstoque',
  'contaBancaria',
  'tipoAgenda',
  'tipoProntuario',
  'vinculo',
];

/** Flag de usuário do legado que concede a permissão (coluna S/N ou T/F). */
export interface FlagLegado {
  readonly tabela: 'TBUSUCPL' | 'GEUSERS' | 'FCPARUSU';
  readonly coluna: string;
}

export interface DeclaracaoPermissao {
  /** Código `modulo.recurso.acao`. */
  readonly codigo: string;
  readonly descricao: string;
  /** Opções do menu de origem que concedem a permissão (cap-08 §8.6). Vazio = recurso próprio do produto. */
  readonly opcoesLegado: readonly number[];
  /** Marcas do usuário na origem que também concedem. */
  readonly flagsLegado?: readonly FlagLegado[];
  /**
   * Recurso só do novo: concedido por perfil (SGH_ACESSO_MAPA_OPCAO e SGH_ACESSO_PERFIL_USUARIO).
   * `todos-os-perfis-de-pessoa`: concedido a todo perfil de pessoa (não a painel, totem ou integração).
   */
  readonly concessaoPorPerfil: 'todos-os-perfis-de-pessoa' | 'por-perfil' | null;
  readonly categoria?: CategoriaPermissao;
  readonly criticidade?: CriticidadePermissao;
  readonly escopos?: readonly EscopoPermissao[];
  /** Ação privativa de categoria com conselho (ATO-01): exige registro no conselho. */
  readonly exigeConselho?: boolean;
  /** Perfis que recebem a permissão nova (concessaoPorPerfil = por-perfil). */
  readonly perfis?: readonly string[];
}

/** Formato do código: três partes em camelCase (`pep.evolucao.ler`). */
export const FORMATO_CODIGO_PERMISSAO = /^[a-z][a-zA-Z0-9]*\.[a-z][a-zA-Z0-9]*\.[a-z][a-zA-Z0-9]*$/;
