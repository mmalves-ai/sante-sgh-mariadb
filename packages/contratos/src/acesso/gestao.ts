// Contratos da tela "Perfis e permissões" (ADR 0022; docs/modulos/acesso.md › Perfis e permissões): ver as
// permissões efetivas de um usuário do SPDATA com a origem de cada uma, conceder e revogar perfis do Sante SGH
// (SGH_ACESSO_PERFIL_USUARIO), decidir o mapa grupo → perfil e perfil → permissão (SGH_ACESSO_MAPA_OPCAO) e
// administrar as permissões do PRÓPRIO legado pelas receitas do executor do M04 (TBPERUSU, TBPAPEL_TBOPCOES,
// TBUSERS_TBPAPEL, TBUSERS.GRUPO, TBGRUUSU), gravadas exatamente como o SPDATA grava. Nada aqui leva senha
// guardada, hash nem dado de pessoa além do login e do nome de exibição.
import { z } from 'zod';
import { textoCp1252 } from '../texto-cp1252.js';
import { esquemaLogin, esquemaSenhaDigitada } from './entrada.js';

/** TBGRUUSU.NOME (VARCHAR(50)): exato, sem espaço nas pontas (o legado tem nome com espaço no meio). */
export const esquemaNomeGrupo = textoCp1252(50).refine((g) => g.length > 0 && g.trim() === g, {
  message: 'Informe o nome do grupo sem espaços nas pontas.',
});

/** TBPAPEL.COD_PAPEL: 0 Gestor de acessos, 1 Administrador, 2 Auditor, 3 Operador de backup, 4 Operador. */
export const CODIGOS_PAPEL = [0, 1, 2, 3, 4] as const;
export const esquemaCodigoPapel = z.literal(CODIGOS_PAPEL);

const esquemaOpcoes = z
  .array(z.number().int().positive())
  .min(1, 'Escolha ao menos uma opção.')
  .max(2_000)
  .refine((l) => new Set(l).size === l.length, { message: 'Opção repetida.' });

// ── Entradas das receitas do legado (executor do M04) ────────────────────────────────────────────
// Uma receita por tabela e ação (a referência de perfil do M03 compara um passo por operação): conceder é
// INSERT, revogar é DELETE nas tabelas de opções (sem gatilho, como o SPDATA), e UPDATE de ATIVO nas de papel
// e de grupo (a trilha do legado referencia a linha do papel; o grupo tem FK de usuários e permissões).

/** acesso.concederOpcoesGrupo / acesso.revogarOpcoesGrupo: TBPERUSU (GRUPO, ID_TBOPCOES). */
/**
 * M37 (condução opcional de um setor, regra 6): com `conducao`, a retirada grava cada par em SGH_CFG_COEX_CONDUCAO
 * (estado anterior, lote, autorização) e a concessão marca o par retirado como devolvido, NA MESMA transação.
 */
export const esquemaConducaoOpcoes = z
  .object({
    setor: z.string().min(1).max(40),
    autorizacao: z.string().min(5).max(200),
    lote: z
      .string()
      .regex(/^\d{1,20}$/)
      .optional(),
  })
  .strict();
export const esquemaOpcoesGrupo = z
  .object({ grupo: esquemaNomeGrupo, opcoes: esquemaOpcoes, conducao: esquemaConducaoOpcoes.optional() })
  .strict();
export type OpcoesGrupoEntrada = z.infer<typeof esquemaOpcoesGrupo>;

/** acesso.concederOpcoesPapel / acesso.revogarOpcoesPapel: TBPAPEL_TBOPCOES (pelo COD_PAPEL). */
export const esquemaOpcoesPapel = z.object({ papel: esquemaCodigoPapel, opcoes: esquemaOpcoes }).strict();
export type OpcoesPapelEntrada = z.infer<typeof esquemaOpcoesPapel>;

/** acesso.concederPapelUsuario: TBUSERS_TBPAPEL nova (o par nunca existiu; o inativo é reativado). */
export const esquemaConcederPapelUsuario = z
  .object({ login: esquemaLogin, papel: esquemaCodigoPapel, idCbo: z.number().int().positive().optional() })
  .strict();
export type ConcederPapelUsuarioEntrada = z.infer<typeof esquemaConcederPapelUsuario>;

/** acesso.revogarPapelUsuario / acesso.reativarPapelUsuario: TBUSERS_TBPAPEL.ATIVO (nunca DELETE). */
export const esquemaPapelUsuario = z.object({ login: esquemaLogin, papel: esquemaCodigoPapel }).strict();
export type PapelUsuarioEntrada = z.infer<typeof esquemaPapelUsuario>;

/** acesso.trocarGrupoUsuario: TBUSERS.GRUPO (só para grupo ativo do TBGRUUSU). */
export const esquemaTrocarGrupoUsuario = z.object({ login: esquemaLogin, grupo: esquemaNomeGrupo }).strict();
export type TrocarGrupoUsuarioEntrada = z.infer<typeof esquemaTrocarGrupoUsuario>;

/** acesso.criarGrupo: TBGRUUSU (NOME, ATIVO = 'T'), sem opções (concedidas depois). */
export const esquemaCriarGrupo = z.object({ nome: esquemaNomeGrupo }).strict();
export type CriarGrupoEntrada = z.infer<typeof esquemaCriarGrupo>;

/** acesso.desativarGrupo / acesso.reativarGrupo: TBGRUUSU.ATIVO (o TRG_TBGRUUSU_BU recusa com usuário ativo). */
export const esquemaGrupo = z.object({ nome: esquemaNomeGrupo }).strict();
export type GrupoEntrada = z.infer<typeof esquemaGrupo>;

/** W1-01: acesso.renomearGrupo — TBGRUUSU.NOME (a chave) só sem dependente nenhum (D-W101-18). */
export const esquemaRenomearGrupo = z
  .object({ nome: esquemaNomeGrupo, novoNome: esquemaNomeGrupo })
  .strict()
  .refine((p) => p.nome !== p.novoNome, {
    message: 'Informe um nome diferente do atual.',
    path: ['novoNome'],
  });
