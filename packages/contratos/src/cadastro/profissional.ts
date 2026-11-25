// D-PROF-39 (revisão do M39, liberação full de 30/10/2026): inclusão e edição do profissional do corpo clínico pelas
// operações do executor (M04). O mesmo validador na tela e no servidor. Texto pelo validador CP1252 (ADR 0008), em
// maiúsculas como o cadastro grava, com o tamanho da coluna. Dados bancários, de repasse, fiscais e de folha NUNCA
// entram (regra 11 do M11): nenhum campo deles existe aqui. O CPF não muda depois de gravado (o cadastro recusa a
// troca da chave); o CNS só na inclusão.
import { z } from 'zod';
import { textoCp1252 } from '../texto-cp1252.js';
import { cnsValido } from '../validacao/cns.js';
import { cpfValido, somenteDigitos } from '../validacao/cpf.js';
import { idBanco } from '../validacao/id-banco.js';

const maiusculas = (max: number) =>
  textoCp1252(max)
    .overwrite((t) => t.replace(/\s+/g, ' ').trim().toLocaleUpperCase('pt-BR'))
    .pipe(textoCp1252(max));
const nome = maiusculas(70).refine((t) => t.length >= 5, 'Nome com ao menos 5 letras.');
const dataCivil = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Use AAAA-MM-DD.')
  .refine((d) => !Number.isNaN(Date.parse(`${d}T00:00:00Z`)) && d > '1900-01-01', 'Data inválida.');
const id = idBanco;
const smallint = z.number().int().min(1).max(32_767);
const email = textoCp1252(50)
  .overwrite((t) => t.trim().toLowerCase())
  .pipe(z.email());
const celular = z.string().transform(somenteDigitos).pipe(z.string().min(10, 'Telefone com DDD.').max(15));
/** Sigla do conselho como o cadastro de conselhos a guarda (CRM, COREN, CREFITO…; até 7 letras). */
export const esquemaSiglaConselho = z
  .string()
  .trim()
  .transform((x) => x.toUpperCase())
  .pipe(z.string().regex(/^[A-Z]{2,7}$/, 'Sigla do conselho (CRM, COREN…).'));
const uf = z
  .string()
  .trim()
  .transform((x) => x.toUpperCase())
  .pipe(z.string().regex(/^[A-Z]{2}$/, 'UF com duas letras.'));

/** Registro novo no conselho com a ocupação (CBO): a chave do registro (CBO, número e UF) não muda depois. */
export const esquemaRegistroNovoProfissional = z
  .object({
    conselho: esquemaSiglaConselho,
    numero: z.number().int().positive().max(2_147_483_647),
    uf,
    /** A ocupação (ID do cadastro de CBO). */
    cbo: id,
    /** Sigla complementar do registro (cadastro de siglas por conselho), quando houver. */
    sigla: smallint.optional(),
    /** Convênios em que o registro passa a ser credenciado (o padrão da tela: todos os ativos). */
    convenios: z.array(smallint).max(300).default([]),
  })
  .strict();
export type RegistroNovoProfissional = z.infer<typeof esquemaRegistroNovoProfissional>;

export const esquemaCadastrarProfissional = z
  .object({
    nome,
    nomeSocial: maiusculas(70).optional(),
    cpf: z
      .string()
      .transform(somenteDigitos)
      .refine(cpfValido, 'CPF inválido: confira os dígitos (sequência repetida não é CPF).'),
    sexo: z.enum(['M', 'F']).optional(),
    nascimento: dataCivil.optional(),
    nomeMae: maiusculas(70).optional(),
    cns: z.string().transform(somenteDigitos).refine(cnsValido, 'CNS inválido.').optional(),
    email: email.optional(),
    celular: celular.optional(),
    registro: esquemaRegistroNovoProfissional,
  })
  .strict();
export type CadastrarProfissionalEntrada = z.infer<typeof esquemaCadastrarProfissional>;

