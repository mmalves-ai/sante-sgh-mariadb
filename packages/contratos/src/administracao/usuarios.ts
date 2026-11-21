// Contratos da tela "Usuários" (M10, ficha seção 7; cap-08 §8.9): lista paginada no servidor, ficha com grupo,
// escopos, papéis SBIS, flags complementares, conexões e situação do termo; gravações pelas receitas do executor
// do M04 (e as tabelas de escopo, exatamente como o legado grava). Nada aqui leva senha, hash, código de
// verificação nem e-mail; a ficha diz se o CPF e a senha estão definidos e só a conta da plataforma recebe o
// número do CPF (`usuario.cpf`; para os demais, null).
import { z } from 'zod';
import { esquemaLogin, esquemaSenhaDigitada } from '../acesso/entrada.js';
import { esquemaNomeGrupo } from '../acesso/gestao.js';
import { textoCp1252 } from '../texto-cp1252.js';
import { cpfValido } from '../validacao/cpf.js';

export const SITUACOES_USUARIO = ['todos', 'ativos', 'inativos', 'bloqueados'] as const;
export type SituacaoUsuarioFiltro = (typeof SITUACOES_USUARIO)[number];

export const TETO_LISTA_USUARIOS = 200;

export const esquemaConsultaUsuarios = z.object({
  busca: z.string().max(40).optional(),
  grupo: z.string().max(50).optional(),
  situacao: z.enum(SITUACOES_USUARIO).optional(),
  pagina: z.coerce.number().int().min(1).max(1000).optional(),
  porPagina: z.coerce.number().int().min(1).max(TETO_LISTA_USUARIOS).optional(),
});
export type ConsultaUsuarios = z.infer<typeof esquemaConsultaUsuarios>;

export const esquemaUsuarioLinha = z.object({
  login: z.string(),
  nome: z.string().nullable(),
  grupo: z.string().nullable(),
  ativo: z.boolean(),
  bloqueado: z.boolean(),
  /** Data (AAAA-MM-DD) da última conexão a qualquer módulo do banco (null: nunca entrou). */
  ultimoAcesso: z.string().nullable(),
});
export type UsuarioLinha = z.infer<typeof esquemaUsuarioLinha>;

export const esquemaListaUsuarios = z.object({
  itens: z.array(esquemaUsuarioLinha),
  total: z.number().int(),
  pagina: z.number().int(),
  porPagina: z.number().int(),
  destino: z.enum(['banco', 'memoria']),
});
export type ListaUsuarios = z.infer<typeof esquemaListaUsuarios>;

/**
 * W1-01 (parte 3c; mercado "identidade única: CPF obrigatório e único"; NGS1.03.09 c,e): painel das contas pessoais
 * ativas sem CPF e dos logins que repartem o mesmo CPF. O número do CPF nunca sai: o grupo de duplicados tem só uma
 * chave opaca. Contas de dispositivo e integração (grupos dispensados) ficam fora do "sem CPF" e só são contadas.
 */
export const esquemaContaCpf = z.object({
  login: z.string(),
  nome: z.string().nullable(),
  grupo: z.string().nullable(),
  ativo: z.boolean(),
  bloqueado: z.boolean(),
});
export type ContaCpf = z.infer<typeof esquemaContaCpf>;

export const esquemaPainelCpf = z.object({
  semCpf: z.array(esquemaContaCpf),
  dispensadasSemCpf: z.number().int(),
  gruposDispensados: z.array(z.string()),
  duplicados: z.array(z.object({ chave: z.string(), contas: z.array(esquemaContaCpf) })),
  destino: z.enum(['banco', 'memoria']),
});
export type PainelCpf = z.infer<typeof esquemaPainelCpf>;

/**
 * W1-01 (parte 11c; mercado k "identidade única na rede e gestão central"): a pessoa procurada pelo CPF (ou pelo login
 * de uma conta deste estabelecimento, que o servidor troca pelo CPF) em cada estabelecimento da rede da sessão, com as
 * contas, o grupo e os perfis do sistema novo. O número do CPF nunca volta na resposta.
 */
export const esquemaAlvoRedeCpf = z
  .object({
    cpf: z
      .string()
      .trim()
      .regex(/^\d{3}\.?\d{3}\.?\d{3}-?\d{2}$/, 'CPF com 11 dígitos')
      .optional(),
    login: z.string().trim().min(1).max(30).optional(),
  })
  .refine((a) => (a.cpf ? 1 : 0) + (a.login ? 1 : 0) === 1, 'Informe o CPF ou o login (um dos dois).');
