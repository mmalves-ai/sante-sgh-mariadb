// Contratos do suporte técnico e do "login como" (ADR 0021; docs/modulos/acesso.md › Suporte técnico e login
// como). Contas PRÓPRIAS do Sante SGH (separadas dos usuários do sistema de origem): PLATAFORMA (o dono) e SUPORTE
// (pessoas identificadas por e-mail, com estabelecimentos atribuídos). Depois do próprio login, a conta abre
// uma sessão "como" um usuário do sistema de origem: a sessão do ALVO (permissões reais do M06) marcada com o ator real.
// Nada aqui leva senha, hash, segredo TOTP nem token de sessão.
import { z } from 'zod';
import { esquemaLogin } from '../acesso/entrada.js';
import { problemasCp1252 } from '../texto-cp1252.js';
import type { TipoAtor } from './como.js';

export * from './como.js';

/** Código do estabelecimento (ARQ-1): o mesmo formato de sessao.ts, sem importar sessao.ts (ciclo). */
const esquemaCodigoEstabelecimento = z.string().regex(/^[a-z][a-z0-9]{1,9}$/);

export const PAPEIS_PLATAFORMA = ['PLATAFORMA', 'SUPORTE'] as const;
export type PapelPlataforma = (typeof PAPEIS_PLATAFORMA)[number];

/** E-mail da conta (minúsculas, sem espaços). */
export const esquemaEmailPlataforma = z
  .string()
  .trim()
  .toLowerCase()
  .max(254)
  .regex(/^[^\s@]+@[^\s@]+\.[^\s@]+$/, 'Informe um e-mail válido.');

/** Senha das contas da plataforma: 12 a 200 caracteres do CP1252 (a mesma regra da tela de reautenticação). */
export const esquemaSenhaPlataforma = z
  .string()
  .min(12, 'A senha tem de ter ao menos 12 caracteres.')
  .max(200)
  .refine((s) => problemasCp1252(s).length === 0, { message: 'A senha tem caractere não aceito.' });

/** POST /api/plataforma/sessao. */
export const esquemaEntrarPlataforma = z.object({
  email: esquemaEmailPlataforma,
  senha: z.string().min(1).max(200),
  codigo: z
    .string()
    .regex(/^\d{6}$/)
    .optional(),
});
export type EntrarPlataforma = z.infer<typeof esquemaEntrarPlataforma>;

/** Resposta do login da plataforma quando falta o segundo fator (TOTP) ou o cadastro dele. */
export interface SegundoFatorPlataforma {
  readonly segundoFator: 'pedir' | 'cadastrar';
  /** Só no cadastro: URI otpauth:// para o QR (mostrada uma vez à própria pessoa). */
  readonly otpauth?: string;
}

export interface ContaPlataformaTela {
  readonly id: string;
  readonly email: string;
  readonly nome: string | null;
  readonly papel: PapelPlataforma;
  readonly ativo: boolean;
  readonly senhaDefinida: boolean;
  readonly segundoFator: boolean;
  readonly criadoEm: string;
  readonly atribuicoes: readonly AtribuicaoTela[];
}

export interface AtribuicaoTela {
  readonly rede: string;
  readonly estabelecimento: string;
}

/** GET /api/plataforma/eu. */
export interface EuPlataforma {
  readonly conta: Pick<ContaPlataformaTela, 'id' | 'email' | 'nome' | 'papel'>;
  /** Ícone do "login como": plataforma ativa, ou suporte ativo com ao menos um estabelecimento. */
  readonly podeEntrarComo: boolean;
  /** Tela "Suporte técnico" (designação e auditoria): só a PLATAFORMA. */
  readonly podeDesignar: boolean;
  /** ADR 0022: "Eu mesmo, com acesso total" no modal (só a PLATAFORMA ativa). */
  readonly podeAcessoTotal?: boolean;
  readonly expiraEm: string;
  readonly segundoFatorObrigatorio: boolean;
}

/** POST /api/plataforma/suportes. */
export const esquemaNovoSuporte = z.object({
  email: esquemaEmailPlataforma,
  nome: z.string().trim().min(1).max(120).optional(),
});

/** PUT /api/plataforma/suportes/:id (função: ativar/desativar). */
export const esquemaFuncaoSuporte = z.object({ ativo: z.boolean() });

/** PUT /api/plataforma/suportes/:id/atribuicoes. */
export const esquemaAtribuicoes = z.object({
  estabelecimentos: z.array(esquemaCodigoEstabelecimento).max(200),
});

