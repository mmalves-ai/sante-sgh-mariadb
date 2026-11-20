// Contratos da porta de entrada (M05): seletor de estabelecimento, login, reautenticação, troca de senha,
// segundo fator (TOTP), unidade e preferências. A senha nunca é normalizada (vai ao verificador como foi
// digitada); só se recusa o que não existe no CP1252, porque o legado guarda o texto em CP1252.
import { z } from 'zod';
import { esquemaCodigoEstabelecimento } from '../sessao.js';
import { problemasCp1252, textoCp1252 } from '../texto-cp1252.js';

/** Tamanho de TBUSERS.NOME (VARCHAR(31)). */
export const TAMANHO_LOGIN = 31;
/** Tamanho de TBUSERS.SENHA (VARCHAR(100)). */
export const TAMANHO_SENHA = 100;

/** Login exato do legado (TBUSERS.NOME): sem espaço nas pontas, maiúsculas contam. */
export const esquemaLogin = textoCp1252(TAMANHO_LOGIN).refine((l) => l.length > 0 && l.trim() === l, {
  message: 'Informe o login sem espaços nas pontas.',
});

/** Senha digitada: sem normalização; só caracteres do CP1252. */
export const esquemaSenhaDigitada = z
  .string()
  .min(1, 'Informe a senha.')
  .max(TAMANHO_SENHA)
  .refine((s) => problemasCp1252(s).length === 0, {
    message: 'A senha tem caractere não aceito.',
  });

/** Código TOTP de 6 dígitos. */
export const esquemaCodigoSegundoFator = z.string().regex(/^\d{6}$/, 'Informe os 6 dígitos.');

/** POST /api/sessao (entrar). */
export const esquemaEntrar = z.object({
  estabelecimento: esquemaCodigoEstabelecimento,
  login: esquemaLogin,
  senha: esquemaSenhaDigitada,
  codigoSegundoFator: esquemaCodigoSegundoFator.optional(),
});
export type Entrar = z.infer<typeof esquemaEntrar>;

/** POST /api/sessao/reautenticar e desbloqueio da tela. */
/** W1-01 (parte 8): uma sessão da própria pessoa ("Minhas sessões"); `ref` é opaca e só serve para encerrar. */
export interface MinhaSessaoTela {
  readonly ref: string;
  readonly inicio: string;
  readonly ultimoUso: string;
  readonly dispositivo: string | null;
  readonly atual: boolean;
  readonly bloqueada: boolean;
}

/** POST /api/sessao/sessoes/encerrar: sem `ref`, encerra todas as outras; com `ref`, só aquela. */
export const esquemaEncerrarMinhasSessoes = z
  .object({
    ref: z
      .string()
      .regex(/^[0-9a-f]{24}$/, 'Sessão inválida.')
      .optional(),
  })
  .strict();
export type EncerrarMinhasSessoes = z.infer<typeof esquemaEncerrarMinhasSessoes>;

// ── W1-01 (parte 11b2): PIN da troca rápida de usuário (D-W101-36) ──

/** PIN digitado: só dígitos; o tamanho exato (parâmetro acesso.trocaRapida.digitosPin) é conferido no servidor. */
export const esquemaPinDigitado = z.string().regex(/^\d{4,8}$/, 'O PIN tem de 4 a 8 dígitos.');

/** O que a tela "Segurança" e a ficha mostram do PIN (nunca o PIN nem o hash). */
export interface SituacaoPinTela {
  readonly ligada: boolean;
  readonly digitosPin: number;
  readonly definido: boolean;
  readonly bloqueado: boolean;
  readonly criadoEm: string | null;
}

/** POST /api/sessao/pin: define ou troca o próprio PIN, com a senha (reautenticação). */
export const esquemaDefinirPin = z.object({ pin: esquemaPinDigitado, senha: esquemaSenhaDigitada }).strict();
export type DefinirPin = z.infer<typeof esquemaDefinirPin>;

/** POST /api/sessao/pin/retirar: retira o próprio PIN, com a senha. */
export const esquemaRetirarPin = z.object({ senha: esquemaSenhaDigitada }).strict();
export type RetirarPin = z.infer<typeof esquemaRetirarPin>;

/**
 * POST /api/sessao/troca-rapida: login + PIN na estação; o estabelecimento é o da sessão anterior (cookie) ou o
 * informado quando não há sessão.
 */
export const esquemaTrocaRapida = z
  .object({
    login: esquemaLogin,
    pin: esquemaPinDigitado,
    estabelecimento: esquemaCodigoEstabelecimento.optional(),
  })
  .strict();
export type TrocaRapida = z.infer<typeof esquemaTrocaRapida>;

/** POST /api/acesso/gestao/usuarios/:login/pin/retirar: o gestor retira o PIN de outro usuário. */
export const esquemaRetirarPinGestor = z
  .object({
    motivo: z.string().trim().min(10, 'Informe o motivo (ao menos 10 caracteres).').max(200),
    senha: esquemaSenhaDigitada,
  })
  .strict();
export type RetirarPinGestor = z.infer<typeof esquemaRetirarPinGestor>;