export type RenomearGrupoEntrada = z.infer<typeof esquemaRenomearGrupo>;

/** W1-01: acesso.excluirGrupo — DELETE do grupo nunca usado, com motivo e retrato (D-CRUD-SNAP). */
export const esquemaExcluirGrupo = z
  .object({
    nome: esquemaNomeGrupo,
    motivo: textoCp1252(200).pipe(z.string().trim().min(3, 'Informe o motivo.')),
  })
  .strict();
export type ExcluirGrupoEntrada = z.infer<typeof esquemaExcluirGrupo>;

/**
 * W1-01 (parte 4c): a descrição do grupo (SGH_ACESSO_GRUPO_DESCR, por versão; o grupo do legado não tem a coluna).
 * Gravação com reautenticação e motivo; a versão anterior fica consultável.
 */
export const esquemaDescreverGrupo = z
  .object({
    grupo: esquemaNomeGrupo,
    descricao: textoCp1252(400).pipe(z.string().trim().min(3, 'Informe a descrição.')),
    motivo: textoCp1252(200).pipe(z.string().trim().min(3, 'Informe o motivo.')),
    senha: esquemaSenhaDigitada,
  })
  .strict();
export type DescreverGrupo = z.infer<typeof esquemaDescreverGrupo>;

/**
 * W1-01 (parte 5): publicar a versão nova da política de senha do Sante (SGH_ACESSO_POLITICA_SENHA), que só aperta
 * TBCFGLOGIN. Com reautenticação e motivo; vigência agora ou no futuro (ISO); a publicada não se edita.
 */
export const esquemaPublicarPoliticaSenha = z
  .object({
    minimoCaracteres: z.number().int().min(8).max(64),
    exigeEspecial: z.boolean(),
    exigeMinuscula: z.boolean(),
    exigeMaiuscula: z.boolean(),
    trocaDias: z.number().int().min(0).max(3650),
    reusoDias: z.number().int().min(0).max(3650),
    recusaNome: z.boolean(),
    recusaNascimento: z.boolean(),
    recusaComuns: z.boolean(),
    /** Lista local de senhas proibidas (uma por item; cabe em 4000 caracteres com as quebras de linha). */
    senhasProibidas: z
      .array(textoCp1252(64).pipe(z.string().trim()))
      .max(300)
      .refine((l) => l.join('\n').length <= 4000, 'A lista de senhas proibidas passou do tamanho.'),
    vigenteDesde: z.string().datetime({ offset: true }),
    motivo: textoCp1252(200).pipe(z.string().trim().min(3, 'Informe o motivo.')),
    senha: esquemaSenhaDigitada,
  })
  .strict();
export type PublicarPoliticaSenha = z.infer<typeof esquemaPublicarPoliticaSenha>;

/**
 * W1-01 (parte 8): incluir, alterar ou retirar (limite null) o limite de sessões simultâneas de um perfil ('*' é o
 * padrão), com motivo e reautenticação. Cada mudança é uma linha nova em SGH_ACESSO_LIMITE_SESSAO.
 */
export const esquemaDefinirLimiteSessao = z
  .object({
    // '*' ou o código do perfil (mesma regra de esquemaPerfil, declarado mais abaixo).
    perfil: z.string().regex(/^(\*|[a-z][a-z0-9-]{1,59})$/, 'Perfil inválido.'),
    limite: z.number().int().min(1).max(50).nullable(),
    motivo: textoCp1252(200).pipe(z.string().trim().min(3, 'Informe o motivo.')),
    senha: esquemaSenhaDigitada,
  })
  .strict();
export type DefinirLimiteSessao = z.infer<typeof esquemaDefinirLimiteSessao>;

/** W1-01 (parte 8): GET /api/acesso/gestao/limites-sessao — os limites em vigor e o histórico (mais novo primeiro). */
export interface LimitesSessaoGestaoTela {
  readonly vigentes: readonly { readonly perfil: string; readonly limite: number }[];
  readonly historico: readonly {
    readonly perfil: string;
    readonly limite: number | null;
    readonly situacao: 'vigente' | 'retirado';
    readonly motivo: string;
    readonly criadoPor: string;
    readonly criadoEm: string | null;
  }[];
  /** Os perfis do Sante que podem ter limite próprio (para o combo). */
  readonly perfis: readonly string[];
}

/** W1-01 (parte 5): cancelar a versão agendada (ainda não em vigor), com motivo e reautenticação. */
export const esquemaCancelarPoliticaSenha = z
  .object({
    motivo: textoCp1252(200).pipe(z.string().trim().min(3, 'Informe o motivo.')),
    senha: esquemaSenhaDigitada,
  })
  .strict();
export type CancelarPoliticaSenha = z.infer<typeof esquemaCancelarPoliticaSenha>;

/** Uma versão da política de senha do Sante, para a tela (a em vigor, as agendadas, as anteriores e as canceladas). */
export interface VersaoPoliticaSenhaTela {
  readonly versao: number;
  readonly minimoCaracteres: number;
  readonly exigeEspecial: boolean;
  readonly exigeMinuscula: boolean;
  readonly exigeMaiuscula: boolean;
  readonly trocaDias: number;
  readonly reusoDias: number;
  readonly recusaNome: boolean;
  readonly recusaNascimento: boolean;
  readonly recusaComuns: boolean;
  readonly senhasProibidas: readonly string[];
  readonly vigenteDesde: string | null;
  readonly motivo: string;
  readonly criadoPor: string;
  readonly criadoEm: string | null;
  /** 'em-vigor' | 'agendada' | 'anterior' | 'cancelada' (calculada no servidor pelo relógio). */
  readonly estado: 'em-vigor' | 'agendada' | 'anterior' | 'cancelada';
  readonly canceladaEm: string | null;
  readonly canceladaPor: string | null;
  readonly motivoCancelamento: string | null;
}

