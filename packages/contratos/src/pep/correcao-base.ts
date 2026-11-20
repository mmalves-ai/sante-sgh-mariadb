// W0-05 (programa CRUD completo): a parte de leitura das correções da nutrição, do serviço social, da oncologia e do
// lactário (situações, a correção lida, o progresso da meta, o alerta, os eventos). Sem dependência dos contratos dos
// módulos, que a importam (evita ciclo de importação).
import { z } from 'zod';

export const ACOES_CORRECAO = ['retificacao', 'estorno', 'nova-versao', 'encerramento'] as const;
export type AcaoCorrecao = (typeof ACOES_CORRECAO)[number];
export const REGISTROS_CORRIGIVEIS = ['triagem', 'meta', 'acompanhamento', 'social'] as const;
export type RegistroCorrigivel = (typeof REGISTROS_CORRIGIVEIS)[number];

export const esquemaCorrecaoLida = z.object({
  acao: z.enum(ACOES_CORRECAO),
  idNovo: z.number().int().nullable(),
  motivo: z.string(),
  por: z.string(),
  em: z.string(),
});
export type CorrecaoLida = z.infer<typeof esquemaCorrecaoLida>;

export const SITUACOES_REGISTRO_CLINICO = ['ativo', 'retificado', 'estornado'] as const;
export type SituacaoRegistroClinico = (typeof SITUACOES_REGISTRO_CLINICO)[number];

export const situacaoDaCorrecao = (c: { acao: AcaoCorrecao } | null): SituacaoRegistroClinico =>
  c === null ? 'ativo' : c.acao === 'estorno' ? 'estornado' : 'retificado';

export const ORIGENS_VOLUME = ['checagem', 'balanco', 'informado'] as const;
export type OrigemVolume = (typeof ORIGENS_VOLUME)[number];

export const ORIGENS_TERAPIA = ['prescrita', 'informada'] as const;
export type OrigemTerapia = (typeof ORIGENS_TERAPIA)[number];

export const SITUACOES_META_TERAPIA = ['vigente', 'substituida', 'encerrada'] as const;
export type SituacaoMetaTerapia = (typeof SITUACOES_META_TERAPIA)[number];

export const PARECERES_NPT = [
  { codigo: 'adequada', rotulo: 'Adequada: liberar para manipulação' },
  { codigo: 'ajustar', rotulo: 'Ajustar: devolver ao prescritor com a sugestão' },
  { codigo: 'inadequada', rotulo: 'Inadequada: não manipular' },
] as const;
export type ParecerNpt = (typeof PARECERES_NPT)[number]['codigo'];
export const CODIGOS_PARECER_NPT = PARECERES_NPT.map((p) => p.codigo) as [ParecerNpt, ...ParecerNpt[]];
export const ACESSOS_NPT = ['central', 'periferico'] as const;
export type AcessoNpt = (typeof ACESSOS_NPT)[number];

export const esquemaAvaliacaoNptLida = z.object({
  id: z.number().int(),
  meta: z.number().int(),
  parecer: z.enum(CODIGOS_PARECER_NPT),
  acesso: z.enum(ACESSOS_NPT),
  osmolaridade: z.number(),
  estabilidade: z.boolean(),
  compatibilidade: z.boolean(),
  observacao: z.string().nullable(),
  por: z.string(),
  em: z.string(),
});
export type AvaliacaoNptLida = z.infer<typeof esquemaAvaliacaoNptLida>;

export const esquemaProgressoMeta = z.object({
  data: z.string(),
  kcalMeta: z.number(),
  kcalAtingida: z.number(),
  ptnMetaG: z.number(),
  ptnAtingidaG: z.number(),
  pctKcal: z.number(),
  pctProteina: z.number(),
  acumuladoKcalMeta: z.number(),
  acumuladoKcalAtingida: z.number(),
  acumuladoPtnMetaG: z.number(),
  acumuladoPtnAtingidaG: z.number(),
  acumuladoPctKcal: z.number(),
  acumuladoPctProteina: z.number(),
  abaixoDoAdequado: z.boolean(),
  /** As parcelas do dia por via (a enteral e a NPT complementar somam no dia); uma só quando há uma terapia. */
  vias: z.array(
    z.object({
      via: z.string(),
      kcalMeta: z.number(),
      kcalAtingida: z.number(),
      ptnMetaG: z.number(),
      ptnAtingidaG: z.number(),
    }),
  ),
});
export type ProgressoMeta = z.infer<typeof esquemaProgressoMeta>;

