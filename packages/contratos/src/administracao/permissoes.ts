// Contratos de "Permissões, menus e papéis SBIS", "Simulador de permissões", "Termo de aceite de uso" e
// "Revisão de acessos por quebra de vidro" (M10, ficha seção 7). A árvore de opções é remontada sem chave de pai
// (regra 5: salto de nível vira aviso); a política de senha é só consultada (regra 9); o histórico de senha só
// aparece como contagem e data.
import { z } from 'zod';
import { esquemaLogin, esquemaSenhaDigitada } from '../acesso/entrada.js';
import { esquemaNomeGrupo } from '../acesso/gestao.js';
import { textoCp1252 } from '../texto-cp1252.js';

export const esquemaNoOpcaoTela = z.object({
  id: z.number().int(),
  modulo: z.number().int(),
  nivel: z.number().int(),
  titulo: z.string(),
  ativo: z.boolean(),
  pai: z.number().int().nullable(),
  salto: z.boolean(),
  filhos: z.array(z.number().int()),
  /** Permissão do sistema novo ligada à opção (null: opção sem permissão, inativa ou de módulo excluído). */
  permissao: z.string().nullable(),
});
export type NoOpcaoTela = z.infer<typeof esquemaNoOpcaoTela>;

export const esquemaArvorePermissoes = z.object({
  modulos: z.array(z.object({ id: z.number().int(), nome: z.string(), raizes: z.array(z.number().int()) })),
  nos: z.array(esquemaNoOpcaoTela),
  avisos: z.array(z.object({ opcao: z.number().int(), modulo: z.number().int(), nivel: z.number().int() })),
  /** Opções do grupo ou do papel escolhido (o que a árvore marca). */
  alvo: z
    .object({
      tipo: z.enum(['grupo', 'papel']),
      chave: z.string(),
      ativo: z.boolean(),
      opcoes: z.array(z.number().int()),
    })
    .nullable(),
});
export type ArvorePermissoes = z.infer<typeof esquemaArvorePermissoes>;

export const esquemaPoliticaSenhaTela = z.object({
  trocaDias: z.number().int().nullable(),
  reutilizacaoDias: z.number().int().nullable(),
  avisoDias: z.number().int().nullable(),
  tentativasBloqueio: z.number().int().nullable(),
  minimoCaracteres: z.number().int().nullable(),
  exige: z.object({
    alfanumerico: z.boolean(),
    numero: z.boolean(),
    especial: z.boolean(),
    minuscula: z.boolean(),
    maiuscula: z.boolean(),
  }),
  termoPeriodico: z.boolean(),
  /** Mínimo que o sistema novo exige além do banco (M05). */
  minimoDoNovo: z.number().int(),
});
export type PoliticaSenhaTela = z.infer<typeof esquemaPoliticaSenhaTela>;

export const esquemaPapelSbisTela = z.object({
  papel: z.number().int(),
  nome: z.string(),
  usuariosAtivos: z.number().int(),
  opcoes: z.number().int(),
});
export type PapelSbisTela = z.infer<typeof esquemaPapelSbisTela>;

export const esquemaPainelPermissoes = z.object({
  grupos: z.array(z.object({ nome: z.string(), ativo: z.boolean(), usuariosAtivos: z.number().int() })),
  papeis: z.array(esquemaPapelSbisTela),
  politica: esquemaPoliticaSenhaTela,
  /** Tipos de permissão de acesso ao prontuário (TBTPPERM_RICADPAC), só consulta. */
  acessoProntuario: z.array(z.object({ id: z.number().int(), descricao: z.string() })),
  operacoes: z.array(
    z.object({
      operacao: z.string(),
      rotulo: z.string(),
      ligada: z.boolean(),
      motivo: z.string().nullable(),
    }),
  ),
});
export type PainelPermissoes = z.infer<typeof esquemaPainelPermissoes>;

/** POST conceder/retirar opções da árvore (Idempotency-Key; a senha reautentica). */
export const esquemaOpcoesArvore = z
  .object({
    grupo: esquemaNomeGrupo,
    opcoes: z.array(z.number().int().positive()).min(1).max(2_000),
    /** Sem a senha: 401 (regra 8). */
    senha: esquemaSenhaDigitada.optional(),
  })
  .strict();

// ── Simulador ────────────────────────────────────────────────────────────────────────────────────

export const esquemaSimular = z.object({
  login: esquemaLogin,
  /** Código da permissão (`modulo.recurso.acao`) ou trecho para procurar. */
  recurso: z.string().min(1).max(120),
});

export const esquemaResultadoSimulacao = z.object({
  login: z.string(),
  grupo: z.string().nullable(),
  perfis: z.array(z.string()),
  avaliadas: z.array(
    z.object({
      permissao: z.string(),
      descricao: z.string(),
      pode: z.boolean(),
      /** Por quê, em frases curtas (origem de cada concessão ou o motivo da retirada). */
      motivos: z.array(z.string()),
    }),
  ),
  calculadaEm: z.string(),
});
export type ResultadoSimulacao = z.infer<typeof esquemaResultadoSimulacao>;