/** W1-01 (parte 5): a tela da política: TBCFGLOGIN (só leitura aqui), o mínimo do novo e as versões do Sante. */
export interface PoliticaSenhaGestaoTela {
  readonly legado: {
    readonly minimoCaracteres: number | null;
    readonly exigeEspecial: boolean;
    readonly exigeMinuscula: boolean;
    readonly exigeMaiuscula: boolean;
    readonly trocaDias: number | null;
    readonly reusoDias: number | null;
  };
  readonly minimoDoNovo: number;
  /** A efetiva hoje (a mais exigente entre as camadas). */
  readonly efetiva: {
    readonly minimoCaracteres: number;
    readonly exigeEspecial: boolean;
    readonly exigeMinuscula: boolean;
    readonly exigeMaiuscula: boolean;
    readonly trocaDias: number;
    readonly reusoDias: number;
    readonly recusaNome: boolean;
    readonly recusaNascimento: boolean;
    readonly recusaComuns: boolean;
  };
  readonly versoes: readonly VersaoPoliticaSenhaTela[];
}

/** Uma versão da descrição do grupo, para a tela (a vigente e as anteriores). */
export interface VersaoDescricaoGrupoTela {
  readonly versao: number;
  readonly descricao: string;
  readonly motivo: string;
  readonly criadoPor: string;
  readonly criadoEm: string | null;
  readonly situacao: 'vigente' | 'substituida' | 'retirada';
  readonly encerradaEm: string | null;
}

/** As receitas do legado que a tela usa, na ordem da tela, com o rótulo para a pessoa. */
export const OPERACOES_GESTAO_LEGADO = {
  'acesso.concederOpcoesGrupo': 'Conceder opções ao grupo',
  'acesso.revogarOpcoesGrupo': 'Retirar opções do grupo',
  'acesso.concederOpcoesPapel': 'Conceder opções ao papel SBIS',
  'acesso.revogarOpcoesPapel': 'Retirar opções do papel SBIS',
  'acesso.concederPapelUsuario': 'Conceder papel SBIS ao usuário',
  'acesso.reativarPapelUsuario': 'Reativar papel SBIS do usuário',
  'acesso.revogarPapelUsuario': 'Retirar papel SBIS do usuário',
  'acesso.trocarGrupoUsuario': 'Trocar o grupo do usuário',
  'acesso.criarGrupo': 'Criar grupo',
  'acesso.desativarGrupo': 'Desativar grupo',
  'acesso.reativarGrupo': 'Reativar grupo',
  'acesso.renomearGrupo': 'Renomear grupo',
  'acesso.excluirGrupo': 'Excluir grupo',
} as const;
export type OperacaoGestaoLegado = keyof typeof OPERACOES_GESTAO_LEGADO;
export const NOMES_OPERACOES_GESTAO = Object.keys(OPERACOES_GESTAO_LEGADO) as OperacaoGestaoLegado[];

/** POST /api/acesso/gestao/legado/:operacao (Idempotency-Key obrigatória; a senha reautentica: SBIS-07). */
export const esquemaPedidoGestaoLegado = z
  .object({ entrada: z.unknown(), senha: esquemaSenhaDigitada })
  .strict();

// ── Perfis do Sante SGH e mapa ───────────────────────────────────────────────────────────────────

/** Perfil do Sante SGH (complementar ou de destino): minúsculas com hífen, até 60 (SGH_ACESSO_*.PERFIL). */
export const esquemaPerfil = z.string().regex(/^[a-z][a-z0-9-]{1,59}$/, 'Perfil inválido.');

/** POST /api/acesso/gestao/perfis: concede o perfil (início, fim opcional, motivo). */
export const esquemaConcederPerfil = z
  .object({
    login: esquemaLogin,
    perfil: esquemaPerfil,
    inicio: z.iso.datetime({ offset: true }).optional(),
    fim: z.iso.datetime({ offset: true }).optional(),
    motivo: textoCp1252(200).pipe(z.string().trim().min(3, 'Informe o motivo.')),
    senha: esquemaSenhaDigitada,
  })
  .strict()
  .refine((p) => !p.fim || !p.inicio || Date.parse(p.fim) > Date.parse(p.inicio), {
    message: 'O fim tem de ser depois do início.',
    path: ['fim'],
  });
export type ConcederPerfil = z.infer<typeof esquemaConcederPerfil>;

/** POST /api/acesso/gestao/perfis/:id/revogar (W0-09: com motivo, que fica na concessão revogada). */
export const esquemaRevogarPerfil = z
  .object({
    motivo: textoCp1252(400).pipe(z.string().trim().min(5, 'Informe o motivo da revogação.')),
    senha: esquemaSenhaDigitada,
  })
  .strict();
export type RevogarPerfil = z.infer<typeof esquemaRevogarPerfil>;

/**
 * POST /api/acesso/gestao/perfis/:id/alteracao (W0-09): nova vigência e motivo da concessão não revogada, com a
 * justificativa da mudança (o valor anterior fica na alteração, só inclusão). O fim, quando houver, é futuro: para
 * tirar o perfil agora, revogue.
 */
export const esquemaAlterarPerfil = z
  .object({
    inicio: z.iso.datetime({ offset: true }),
    fim: z.iso.datetime({ offset: true }).nullable(),
    motivo: textoCp1252(200).pipe(z.string().trim().min(3, 'Informe o motivo.')),
    justificativa: textoCp1252(400).pipe(z.string().trim().min(5, 'Justifique a alteração.')),
    senha: esquemaSenhaDigitada,
  })
  .strict()
  .refine((p) => !p.fim || Date.parse(p.fim) > Date.parse(p.inicio), {
    message: 'O fim tem de ser depois do início.',
    path: ['fim'],
  });
export type AlterarPerfil = z.infer<typeof esquemaAlterarPerfil>;

/** GET /api/acesso/gestao/perfis/:id/alteracoes: o anterior e o novo de cada alteração. */
export interface AlteracaoPerfilTela {
  readonly id: string;
  readonly inicioAntes: string;
  readonly fimAntes: string | null;
  readonly motivoAntes: string | null;
  readonly inicio: string;
  readonly fim: string | null;
  readonly motivo: string;
  readonly justificativa: string;
  readonly alteradoPor: string;
  readonly alteradoEm: string;
}