export type AlvoRedeCpf = z.infer<typeof esquemaAlvoRedeCpf>;

export const esquemaContaRedeCpf = esquemaContaCpf.extend({ perfis: z.array(z.string()) });
export type ContaRedeCpf = z.infer<typeof esquemaContaRedeCpf>;

export const esquemaPainelRedeCpf = z.object({
  estabelecimentos: z.array(
    z.object({
      codigo: z.string(),
      nome: z.string(),
      /** `indisponivel`: o banco não respondeu (as contas dele não entram na conta nem no bloqueio). */
      situacao: z.enum(['lido', 'indisponivel']),
      contas: z.array(esquemaContaRedeCpf),
    }),
  ),
  totalContas: z.number().int(),
  /** Contas que o "bloquear em todos" alcançaria (ativas e ainda não bloqueadas). */
  aBloquear: z.number().int(),
  destino: z.enum(['banco', 'memoria']),
});
export type PainelRedeCpf = z.infer<typeof esquemaPainelRedeCpf>;

export const esquemaBloquearRedeCpf = z.object({
  cpf: z.string().trim().optional(),
  login: z.string().trim().max(30).optional(),
  motivo: z.string().trim().min(10, 'Motivo com pelo menos 10 caracteres').max(400),
  // Sem a senha: 401 na reautenticação (regra 8), não 400.
  senha: z.string().max(200).optional(),
});
export type BloquearRedeCpf = z.infer<typeof esquemaBloquearRedeCpf>;

export const esquemaResultadoBloqueioRedeCpf = z.object({
  resultados: z.array(
    z.object({
      estabelecimento: z.string(),
      login: z.string().nullable(),
      resultado: z.enum(['bloqueado', 'ja-bloqueado', 'inativo', 'recusado', 'falhou', 'indisponivel']),
      detalhe: z.string().nullable(),
    }),
  ),
  bloqueados: z.number().int(),
  destino: z.enum(['banco', 'memoria']),
});
export type ResultadoBloqueioRedeCpf = z.infer<typeof esquemaResultadoBloqueioRedeCpf>;

/** Escopos que a tela concede e retira (uma receita por tabela e ação). */
export const TIPOS_ESCOPO = [
  'unidade',
  'local',
  'convenio',
  'convenioFaturamento',
  'tipoAgenda',
  'tipoProntuario',
] as const;
export type TipoEscopo = (typeof TIPOS_ESCOPO)[number];

export const esquemaItemEscopo = z.object({ valor: z.string(), rotulo: z.string() });
export type ItemEscopo = z.infer<typeof esquemaItemEscopo>;

export const esquemaFlagUsuario = z.object({
  coluna: z.string(),
  /** Letra guardada (T/F ou S/N), como o legado guarda. */
  letra: z.string().nullable(),
  ligado: z.boolean().nullable(),
  /** Efeito da coluna não confirmado com a área: não gera permissão (ficha, códigos de baixa confiança). */
  aConfirmar: z.boolean(),
  /** W1-01: a ficha pode ligar (letra T vista na coluna) ou desligar (F vista); ausente = só o valor. */
  podeLigar: z.boolean().optional(),
  podeDesligar: z.boolean().optional(),
});
export type FlagUsuario = z.infer<typeof esquemaFlagUsuario>;

export const esquemaEstadoOperacaoTela = z.object({
  operacao: z.string(),
  rotulo: z.string(),
  ligada: z.boolean(),
  motivo: z.string().nullable(),
});
export type EstadoOperacaoTela = z.infer<typeof esquemaEstadoOperacaoTela>;

