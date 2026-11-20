// Painel de migração gradual, treinamento e governança (ficha do M37; cap-15 §15.3.2 a §15.3.5, §15.4, §15.8;
// cap-14 §14.8 e §14.9; DP-4). Contratos da API das telas "Migração gradual dos usuários" (setores, pessoas,
// treinamento, indicadores, condução opcional e chamados), do diálogo "Abrir chamado" da casca, do lote de liberação
// (regra 3a) e do relatório de governança (`pnpm coexistencia:relatorio`). Só contagens e nomes de estrutura; a lista
// por pessoa (login e nome de usuário) só sai para quem tem `config.coexistenciaPessoas.ler`. Nenhum dado de
// paciente em campo estruturado. Os textos daqui podem aparecer na tela: nunca citam o outro sistema pelo nome
// (ADR 0023); "o outro sistema" é a forma usada.
import { z } from 'zod';
import { textoCp1252 } from '../texto-cp1252.js';
import { PAPEIS_TREINAMENTO } from '../prontidao/catalogo.js';
import { esquemaIndicadoresDisputa } from '../onda1/onda1.js';

// ── Setores (SGH_CFG_COEX_SETOR) ────────────────────────────────────────────────────────────────────────

/** Situação do setor na coexistência (ficha, seção 6), na ordem da passagem. */
export const SITUACOES_SETOR_COEX = [
  'legado',
  'homologacao',
  'treinamento',
  'liberado',
  'acompanhamento',
  'migrado',
] as const;
export type SituacaoSetorCoex = (typeof SITUACOES_SETOR_COEX)[number];

/** Situações em que as pessoas do setor podem receber o acesso ao novo (regra 3). */
export const SITUACOES_SETOR_LIBERADO: readonly SituacaoSetorCoex[] = [
  'liberado',
  'acompanhamento',
  'migrado',
];

export const TIPOS_COMPOSICAO_SETOR = ['unidade', 'local', 'grupo'] as const;
export type TipoComposicaoSetor = (typeof TIPOS_COMPOSICAO_SETOR)[number];

/** O estabelecimento que vai primeiro (DP-4): o ProntoCardio inteiro antes do Serrano. */
export const ESTABELECIMENTO_PRIMEIRO_DP4 = 'pc';

/** Parcela impressa "novo 61 de 100 = 61%" (regra 2): a conta e as parcelas. */
export const esquemaParcelaCoexistencia = z.object({
  novo: z.number().int().nonnegative(),
  legado: z.number().int().nonnegative(),
  total: z.number().int().nonnegative(),
  /** Percentual inteiro do novo sobre o total; null sem nenhuma linha no dia. */
  percentual: z.number().int().min(0).max(100).nullable(),
});
export type Parcela = z.infer<typeof esquemaParcelaCoexistencia>;

export const esquemaAvaliacaoMigrado = z.object({
  /** A proposta da regra 10 está cumprida (só acompanhamento: nada é desligado). */
  cumprido: z.boolean(),
  criterios: z.array(
    z.object({
      criterio: z.enum(['sem-s1', 's2-caindo', 'conexoes-em-queda', 'metas', 'aceite']),
      atendido: z.boolean(),
      detalhe: z.string(),
    }),
  ),
});
export type AvaliacaoMigrado = z.infer<typeof esquemaAvaliacaoMigrado>;