export const TIPOS_MAPA = ['grupo-perfil', 'perfil-permissao'] as const;
export type TipoMapa = (typeof TIPOS_MAPA)[number];
export const SITUACOES_MAPA = ['proposta', 'aprovada', 'recusada'] as const;
export type SituacaoMapa = (typeof SITUACOES_MAPA)[number];

/** Chave natural de uma linha do mapa (a proposta automática ainda não tem linha no banco). */
export const esquemaChaveMapa = z.discriminatedUnion('tipo', [
  z.object({ tipo: z.literal('grupo-perfil'), grupo: esquemaNomeGrupo, perfil: esquemaPerfil }).strict(),
  z
    .object({
      tipo: z.literal('perfil-permissao'),
      perfil: esquemaPerfil,
      permissao: z.string().regex(/^[a-z][a-zA-Z0-9]*\.[a-z][a-zA-Z0-9]*\.[a-z][a-zA-Z0-9]*$/),
    })
    .strict(),
]);
export type ChaveMapa = z.infer<typeof esquemaChaveMapa>;

/**
 * POST /api/acesso/gestao/mapa/decidir: aprovar, recusar ou propor (nova linha, origem revisão da área). W0-09: tirar
 * uma aprovação (recusar ou voltar a 'proposta') exige o motivo; a decisão anterior fica no histórico.
 */
export const esquemaDecidirMapa = z
  .object({
    chave: esquemaChaveMapa,
    situacao: z.enum(SITUACOES_MAPA),
    motivo: z.string().trim().max(400).optional(),
    senha: esquemaSenhaDigitada,
  })
  .strict();
export type DecidirMapa = z.infer<typeof esquemaDecidirMapa>;

/** POST /api/acesso/gestao/mapa/previa (W0-09): o que a decisão faria, antes de confirmar (nada grava). */
export const esquemaPreviaMapa = z
  .object({ chave: esquemaChaveMapa, situacao: z.enum(SITUACOES_MAPA) })
  .strict();
export type PreviaMapa = z.infer<typeof esquemaPreviaMapa>;

export interface PreviaMapaTela {
  /** Situação atual da linha (null: ainda não tem linha no banco). */
  readonly situacaoAtual: SituacaoMapa | null;
  readonly situacao: SituacaoMapa;
  /** Mudar a decisão de uma linha que já existe: o motivo é obrigatório. */
  readonly exigeMotivo: boolean;
  /** Usuários ativos que perdem o perfil (grupo → perfil) ou a permissão (perfil → permissão) na confirmação. */
  readonly perdem: number;
  /** Até 20 logins dos que perdem (para conferir antes de confirmar). */
  readonly amostra: readonly string[];
  /** A busca parou no teto (a contagem é um mínimo). */
  readonly limitado: boolean;
  /** Perfil → permissão já declarado no catálogo: a linha do mapa não muda nada (sempre vale). */
  readonly doCatalogo: boolean;
}

export interface DecisaoMapaTela {
  readonly id: string;
  readonly situacaoAntes: SituacaoMapa | null;
  readonly aprovadoPorAntes: string | null;
  readonly situacao: SituacaoMapa;
  readonly motivo: string | null;
  readonly usuariosAfetados: number | null;
  readonly decididoPor: string;
  readonly decididoEm: string | null;
}

/** POST /api/acesso/gestao/cache/invalidar: o usuário (ou o estabelecimento inteiro, sem login). */
export const esquemaInvalidarCache = z.object({ login: esquemaLogin.optional() }).strict();

// ── Telas ────────────────────────────────────────────────────────────────────────────────────────

export interface UsuarioGestaoTela {
  readonly login: string;
  readonly nome: string;
  readonly grupo: string | null;
  readonly ativo: boolean;
  readonly bloqueado: boolean;
}

/** De onde veio a permissão (texto da tela montado de cada tipo). */
export type OrigemPermissaoTela =
  | { readonly tipo: 'grupo'; readonly grupo: string; readonly opcao: number }
  | { readonly tipo: 'papel'; readonly opcao: number }
  | { readonly tipo: 'flag'; readonly flag: string }
  | { readonly tipo: 'perfil'; readonly perfil: string; readonly via: OrigemPerfilTela }
  | { readonly tipo: 'todos-os-perfis-de-pessoa' }
  | { readonly tipo: 'acesso-total' };

/** De onde veio o perfil do Sante SGH do usuário. */
export type OrigemPerfilTela = 'papel' | 'conselho' | 'concessao' | 'grupo';

export interface PermissaoEfetivaTela {
  readonly codigo: string;
  readonly descricao: string;
  readonly origens: readonly OrigemPermissaoTela[];
}

export interface PerfilConcedidoTela {
  readonly id: string;
  readonly perfil: string;
  readonly inicio: string;
  readonly fim: string | null;
  readonly motivo: string | null;
  readonly concedidoPor: string;
  readonly revogadoEm: string | null;
  readonly revogadoPor: string | null;
  /** W0-09: o motivo da revogação (as anteriores ao W0-09 ficam sem). */
  readonly revogadoMotivo?: string | null;
  readonly vigente: boolean;
  /** W0-09: quantas alterações de vigência ou motivo (GET perfis/:id/alteracoes traz o anterior de cada uma). */
  readonly alteracoes?: number;
}

export interface PapelUsuarioTela {
  readonly papel: number;
  readonly nome: string;
  readonly ativo: boolean;
}

export interface EfetivasTela {
  readonly usuario: UsuarioGestaoTela;
  readonly grupoAtivo: boolean | null;
  readonly papeis: readonly PapelUsuarioTela[];
  readonly perfis: readonly { readonly perfil: string; readonly origens: readonly OrigemPerfilTela[] }[];
  readonly permissoes: readonly PermissaoEfetivaTela[];
  /** O que a segregação de funções retirou (regra 9). */
  readonly retiradas: readonly { readonly permissao: string; readonly motivo: string }[];
  /** Conflitos mantidos porque o legado concede (revisão). */
  readonly conflitos: readonly { readonly permissao: string; readonly motivo: string }[];
  readonly concessoes: readonly PerfilConcedidoTela[];
  /** Quando as permissões foram calculadas (o cache da sessão é de 3 min; a tela lê ao vivo). */
  readonly calculadaEm: string;
}