/** O que muda nos dados do profissional (null apaga o campo opcional). */
export const esquemaAlteracoesProfissional = z
  .object({
    nome: nome.optional(),
    nomeSocial: z.union([maiusculas(70), z.null()]).optional(),
    sexo: z.union([z.enum(['M', 'F']), z.null()]).optional(),
    nascimento: z.union([dataCivil, z.null()]).optional(),
    nomeMae: z.union([maiusculas(70), z.null()]).optional(),
    email: z.union([email, z.null()]).optional(),
    celular: z.union([celular, z.null()]).optional(),
  })
  .strict()
  .refine((a) => Object.keys(a).length > 0, 'Nenhum campo para alterar.');
export type AlteracoesProfissional = z.infer<typeof esquemaAlteracoesProfissional>;

export const esquemaAlterarProfissional = z
  .object({
    profissional: id,
    /** Versão que a ficha leu (controle otimista; opaca para a tela). */
    versao: z.string().min(2).max(4000),
    alteracoes: esquemaAlteracoesProfissional,
  })
  .strict();
export type AlterarProfissionalEntrada = z.infer<typeof esquemaAlterarProfissional>;

/** Outro registro (outro conselho, número, UF ou CBO) para o mesmo profissional. */
export const esquemaIncluirRegistroProfissional = esquemaRegistroNovoProfissional
  .extend({ profissional: id })
  .strict();
export type IncluirRegistroProfissionalEntrada = z.infer<typeof esquemaIncluirRegistroProfissional>;

/** Justificativa ou motivo (trilha e histórico): texto livre de 10 a 200 letras, CP1252. */
export const esquemaMotivoProfissional = textoCp1252(200)
  .overwrite((t) => t.replace(/\s+/g, ' ').trim())
  .pipe(textoCp1252(200))
  .refine((t) => t.length >= 10, 'Escreva o motivo com ao menos 10 letras.');

/**
 * Ativar/inativar o registro e corrigir o conselho e a sigla (CBO, número e UF pedem registro novo). Revisão da
 * D-PROF-39: mudar `ativo` é encerrar ou reativar o registro — exige o motivo (vai ao histórico do profissional) e, no
 * servidor, a permissão de inativar (cadastro.profissional.excluir), como inativar e reativar o profissional.
 */
export const esquemaAlterarRegistroProfissional = z
  .object({
    registro: id,
    versao: z.string().min(2).max(1000),
    alteracoes: z
      .object({
        ativo: z.boolean().optional(),
        conselho: esquemaSiglaConselho.optional(),
        sigla: z.union([smallint, z.null()]).optional(),
      })
      .strict()
      .refine((a) => Object.keys(a).length > 0, 'Nenhum campo para alterar.'),
    /** O motivo do encerramento ou da reativação (obrigatório quando `alteracoes.ativo` vem). */
    motivo: esquemaMotivoProfissional.optional(),
  })
  .strict()
  .refine((e) => e.alteracoes.ativo === undefined || e.motivo !== undefined, {
    message: 'Escreva o motivo do encerramento ou da reativação do registro.',
    path: ['motivo'],
  });
export type AlterarRegistroProfissionalEntrada = z.infer<typeof esquemaAlterarRegistroProfissional>;

/** Especialidade do registro: inclui ou muda a situação (nunca exclui). */
export const esquemaEspecialidadeProfissional = z
  .object({ registro: id, especialidade: smallint, ativo: z.boolean() })
  .strict();
export type EspecialidadeProfissionalEntrada = z.infer<typeof esquemaEspecialidadeProfissional>;

/** Credenciar ou descredenciar o registro num convênio. */
export const esquemaCredenciamentoProfissional = z
  .object({ registro: id, convenio: smallint, credenciado: z.boolean() })
  .strict();
export type CredenciamentoProfissionalEntrada = z.infer<typeof esquemaCredenciamentoProfissional>;

// ── Respostas e listas da tela ──────────────────────────────────────────────────────────────────────

export const esquemaProfissionalGravado = z.object({
  profissional: z.number().int(),
  registro: z.number().int(),
});
export type ProfissionalGravado = z.infer<typeof esquemaProfissionalGravado>;
export const esquemaRegistroProfissionalGravado = z.object({ registro: z.number().int() });
export type RegistroProfissionalGravado = z.infer<typeof esquemaRegistroProfissionalGravado>;