export const esquemaFichaUsuario = z.object({
  usuario: z.object({
    login: z.string(),
    id: z.number().int(),
    nome: z.string().nullable(),
    grupo: z.string().nullable(),
    ativo: z.boolean(),
    bloqueado: z.boolean(),
    cpfInformado: z.boolean(),
    /**
     * O número do CPF (11 dígitos, sem máscara) SÓ para a conta da plataforma (sessão "como" ou acesso total de
     * ator `plataforma`); null para todos os outros (gestor de acessos, suporte, Auditor) e quando não há CPF.
     * A leitura fica na trilha (acesso.usuario.consultado com o alvo usuário e a marca `cpf:visto`).
     */
    cpf: z
      .string()
      .regex(/^\d{11}$/)
      .nullable(),
    senhaDefinida: z.boolean(),
    /** Versão (colunas mostradas) para o controle otimista da alteração. */
    versao: z.string(),
  }),
  grupoAtivo: z.boolean().nullable(),
  papeis: z.array(z.object({ papel: z.number().int(), nome: z.string(), ativo: z.boolean() })),
  escopos: z.record(z.enum(TIPOS_ESCOPO), z.array(esquemaItemEscopo)),
  /** Escopos só consultados aqui (gravados por outras áreas): quantidade. */
  escoposConsulta: z.object({
    centrosCusto: z.number().int(),
    locaisEstoque: z.number().int(),
    contasBancarias: z.number().int(),
  }),
  /** Escopo de setor (bloco), recurso novo (SGH_ACESSO_ESCOPO_SETOR). */
  setores: z.array(esquemaItemEscopo),
  flags: z.array(esquemaFlagUsuario),
  conexoes: z.array(z.object({ modulo: z.number().int(), nome: z.string(), ultima: z.string() })),
  /** Sessões ativas no sistema novo (sem token nem endereço): o que cai ao bloquear. */
  sessoes: z.array(
    z.object({
      inicio: z.string(),
      ultimoUso: z.string(),
      estabelecimento: z.string(),
      bloqueada: z.boolean(),
      como: z.boolean(),
    }),
  ),
  termo: z.object({ aceitouVigente: z.boolean(), aceitoEm: z.string().nullable() }),
  /** Só para o Auditor: quantas trocas de senha e a data da última (nunca o valor). */
  historicoSenha: z.object({ trocas: z.number().int(), ultima: z.string().nullable() }).nullable(),
  /** O profissional ligado ao login pelo papel Operador de sistema ativo (profissional ligado ao papel do usuário); null sem vínculo. */
  profissionalVinculado: z.object({ id: z.number().int(), nome: z.string() }).nullable(),
  operacoes: z.array(esquemaEstadoOperacaoTela),
  destino: z.enum(['banco', 'memoria']),
});
export type FichaUsuario = z.infer<typeof esquemaFichaUsuario>;

/** Opções que a ficha oferece para conceder escopo (unidades, locais, convênios, tipos), com o rótulo. */
export const esquemaOpcoesEscopo = z.record(z.enum(TIPOS_ESCOPO), z.array(esquemaItemEscopo));
export type OpcoesEscopo = z.infer<typeof esquemaOpcoesEscopo>;

// ── Entradas das receitas (executor do M04) ─────────────────────────────────────────────────────

const esquemaNomeCompleto = textoCp1252(70).refine((n) => n.trim().length > 0, {
  message: 'Informe o nome completo.',
});

/** acesso.criarUsuario: usuário (login exato; grupo ativo; CPF opcional, nunca repetido). */
export const esquemaCriarUsuario = z
  .object({
    login: esquemaLogin,
    nomeCompleto: esquemaNomeCompleto,
    grupo: esquemaNomeGrupo,
    cpf: z
      .string()
      .regex(/^\d{11}$/, 'CPF com 11 dígitos.')
      .optional(),
  })
  .strict();
export type CriarUsuarioEntrada = z.infer<typeof esquemaCriarUsuario>;

/**
 * acesso.alterarUsuario: nome completo do usuário e, W1-01, o CPF (o grupo troca pela receita própria; nunca NOME nem
 * senha). A troca de CPF exige justificativa (SBIS NGS1.03.09 b), gravada na trilha com o valor anterior; o CPF
 * novo nunca pode ser de outro login (NGS1.03.09 c, e). O CPF fica fora da `versao` (a ficha não o mostra a todos).
 */
export const esquemaAlterarUsuario = z
  .object({
    login: esquemaLogin,
    nomeCompleto: esquemaNomeCompleto,
    versao: z.string().min(2).max(400),
    cpf: z
      .string()
      .regex(/^\d{11}$/, 'CPF com 11 dígitos.')
      .refine(cpfValido, 'CPF inválido: confira os dígitos (sequência repetida não é CPF).')
      .optional(),
    justificativa: textoCp1252(255)
      .pipe(z.string().trim().min(10, 'Justificativa com pelo menos 10 caracteres.'))
      .optional(),
  })
  .strict();
export type AlterarUsuarioEntrada = z.infer<typeof esquemaAlterarUsuario>;