export interface LinhaMapaTela {
  readonly id: string | null;
  readonly tipo: TipoMapa;
  readonly grupo: string | null;
  readonly perfil: string;
  readonly permissao: string | null;
  readonly origem: 'proposta-automatica' | 'revisao-area' | 'catalogo';
  readonly situacao: SituacaoMapa;
  readonly aprovadoPor: string | null;
  readonly aprovadoEm: string | null;
}

export interface MapaGestaoTela {
  readonly grupoPerfil: readonly LinhaMapaTela[];
  readonly perfilPermissao: readonly LinhaMapaTela[];
  /** Perfis que a tela oferece (complementares e de destino do mapa de grupos). */
  readonly perfis: readonly string[];
}

/** Estado de cada receita do legado no estabelecimento (POL-3: desligada, com o motivo visível). */
export interface OperacaoGestaoTela {
  readonly operacao: OperacaoGestaoLegado;
  readonly rotulo: string;
  readonly ligada: boolean;
  readonly estado: string | null;
  readonly motivo: string | null;
}

export interface GrupoGestaoTela {
  readonly grupo: string;
  readonly ativo: boolean;
  readonly opcoes: readonly number[];
}

export interface PapelGestaoTela {
  readonly papel: number;
  readonly nome: string;
  readonly opcoes: readonly number[];
}

export interface ResultadoGestaoTela {
  readonly operacao: string;
  /** Logins cujo cache de permissões foi invalidado (ou "todos" do estabelecimento). */
  readonly invalidado: 'usuario' | 'estabelecimento';
  readonly destino: 'legado' | 'memoria';
}

// ── W1-01 (parte 9b): contas dormentes ──────────────────────────────────────────────────────────

/**
 * W1-01 (parte 9b): incluir, trocar o prazo ou retirar a exceção de uma conta dormente (linha nova em
 * SGH_ACESSO_DORMENCIA_EXCECAO), com motivo e reautenticação. `ate` null: sem prazo (ignorado ao retirar).
 */
export const esquemaExcecaoDormencia = z
  .object({
    login: esquemaLogin,
    ate: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, 'Data inválida (AAAA-MM-DD).')
      .nullable(),
    retirar: z.boolean(),
    motivo: textoCp1252(200).pipe(z.string().trim().min(10, 'Explique o motivo (mínimo 10 caracteres).')),
    senha: esquemaSenhaDigitada,
  })
  .strict();
export type ExcecaoDormencia = z.infer<typeof esquemaExcecaoDormencia>;

/** W1-01 (parte 11d): situação do registro no conselho e fonte da conferência (SGH_ACESSO_CONSELHO_CONFER). */
export const SITUACOES_CONSELHO_TELA = [
  'ativo',
  'inativo',
  'suspenso',
  'cancelado',
  'nao-localizado',
] as const;
export const FONTES_CONSELHO_TELA = ['portal-conselho', 'documento', 'declaracao', 'outra'] as const;

/** W1-01 (parte 11d): registrar a conferência de um registro do conselho do usuário, com reautenticação. */
export const esquemaConferirConselho = z
  .object({
    registro: z.number().int().positive(),
    situacao: z.enum(SITUACOES_CONSELHO_TELA),
    conferidoEm: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Data inválida (AAAA-MM-DD).'),
    fonte: z.enum(FONTES_CONSELHO_TELA),
    observacao: textoCp1252(200).pipe(
      z.string().trim().min(10, 'Descreva a conferência (mínimo 10 caracteres).'),
    ),
    senha: esquemaSenhaDigitada,
  })
  .strict();
export type ConferirConselho = z.infer<typeof esquemaConferirConselho>;

/** W1-01 (parte 11d): a aba "Conselho" da ficha do usuário. */
export interface ConselhoUsuarioTela {
  readonly login: string;
  readonly parametros: {
    readonly bloqueio: 'desligado' | 'irregular' | 'irregular-ou-nao-conferido';
    readonly validadeDias: number;
    /** Sempre false enquanto não houver o conector com o conselho (dependência externa). */
    readonly consultaAutomatica: boolean;
    readonly motivoConsultaAutomatica: string;
  };
  readonly registros: readonly {
    readonly registro: number;
    readonly sigla: string | null;
    readonly numero: string | null;
    readonly uf: string | null;
    readonly ocupacao: string | null;
    readonly estado: 'regular' | 'irregular' | 'nao-conferido' | 'vencido';
    readonly liberaAtosPrivativos: boolean;
    readonly motivo: string;
    readonly ultima: {
      readonly situacao: (typeof SITUACOES_CONSELHO_TELA)[number];
      readonly conferidoEm: string;
      readonly fonte: (typeof FONTES_CONSELHO_TELA)[number];
    } | null;
  }[];
  /** Os atos privativos do usuário depois da conferência (false também quando não há registro). */
  readonly atosPrivativos: boolean;
  readonly motivoBloqueio: string | null;
  readonly historico: readonly {
    readonly id: string;
    readonly registro: number;
    readonly situacao: (typeof SITUACOES_CONSELHO_TELA)[number];
    readonly conferidoEm: string;
    readonly fonte: (typeof FONTES_CONSELHO_TELA)[number];
    readonly observacao: string;
    readonly criadoPor: string;
    readonly criadoEm: string | null;
  }[];
  readonly podeConferir: boolean;
}

/** W1-01 (parte 9b): rodar agora a rotina das contas dormentes (bloqueio pelo executor), com reautenticação. */
export const esquemaRodarContasDormentes = z.object({ senha: esquemaSenhaDigitada }).strict();
export type RodarContasDormentes = z.infer<typeof esquemaRodarContasDormentes>;

/** Uma conta dormente na tela (sem dado de pessoa: login, tipo, dias e situação). */
export interface ContaDormenteTela {
  readonly login: string;
  readonly tipo: 'pessoal' | 'dispositivo';
  readonly situacao: string;
  readonly diasSemAcesso: number | null;
  readonly limiteDias: number;
  readonly ultimoAcesso: string | null;
  readonly motivoExcecao?: string;
}

