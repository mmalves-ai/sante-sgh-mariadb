// Contratos das telas e da API do MPI da Rede (M57, etapa 1; ficha, seções 4, 7 e 8): fila de prováveis duplicados
// entre os estabelecimentos da rede, decisão humana (mesma pessoa / outra pessoa), desfazer vínculo, vínculos de um
// cadastro e relatório de divergência entre os índices dos bancos. O MASCARAMENTO é do servidor (cap-08 §8.13): CPF e
// CNS saem mascarados; o nome da mãe sai em iniciais. Nenhum nome de tabela sai daqui (fronteira).
import { z } from 'zod';
import {
  CRITERIOS_PAREAMENTO_REDE,
  DIVERGENCIAS_PAREAMENTO_REDE,
  FAIXAS_PONTUACAO_REDE_CODIGOS,
  ORIGENS_VINCULO_REDE,
  SITUACOES_CANDIDATO_REDE,
  SITUACOES_VINCULO_REDE,
  TIPOS_DIVERGENCIA_INDICE_REDE,
} from './vocabulario.js';
import { idBancoTexto } from '../validacao/id-banco.js';

/** Teto da página da fila (paginação no servidor). */
export const TETO_PAGINA_FILA_REDE = 50;

/** Código de estabelecimento (ARQ-1): minúsculas e dígitos, 2 a 10. */
const codigoEstabelecimento = z.string().regex(/^[a-z][a-z0-9]{1,9}$/);

// ── Fila ──────────────────────────────────────────────────────────────────────────────────────────────

export const esquemaConsultaFilaRede = z
  .object({
    situacao: z.enum(SITUACOES_CANDIDATO_REDE).default('aberto'),
    faixa: z.enum(FAIXAS_PONTUACAO_REDE_CODIGOS).optional(),
    /** Só os pares com um cadastro deste estabelecimento (padrão: o da sessão e todos os outros da rede). */
    outroEstabelecimento: codigoEstabelecimento.optional(),
    /** Busca por paciente: o prontuário do cadastro no estabelecimento da sessão. */
    prontuario: idBancoTexto.optional(),
    pagina: z.coerce.number().int().min(1).max(10_000).default(1),
    porPagina: z.coerce.number().int().min(1).max(TETO_PAGINA_FILA_REDE).default(20),
  })
  .strict();
export type ConsultaFilaRede = z.infer<typeof esquemaConsultaFilaRede>;

/** Um lado do par: o cadastro de um estabelecimento (lido ao vivo do banco dele; nada de outro banco no SQL). */
export const esquemaLadoCandidatoRede = z.object({
  estabelecimento: codigoEstabelecimento,
  /** Nome de exibição do estabelecimento (da configuração da rede). */
  estabelecimentoNome: z.string(),
  id: z.number().int().positive(),
  prontuario: z.number().int(),
  nome: z.string(),
  /** AAAA-MM-DD, ou null quando a data é a sentinela. */
  nascimento: z.string().nullable(),
  sexo: z.enum(['F', 'M']).nullable(),
  /** Iniciais (M*** D*** S***). */
  maeMascarada: z.string().nullable(),
  cpfMascarado: z.string().nullable(),
  cnsMascarado: z.string().nullable(),
  /** O cadastro deixou de existir ou ficou inativo/unificado depois do pareamento: o par não pode ser vinculado. */
  disponivel: z.boolean(),
});
export type LadoCandidatoRede = z.infer<typeof esquemaLadoCandidatoRede>;

export const esquemaCandidatoRede = z.object({
  /** Chave do par, igual nos dois bancos (estabelecimento:id|estabelecimento:id, em ordem). */
  chave: z.string().min(1).max(80),
  local: esquemaLadoCandidatoRede,
  remoto: esquemaLadoCandidatoRede,
  pontuacao: z.number().int().min(0).max(100),
  criterios: z.array(z.enum(CRITERIOS_PAREAMENTO_REDE)),
  divergencias: z.array(z.enum(DIVERGENCIAS_PAREAMENTO_REDE)),
  situacao: z.enum(SITUACOES_CANDIDATO_REDE),
  origem: z.enum(ORIGENS_VINCULO_REDE).nullable(),
  decididoPor: z.string().nullable(),
  decididoEm: z.string().nullable(),
});
export type CandidatoRede = z.infer<typeof esquemaCandidatoRede>;

