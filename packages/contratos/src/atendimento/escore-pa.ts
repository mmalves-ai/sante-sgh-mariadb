// W0-07 (programa CRUD completo, mercado M1): o alerta de deterioração e de sepse no pronto atendimento. NEWS2, qSOFA e
// SIRS calculados pelo servidor (o motor dos escores da enfermagem) dos sinais da classificação e das reavaliações; o
// quadro mostra o chip e sugere o protocolo de sepse no limiar parametrizado. O escore errado se estorna com o motivo e
// se relança (matriz: "Classificação de risco" e "Checagem / sinais vitais").
import { z } from 'zod';

export const CONSCIENCIAS_ACVPU = [
  { codigo: 'A', rotulo: 'Alerta' },
  { codigo: 'C', rotulo: 'Confusão nova' },
  { codigo: 'V', rotulo: 'Responde à voz' },
  { codigo: 'P', rotulo: 'Responde à dor' },
  { codigo: 'U', rotulo: 'Sem resposta' },
] as const;
export const CODIGOS_ACVPU = ['A', 'C', 'V', 'P', 'U'] as const;

export const NIVEIS_DETERIORACAO = ['baixo', 'baixoMedio', 'medio', 'alto', 'indeterminado'] as const;
export type NivelDeterioracaoPa = (typeof NIVEIS_DETERIORACAO)[number];

/** Os parâmetros dos limiares (o padrão de mercado: NEWS2 5 ou qSOFA 2; o protocolo institucional ajusta). */
export const PARAMETRO_LIMIAR_NEWS2_SEPSE = 'atendimento.paSepseLimiarNews2';
export const PARAMETRO_LIMIAR_QSOFA_SEPSE = 'atendimento.paSepseLimiarQsofa';

const inteiro = (min: number, max: number) => z.number().int().min(min).max(max).nullable().default(null);

/** Os sinais da aferição (a mesma faixa plausível da classificação). */
export const esquemaSinaisEscorePa = z
  .object({
    fr: inteiro(0, 100),
    spo2: inteiro(0, 100),
    /** Oxigênio suplementar em L/min (0 = ar ambiente). */
    o2: z.number().min(0).max(60).nullable().default(null),
    pas: inteiro(0, 350),
    fc: inteiro(0, 300),
    consciencia: z.enum(CODIGOS_ACVPU).nullable().default(null),
    temperatura: z.number().min(25).max(45).nullable().default(null),
    leucocitos: inteiro(0, 500_000),
    bastoes10: z.boolean().nullable().default(null),
  })
  .strict();
export type SinaisEscorePa = z.infer<typeof esquemaSinaisEscorePa>;

const motivo = z.string().trim().min(5, 'Informe o motivo (5 caracteres ou mais).').max(300);

export const esquemaRegistrarEscorePa = z
  .object({
    atendimento: z.number().int().positive(),
    /** 'classificacao': confirmando os sinais da classificação; 'reavaliacao': uma aferição nova no PA. */
    origem: z.enum(['classificacao', 'reavaliacao']).default('reavaliacao'),
    sinais: esquemaSinaisEscorePa,
  })
  .strict();
export type RegistrarEscorePa = z.infer<typeof esquemaRegistrarEscorePa>;

export const esquemaEstornarEscorePa = z
  .object({
    atendimento: z.number().int().positive(),
    escore: z.number().int().positive(),
    motivo,
    /** O relançamento com os sinais certos, na mesma transação (opcional: estornar sem relançar). */
    relancar: esquemaSinaisEscorePa.nullable().default(null),
  })
  .strict();
export type EstornarEscorePa = z.infer<typeof esquemaEstornarEscorePa>;

const esquemaParcialEscore = z.object({
  total: z.number().int(),
  completo: z.boolean(),
  faltando: z.array(z.string()),
});

/** O chip do cartão do quadro: o último escore válido (registrado) ou o calculado dos sinais mais recentes. */
export const esquemaAlertaEscorePa = z.object({
  /** null: calculado dos sinais (ainda não registrado no PA). */
  id: z.number().int().nullable(),
  origem: z.enum(['classificacao', 'reavaliacao', 'relancamento', 'sinais']),
  news2: esquemaParcialEscore,
  qsofa: esquemaParcialEscore,
  sirs: esquemaParcialEscore,
  nivel: z.enum(NIVEIS_DETERIORACAO),
  sugereSepse: z.boolean(),
  motivoSepse: z.array(z.enum(['news2', 'qsofa'])),
  aferidoEm: z.string(),
});
export type AlertaEscorePa = z.infer<typeof esquemaAlertaEscorePa>;

export const esquemaEscorePaLido = z.object({
  id: z.number().int(),
  origem: z.enum(['classificacao', 'reavaliacao', 'relancamento']),
  sinais: esquemaSinaisEscorePa,
  news2: esquemaParcialEscore,
  qsofa: esquemaParcialEscore,
  sirs: esquemaParcialEscore,
  nivel: z.enum(NIVEIS_DETERIORACAO),
  sugereSepse: z.boolean(),
  limiares: z.object({ news2: z.number().int(), qsofa: z.number().int() }),
  substitui: z.number().int().nullable(),
  motivo: z.string().nullable(),
  aferidoEm: z.string(),
  usuario: z.string(),
  estorno: z.object({ motivo: z.string(), usuario: z.string(), em: z.string() }).nullable(),
});
export type EscorePaLidoContrato = z.infer<typeof esquemaEscorePaLido>;

export const esquemaEscoresPaDoAtendimento = z.object({
  reg: z.number().int(),
  limiares: z.object({ news2: z.number().int(), qsofa: z.number().int() }),
  /** Os sinais mais recentes aferidos no atendimento (a classificação ou outra tela), para pré-preencher. */
  sinaisRecentes: esquemaSinaisEscorePa.nullable(),
  /** O alerta vigente (o mesmo do chip do quadro). */
  alerta: esquemaAlertaEscorePa.nullable(),
  /** Todos os escores registrados, do mais novo ao mais antigo (os estornados também, marcados). */
  historico: z.array(esquemaEscorePaLido),
  atualizadoEm: z.string(),
});
export type EscoresPaDoAtendimento = z.infer<typeof esquemaEscoresPaDoAtendimento>;