/** W1-01 (parte 9b): GET /api/acesso/gestao/contas-dormentes — prévia de hoje, exceções e histórico. */
export interface ContasDormentesGestaoTela {
  readonly hoje: string;
  readonly parametros: {
    readonly ligada: boolean;
    readonly diasPessoal: number;
    readonly diasDispositivo: number;
  };
  /** As que a rotina bloquearia hoje. */
  readonly previa: readonly ContaDormenteTela[];
  /** Dormentes poupadas (exceção vigente, nunca entrou, último gestor). */
  readonly poupadas: readonly ContaDormenteTela[];
  readonly excecoes: readonly {
    readonly login: string;
    readonly ate: string | null;
    readonly motivo: string;
  }[];
  readonly historico: readonly {
    readonly login: string;
    readonly ate: string | null;
    readonly situacao: 'vigente' | 'retirada';
    readonly motivo: string;
    readonly criadoPor: string;
    readonly criadoEm: string | null;
  }[];
  /** A operação de bloqueio neste estabelecimento (desligada: a rodada não bloqueia e diz por quê). */
  readonly bloqueio: { readonly ligada: boolean; readonly motivo: string | null };
}

/** W1-01 (parte 9b): resultado de POST …/contas-dormentes/rodar. */
export interface RodadaContasDormentesTela {
  readonly hoje: string;
  readonly ligada: boolean;
  readonly motivo: string | null;
  readonly bloqueadas: readonly ContaDormenteTela[];
  readonly poupadas: readonly ContaDormenteTela[];
  readonly falhas: readonly { readonly login: string; readonly codigo: string }[];
}

// ── W1-01 (parte 9c2): recertificação de acessos ───────────────────────────────────────────────

const esquemaDia = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Data inválida (AAAA-MM-DD).');

/** Abrir a campanha: escopo (um grupo, um setor ou todas as contas), prazo, motivo e reautenticação. */
export const esquemaAbrirRecert = z
  .object({
    escopo: z.enum(['grupo', 'setor', 'todos']),
    alvo: textoCp1252(40).nullable(),
    prazo: esquemaDia,
    motivo: textoCp1252(200).pipe(z.string().trim().min(10, 'Explique o motivo (mínimo 10 caracteres).')),
    senha: esquemaSenhaDigitada,
  })
  .strict();
export type AbrirRecert = z.infer<typeof esquemaAbrirRecert>;

/** Decidir uma conta: manter, ou retirar com bloqueio da conta ou revogação de um perfil do retrato. */
export const esquemaDecidirRecert = z
  .object({
    login: esquemaLogin,
    decisao: z.enum(['manter', 'retirar']),
    acao: z.enum(['bloqueio', 'revogacao']).nullable(),
    perfil: textoCp1252(60).nullable(),
    motivo: textoCp1252(200),
    senha: esquemaSenhaDigitada,
  })
  .strict();
export type DecidirRecert = z.infer<typeof esquemaDecidirRecert>;

/** Encerrar (as pendentes ficam pendentes no relatório) ou cancelar a campanha aberta. */
export const esquemaFecharRecert = z
  .object({
    situacao: z.enum(['encerrada', 'cancelada']),
    motivo: textoCp1252(200).pipe(z.string().trim().min(10, 'Explique o motivo (mínimo 10 caracteres).')),
    senha: esquemaSenhaDigitada,
  })
  .strict();
export type FecharRecert = z.infer<typeof esquemaFecharRecert>;

export interface RelatorioRecertTela {
  readonly total: number;
  readonly mantidas: number;
  readonly bloqueadas: number;
  readonly revogadas: number;
  readonly pendentes: number;
  readonly atrasadas: number;
  readonly percentual: number;
}

export interface CampanhaRecertTela {
  readonly id: string;
  readonly escopo: 'grupo' | 'setor' | 'todos';
  readonly alvo: string | null;
  readonly prazo: string;
  readonly motivo: string;
  readonly situacao: 'aberta' | 'encerrada' | 'cancelada';
  readonly criadoPor: string;
  readonly criadoEm: string | null;
  readonly fechadoPor: string | null;
  readonly fechadoEm: string | null;
  readonly motivoFechamento: string | null;
  readonly relatorio: RelatorioRecertTela;
}

/** Uma conta da campanha (só login, grupo e perfis do retrato; nunca dado de pessoa). */
export interface ItemRecertTela {
  readonly login: string;
  readonly grupo: string | null;
  readonly perfis: readonly string[];
  readonly decisao: 'manter' | 'retirar' | null;
  readonly acao: 'bloqueio' | 'revogacao' | null;
  readonly perfil: string | null;
  readonly motivo: string | null;
  readonly decididoPor: string | null;
  readonly decididoEm: string | null;
}

/** GET /api/acesso/gestao/recertificacoes — campanhas (mais nova primeiro) e o prazo padrão para a nova. */
export interface RecertificacoesGestaoTela {
  readonly hoje: string;
  readonly prazoPadrao: string;
  readonly prazoMaximoDias: number;
  readonly campanhas: readonly CampanhaRecertTela[];
  /** As operações do efeito da retirada neste estabelecimento (desligada: o motivo aparece na tela). */
  readonly bloqueio: { readonly ligada: boolean; readonly motivo: string | null };
}

/** GET /api/acesso/gestao/recertificacoes/:id — a campanha com as contas. */
export interface RecertificacaoGestaoTela {
  readonly hoje: string;
  readonly campanha: CampanhaRecertTela;
  readonly itens: readonly ItemRecertTela[];
}

/** Resultado de POST …/recertificacoes/:id/decisoes (o efeito da retirada já aplicado). */
export interface DecisaoRecertTela {
  readonly login: string;
  readonly decisao: 'manter' | 'retirar';
  readonly acao: 'bloqueio' | 'revogacao' | null;
  readonly perfil: string | null;
  readonly destino: 'legado' | 'memoria';
}

// ── W1-01 (parte 10b): pedido de acesso (tela 403 → dois níveis → concessão com fim) ───────────