/** POST /api/plataforma/convite (definir a senha pelo convite, sem sessão). */
export const esquemaAceitarConvite = z.object({
  token: z.string().regex(/^[A-Za-z0-9_-]{32,128}$/),
  senha: esquemaSenhaPlataforma,
});

/**
 * POST /api/plataforma/como. `modo` `acesso-total` (ADR 0022): só a PLATAFORMA; `login` é o usuário do sistema de origem
 * "em nome de quem gravar" (o login nas colunas de usuário e na trilha); a
 * auditoria registra o ator real.
 */
export const esquemaEntrarComo = z.object({
  estabelecimento: esquemaCodigoEstabelecimento,
  login: esquemaLogin,
  /** Motivo ou número do chamado (opcional; R2): vai à auditoria e ao aviso do auditor. */
  motivo: z.string().trim().max(200).optional(),
  modo: z.enum(['como', 'acesso-total']).optional(),
});
export type EntrarComo = z.infer<typeof esquemaEntrarComo>;

/** Estabelecimento onde a conta pode entrar (modal do "login como"). */
export interface EstabelecimentoComo {
  readonly rede: string;
  readonly codigo: string;
  readonly nome: string;
  readonly disponivel: boolean;
}

/**
 * ADR 0022: o padrão de "em nome de quem gravar" do acesso total no estabelecimento
 * (PLATAFORMA_EM_NOME_DE), quando configurado; a tela pré-seleciona e a pessoa pode trocar.
 */
export interface EmNomeDePadrao {
  readonly estabelecimento: string;
  readonly login: string | null;
}

/** Grupo de usuários ativo com a contagem de logins não bloqueados. */
export interface GrupoComo {
  readonly grupo: string;
  readonly usuarios: number;
}

export interface UsuarioComo {
  readonly login: string;
  readonly nome: string;
}

export const STATUS_ACAO = ['ok', 'error', 'blocked', 'aborted'] as const;
export type StatusAcao = (typeof STATUS_ACAO)[number];

export interface SessaoComoTela {
  readonly id: string;
  readonly atorTipo: TipoAtor;
  readonly atorEmail: string;
  readonly rede: string;
  readonly estabelecimento: string;
  readonly alvoLogin: string;
  readonly motivo: string | null;
  /** ADR 0022: `acesso-total` (alvo = "em nome de") ou `como`. */
  readonly modo: 'como' | 'acesso-total';
  readonly inicio: string;
  readonly expiraEm: string;
  readonly fim: string | null;
  readonly encerramento: string | null;
  readonly aberta: boolean;
  readonly escritas: number;
  readonly atosClinicos: number;
}

export interface AcaoComoTela {
  readonly id: string;
  readonly sessao: string;
  readonly dataHora: string;
  readonly metodo: string;
  readonly caminho: string;
  readonly status: StatusAcao;
  readonly http: number | null;
  /** Ato clínico ou assinatura: destacado na consulta ("feito pelo suporte técnico em nome de <alvo>"). */
  readonly clinico: boolean;
  readonly marca: string | null;
  /** Efeito externo já consumado (documento no S3 com Object Lock, mensagem enviada): ação recomendada. */
  readonly naoReversivel: string | null;
  readonly imagens: number;
  readonly corrigida: boolean;
}

export interface LeituraComoTela {
  readonly sessao: string;
  readonly caminho: string;
  readonly quantidade: number;
  readonly primeira: string;
  readonly ultima: string;
}

export type OperacaoImagem = 'INSERT' | 'UPDATE' | 'DELETE';

/** Um passo da prévia do "Corrigir" (forma automática: "Desfazer"). */
export interface PassoCorrecaoTela {
  readonly imagem: string;
  readonly tabela: string;
  readonly chave: Readonly<Record<string, string>>;
  readonly operacaoOriginal: OperacaoImagem;
  /** excluir o inserido | restaurar as colunas alteradas | reinserir o excluído */
  readonly compensacao: 'excluir' | 'restaurar' | 'reinserir';
  /** Colunas que mudam (atual → depois da correção); valores como texto, só para a pessoa autorizada. */
  readonly mudancas: readonly { coluna: string; atual: string | null; corrigido: string | null }[];
  /** O registro mudou depois da escrita do suporte: confirmação explícita exigida. */
  readonly conflito: readonly { coluna: string; esperado: string | null; atual: string | null }[];
  readonly naoReversivel: string | null;
}

