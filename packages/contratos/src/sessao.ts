// Contrato da sessão (M05): login no TBUSERS do estabelecimento escolhido, sessão no servidor (BFF) e o que a
// casca (M07) consome em GET /api/sessao. Nenhum token vai ao corpo: a sessão é um cookie HttpOnly.
// Permissões (M06): as do legado (grupo, papéis, flags) mais os recursos novos por perfil.
import { z } from 'zod';
import { esquemaComoSessao } from './suporte/como.js';

/** Código curto e imutável do estabelecimento (ARQ-1). */
export const esquemaCodigoEstabelecimento = z.string().regex(/^[a-z][a-z0-9]{1,9}$/);

export const esquemaEstabelecimentoSessao = z.object({
  codigo: esquemaCodigoEstabelecimento,
  /** Nome de exibição configurado (FB_<COD>_NOME). */
  nome: z.string().min(1),
});
export type EstabelecimentoSessao = z.infer<typeof esquemaEstabelecimentoSessao>;

/** Unidade de atendimento do legado à qual o usuário tem acesso (segundo seletor, depois do login). */
export const esquemaUnidadeSessao = z.object({ codigo: z.number().int(), nome: z.string() });
export type UnidadeSessao = z.infer<typeof esquemaUnidadeSessao>;

/** Papel SBIS do usuário no legado (cap-08 §8.8). */
export const esquemaPapelSessao = z.object({ codigo: z.number().int(), nome: z.string() });
export type PapelSessao = z.infer<typeof esquemaPapelSessao>;

/** Escopos do legado (cap-08 §8.4), lidos ao vivo; lista vazia = sem restrição naquele escopo (M06). */
export const esquemaEscoposSessao = z.object({
  unidades: z.array(z.string()),
  locais: z.array(z.string()),
  convenios: z.array(z.string()),
  centrosCusto: z.array(z.string()),
  locaisEstoque: z.array(z.string()),
  contasBancarias: z.array(z.string()),
  tiposAgenda: z.array(z.string()),
  tiposProntuario: z.array(z.string()),
});
export type EscoposSessao = z.infer<typeof esquemaEscoposSessao>;

export const ESCOPOS_SEM_RESTRICAO: EscoposSessao = {
  unidades: [],
  locais: [],
  convenios: [],
  centrosCusto: [],
  locaisEstoque: [],
  contasBancarias: [],
  tiposAgenda: [],
  tiposProntuario: [],
};

/** Perfil do Sante SGH proposto para o grupo do legado (M06, mapa dos 42 grupos). */
export const esquemaPerfilSessao = z.object({
  /** perfil | continua-no-legado | painel | caso-a-caso */
  tipo: z.string(),
  perfil: z.string().nullable(),
  categoria: z.string().nullable(),
  assistencial: z.boolean(),
  /** Perfis complementares (papéis SBIS, conselho, concessões em SGH_ACESSO_PERFIL_USUARIO). */
  complementares: z.array(z.string()),
});
export type PerfilSessao = z.infer<typeof esquemaPerfilSessao>;

/** Por que a troca de senha é obrigatória antes de usar o sistema (null: não é). */
export const MOTIVOS_TROCA_SENHA = ['senha-sem-cifra', 'senha-expirada', 'senha-provisoria'] as const;
export type MotivoTrocaSenha = (typeof MOTIVOS_TROCA_SENHA)[number];