// ── Termo de uso ─────────────────────────────────────────────────────────────────────────────────

export const esquemaTermoVigente = z.object({
  id: z.number().int(),
  texto: z.string(),
  desde: z.string(),
  aceites: z.number().int(),
  /** Aceites nesta versão (lista paginada; login e data; só para quem administra). */
  ultimosAceites: z.array(z.object({ login: z.string(), em: z.string() })),
});
export type TermoVigente = z.infer<typeof esquemaTermoVigente>;

export const esquemaTermoDaSessao = z.object({
  pendente: z.boolean(),
  termo: z.object({ id: z.number().int(), texto: z.string(), desde: z.string() }).nullable(),
  /** POL-3: o aceite pelo sistema novo pode estar desligado; o motivo aparece. */
  aceitePossivel: z.boolean(),
  motivo: z.string().nullable(),
});
export type TermoDaSessao = z.infer<typeof esquemaTermoDaSessao>;

export const esquemaAceitarTermo = z.object({ termo: z.number().int().positive() }).strict();
export type AceitarTermoEntrada = z.infer<typeof esquemaAceitarTermo>;

/**
 * W1-01 (parte 6): publicar nova versão do termo de uso. A versão publicada não se edita (o próprio legado recusa
 * mudar o texto, a data e o autor de PRTERMOCAD): a nova entra ativa e a anterior sai de vigência, com os aceites
 * dela intactos e consultáveis. `termoAnterior` é a versão que a tela mostrou (null: não havia termo vigente).
 */
export const esquemaPublicarTermo = z
  .object({
    termoAnterior: z.number().int().positive().nullable(),
    texto: textoCp1252(32_000).pipe(
      z.string().trim().min(20, 'O termo precisa de pelo menos 20 caracteres.'),
    ),
    motivo: textoCp1252(255).pipe(z.string().trim().min(10, 'Motivo com pelo menos 10 caracteres.')),
  })
  .strict();
export type PublicarTermoEntrada = z.infer<typeof esquemaPublicarTermo>;

/** W1-01 (parte 6b): o pedido da tela leva a senha de quem publica (reautenticação; operação crítica). */
export const esquemaPedidoPublicarTermo = esquemaPublicarTermo
  .extend({ senha: esquemaSenhaDigitada })
  .strict();
export type PedidoPublicarTermo = z.infer<typeof esquemaPedidoPublicarTermo>;

/** W1-01 (parte 6b): as versões do termo (a mais nova primeiro), sem o texto; a vigente é a única com `vigente`. */
export const esquemaVersoesTermo = z.object({
  versoes: z.array(
    z.object({
      id: z.number().int(),
      desde: z.string(),
      vigente: z.boolean(),
      publicadoPor: z.string(),
      aceites: z.number().int(),
    }),
  ),
  /** POL-3: publicar pelo sistema novo pode estar desligado neste estabelecimento; o motivo aparece. */
  publicarPossivel: z.boolean(),
  motivo: z.string().nullable(),
  destino: z.enum(['legado', 'memoria']),
});
export type VersoesTermo = z.infer<typeof esquemaVersoesTermo>;

/** W1-01 (parte 6b): uma versão (vigente ou anterior) com o texto e uma página dos aceites dela (imutáveis). */
export const esquemaVersaoTermo = z.object({
  id: z.number().int(),
  texto: z.string(),
  desde: z.string(),
  vigente: z.boolean(),
  aceites: z.number().int(),
  pagina: z.number().int(),
  porPagina: z.number().int(),
  itens: z.array(z.object({ login: z.string(), em: z.string() })),
});
export type VersaoTermo = z.infer<typeof esquemaVersaoTermo>;

// ── Quebra de vidro ──────────────────────────────────────────────────────────────────────────────

export const CLASSIFICACOES_REVISAO = ['justificado', 'nao-justificado'] as const;

export const esquemaQuebraVidro = z.object({
  id: z.string(),
  login: z.string(),
  idPaciente: z.number().int().nullable(),
  /** Prontuário do paciente (RICADPAC.PRONT): o número que a tela mostra. */
  prontuario: z.number().int().nullable(),
  motivo: z.string().nullable(),
  justificativa: z.string().nullable(),
  inicio: z.string().nullable(),
  fim: z.string().nullable(),
  revisao: z
    .object({ classificacao: z.enum(CLASSIFICACOES_REVISAO), por: z.string(), em: z.string() })
    .nullable(),
});
export type QuebraVidro = z.infer<typeof esquemaQuebraVidro>;

export const esquemaListaQuebrasVidro = z.object({
  itens: z.array(esquemaQuebraVidro),
  pendentes: z.number().int(),
  destino: z.enum(['legado', 'memoria']),
});
export type ListaQuebrasVidro = z.infer<typeof esquemaListaQuebrasVidro>;

export const esquemaRevisarQuebraVidro = z
  .object({
    classificacao: z.enum(CLASSIFICACOES_REVISAO),
    nota: textoCp1252(500).optional(),
  })
  .strict();