export const esquemaSetorCoex = z.object({
  codigo: z.string(),
  nome: z.string(),
  onda: z.number().int().min(0).max(5),
  situacao: z.enum(SITUACOES_SETOR_COEX),
  papeis: z.array(z.enum(PAPEIS_TREINAMENTO)),
  chaveLiberacao: z.string().nullable(),
  /** As chaves (operações e funcionalidades) que o lote do setor liga por pessoa. */
  chaves: z.array(z.object({ tipo: z.enum(['operacao', 'recurso']), chave: z.string() })),
  conducao: z.boolean(),
  aceiteCoordenador: z.boolean(),
  datas: z.object({
    homologacao: z.string().nullable(),
    treinamento: z.string().nullable(),
    liberado: z.string().nullable(),
    acompanhamento: z.string().nullable(),
    migrado: z.string().nullable(),
  }),
  composicao: z.array(z.object({ tipo: z.enum(TIPOS_COMPOSICAO_SETOR), valor: z.string() })),
  /** Pessoas do setor (ativas, não bloqueadas): contagem agregada (abaixo de 5: "<5"). */
  pessoas: z.union([z.number().int(), z.literal('<5')]),
  treinados: z.union([z.number().int(), z.literal('<5')]),
  comAcesso: z.union([z.number().int(), z.literal('<5')]),
  /** Parcela do último dia medido (regra 2). */
  parcela: esquemaParcelaCoexistencia,
  migrado: esquemaAvaliacaoMigrado,
  /** Gravado no banco (false: só o catálogo do setor, ainda sem linha em SGH_CFG_COEX_SETOR). */
  gravado: z.boolean(),
});
export type SetorCoex = z.infer<typeof esquemaSetorCoex>;

export const esquemaPainelSetores = z.object({
  estabelecimento: z.string(),
  /** DP-4: o estabelecimento ativo espera o primeiro terminar (o Serrano espera o ProntoCardio). */
  aguardandoPrimeiro: z.boolean(),
  primeiro: z.string(),
  motivoAguardando: z.string().nullable(),
  setores: z.array(esquemaSetorCoex),
  /** Público por papel (cap-15 §15.4.1), contado no banco do estabelecimento; total e parcelas. */
  publico: z.object({
    total: z.number().int(),
    parcelas: z.array(
      z.object({ papel: z.enum(PAPEIS_TREINAMENTO), nome: z.string(), usuarios: z.number().int() }),
    ),
    referencia: z.number().int().nullable(),
  }),
  lotes: z.array(
    z.object({
      id: z.string(),
      setor: z.string(),
      alvoTipo: z.enum(['usuarios', 'grupo', 'setor']),
      alvo: z.string(),
      incluidos: z.number().int(),
      fora: z.number().int(),
      /** O lote inclui a condução do setor (recolhido junto: as opções voltam aos grupos). */
      conducao: z.boolean(),
      situacao: z.enum(['aplicado', 'recolhido']),
      aplicadoPor: z.string(),
      aplicadoEm: z.string(),
      recolhidoEm: z.string().nullable(),
    }),
  ),
});
export type PainelSetores = z.infer<typeof esquemaPainelSetores>;

export const esquemaEditarSetor = z.object({
  situacao: z.enum(SITUACOES_SETOR_COEX),
  chaveLiberacao: textoCp1252(80).nullable().optional(),
  conducao: z.boolean().optional(),
  aceiteCoordenador: z.boolean().optional(),
  composicao: z
    .array(
      z.object({
        tipo: z.enum(TIPOS_COMPOSICAO_SETOR),
        // Grava em SGH_CFG_COEX_SETOR_UNID.VALOR (banco sem charset): só o que a tabela CP1252 representa.
        valor: textoCp1252(50).pipe(z.string().trim().min(1)),
      }),
    )
    .max(200)
    .optional(),
  justificativa: textoCp1252(200).pipe(z.string().min(10, 'Justifique com pelo menos 10 caracteres.')),
});
export type EditarSetor = z.infer<typeof esquemaEditarSetor>;

// ── Pessoas ─────────────────────────────────────────────────────────────────────────────────────────

export const esquemaPessoaCoex = z.object({
  login: z.string(),
  nome: z.string().nullable(),
  grupo: z.string().nullable(),
  papel: z.enum(PAPEIS_TREINAMENTO).nullable(),
  setores: z.array(z.string()),
  trilhaConcluida: z.boolean(),
  /** Acesso ao novo ligado por pessoa (chave de pessoa) em alguma chave do setor. */
  acessoNovo: z.boolean(),
  ultimoUsoNovo: z.string().nullable(),
  ultimaConexaoOutro: z.string().nullable(),
  /** Dias desde a última conexão no outro sistema (pela diferença entre retratos; regra 1). */
  diasSemOutro: z.number().int().nullable(),
});
export type PessoaCoex = z.infer<typeof esquemaPessoaCoex>;