export const esquemaSessao = z.object({
  usuario: z.object({
    /** TBUSERS.ID_TBUSERS como texto. */
    id: z.string().min(1),
    /** Nome de exibição (TBUSERS.NOMEC, ou o login quando vazio). */
    nome: z.string().min(1),
    /** Login exato (TBUSERS.NOME, maiúsculas contam): é o que o executor grava nas colunas USUARIO*. */
    login: z.string().optional(),
  }),
  /** Código da rede, resolvida pelo endereço de acesso (ARQ-2). */
  rede: z.string().nullable(),
  /** Estabelecimentos da rede (exibição; trocar é um novo login). */
  estabelecimentos: z.array(esquemaEstabelecimentoSessao),
  estabelecimentoAtivo: z.string().nullable(),
  /** Unidades (TBUNIDAD) a que o usuário tem acesso; com mais de uma, a casca pede a escolha. */
  unidades: z.array(esquemaUnidadeSessao).optional(),
  unidadeAtiva: z.number().int().nullable().optional(),
  papeis: z.array(esquemaPapelSessao).optional(),
  permissoes: z.array(z.string()),
  /** M06: escopos do legado (as mesmas condições CASL no servidor e na tela). */
  escopos: esquemaEscoposSessao.optional(),
  /** M06: perfil proposto pelo grupo e perfis complementares. */
  perfil: esquemaPerfilSessao.optional(),
  /**
   * M38 (regra 3): grupo do legado do usuário (TBGRUUSU.NOME): o escopo `grupo` das chaves de liberação (a onda 0
   * é de MASTER e MASTER_SEM_FINANCEIRO). Nome de grupo, nunca dado de pessoa; null: sem grupo (plataforma).
   */
  grupoLegado: z.string().max(31).nullable().optional(),
  /** M06: PRPARAM.REST_ACESS_PACI_NAO_ESTE_ATEND do banco da sessão (vínculo sobre dados do legado). */
  restricaoVinculo: z.boolean().optional(),
  /** Verdadeiro só para os usuários sintéticos dos testes (nunca em homolog, treino ou produção). */
  sintetica: z.boolean(),
  /** Bloqueio por inatividade, em segundos (menor entre TBCFGLOGIN e o padrão do perfil; 0 = desligado). */
  bloqueioInatividadeSegundos: z.number().int().min(0),
  /** Aviso antes do bloqueio, em segundos antes do prazo (0 = sem aviso). */
  avisoInatividadeSegundos: z.number().int().min(0).optional(),
  /** A sessão está bloqueada (inatividade no servidor): só desbloqueia com a senha. */
  bloqueada: z.boolean().optional(),
  /** Fim da duração máxima (12 h), ISO 8601. */
  expiraEm: z.string().optional(),
  /** Último acesso válido antes deste e falhas desde então (cap-08 §8.8). */
  ultimoAcesso: z.object({ em: z.string().nullable(), falhasDesde: z.number().int().min(0) }).optional(),
  /** Sem aceite da versão vigente do termo de uso (PRTERMOACEITE): rotas do PEP fechadas. */
  termoPendente: z.boolean().optional(),
  /** Troca de senha obrigatória antes de seguir. */
  trocaSenha: z.enum(MOTIVOS_TROCA_SENHA).nullable().optional(),
  /** A troca de senha pelo novo está liberada; falso: troca só no sistema atual (plano B, ADR 0012). */
  trocaSenhaPeloNovo: z.boolean().optional(),
  /**
   * Segundo fator na entrada. M59-F2: `exigencia` da política (opcional, adesao: entrou e é levado ao cadastro até
   * `prazoAdesaoAte`, obrigatorio) por perfil, grupo ou todos.
   */
  segundoFator: z
    .object({
      cadastrado: z.boolean(),
      disponivel: z.boolean(),
      exigencia: z.enum(['opcional', 'adesao', 'obrigatorio']).optional(),
      prazoAdesaoAte: z.string().nullable().optional(),
    })
    .optional(),
  /** Até quando vale a reautenticação recente (operações críticas), ISO 8601; null: fora da janela. */
  reautenticacaoValidaAte: z.string().nullable().optional(),
  /**
   * Sessão "como" (ADR 0021): a sessão do alvo aberta pela plataforma ou pelo suporte técnico; a casca mostra
   * a faixa fixa com "Voltar à minha conta". Ausente: sessão do próprio usuário.
   */
  como: esquemaComoSessao.optional(),
});
export type Sessao = z.infer<typeof esquemaSessao>;

/** Resposta pública de GET /api/marca: nome e marca do produto vêm da configuração da rede (DP-49). */
export const esquemaMarcaPublica = z.object({
  produto: z.string().min(1),
  /** Identificador do pacote de marca em @sgh/ui (SVGs e cores). */
  marca: z.string().regex(/^[a-z0-9-]+$/),
  rede: z.string().nullable(),
  /** M37: AMBIENTE=treino (a faixa "AMBIENTE DE TREINAMENTO" em todas as telas e impressões). */
  treino: z.boolean().optional(),
});
export type MarcaPublica = z.infer<typeof esquemaMarcaPublica>;

/** Corpo de POST /api/sessao/estabelecimento (troca de estabelecimento = novo login no M05). */
export const esquemaTrocaEstabelecimento = z.object({ codigo: z.string().min(1) });
export type TrocaEstabelecimento = z.infer<typeof esquemaTrocaEstabelecimento>;