const esquemaMotivoPedido = textoCp1252(200).pipe(
  z.string().trim().min(10, 'Explique o motivo (mínimo 10 caracteres).'),
);

/** Pedir um perfil (a própria pessoa): perfil, setor (bloco), período (primeiro e último dia) e motivo. */
export const esquemaNovoPedidoAcesso = z
  .object({
    perfil: textoCp1252(60),
    setor: textoCp1252(5),
    inicio: esquemaDia,
    fim: esquemaDia,
    motivo: esquemaMotivoPedido,
  })
  .strict();
export type NovoPedidoAcessoCorpo = z.infer<typeof esquemaNovoPedidoAcesso>;

/** Cancelar o próprio pedido antes da concessão (motivo e reautenticação). */
export const esquemaCancelarPedidoAcesso = z
  .object({ motivo: esquemaMotivoPedido, senha: esquemaSenhaDigitada })
  .strict();
export type CancelarPedidoAcessoCorpo = z.infer<typeof esquemaCancelarPedidoAcesso>;

/** Decidir o nível que o pedido espera (recusar exige motivo; aprovar aceita o motivo vazio). */
export const esquemaDecidirPedidoAcesso = z
  .object({
    decisao: z.enum(['aprovar', 'recusar']),
    motivo: textoCp1252(200),
    senha: esquemaSenhaDigitada,
  })
  .strict();
export type DecidirPedidoAcessoCorpo = z.infer<typeof esquemaDecidirPedidoAcesso>;

/** Revisão: reaplicar a concessão do pedido 'aprovado' que ficou sem ela (reautenticação). */
export const esquemaConcederPedidoAcesso = z.object({ senha: esquemaSenhaDigitada }).strict();
export type ConcederPedidoAcessoCorpo = z.infer<typeof esquemaConcederPedidoAcesso>;

export type SituacaoPedidoAcessoTela =
  'pendente' | 'aprovado-setor' | 'aprovado' | 'concedido' | 'recusado' | 'cancelado';

/** Um pedido (só login, perfil, setor, período, motivo e quem decidiu; nunca dado de pessoa). */
export interface PedidoAcessoTela {
  readonly id: string;
  readonly login: string;
  readonly perfil: string;
  readonly setor: string;
  readonly inicio: string;
  readonly fim: string;
  readonly motivo: string;
  readonly situacao: SituacaoPedidoAcessoTela;
  /** O nível que o pedido espera (null: não espera decisão). */
  readonly nivel: 'setor' | 'acessos' | null;
  readonly criadoEm: string | null;
  readonly setorPor: string | null;
  readonly setorEm: string | null;
  readonly acessosPor: string | null;
  readonly acessosEm: string | null;
  readonly fechadoPor: string | null;
  readonly fechadoEm: string | null;
  readonly motivoFechamento: string | null;
  /** ID da concessão em SGH_ACESSO_PERFIL_USUARIO (concedido). */
  readonly concessao: string | null;
}

/** Um setor (bloco) do estabelecimento para o combo do pedido (parte 10c). */
export interface SetorPedidoTela {
  readonly valor: string;
  readonly rotulo: string;
}

/** GET /api/acesso/pedidos — os pedidos da própria pessoa e o que ela pode pedir. */
export interface MeusPedidosAcessoTela {
  readonly hoje: string;
  readonly periodoMaximoDias: number;
  /** Perfis do catálogo que se pedem (os que a pessoa já tem vigentes ficam de fora). */
  readonly perfis: readonly string[];
  /** Setores (blocos) para o combo com busca (vazio se a estrutura não estiver disponível). */
  readonly setores: readonly SetorPedidoTela[];
  readonly pedidos: readonly PedidoAcessoTela[];
}

/** GET /api/acesso/gestao/pedidos — os pedidos do estabelecimento (em andamento primeiro) para decidir. */
export interface PedidosAcessoGestaoTela {
  readonly hoje: string;
  readonly pedidos: readonly PedidoAcessoTela[];
  /** O 1º nível cabe a um gestor de acessos (não há cadastro de gestor de setor; D-W101-34). */
  readonly setorSemGestor: boolean;
  /** Os nomes dos setores para a lista. */
  readonly setores: readonly SetorPedidoTela[];
}

/** Resultado de POST …/pedidos/:id/decisao (aprovado no 2º nível: o perfil já concedido). */
export interface DecisaoPedidoAcessoTela {
  readonly id: string;
  readonly situacao: SituacaoPedidoAcessoTela;
  readonly concessao: string | null;
  readonly destino: 'legado' | 'memoria';
}

// ── W1-01 (parte 11a): provisionamento pelo RH (tarefas derivadas dos vínculos; D-W101-35) ───────────

export type TipoTarefaRhTela = 'criar-acesso' | 'revisar-acesso' | 'suspender-acesso';

/** Resolver uma tarefa do RH: feita (criar-acesso exige o login criado) ou dispensada, com motivo e senha. */
export const esquemaResolverTarefaRh = z
  .object({
    tipo: z.enum(['criar-acesso', 'revisar-acesso', 'suspender-acesso']),
    vinculo: z.number().int().positive(),
    ref: textoCp1252(40).pipe(z.string().trim().min(1, 'Informe a tarefa.')),
    situacao: z.enum(['feita', 'dispensada']),
    login: esquemaLogin.nullable(),
    motivo: textoCp1252(200),
    senha: esquemaSenhaDigitada,
  })
  .strict();
export type ResolverTarefaRhCorpo = z.infer<typeof esquemaResolverTarefaRh>;

/** Incluir, trocar (perfil) ou retirar (perfil null) a sugestão de perfil de um cargo, com motivo e senha. */
export const esquemaDefinirPerfilCargoRh = z
  .object({
    cargo: textoCp1252(60).pipe(z.string().trim().min(1, 'Informe o cargo.')),
    perfil: textoCp1252(60).nullable(),
    motivo: textoCp1252(200).pipe(z.string().trim().min(10, 'Explique o motivo (mínimo 10 caracteres).')),
    senha: esquemaSenhaDigitada,
  })
  .strict();
