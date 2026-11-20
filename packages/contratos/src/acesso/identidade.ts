// Contratos do M59-F2 (senhas, segundo fator e identidade; ficha do M59, seções 6 a 8; cap-08 §8.8, §8.16;
// SBIS-03, SBIS-08). Nada aqui leva senha, hash, salt nem segredo TOTP: a situação da credencial é uma classe
// ("forte", "legado com cifra", ...) e as contagens saem em faixa (0, "<5" ou o número a partir de 5).
//
// - Credencial forte (SGH_ACESSO_CREDENCIAL): Argon2id com sal individual, regravada no primeiro login pelo
//   Sante SGH; o legado (TBUSERS.SENHA) fica como está até a retirada (acesso.retirarSenhaLegado), que só roda
//   depois do fim do período de contingência (parâmetro legado.contingencia, por estabelecimento).
// - Política do segundo fator (SGH_ACESSO_POLITICA_2FA): obrigatoriedade por perfil, por grupo ou para todos,
//   por estabelecimento, em ondas (1: perfis críticos; 2: todos), com prazo de adesão em dias.
import { z } from 'zod';
import { esquemaCodigoEstabelecimento } from '../sessao.js';
import { esquemaLogin } from './entrada.js';

/** Contagem em faixa: nenhum número abaixo de 5 sai (só "<5"). */
export const esquemaFaixaContagem = z.union([z.number().int().nonnegative(), z.literal('<5')]);
export type FaixaContagem = z.infer<typeof esquemaFaixaContagem>;

/** Situação da senha de um usuário, sem nenhum valor (só a classe). */
export const SITUACOES_CREDENCIAL = [
  /** Credencial forte do Sante SGH (Argon2id, sal individual) em SGH_ACESSO_CREDENCIAL. */
  'forte',
  /** Só a senha do legado, cifrada e com SALT. */
  'legado-cifrada',
  /** Só a senha do legado, cifrada e sem SALT. */
  'legado-sem-salt',
  /** Só a senha do legado, em texto puro (SENHA_CRIPTOGRAFADA = F). */
  'legado-texto-puro',
  /** Nenhuma senha guardada (primeiro acesso, ou retirada depois da credencial forte). */
  'sem-senha',
] as const;
export type SituacaoCredencial = (typeof SITUACOES_CREDENCIAL)[number];

export const ROTULOS_SITUACAO_CREDENCIAL: Readonly<Record<SituacaoCredencial, string>> = {
  forte: 'Credencial forte',
  'legado-cifrada': 'Senha antiga com cifra',
  'legado-sem-salt': 'Senha antiga sem sal',
  'legado-texto-puro': 'Senha antiga sem cifra',
  'sem-senha': 'Sem senha guardada',
};

/** Situação do segundo fator de um usuário. */
export const SITUACOES_SEGUNDO_FATOR = ['ativo', 'pendente', 'ausente', 'revogado'] as const;
export type SituacaoSegundoFator = (typeof SITUACOES_SEGUNDO_FATOR)[number];

/** O que a política exige do usuário agora (regra 3). */
export const EXIGENCIAS_2FA = [
  /** Nenhuma política alcança o usuário: o segundo fator é opcional. */
  'opcional',
  /** A política alcança o usuário e ele está no prazo de adesão: entra e é levado ao cadastro. */
  'adesao',
  /** A política alcança o usuário e o prazo de adesão acabou: sem segundo fator ativo, não entra. */
  'obrigatorio',
] as const;
export type Exigencia2fa = (typeof EXIGENCIAS_2FA)[number];

export const ROTULOS_EXIGENCIA_2FA: Readonly<Record<Exigencia2fa, string>> = {
  opcional: 'Opcional',
  adesao: 'Obrigatório (prazo de adesão)',
  obrigatorio: 'Obrigatório',
};

/** Alvo de uma linha da política: um perfil do Sante SGH, um grupo de usuários ou todos. */
export const ALVOS_POLITICA_2FA = ['perfil', 'grupo', 'todos'] as const;
export type AlvoPolitica2fa = (typeof ALVOS_POLITICA_2FA)[number];

/** Ondas da obrigatoriedade (ficha, seção 12): 1 = perfis críticos; 2 = todos. */
export const ONDAS_2FA = [1, 2] as const;

const esquemaDataIso = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use AAAA-MM-DD.');

/** Uma linha da política (leitura). */
export const esquemaPolitica2fa = z.object({
  id: z.string().min(1),
  estabelecimento: esquemaCodigoEstabelecimento,
  alvo: z.enum(ALVOS_POLITICA_2FA),
  /** Código do perfil, nome do grupo ou null quando o alvo é "todos". */
  valor: z.string().max(60).nullable(),
  onda: z.union([z.literal(1), z.literal(2)]),
  /** Dia em que a obrigatoriedade começa (AAAA-MM-DD, hora civil do estabelecimento). */
  inicio: esquemaDataIso,
  /** Dias de adesão a partir do início: dentro deles, quem não tem segundo fator entra e é levado ao cadastro. */
  prazoAdesaoDias: z.number().int().min(0).max(90),
  ativa: z.boolean(),
  criadaPor: z.string(),
  criadaEm: z.string(),
  encerradaEm: z.string().nullable(),
});
export type Politica2fa = z.infer<typeof esquemaPolitica2fa>;