export interface PreviaCorrecaoTela {
  readonly passos: readonly PassoCorrecaoTela[];
  readonly naoReversiveis: readonly { acao: string; motivo: string }[];
  readonly exigeConfirmacao: boolean;
  /** Efeitos dos gatilhos do legado que não voltam ao estado idêntico (geradores, estoque, cascatas). */
  readonly avisos: readonly string[];
  /**
   * Resumo da prévia (imagens, compensações, mudanças e conflitos). A execução manda o mesmo resumo e só
   * acontece se o plano refeito na transação travada for igual ao que foi mostrado (senão, 409 com a
   * prévia nova).
   */
  readonly resumo: string;
}

/** POST /api/plataforma/auditoria/correcoes. */
export const esquemaCorrigir = z
  .object({
    estabelecimento: esquemaCodigoEstabelecimento,
    sessao: z.string().regex(/^\d{1,18}$/),
    /** Uma escrita (REF da ação); ausente = a sessão inteira, em ordem inversa. */
    acao: z
      .string()
      .regex(/^\d{1,18}$/)
      .optional(),
    /** Prévia (true) ou execução (false). */
    previa: z.boolean(),
    /** Exigida quando a prévia mostra conflito com mudança posterior. */
    confirmarConflito: z.boolean().optional(),
    /** O resumo da prévia mostrada (obrigatório na execução). */
    resumo: z
      .string()
      .regex(/^[0-9a-f]{64}$/)
      .optional(),
  })
  .strict()
  .refine((p) => p.previa || p.resumo !== undefined, {
    message: 'A execução exige o resumo da prévia mostrada.',
    path: ['resumo'],
  });
export type PedidoCorrecao = z.infer<typeof esquemaCorrigir>;

/** Linha do relatório que cruza a trilha de auditoria com a auditoria do "como" (R3). */
export interface CruzamentoTrilhaTela {
  readonly idTrilhaLegado: string;
  readonly dataHora: string;
  readonly usuarioLegado: string;
  readonly tipo: number | null;
  readonly estacao: string;
  /** Autor real: "Suporte técnico (sessão N)" quando ligado à SGH_TRILHA do "como"; senão, o próprio usuário. */
  readonly autorReal: string;
  readonly ligada: boolean;
}

/** Resultado da correção executada (cada passo, ligado à escrita original). */
export interface ResultadoCorrecaoTela {
  readonly corrigidos: number;
  readonly correcoes: readonly { imagem: string; correcao: string; compensacao: string }[];
  readonly naoReversiveis: readonly { acao: string; motivo: string }[];
  /**
   * ADR 0022 (decisão 12): o Corrigir é uma gravação e troca a geração das permissões do estabelecimento.
   * 'recalculadas': vale na hora; 'no-prazo-do-cache': a invalidação falhou e a correção das permissões só vale
   * quando o cache vencer (3 min). Ausente: nada corrigido.
   */
  readonly permissoes?: 'recalculadas' | 'no-prazo-do-cache';
}

/** Convite de definição de senha (mostrado uma vez à plataforma, que o entrega à pessoa). */
export interface ConviteTela {
  readonly token: string;
  readonly expiraEm: string;
}

/** Mudança de função ou de atribuição (SGH_PLAT_AUDITORIA): quem, quando, o quê. */
export interface AuditoriaContaTela {
  readonly id: string;
  readonly dataHora: string;
  readonly ator: string;
  readonly evento: string;
  readonly contaAlvo: string | null;
  readonly detalhe: string | null;
}

/** Detalhe de uma sessão "como" na aba Auditoria. */
export interface DetalheSessaoComoTela {
  readonly sessao: SessaoComoTela;
  readonly acoes: readonly AcaoComoTela[];
  readonly leituras: readonly LeituraComoTela[];
}

/** POST /api/plataforma/suportes/:id/convite e definição do segundo fator: corpo vazio. */
export const esquemaCorpoVazio = z.object({}).strict();

/**
 * Caminhos de ATO CLÍNICO ou de ASSINATURA (destacados na auditoria: "feito pelo suporte técnico em nome de
 * <alvo>"). Não é bloqueio: dentro do "como" vale tudo o que o alvo pode (decisão do dono, 20/10/2026).
 */
export const CAMINHOS_ATO_CLINICO: readonly RegExp[] = [
  /^\/api\/pep(?:\/|$)/,
  /^\/api\/enfermagem(?:\/|$)/,
  /^\/api\/prescricao(?:\/|$)/,
  /^\/api\/documento\/emissoes(?:\/|$)/,
  /^\/api\/documento\/impressoes\/assinatura$/,
  /^\/api\/acesso\/emergencias$/,
];