export const esquemaPaginaPessoas = z.object({
  total: z.number().int(),
  pagina: z.number().int(),
  itens: z.array(esquemaPessoaCoex),
});
export type PaginaPessoas = z.infer<typeof esquemaPaginaPessoas>;

// ── Treinamento (SGH_CFG_COEX_TRILHA e SGH_CFG_COEX_TREINO) ─────────────────────────────────────────────

export const RESULTADOS_TREINO = ['aprovado', 'refazer'] as const;

/**
 * Turno da turma (M43, regra 6; cap-15 §15.4.2: plantonistas, noite e fim de semana treinam no turno deles). Opcional no
 * registro: a conclusão sem turno conta como "não informado" na contagem por turno do painel.
 */
export const TURNOS_TREINO = ['manha', 'tarde', 'noite', 'fim-de-semana'] as const;
export type TurnoTreino = (typeof TURNOS_TREINO)[number];

/** Os dois materiais de cada tarefa da trilha (gerados por `pnpm treinamento:gerar`). */
export const TIPOS_GUIA_TREINO = ['guia', 'video'] as const;

/** Um guia (ou roteiro de vídeo) servido à tela de treinamento: o texto em Markdown simples. */
export const esquemaGuiaTreino = z.object({
  papel: z.enum(PAPEIS_TREINAMENTO),
  tarefa: z.string(),
  tipo: z.enum(TIPOS_GUIA_TREINO),
  titulo: z.string(),
  texto: z.string(),
});
export type GuiaTreino = z.infer<typeof esquemaGuiaTreino>;

export const esquemaTrilhaCoex = z.object({
  papel: z.enum(PAPEIS_TREINAMENTO),
  onda: z.number().int().min(0).max(5),
  versao: z.number().int().positive(),
  nome: z.string(),
  carga: z.string(),
  tarefas: z.array(
    z.object({
      id: z.string(),
      titulo: z.string(),
      guia: z.string(),
      video: z.string(),
      desatualizada: z.boolean(),
    }),
  ),
  exercicio: z.string(),
  situacao: z.enum(['vigente', 'desatualizada']),
  /** Gravada no banco (false: proposta do catálogo, ainda não publicada). */
  publicada: z.boolean(),
  publicadaEm: z.string().nullable(),
  concluidas: z.number().int(),
  /**
   * W0-09: as versões gravadas (a mais nova primeiro), para retirar uma versão: 'retirada' é a inativada (tinha turmas
   * ou conclusões), visível com a história; as conclusões contadas são as que valem (sem as estornadas).
   */
  versoes: z.array(
    z.object({
      versao: z.number().int(),
      situacao: z.enum(['vigente', 'desatualizada', 'retirada']),
      publicadaEm: z.string().nullable(),
      conclusoes: z.number().int().nonnegative(),
    }),
  ),
});
export type TrilhaCoex = z.infer<typeof esquemaTrilhaCoex>;

export const esquemaConclusaoTreino = z.object({
  id: z.string(),
  login: z.string(),
  papel: z.enum(PAPEIS_TREINAMENTO),
  onda: z.number().int(),
  versao: z.number().int(),
  turma: z.string(),
  turno: z.enum(TURNOS_TREINO).nullable(),
  concluidoEm: z.string(),
  resultado: z.enum(RESULTADOS_TREINO),
  registradoPor: z.string(),
});
export type ConclusaoTreino = z.infer<typeof esquemaConclusaoTreino>;

export const esquemaPainelTreino = z.object({
  estabelecimento: z.string(),
  trilhas: z.array(esquemaTrilhaCoex),
  turmas: z.array(
    z.object({ turma: z.string(), papel: z.string(), onda: z.number().int(), pessoas: z.number().int() }),
  ),
  conclusoes: z.array(esquemaConclusaoTreino),
  /**
   * M43, regra 6: pessoas com a trilha concluída (aprovada) por turno da turma; "nao-informado" para a conclusão
   * registrada sem turno. Contagens agregadas (a pessoa conta uma vez por turno).
   */
  porTurno: z.array(
    z.object({ turno: z.enum([...TURNOS_TREINO, 'nao-informado']), pessoas: z.number().int().nonnegative() }),
  ),
  /** O ambiente de treino abre quando o dono registrar o método de mascaramento (ficha, seção 12). */
  ambienteTreino: z.object({ metodoRegistrado: z.boolean(), motivo: z.string() }),
});
export type PainelTreino = z.infer<typeof esquemaPainelTreino>;