/** POST /api/acesso/identidade/politica-2fa (nova linha). */
export const esquemaNovaPolitica2fa = z
  .object({
    alvo: z.enum(ALVOS_POLITICA_2FA),
    valor: z.string().trim().min(1).max(60).nullable(),
    onda: z.union([z.literal(1), z.literal(2)]),
    inicio: esquemaDataIso,
    prazoAdesaoDias: z.number().int().min(0).max(90),
    motivo: z.string().trim().min(5, 'Explique o motivo (5 caracteres ou mais).').max(200),
  })
  .strict()
  .refine((p) => (p.alvo === 'todos' ? p.valor === null : p.valor !== null), {
    message: 'Informe o perfil ou o grupo (e nada quando o alvo é "todos").',
    path: ['valor'],
  });
export type NovaPolitica2fa = z.infer<typeof esquemaNovaPolitica2fa>;

/**
 * POST /api/acesso/identidade/politica-2fa/:id/alteracao (W0-09): o prazo e o alvo da linha vigente, com motivo. A
 * linha atual é encerrada ("Alterada") e nasce outra com a mesma onda e o mesmo início: o anterior fica visível.
 */
export const esquemaAlterarPolitica2fa = z
  .object({
    alvo: z.enum(ALVOS_POLITICA_2FA),
    valor: z.string().trim().min(1).max(60).nullable(),
    prazoAdesaoDias: z.number().int().min(0).max(90),
    motivo: z.string().trim().min(5, 'Explique o motivo (5 caracteres ou mais).').max(200),
  })
  .strict()
  .refine((p) => (p.alvo === 'todos' ? p.valor === null : p.valor !== null), {
    message: 'Informe o perfil ou o grupo (e nada quando o alvo é "todos").',
    path: ['valor'],
  });
export type AlterarPolitica2fa = z.infer<typeof esquemaAlterarPolitica2fa>;

/** POST /api/acesso/identidade/politica-2fa/:id/encerrar (a obrigatoriedade volta a opcional: recolher). */
export const esquemaEncerrarPolitica2fa = z.object({ motivo: z.string().trim().min(5).max(200) }).strict();
export type EncerrarPolitica2fa = z.infer<typeof esquemaEncerrarPolitica2fa>;

/** Resumo agregado da situação das senhas e do segundo fator do estabelecimento (só faixas). */
export const esquemaResumoIdentidade = z.object({
  estabelecimento: esquemaCodigoEstabelecimento,
  /** Usuários ativos e livres (STATUS = T, BLOQUEADO = F) contados. */
  ativos: esquemaFaixaContagem,
  porSenha: z.record(z.enum(SITUACOES_CREDENCIAL), esquemaFaixaContagem),
  porSegundoFator: z.record(z.enum(SITUACOES_SEGUNDO_FATOR), esquemaFaixaContagem),
  /** O período de contingência (legado.contingencia) está ligado: a retirada da senha antiga fica recusada. */
  contingencia: z.boolean(),
  /** As tabelas SGH_ do M59-F2 existem no banco do estabelecimento (sgh:aplicar). */
  tabelasProntas: z.boolean(),
});
export type ResumoIdentidade = z.infer<typeof esquemaResumoIdentidade>;

/** Uma linha da lista de usuários com a situação (login e nome são de usuário do sistema, não de paciente). */
export const esquemaUsuarioIdentidade = z.object({
  login: z.string(),
  nome: z.string(),
  grupo: z.string().nullable(),
  ativo: z.boolean(),
  bloqueado: z.boolean(),
  senha: z.enum(SITUACOES_CREDENCIAL),
  /** A senha antiga ainda está no legado (mesmo com credencial forte): candidata à retirada. */
  senhaLegadoPresente: z.boolean(),
  credencialEm: z.string().nullable(),
  segundoFator: z.enum(SITUACOES_SEGUNDO_FATOR),
});
export type UsuarioIdentidade = z.infer<typeof esquemaUsuarioIdentidade>;

/** GET /api/acesso/identidade/usuarios?busca=&pagina= */
export const esquemaFiltroUsuariosIdentidade = z.object({
  busca: z.string().trim().max(60).optional(),
  senha: z.enum(SITUACOES_CREDENCIAL).optional(),
  pagina: z.coerce.number().int().min(1).max(500).default(1),
});
export type FiltroUsuariosIdentidade = z.infer<typeof esquemaFiltroUsuariosIdentidade>;

export const esquemaPaginaUsuariosIdentidade = z.object({
  itens: z.array(esquemaUsuarioIdentidade),
  pagina: z.number().int(),
  temMais: z.boolean(),
});
export type PaginaUsuariosIdentidade = z.infer<typeof esquemaPaginaUsuariosIdentidade>;

/** Entrada de acesso.retirarSenhaLegado (a operação do executor; nenhuma senha vai junto). */
export const esquemaRetirarSenhaLegado = z.object({ login: esquemaLogin }).strict();
export type RetirarSenhaLegadoEntrada = z.infer<typeof esquemaRetirarSenhaLegado>;

/** GET /api/sessao/segundo-fator: a situação do próprio usuário e o que a política exige dele. */
export const esquemaMeuSegundoFator = z.object({
  situacao: z.enum(SITUACOES_SEGUNDO_FATOR),
  exigencia: z.enum(EXIGENCIAS_2FA),
  /** Fim do prazo de adesão (AAAA-MM-DD) quando a exigência é "adesao"; null nos demais. */
  prazoAdesaoAte: z.string().nullable(),
  confirmadoEm: z.string().nullable(),
  /** O cadastro está disponível (tabela pronta e chave do envelope configurada). */
  disponivel: z.boolean(),
});
export type MeuSegundoFator = z.infer<typeof esquemaMeuSegundoFator>;