export const esquemaReautenticar = z.object({
  senha: esquemaSenhaDigitada,
  codigoSegundoFator: esquemaCodigoSegundoFator.optional(),
});
export type Reautenticar = z.infer<typeof esquemaReautenticar>;

/** POST /api/sessao/senha. */
export const esquemaTrocarSenha = z
  .object({
    senhaAtual: esquemaSenhaDigitada,
    senhaNova: esquemaSenhaDigitada,
    confirmacao: z.string(),
  })
  .refine((t) => t.senhaNova === t.confirmacao, {
    message: 'A confirmação não confere com a senha nova.',
    path: ['confirmacao'],
  });
export type TrocarSenha = z.infer<typeof esquemaTrocarSenha>;

/**
 * W1-01 (parte 7), "Esqueci a senha": POST /api/sessao/recuperacao. A resposta é a mesma para conta existente e
 * inexistente (`RESPOSTA_RECUPERACAO_SENHA`); o token vai só ao e-mail institucional, nunca na resposta.
 */
export const esquemaPedirRecuperacaoSenha = z
  .object({ estabelecimento: esquemaCodigoEstabelecimento, login: esquemaLogin })
  .strict();
export type PedirRecuperacaoSenha = z.infer<typeof esquemaPedirRecuperacaoSenha>;

/** Token de uso único do e-mail (32 bytes em base64url). */
export const esquemaTokenRecuperacaoSenha = z.string().regex(/^[A-Za-z0-9_-]{43}$/);

/** POST /api/sessao/recuperacao/usar: o token do e-mail vira a senha provisória (troca forçada no próximo acesso). */
export const esquemaUsarRecuperacaoSenha = z.object({ token: esquemaTokenRecuperacaoSenha }).strict();
export type UsarRecuperacaoSenha = z.infer<typeof esquemaUsarRecuperacaoSenha>;

/** A mensagem genérica do pedido (idêntica para qualquer login). */
export const RESPOSTA_RECUPERACAO_SENHA =
  'Se o usuário existir e tiver e-mail institucional cadastrado, as instruções chegam nele em instantes. O link vale por pouco tempo e uma vez só.';

export interface RespostaPedidoRecuperacaoSenha {
  readonly mensagem: string;
}

export interface DisponibilidadeRecuperacaoSenha {
  readonly disponivel: boolean;
}

/** A senha provisória, mostrada uma vez só a quem tem o token; o sistema exige a troca no próximo acesso. */
export interface ResultadoRecuperacaoSenha {
  readonly senhaProvisoria: string;
  readonly trocaObrigatoria: boolean;
}

/**
 * POST /api/sessao/segundo-fator: inicia o cadastro (sem código) ou confirma (com o código). Iniciar é crítico
 * (SBIS-07): vale a janela recente de reautenticação ou a `senha` digitada na hora (nunca guardada).
 */
export const esquemaSegundoFatorPedido = z.object({
  codigo: esquemaCodigoSegundoFator.optional(),
  senha: z.string().min(1).max(64).optional(),
});
export type SegundoFatorPedido = z.infer<typeof esquemaSegundoFatorPedido>;

/** Resposta do início do cadastro: segredo em base32 para o aplicativo e o URI otpauth. */
export const esquemaSegundoFatorInicio = z.object({
  segredo: z.string().regex(/^[A-Z2-7]+$/),
  uri: z.string().startsWith('otpauth://totp/'),
  expiraEm: z.string(),
});
export type SegundoFatorInicio = z.infer<typeof esquemaSegundoFatorInicio>;

/** POST /api/sessao/unidade (segundo seletor). */
export const esquemaEscolherUnidade = z.object({ codigo: z.number().int() });

/** GET /api/estabelecimentos: lista do seletor, só da rede do endereço, sem dado sensível. */
export const esquemaEstabelecimentoEntrada = z.object({
  codigo: esquemaCodigoEstabelecimento,
  nome: z.string().min(1),
  disponivel: z.boolean(),
});
export const esquemaEstabelecimentosEntrada = z.object({
  rede: z.string(),
  estabelecimentos: z.array(esquemaEstabelecimentoEntrada),
});
export type EstabelecimentosEntrada = z.infer<typeof esquemaEstabelecimentosEntrada>;

/** Preferências do usuário servidas à casca (SGH_ACESSO_PREFERENCIA). */
export const esquemaPreferenciasUsuario = z.object({
  tema: z.enum(['claro', 'escuro', 'sistema']),
  densidade: z.enum(['compacta', 'confortavel']),
  fonteAmpliada: z.boolean(),
});
export type PreferenciasUsuario = z.infer<typeof esquemaPreferenciasUsuario>;

/** Falhas da política de senha (mensagens na tela pelo vue-i18n). */
export const FALHAS_SENHA = [
  'curta',
  'sem-letra',
  'sem-numero',
  'sem-especial',
  'sem-minuscula',
  'sem-maiuscula',
  'deriva-do-login',
  // W1-01 (parte 5): recusas da política do Sante (SGH_ACESSO_POLITICA_SENHA).
  'deriva-do-nome',
  'deriva-do-nascimento',
  'comum',
  'igual-atual',
  'repetida',
] as const;
export type FalhaSenha = (typeof FALHAS_SENHA)[number];