export const esquemaPublicarTrilha = z.object({
  exercicio: textoCp1252(400).pipe(z.string().min(10)),
  carga: textoCp1252(60).optional(),
});

export const esquemaRegistrarConclusao = z.object({
  logins: z.array(z.string().trim().min(1).max(31)).min(1).max(500),
  papel: z.enum(PAPEIS_TREINAMENTO),
  onda: z.number().int().min(0).max(5),
  turma: textoCp1252(40).pipe(z.string().min(2)),
  turno: z.enum(TURNOS_TREINO).optional(),
  concluidoEm: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  resultado: z.enum(RESULTADOS_TREINO),
});
export type RegistrarConclusao = z.infer<typeof esquemaRegistrarConclusao>;

// ── W0-09 (CRUD completo; script 1122): o ciclo de vida dos registros da implantação ─────────────────────────────

/** O motivo de toda mudança do ciclo (vai ao histórico com o valor anterior). */
export const esquemaMotivoCoex = textoCp1252(200).pipe(
  z.string().trim().min(5, 'Informe o motivo (ao menos 5 caracteres).'),
);

/** Voltar o item do critério de liberação a pendente. */
export const esquemaVoltarItemPendente = z.object({ motivo: esquemaMotivoCoex }).strict();

/** Voltar o item da checklist do desligamento a pendente (operação crítica: com a senha). */
export const esquemaVoltarItemDesligamentoPendente = z
  .object({ motivo: esquemaMotivoCoex, senha: z.string().min(1).max(200) })
  .strict();

/** Estornar a conclusão de treinamento. */
export const esquemaEstornarConclusao = z.object({ motivo: esquemaMotivoCoex }).strict();

/**
 * Retirar a versão da trilha: sem `inativar`, a exclusão (recusada com 409 e a contagem quando há turmas ou conclusões,
 * com a oferta de inativar); com `inativar: true`, a inativação ('retirada').
 */
export const esquemaRetirarVersaoTrilha = z
  .object({ motivo: esquemaMotivoCoex, inativar: z.boolean().optional() })
  .strict();

export interface ResultadoRetirarVersaoTrilha {
  readonly papel: string;
  readonly onda: number;
  readonly versao: number;
  readonly resultado: 'excluida' | 'inativada';
  /** A versão anterior que voltou a vigente (a retirada era a vigente), ou null. */
  readonly promovida: number | null;
}

// ── W0-09 (script 1123; D-RETRO-REGISTRO-F6): o registro do fim e o da retrocompatibilidade gravados pela tela ───

export const PARAMETRO_REGISTRO_COEX = 'coexistencia.registro.modo';
export const MODOS_REGISTRO_COEX = ['tela', 'excecao'] as const;
export type ModoRegistroCoex = (typeof MODOS_REGISTRO_COEX)[number];
export const TIPOS_REGISTRO_COEX = ['fim', 'retrocompatibilidade'] as const;
export type TipoRegistroCoex = (typeof TIPOS_REGISTRO_COEX)[number];
/** O teto do conteúdo gravado (JSON só ASCII; VARCHAR(16000)), bem acima de qualquer registro real (~2 KB). */
export const TETO_REGISTRO_COEX = 16_000;

/**
 * Gravar o registro (operação crítica: com a senha). `conteudo` é o registro inteiro, no mesmo esquema do arquivo
 * versionado (validado pelo tipo); null volta a valer o registro versionado (a gravação anterior fica no histórico).
 */
export const esquemaGravarRegistroCoex = z
  .object({
    conteudo: z.record(z.string(), z.unknown()).nullable(),
    motivo: esquemaMotivoCoex,
    senha: z.string().min(1).max(200),
  })
  .strict();

export interface VersaoRegistroCoex {
  readonly versao: number;
  readonly motivo: string;
  readonly gravadoPor: string;
  readonly gravadoEm: string;
  /** A versão que voltou a valer o registro versionado (conteúdo vazio). */
  readonly retornoAoArquivo: boolean;
}