const opcao = z.object({ valor: z.union([z.number().int(), z.string()]), rotulo: z.string() });
/** Listas da edição (combos com busca, ADR 0027): conselhos, siglas, CBO, especialidades, unidades, convênios, UF. */
export const esquemaOpcoesProfissional = z.object({
  conselhos: z.array(opcao),
  siglas: z.array(z.object({ valor: z.number().int(), rotulo: z.string(), conselho: z.string().nullable() })),
  cbos: z.array(opcao),
  especialidades: z.array(opcao),
  unidades: z.array(opcao),
  convenios: z.array(opcao),
  ufs: z.array(z.string()),
});
export type OpcoesProfissional = z.infer<typeof esquemaOpcoesProfissional>;

/** Dados editáveis do profissional na ficha (sem documentos, sem dados bancários nem de repasse). */
export const esquemaDadosProfissional = z.object({
  sexo: z.string().nullable(),
  nascimento: z.string().nullable(),
  nomeMae: z.string().nullable(),
  email: z.string().nullable(),
  celular: z.string().nullable(),
  /** Versão para o controle otimista (opaca). */
  versao: z.string(),
});
export type DadosProfissional = z.infer<typeof esquemaDadosProfissional>;

// ── Vínculo com o login, inativação, reativação e exclusão (requisitos do dono, 18/11/2026) ─────────────

/** Login do sistema (o nome de usuário, como o cadastro de usuários o guarda: até 31 letras, maiúsculas). */
export const esquemaLoginSistema = z
  .string()
  .trim()
  .transform((x) => x.toUpperCase())
  .pipe(z.string().regex(/^[A-Z0-9._@-]{1,31}$/, 'Login inválido.'));

/**
 * Liga, troca ou desliga o login do sistema do registro do profissional (é por ele que o profissional vê os próprios
 * atendimentos e assina como profissional). `versao` é o login ligado que a ficha leu ('' sem login). Trocar ou
 * desligar um login já ligado exige justificativa (SBIS NGS1.03.09 d: o vínculo de quem já operou não some sem
 * registro; o histórico guarda o antes e o depois).
 */
export const esquemaVincularLoginProfissional = z
  .object({
    profissional: id,
    registro: id,
    login: z.union([esquemaLoginSistema, z.null()]),
    versao: z.string().max(31),
    justificativa: esquemaMotivoProfissional.optional(),
  })
  .strict();
export type VincularLoginProfissionalEntrada = z.infer<typeof esquemaVincularLoginProfissional>;

// ── Login único por profissional (pergunta do dono, 18/11/2026: "por que tem 3 logins?") ────────────────
// O login liga-se a UM registro (ocupação) do profissional, como o cadastro anterior (papel Operador de sistema,
// profissional ligado ao papel do usuário; 679 logins medidos, cada um num registro). O profissional com o mesmo conselho em
// várias ocupações (vários CBOs) continua com UM login: trocar a ocupação move a ligação; ligar um SEGUNDO login, a
// outro registro do mesmo profissional, é recusado. A mesma regra no executor, na memória da API e na tela.

/** Código da recusa: o profissional já tem outro login ligado a outro registro dele. */
export const RECUSA_OUTRO_LOGIN_NO_PROFISSIONAL = 'outro-login-no-profissional';

/** A mensagem da recusa (a mesma no executor e na memória da API). */
export function mensagemOutroLoginNoProfissional(login: string): string {
  return `Este profissional já tem o login ${login} ligado a outra ocupação. Um profissional tem um login só: troque o login ou a ocupação em vez de ligar outro.`;
}

/** Uma ligação lida: o registro (ocupação) e o login ligado a ele. */
export interface LigacaoLoginProfissional {
  readonly registro: number;
  readonly login: string;
}

/**
 * A regra do login único: ligar `login` ao `registro` é recusado quando OUTRO registro do mesmo profissional já tem um
 * login DIFERENTE. Devolve esse login (o motivo da recusa) ou null (pode ligar). Desligar (login null) sempre pode;
 * mover o mesmo login de uma ocupação para outra também (é a troca de ocupação).
 */
export function outroLoginDoProfissional(
  ligacoes: readonly LigacaoLoginProfissional[],
  registro: number,
  login: string | null,
): string | null {
  if (!login) return null;
  const novo = login.trim().toUpperCase();
  const outro = ligacoes.find((x) => x.registro !== registro && x.login.trim().toUpperCase() !== novo);
  return outro ? outro.login.trim().toUpperCase() : null;
}