export const esquemaAlertaMeta = z.object({
  dias: z.number().int(),
  desde: z.string(),
  ate: z.string(),
  mensagem: z.string(),
});
export type AlertaMeta = z.infer<typeof esquemaAlertaMeta>;

export const esquemaVolumeBalanco = z.object({
  data: z.string(),
  lancamentos: z.number().int(),
  volumeMl: z.number(),
});
export type VolumeBalanco = z.infer<typeof esquemaVolumeBalanco>;

export const CATEGORIAS_MOTIVO_CICLO = [
  { codigo: 'toxicidade', rotulo: 'Toxicidade' },
  { codigo: 'desistencia', rotulo: 'Desistência do paciente' },
  { codigo: 'obito', rotulo: 'Óbito' },
  { codigo: 'clinico', rotulo: 'Condição clínica (exames, infecção, cirurgia)' },
  { codigo: 'outro', rotulo: 'Outro motivo (descrito)' },
] as const;
export type CategoriaMotivoCiclo = (typeof CATEGORIAS_MOTIVO_CICLO)[number]['codigo'];
export const CODIGOS_CATEGORIA_CICLO = CATEGORIAS_MOTIVO_CICLO.map((c) => c.codigo) as [
  CategoriaMotivoCiclo,
  ...CategoriaMotivoCiclo[],
];
export const ANDAMENTOS_CICLO = ['ativo', 'suspenso', 'cancelado'] as const;
export type AndamentoCiclo = (typeof ANDAMENTOS_CICLO)[number];

export const EVENTOS_ONCO = [
  'versao-revogada',
  'protocolo-inativado',
  'protocolo-reativado',
  'ciclo-ajustado',
  'ciclo-suspenso',
  'ciclo-retomado',
  'ciclo-cancelado',
  'prescricao-desligada',
] as const;
export type EventoOnco = (typeof EVENTOS_ONCO)[number];

/**
 * A versão anterior do ciclo ajustado (data, redução, justificativa do intervalo e doses), relida na transação do ajuste:
 * a prescrição anterior do quimioterápico continua visível como inativa (na tela e na impressão).
 */
export const esquemaVersaoCicloAnterior = z.object({
  dataPrevista: z.string(),
  reducaoPct: z.number().int(),
  motivoReducao: z.string().nullable(),
  justificativaIntervalo: z.string().nullable(),
  doses: z.array(z.object({ farmaco: z.string(), final: z.number() })),
});
export type VersaoCicloAnterior = z.infer<typeof esquemaVersaoCicloAnterior>;

export const esquemaEventoOncoLido = z.object({
  id: z.number().int(),
  evento: z.enum(EVENTOS_ONCO),
  categoria: z.enum(CODIGOS_CATEGORIA_CICLO).nullable(),
  prescricao: z.number().int().nullable(),
  ciclosAfetados: z.number().int().nullable(),
  /** Só no 'ciclo-ajustado': a versão anterior do ciclo (inativa); null nos demais. */
  antes: esquemaVersaoCicloAnterior.nullable(),
  motivo: z.string(),
  por: z.string(),
  em: z.string(),
});
export type EventoOncoLido = z.infer<typeof esquemaEventoOncoLido>;

export const esquemaAlteracaoHotLida = z.object({
  id: z.number().int(),
  evento: z.enum(['alterada', 'cancelada', 'etiqueta-emitida']),
  antes: z.string().nullable(),
  depois: z.string().nullable(),
  motivo: z.string().nullable(),
  por: z.string(),
  em: z.string(),
});
export type AlteracaoHotLida = z.infer<typeof esquemaAlteracaoHotLida>;