export interface RegistroCoexGravado {
  readonly tipo: TipoRegistroCoex;
  readonly modo: ModoRegistroCoex;
  /** De onde vem o registro que vale agora. */
  readonly fonte: 'tela' | 'arquivo';
  readonly versaoVigente: number | null;
  /** O conteúdo gravado que vale (fonte 'tela'); null quando vale o arquivo. */
  readonly conteudo: Record<string, unknown> | null;
  /** Da mais nova para a mais antiga. */
  readonly historico: readonly VersaoRegistroCoex[];
}

// ── Indicadores (SGH_CFG_COEX_USO_DIA; cap-15 §15.3.4) ─────────────────────────────────────────────────

/** Os cinco indicadores do cap-15 §15.3.4. */
export const INDICADORES_COEX = ['parcela', 'tempo', 'colisoes', 'carga', 'chamados'] as const;

export const esquemaPainelIndicadores = z.object({
  estabelecimento: z.string(),
  dias: z.array(z.string()),
  parcela: z.array(
    z.object({
      dia: z.string(),
      setor: z.string(),
      operacao: z.string(),
      parcela: esquemaParcelaCoexistencia,
    }),
  ),
  tempo: z.array(
    z.object({
      dia: z.string(),
      tarefa: z.string(),
      p50Ms: z.number().int().nullable(),
      p95Ms: z.number().int().nullable(),
    }),
  ),
  colisoes: z.array(
    z.object({ dia: z.string(), colisoes: z.number().int(), esperasTrava: z.number().int() }),
  ),
  carga: z.object({
    conexoesPorSistema: z.array(z.object({ sistema: z.string(), conexoes: z.number().int() })),
    transacoesLongas: z.number().int(),
    consultasLentas: z.number().int().nullable(),
    lidoEm: z.string().nullable(),
  }),
  chamados: z.array(
    z.object({
      severidade: z.enum(['S1', 'S2', 'S3', 'S4']),
      abertos: z.number().int(),
      resolvidos: z.number().int(),
      horasCorrecaoMedia: z.number().nullable(),
    }),
  ),
  grafana: z.string().nullable(),
  /** M39: indicadores de disputa da onda 1 por dia da janela (colisões, recusas por horário ocupado, senhas, travas). */
  disputa: z.array(esquemaIndicadoresDisputa),
});
export type PainelIndicadores = z.infer<typeof esquemaPainelIndicadores>;

// ── Lote de liberação (SGH_CFG_COEX_LOTE; regra 3a, DP-4) ──────────────────────────────────────────────

export const TIPOS_ALVO_LOTE = ['usuarios', 'grupo', 'setor'] as const;
export type TipoAlvoLote = (typeof TIPOS_ALVO_LOTE)[number];

export const esquemaPedidoLoteCoex = z.object({
  setor: z.string().min(1).max(40),
  alvo: z.object({
    tipo: z.enum(TIPOS_ALVO_LOTE),
    /** Logins (usuarios), o grupo do legado (grupo) ou vazio (setor inteiro). */
    valores: z.array(textoCp1252(50).pipe(z.string().trim().min(1))).max(2000),
  }),
  justificativa: textoCp1252(200).pipe(z.string().min(10, 'Justifique com pelo menos 10 caracteres.')),
  referenciaAutorizacao: textoCp1252(200).optional(),
  /**
   * Setor com a condução ligada (regra 6): os pares "GRUPO:opção" com usuários fora do setor que o gestor de acessos
   * decidiu incluir; sem decisão, esses pares ficam fora da condução do lote (e aparecem listados).
   */
  decisaoGestor: z.array(z.string().max(80)).max(500).optional(),
  senha: z.string().max(200).optional(),
});
export type PedidoLoteCoex = z.infer<typeof esquemaPedidoLoteCoex>;