/**
 * Revisão: o dado herdado com DOIS logins no MESMO registro (o legado não impede). Ligar ou trocar o login nesse
 * registro deixaria o outro lá: devolve o login que sobraria (nem o novo, nem o `versao` que a troca tira) ou null.
 */
export function outroLoginNoRegistro(
  ligacoes: readonly LigacaoLoginProfissional[],
  registro: number,
  login: string | null,
  versao: string,
): string | null {
  if (!login) return null;
  const novo = login.trim().toUpperCase();
  const sai = versao.trim().toUpperCase();
  const outro = ligacoes.find((x) => {
    const l = x.login.trim().toUpperCase();
    return x.registro === registro && l !== novo && l !== sai;
  });
  return outro ? outro.login.trim().toUpperCase() : null;
}

/** A mensagem da recusa do outro login no mesmo registro. */
export function mensagemOutroLoginNoRegistro(login: string): string {
  return `Esta ocupação também tem o login ${login} ligado. Um profissional tem um login só: desligue ${login} antes.`;
}

/** Os logins distintos ligados ao profissional (mais de um só por dado herdado: a tela avisa e oferece desligar). */
export function loginsDistintosDoProfissional(ligacoes: readonly LigacaoLoginProfissional[]): string[] {
  return [...new Set(ligacoes.map((x) => x.login.trim().toUpperCase()).filter(Boolean))];
}

/** Inativar ou reativar o profissional (todos os registros dele), sempre com o motivo. */
export const esquemaSituacaoProfissional = z
  .object({ profissional: id, motivo: esquemaMotivoProfissional })
  .strict();
export type SituacaoProfissionalEntrada = z.infer<typeof esquemaSituacaoProfissional>;

/** Excluir o profissional cadastrado por engano (só sem nenhum vínculo), com o motivo. */
export const esquemaExcluirProfissional = z
  .object({ profissional: id, motivo: esquemaMotivoProfissional })
  .strict();
export type ExcluirProfissionalEntrada = z.infer<typeof esquemaExcluirProfissional>;

/** Excluir o registro incluído por engano (só sem nenhum ato vinculado), com o motivo. */
export const esquemaExcluirRegistroProfissional = z
  .object({ registro: id, motivo: esquemaMotivoProfissional })
  .strict();
export type ExcluirRegistroProfissionalEntrada = z.infer<typeof esquemaExcluirRegistroProfissional>;

/** Um grupo de vínculos que impede a exclusão (o rótulo é de produto; nenhum nome de tabela sai daqui). */
export const esquemaVinculoProfissional = z.object({
  grupo: z.string(),
  quantidade: z.number().int(),
});
/** O que depende do profissional (ou do registro): vazio, a exclusão é permitida. */
export const esquemaDependenciasProfissional = z.object({
  total: z.number().int(),
  vinculos: z.array(esquemaVinculoProfissional),
  podeExcluir: z.boolean(),
});
export type DependenciasProfissional = z.infer<typeof esquemaDependenciasProfissional>;

/** Logins que podem ser ligados (ativos), com o nome completo para a busca. */
export const esquemaLoginsProfissional = z.array(
  z.object({
    login: z.string(),
    nome: z.string().nullable(),
    /** O profissional a que o login já está ligado (null: livre). */
    profissional: z.number().int().nullable(),
  }),
);
export type LoginsProfissional = z.infer<typeof esquemaLoginsProfissional>;

/** Uma linha do histórico do vínculo e da situação (quem, quando, o quê e o motivo). */
export const esquemaEventoProfissional = z.object({
  evento: z.enum([
    'login-ligado',
    'login-trocado',
    'login-desligado',
    'inativado',
    'reativado',
    'registro-excluido',
  ]),
  registro: z.number().int().nullable(),
  loginAntes: z.string().nullable(),
  loginDepois: z.string().nullable(),
  motivo: z.string().nullable(),
  usuario: z.string(),
  em: z.string(),
});
export type EventoProfissional = z.infer<typeof esquemaEventoProfissional>;