/** acesso.bloquearUsuario / acesso.desbloquearUsuario: marca de bloqueio do usuário. */
export const esquemaBloquearUsuario = z.object({ login: esquemaLogin }).strict();
export type BloquearUsuarioEntrada = z.infer<typeof esquemaBloquearUsuario>;

/**
 * W1-01: entrada da receita acesso.trocarSenha. A senha digitada nunca chega ao executor: o servidor a confere
 * contra a política e o histórico e entrega só o resumo (40 hex maiúsculos) e o sal novo (20 de [A-Z0-9]), no
 * formato medido no legado.
 */
export const esquemaTrocarSenhaLegado = z
  .object({
    login: esquemaLogin,
    resumo: z.string().regex(/^[0-9A-F]{40}$/),
    sal: z.string().regex(/^[0-9A-Z]{20}$/),
  })
  .strict();
export type TrocarSenhaLegadoEntrada = z.infer<typeof esquemaTrocarSenhaLegado>;

/** Conceder ou retirar um escopo (uma receita por tabela e ação). */
export const esquemaEscopoUsuario = z
  .object({ login: esquemaLogin, valor: z.union([z.number().int(), z.string().min(1).max(10)]) })
  .strict();
export type EscopoUsuarioEntrada = z.infer<typeof esquemaEscopoUsuario>;

/**
 * Pedido HTTP de gravação: a entrada da receita e a senha (reautenticação; SBIS-07). Sem a senha, o servidor
 * responde 401 em Problem Details (regra 8 da ficha), não 400.
 */
export const esquemaPedidoUsuario = z
  .object({ entrada: z.unknown(), senha: esquemaSenhaDigitada.optional() })
  .strict();

export const esquemaPedidoSetor = z
  .object({
    bloco: z.string().min(1).max(5),
    acao: z.enum(['conceder', 'retirar']),
    senha: esquemaSenhaDigitada.optional(),
  })
  .strict();

/** Receitas da tela de usuários, com o rótulo para a pessoa. */
export const OPERACOES_USUARIOS = {
  'acesso.criarUsuario': 'Criar usuário',
  'acesso.alterarUsuario': 'Alterar o nome completo',
  'acesso.bloquearUsuario': 'Bloquear usuário',
  'acesso.desbloquearUsuario': 'Desbloquear usuário',
  'acesso.concederUnidadeUsuario': 'Conceder unidade',
  'acesso.retirarUnidadeUsuario': 'Retirar unidade',
  'acesso.concederLocalUsuario': 'Conceder local de atendimento',
  'acesso.retirarLocalUsuario': 'Retirar local de atendimento',
  'acesso.concederConvenioUsuario': 'Conceder convênio',
  'acesso.retirarConvenioUsuario': 'Retirar convênio',
  'acesso.concederConvenioFaturamentoUsuario': 'Conceder convênio do faturamento',
  'acesso.retirarConvenioFaturamentoUsuario': 'Retirar convênio do faturamento',
  'acesso.concederTipoAgendaUsuario': 'Conceder tipo de agenda',
  'acesso.retirarTipoAgendaUsuario': 'Retirar tipo de agenda',
  'acesso.concederTipoProntuarioUsuario': 'Conceder tipo de prontuário',
  'acesso.retirarTipoProntuarioUsuario': 'Retirar tipo de prontuário',
  'acesso.trocarGrupoUsuario': 'Trocar o grupo do usuário',
  'acesso.alterarFlagsUsuario': 'Alterar permissões complementares',
  'acesso.redefinirSenha': 'Redefinir a senha (senha provisória)',
} as const;
export type OperacaoUsuario = keyof typeof OPERACOES_USUARIOS;
export const NOMES_OPERACOES_USUARIOS = Object.keys(OPERACOES_USUARIOS) as OperacaoUsuario[];

/** Nome da receita de escopo (conceder ou retirar) de cada tipo. */
export function operacaoDeEscopo(tipo: TipoEscopo, acao: 'conceder' | 'retirar'): OperacaoUsuario {
  const t = `${tipo.charAt(0).toUpperCase()}${tipo.slice(1)}`;
  return `acesso.${acao}${t}Usuario` as OperacaoUsuario;
}

export const esquemaResultadoUsuario = z.object({
  operacao: z.string(),
  destino: z.enum(['banco', 'memoria']),
  /** Sessões do usuário encerradas no sistema novo (bloqueio). */
  sessoesEncerradas: z.number().int().optional(),
  id: z.number().int().optional(),
});
export type ResultadoUsuario = z.infer<typeof esquemaResultadoUsuario>;