export const esquemaResultadoLoteCoex = z.object({
  lote: z.string(),
  incluidos: z.array(z.string()),
  /** Quem ficou de fora (regra 3: sem a trilha concluída, ou fora do setor) e por quê. */
  fora: z.array(z.object({ login: z.string(), motivo: z.string() })),
  chaves: z.array(
    z.object({ tipo: z.string(), chave: z.string(), loteLiberacao: z.string(), alteradas: z.number().int() }),
  ),
  /** A condução do lote (setor com a condução ligada): as opções retiradas e os pares que ficaram de fora. */
  conducao: z
    .object({
      feitas: z.number().int(),
      grupos: z.array(z.string()),
      fora: z.array(z.object({ grupo: z.string(), opcao: z.number().int(), motivo: z.string() })),
    })
    .nullable(),
  destino: z.enum(['legado', 'memoria']),
  /** M39 (regra 1): em dev/ci, o que falta da lista para ligar o setor da onda 1 (fora de dev/ci, o lote é recusado). */
  avisoLigar: z.string().nullable().optional(),
});
export type ResultadoLoteCoex = z.infer<typeof esquemaResultadoLoteCoex>;

export const esquemaRecolherLote = z.object({
  justificativa: textoCp1252(200).pipe(z.string().min(10)),
  senha: z.string().max(200).optional(),
});

// ── Condução opcional (SGH_CFG_COEX_CONDUCAO; regra 6) ──────────────────────────────────────────────────

export const esquemaParConducao = z.object({
  grupo: z.string(),
  opcao: z.number().int().positive(),
  titulo: z.string().nullable(),
  /** Usuários ativos do grupo no setor e fora dele (o par com gente fora do setor exige a decisão do gestor). */
  usuariosNoSetor: z.number().int(),
  usuariosFora: z.number().int(),
  exigeDecisao: z.boolean(),
  situacao: z.enum(['proposta', 'retirada', 'devolvida']),
  idConducao: z.string().nullable(),
});
export type ParConducao = z.infer<typeof esquemaParConducao>;

export const esquemaPainelConducao = z.object({
  estabelecimento: z.string(),
  setor: z.string(),
  conducaoLigada: z.boolean(),
  operacoes: z.array(z.string()),
  pares: z.array(esquemaParConducao),
  retiradas: z.number().int(),
});
export type PainelConducao = z.infer<typeof esquemaPainelConducao>;

export const esquemaRetirarConducao = z.object({
  pares: z
    .array(z.object({ grupo: z.string().min(1).max(50), opcao: z.number().int().positive() }))
    .min(1)
    .max(500),
  /** A linha de autorização do dono para este setor e estabelecimento (obrigatória: DP-4). */
  autorizacao: textoCp1252(200).pipe(z.string().min(5)),
  /** Os pares com usuário fora do setor que o gestor de acessos decidiu incluir. */
  decisaoGestor: z.array(z.string()).max(500).optional(),
  senha: z.string().max(200).optional(),
});
export type RetirarConducao = z.infer<typeof esquemaRetirarConducao>;

export const esquemaDevolverConducao = z.object({
  /** Vazio: devolve tudo o que está retirado do setor. */
  ids: z
    .array(z.string().regex(/^\d{1,20}$/))
    .max(500)
    .optional(),
  senha: z.string().max(200).optional(),
});

export const esquemaResultadoConducao = z.object({
  feitas: z.number().int(),
  grupos: z.array(z.string()),
  destino: z.enum(['legado', 'memoria']),
});
export type ResultadoConducao = z.infer<typeof esquemaResultadoConducao>;

// ── Chamados (SGH_CFG_CHAMADO; regra 7) ─────────────────────────────────────────────────────────────────

export const SEVERIDADES_CHAMADO = ['S1', 'S2', 'S3', 'S4'] as const;
export type SeveridadeChamado = (typeof SEVERIDADES_CHAMADO)[number];
export const SISTEMAS_CHAMADO = ['novo', 'outro', 'ambos'] as const;
export const SITUACOES_CHAMADO = [
  'aberto',
  'em-atendimento',
  'contornado',
  'resolvido',
  'cancelado',
] as const;
export const NIVEIS_SUPORTE = ['N0', 'N1', 'N2', 'N3'] as const;

/** Aviso fixo do diálogo (ficha, seção 6). */
export const AVISO_TEXTO_CHAMADO = 'Não escreva nome, CPF ou dado clínico do paciente.';