export type DefinirPerfilCargoRhCorpo = z.infer<typeof esquemaDefinirPerfilCargoRh>;

/** Uma tarefa aberta (nome do colaborador, cargo e setor do vínculo; o login, quando há usuário). */
export interface TarefaRhTela {
  readonly tipo: TipoTarefaRhTela;
  readonly vinculo: number;
  readonly ref: string;
  readonly nome: string;
  readonly cargo: string;
  readonly setor: string | null;
  readonly desde: string;
  readonly login: string | null;
  readonly perfilSugerido: string | null;
  readonly detalhe: readonly string[];
}

/** Uma resolução registrada (imutável). */
export interface ResolucaoRhTela {
  readonly id: string;
  readonly tipo: TipoTarefaRhTela;
  readonly vinculo: number;
  readonly ref: string;
  readonly situacao: 'feita' | 'dispensada';
  readonly login: string | null;
  readonly motivo: string;
  readonly resolvidoPor: string;
  readonly resolvidoEm: string | null;
}

/** GET /api/acesso/gestao/rh/tarefas */
export interface TarefasRhGestaoTela {
  readonly hoje: string;
  readonly tarefas: readonly TarefaRhTela[];
  /** As resoluções mais novas (consultáveis; não se editam). */
  readonly resolvidas: readonly ResolucaoRhTela[];
  readonly parametros: { readonly suspenderAfastamento: boolean; readonly diasMinimosAfastamento: number };
  /** O bloqueio (suspender feita) depende da receita acesso.bloquearUsuario ligada. */
  readonly bloqueio: { readonly ligada: boolean; readonly motivo: string | null };
}

/** Uma linha do mapa cargo → perfil (histórico: a mais nova primeiro). */
export interface PerfilCargoRhTela {
  readonly id: string;
  readonly cargo: string;
  readonly perfil: string | null;
  readonly situacao: 'vigente' | 'retirado';
  readonly motivo: string;
  readonly criadoPor: string;
  readonly criadoEm: string | null;
}

/** GET /api/acesso/gestao/rh/perfis-cargo */
export interface PerfisCargoRhGestaoTela {
  /** Mapa em vigor: cargo (chave normalizada) → perfil. */
  readonly vigentes: Readonly<Record<string, string>>;
  readonly historico: readonly PerfilCargoRhTela[];
  /** Perfis do catálogo que se podem sugerir. */
  readonly perfis: readonly string[];
  /** Cargos que aparecem nos vínculos ativos (para o combo com busca). */
  readonly cargos: readonly string[];
}

/** Resultado de POST …/rh/tarefas/resolver (suspender feita: o bloqueio já aplicado). */
export interface ResolucaoTarefaRhResultado {
  readonly id: string;
  readonly bloqueado: boolean;
  readonly destino: 'legado' | 'memoria';
}

// ── W1-01 (parte 12a): "Aplicar acessos de…" (usuário-modelo) ───────────────────────────────────

/** Somar: só acrescenta ao alvo. Igualar: também retira do alvo o papel e o perfil que o modelo não tem. */
export const esquemaModoModelo = z.enum(['somar', 'igualar']);

/** POST /api/acesso/gestao/usuarios/:login/modelo/previa: a diferença, sem gravar. */
export const esquemaPreviaModelo = z.object({ modelo: esquemaLogin, modo: esquemaModoModelo }).strict();
export type PreviaModeloEntrada = z.infer<typeof esquemaPreviaModelo>;

/**
 * POST /api/acesso/gestao/usuarios/:login/modelo/aplicar: grava o plano que a prévia mostrou (`conferencia` é o
 * resumo dela; se o modelo ou o alvo mudou no meio, recusa com `previa-desatualizada`). Motivo e senha obrigatórios.
 */
export const esquemaAplicarModelo = z
  .object({
    modelo: esquemaLogin,
    modo: esquemaModoModelo,
    conferencia: z.string().regex(/^[0-9a-f]{64}$/, 'Prévia inválida: mostre a diferença de novo.'),
    motivo: textoCp1252(200).pipe(z.string().trim().min(10, 'Explique o motivo (ao menos 10 caracteres).')),
    senha: esquemaSenhaDigitada,
  })
  .strict();
export type AplicarModeloEntrada = z.infer<typeof esquemaAplicarModelo>;

export interface ItemPapelModeloTela {
  readonly papel: number;
  readonly nome: string;
}

export interface PreviaModeloTela {
  readonly alvo: string;
  readonly modelo: string;
  readonly modo: 'somar' | 'igualar';
  readonly grupo: { readonly de: string | null; readonly para: string } | null;
  readonly papeisConceder: readonly ItemPapelModeloTela[];
  readonly papeisReativar: readonly ItemPapelModeloTela[];
  readonly papeisRetirar: readonly ItemPapelModeloTela[];
  readonly perfisConceder: readonly { readonly perfil: string; readonly fim: string | null }[];
  readonly perfisRetirar: readonly { readonly id: string; readonly perfil: string }[];
  readonly iguais: number;
  readonly ignorados: readonly {
    readonly tipo: 'grupo' | 'papel' | 'perfil';
    readonly item: string;
    readonly motivo: 'privilegio-nominal' | 'vem-do-conselho' | 'grupo-inativo' | 'segregacao';
  }[];
  readonly passos: number;
  /** Resumo (sha256) do plano: volta no aplicar. */
  readonly conferencia: string;
}

export interface PassoModeloTela {
  readonly acao:
    | 'trocar-grupo'
    | 'conceder-papel'
    | 'reativar-papel'
    | 'retirar-papel'
    | 'conceder-perfil'
    | 'retirar-perfil';
  readonly item: string;
  readonly feito: boolean;
  /** Mensagem da recusa do passo (sem tabela nem valor), quando não foi feito. */
  readonly erro: string | null;
}

export interface ResultadoModeloTela {
  readonly alvo: string;
  readonly modelo: string;
  readonly passos: readonly PassoModeloTela[];
  readonly feitos: number;
  readonly falhas: number;
  readonly destino: 'legado' | 'memoria';
}