export const esquemaFilaRede = z.object({
  itens: z.array(esquemaCandidatoRede),
  total: z.number().int(),
  pagina: z.number().int(),
  porPagina: z.number().int(),
  /** Contagem por faixa da situação consultada (sem dado pessoal). */
  porFaixa: z.object({ alta: z.number().int(), media: z.number().int(), baixa: z.number().int() }),
  /** Estabelecimentos da rede da sessão que entram no índice (ARQ-1, ARQ-2). */
  estabelecimentos: z.array(z.object({ codigo: codigoEstabelecimento, nome: z.string() })),
});
export type FilaRede = z.infer<typeof esquemaFilaRede>;

// ── Decisão, vínculo e desfazer ─────────────────────────────────────────────────────────────────────

const justificativa = z.string().trim().min(5).max(200);

/** Decisão humana sobre um par da fila. "Mesma pessoa" vincula nos dois bancos; "outra pessoa" tira o par da fila. */
export const esquemaDecisaoCandidatoRede = z.discriminatedUnion('decisao', [
  z.object({ decisao: z.literal('mesma_pessoa'), justificativa: justificativa.optional() }).strict(),
  z.object({ decisao: z.literal('outra_pessoa'), justificativa }).strict(),
]);
export type DecisaoCandidatoRede = z.infer<typeof esquemaDecisaoCandidatoRede>;

/** Desfazer um vínculo: apaga só a ligação do índice (regra 1); `reabrir` devolve o par à fila. */
export const esquemaDesfazerVinculoRede = z
  .object({ justificativa, reabrir: z.boolean().default(false) })
  .strict();
export type DesfazerVinculoRede = z.infer<typeof esquemaDesfazerVinculoRede>;

/** Resultado de vincular ou desfazer: a gravação em cada banco é separada (regra 4). */
export const esquemaResultadoGravacaoRede = z.object({
  chave: z.string(),
  /** Identificador da pessoa da Rede (estável; o mesmo em todos os bancos). */
  pessoa: z.string().nullable(),
  bancos: z.array(
    z.object({
      estabelecimento: codigoEstabelecimento,
      /** `pendente`: a gravação naquele banco falhou e entra no reparo do relatório diário (idempotente). */
      situacao: z.enum(['gravado', 'ja_estava', 'pendente']),
    }),
  ),
});
export type ResultadoGravacaoRede = z.infer<typeof esquemaResultadoGravacaoRede>;

/** Vínculos de um cadastro local (o que a fila e, na etapa 2, o aviso do cabeçalho usam). */
export const esquemaVinculosCadastroRede = z.object({
  pessoa: z.string().nullable(),
  vinculos: z.array(
    z.object({
      chave: z.string(),
      estabelecimento: codigoEstabelecimento,
      idRemoto: z.number().int().positive(),
      prontuarioRemoto: z.number().int(),
      origem: z.enum(ORIGENS_VINCULO_REDE),
      situacao: z.enum(SITUACOES_VINCULO_REDE),
      criadoPor: z.string(),
      criadoEm: z.string(),
      desfeitoPor: z.string().nullable(),
      desfeitoEm: z.string().nullable(),
    }),
  ),
});
export type VinculosCadastroRede = z.infer<typeof esquemaVinculosCadastroRede>;

// ── Pareamento e divergência ─────────────────────────────────────────────────────────────────────────

/** Resultado de um ciclo de pareamento (carga inicial em lotes ou incremental): só contagens. */
export const esquemaCicloPareamentoRede = z.object({
  lidos: z.number().int(),
  automaticos: z.number().int(),
  naFila: z.number().int(),
  descartados: z.number().int(),
  duplicadosLocais: z.number().int(),
  inelegiveis: z.number().int(),
  /** Marca d'água por estabelecimento (maior ID lido e a última atualização vista). */
  marcas: z.array(
    z.object({
      estabelecimento: codigoEstabelecimento,
      ultimoId: z.number().int(),
      ultimaAtualizacao: z.string().nullable(),
    }),
  ),
});
export type CicloPareamentoRede = z.infer<typeof esquemaCicloPareamentoRede>;