export const esquemaAbrirChamado = z.object({
  /** A primeira pergunta: em que sistema aconteceu (regra 7). */
  sistema: z.enum(SISTEMAS_CHAMADO),
  severidade: z.enum(SEVERIDADES_CHAMADO),
  // Grava em SGH_CFG_CHAMADO.TELA (banco sem charset): fora do CP1252 é recusado na entrada, não no banco.
  tela: textoCp1252(200).optional(),
  versao: z.string().max(40).optional(),
  traceId: z
    .string()
    .regex(/^[0-9a-f-]{8,64}$/i)
    .optional(),
  setor: z.string().max(40).optional(),
  dadoPessoal: z.boolean().default(false),
  descricao: textoCp1252(2000).pipe(z.string().min(10, 'Descreva com pelo menos 10 caracteres.')),
});
export type AbrirChamado = z.infer<typeof esquemaAbrirChamado>;

export const esquemaTriarChamado = z.object({
  severidade: z.enum(SEVERIDADES_CHAMADO),
  situacao: z.enum(SITUACOES_CHAMADO),
  nivel: z.enum(NIVEIS_SUPORTE),
  comandante: z.string().max(31).nullable().optional(),
  contorno: textoCp1252(400).optional(),
});
export type TriarChamado = z.infer<typeof esquemaTriarChamado>;

export const esquemaChamadoLido = z.object({
  id: z.string(),
  sistema: z.enum(SISTEMAS_CHAMADO),
  severidade: z.enum(SEVERIDADES_CHAMADO),
  nivel: z.enum(NIVEIS_SUPORTE),
  situacao: z.enum(SITUACOES_CHAMADO),
  tela: z.string().nullable(),
  versao: z.string().nullable(),
  traceId: z.string().nullable(),
  setor: z.string().nullable(),
  ocorridoEm: z.string(),
  prazoResposta: z.string(),
  prazoSolucao: z.string(),
  vencido: z.boolean(),
  comandante: z.string().nullable(),
  dadoPessoal: z.boolean(),
  encarregadoAvisado: z.boolean(),
  descricao: z.string(),
  contorno: z.string().nullable(),
  abertoPor: z.string(),
  abertoEm: z.string(),
  /** S1: próxima atualização devida (a cada 30 min). */
  proximaAtualizacao: z.string().nullable(),
});
export type ChamadoLido = z.infer<typeof esquemaChamadoLido>;

/** Tamanho da página da lista de chamados. */
export const TAMANHO_PAGINA_CHAMADOS = 50;

/** Filtros da lista de chamados (a query da rota; todos opcionais). */
export const esquemaFiltroChamados = z.object({
  severidade: z.enum(SEVERIDADES_CHAMADO).optional(),
  situacao: z.enum(SITUACOES_CHAMADO).optional(),
  sistema: z.enum(SISTEMAS_CHAMADO).optional(),
  setor: z
    .string()
    .regex(/^[a-z0-9-]{1,40}$/)
    .optional(),
  /** Abertos nos últimos N dias (sem ele, todos). */
  dias: z.coerce.number().int().min(1).max(365).optional(),
  pagina: z.coerce.number().int().min(1).max(100_000).optional(),
});
export type FiltroChamados = z.infer<typeof esquemaFiltroChamados>;

export const esquemaListaChamados = z.object({
  total: z.number().int(),
  pagina: z.number().int(),
  tamanho: z.number().int(),
  itens: z.array(esquemaChamadoLido),
  /** Os prazos vigentes (parâmetros, "a aprovar" pela diretoria). */
  prazos: z.array(
    z.object({
      severidade: z.enum(SEVERIDADES_CHAMADO),
      respostaMin: z.number().int(),
      solucaoMin: z.number().int(),
      diaUtil: z.boolean(),
      aprovado: z.boolean(),
    }),
  ),
});
export type ListaChamados = z.infer<typeof esquemaListaChamados>;

// ── Relatório de governança (regra 9) ───────────────────────────────────────────────────────────────────

export const PERIODOS_RELATORIO_COEX = ['dia', 'semana'] as const;
export type PeriodoRelatorioCoex = (typeof PERIODOS_RELATORIO_COEX)[number];