/**
 * Escritas com efeito externo já consumado: não se desfazem (o S3 com Object Lock é imutável; mensagem
 * enviada não volta). A correção as lista com a ação corretiva recomendada.
 */
export const EFEITOS_NAO_REVERSIVEIS: readonly { readonly caminho: RegExp; readonly motivo: string }[] = [
  {
    caminho: /^\/api\/documento\/emissoes(?:\/|$)/,
    motivo:
      'Documento emitido no armazenamento com retenção (imutável): emita a 2ª via com o motivo da correção.',
  },
  {
    caminho: /^\/api\/documento\/impressoes(?:\/|$)/,
    motivo: 'Impressão já enviada à impressora: descarte a etiqueta e imprima de novo.',
  },
  {
    caminho: /^\/api\/acesso\/emergencias$/,
    motivo: 'Quebra de vidro registrada e o Auditor já avisado: registre a revisão como não justificada.',
  },
  {
    // M22: registro clínico (finalização, rascunho, descarte e suspensão). O prontuário não apaga: o Corrigir não
    // compensa essas escritas (nem as tabelas SGH_ da prova, só de inclusão).
    caminho:
      /^\/api\/pep\/(?:registro\/[^/]+\/(?:finalizar|rascunho|registros\/[^/]+\/suspender)|rascunhos\/[^/]+\/descartar)$/,
    motivo:
      'Registro clínico gravado no prontuário (não se apaga): suspenda o registro com a justificativa e faça o registro de correção; o rascunho, descarte.',
  },
  {
    // M47.3: o item da lista de trabalho vai ao PACS pela outbox (mensagem ao parceiro externo); o status simulado
    // fica registrado como o da modalidade.
    caminho: /^\/api\/sadt\/imagem\/worklist\/(?:enviar|[^/]+\/(?:reenviar|simular))$/,
    motivo:
      'Item enviado à lista de trabalho do PACS (mensagem já entregue): reenvie com o mesmo número de acesso ou trate a entrega no monitor de integrações.',
  },
];

export function ehAtoClinico(caminho: string): boolean {
  return CAMINHOS_ATO_CLINICO.some((r) => r.test(caminho));
}

export function naoReversivelDe(caminho: string): string | null {
  return EFEITOS_NAO_REVERSIVEIS.find((e) => e.caminho.test(caminho))?.motivo ?? null;
}

/** Campo de alerta: só identificadores e códigos (nunca nome, texto livre nem dado clínico). */
const CODIGO_ALERTA = /^[A-Za-z0-9._:-]{1,64}$/;

/** Carga do aviso ao Auditor da sessão "como" (SGH_OUTBOX ou fila), montada pela API. */
export interface CargaAlertaSuporte {
  /** O estabelecimento em que a sessão "como" foi aberta (o HOSPITAL da outbox é o banco da plataforma). */
  readonly estabelecimento: string;
  readonly idSessao: string;
  readonly atorTipo: string;
  /** Id do usuário alvo. */
  readonly idUsuario: string;
  readonly motivo: string;
  readonly inicio: string;
  readonly fim: string;
}

export function cargaAlertaSuporte(c: CargaAlertaSuporte): CargaAlertaSuporte {
  for (const v of Object.values(c))
    if (typeof v !== 'string' || !CODIGO_ALERTA.test(v)) throw new Error('Alerta com campo fora do formato.');
  return { ...c };
}

/** Job 'alerta-suporte' da fila email-<rede>: a carga mais a rede e o hospital acrescentados pelo relay. */
export interface AlertaSuporteJob extends CargaAlertaSuporte {
  readonly rede: string;
  readonly hospital: string;
}

/**
 * Confere o job do aviso (o worker chama antes de montar o e-mail). O estabelecimento é o da carga; sem ele
 * (caminho direto da fila), o hospital do job.
 */
export function conferirAlertaSuporte(d: unknown): AlertaSuporteJob {
  const j = (d ?? {}) as Record<string, unknown>;
  const x: Record<string, unknown> = { ...j, estabelecimento: j['estabelecimento'] ?? j['hospital'] };
  const campos = [
    'rede',
    'hospital',
    'estabelecimento',
    'idSessao',
    'atorTipo',
    'idUsuario',
    'inicio',
    'fim',
    'motivo',
  ];
  for (const k of campos) {
    const v = x[k];
    if (typeof v !== 'string' || !CODIGO_ALERTA.test(v)) throw new Error('Alerta com campo fora do formato.');
  }
  return Object.fromEntries(campos.map((k) => [k, x[k]])) as unknown as AlertaSuporteJob;
}