export const esquemaDivergenciasRede = z.object({
  geradoEm: z.string(),
  estabelecimentos: z.array(codigoEstabelecimento),
  total: z.number().int(),
  itens: z.array(
    z.object({
      chave: z.string(),
      tipo: z.enum(TIPOS_DIVERGENCIA_INDICE_REDE),
      /** Situação vista em cada banco (null: o banco não tem a linha). */
      porBanco: z.array(
        z.object({
          estabelecimento: codigoEstabelecimento,
          situacao: z.enum(SITUACOES_VINCULO_REDE).nullable(),
          pessoa: z.string().nullable(),
        }),
      ),
    }),
  ),
});
export type DivergenciasRede = z.infer<typeof esquemaDivergenciasRede>;

// ── Etapa 2: aviso no cabeçalho do paciente e acesso cruzado (ficha, seções 4 e 7; regras 6 e 7) ──────────

/** Chave de liberação do acesso cruzado ao prontuário (DP-42; ficha, seção 12). */
export const CHAVE_LIBERACAO_ACESSO_CRUZADO_REDE = 'rede.acessoCruzado';

export const SITUACOES_AVISO_REDE = [
  /** O MPI da Rede não está liberado no estabelecimento da sessão: o cabeçalho não mostra nada. */
  'desligado',
  /** O cadastro não está ligado a nenhum cadastro de outro estabelecimento. */
  'sem-vinculo',
  /** Ligado, mas o outro estabelecimento não tem atendimento nem internação desse paciente. */
  'sem-atendimentos',
  'com-atendimentos',
] as const;
export type SituacaoAvisoRede = (typeof SITUACOES_AVISO_REDE)[number];

/**
 * O aviso "este paciente tem atendimentos em outro estabelecimento da rede": só contagens e as datas mais recentes, por
 * estabelecimento (nenhum conteúdo clínico, nenhum nome de profissional, nenhum diagnóstico).
 */
export const esquemaAvisoRedePaciente = z.object({
  situacao: z.enum(SITUACOES_AVISO_REDE),
  estabelecimentos: z.array(
    z.object({
      estabelecimento: codigoEstabelecimento,
      estabelecimentoNome: z.string(),
      /** O cadastro do paciente no outro estabelecimento (o acesso cruzado abre por ele). */
      idRemoto: z.number().int().positive(),
      /** false: o banco daquele estabelecimento não respondeu (as contagens ficam em 0). */
      disponivel: z.boolean(),
      atendimentos: z.number().int().min(0),
      ultimoAtendimento: z.string().nullable(),
      internacoes: z.number().int().min(0),
      ultimaInternacao: z.string().nullable(),
      /** Abrir o registro deste estabelecimento (acesso cruzado): a regra da DP-42 ligada nos dois e a permissão. */
      podeAbrir: z.boolean(),
    }),
  ),
  /** Resumo do acesso cruzado: `pode` se algum abre; `motivo` de não abrir (a regra da DP-42 ainda não registrada…). */
  acessoCruzado: z.object({ pode: z.boolean(), motivo: z.string().nullable() }),
});
export type AvisoRedePaciente = z.infer<typeof esquemaAvisoRedePaciente>;

/** Pedido de abertura do registro do outro estabelecimento: motivo da lista fechada do M15 e a justificativa. */
export const esquemaPedidoProntuarioRede = z
  .object({
    motivo: z.enum([
      'assistencia',
      'auditoria-contas',
      'same',
      'comissao-prontuario',
      'juridico',
      'pedido-titular',
    ]),
    justificativa: z.string().trim().min(5).max(200),
    pagina: z.coerce.number().int().min(1).max(10_000).default(1),
  })
  .strict();
export type PedidoProntuarioRede = z.infer<typeof esquemaPedidoProntuarioRede>;

/** Evento da linha do tempo do outro estabelecimento (só leitura; o documento não abre daqui). */
export const esquemaEventoProntuarioRede = z.object({
  chave: z.string(),
  tipo: z.string(),
  quando: z.string(),
  titulo: z.string(),
  detalhe: z.string().nullable(),
  profissional: z.string().nullable(),
  situacao: z.string().nullable(),
  suspenso: z.boolean(),
  sigilo: z.boolean(),
});

export const esquemaProntuarioRede = z.object({
  estabelecimento: codigoEstabelecimento,
  estabelecimentoNome: z.string(),
  idRemoto: z.number().int().positive(),
  prontuarioRemoto: z.number().int(),
  eventos: z.array(esquemaEventoProntuarioRede),
  pagina: z.number().int(),
  temMais: z.boolean(),
});
export type ProntuarioRede = z.infer<typeof esquemaProntuarioRede>;
