// Nutrição clínica (M45, etapa 5; ficha, seções 4, 5, 7 e 8; cap-05b §5.9; cap-06a §6.3): a triagem nutricional
// (NRS-2002, ou NUTRIC modificado na terapia intensiva) em até 48 h da admissão, de preferência em 24 h, com a fila
// "pacientes a triar" (vencida em vermelho, regra 10); e a terapia nutricional enteral e parenteral da EMTN (a meta
// calórica e proteica ligada à dieta prescrita pela nutricionista e o acompanhamento diário com o volume infundido
// vindo da checagem e o percentual atingido). O total da triagem é SEMPRE calculado pelo servidor (regra 3): o que vem
// da tela são as respostas; a idade vem do cadastro. Nenhum nome de tabela aqui.
import { z } from 'zod';
import { esquemaChaveLeito } from '../internacao/adt.js';
import { esquemaDataIso } from '../preco/entradas.js';
import { textoCp1252 } from '../texto-cp1252.js';
import {
  esquemaAlertaMeta,
  esquemaAvaliacaoNptLida,
  esquemaCorrecaoLida,
  esquemaProgressoMeta,
  esquemaVolumeBalanco,
  ORIGENS_TERAPIA,
  ORIGENS_VOLUME,
  SITUACOES_META_TERAPIA,
  SITUACOES_REGISTRO_CLINICO,
} from './correcao-base.js';

const id = z.number().int().positive().max(2_147_483_647);
const livre = (max: number) => textoCp1252(max).overwrite((t) => t.replace(/\s+/g, ' ').trim());

/** Chave de liberação da nutrição (SGH_CFG_LIBERACAO; ficha, seção 12), por estabelecimento e unidade. */
export const CHAVE_LIBERACAO_NUTRICAO = 'nutricao';

// ── Instrumentos de triagem (regra 10) ────────────────────────────────────────────────────────────

export const INSTRUMENTOS_TRIAGEM = [
  { codigo: 'nrs2002', rotulo: 'NRS-2002', versao: 'nrs2002-v1' },
  { codigo: 'nutric', rotulo: 'NUTRIC modificado (terapia intensiva)', versao: 'mnutric-v1' },
] as const;
export type InstrumentoTriagem = (typeof INSTRUMENTOS_TRIAGEM)[number]['codigo'];
export const CODIGOS_INSTRUMENTO_TRIAGEM = INSTRUMENTOS_TRIAGEM.map((i) => i.codigo) as [
  InstrumentoTriagem,
  ...InstrumentoTriagem[],
];
export const versaoDoInstrumento = (i: InstrumentoTriagem): string =>
  INSTRUMENTOS_TRIAGEM.find((x) => x.codigo === i)?.versao ?? i;

/** Risco da triagem: NRS-2002 total ≥ 3 é risco; NUTRIC modificado ≥ 5 é alto risco. */
export const RISCOS_TRIAGEM = [
  { codigo: 'sem-risco', rotulo: 'Sem risco nutricional (reavaliar)' },
  { codigo: 'risco', rotulo: 'Em risco nutricional' },
  { codigo: 'alto', rotulo: 'Alto risco nutricional' },
] as const;
export type RiscoTriagem = (typeof RISCOS_TRIAGEM)[number]['codigo'];
export const CODIGOS_RISCO_TRIAGEM = RISCOS_TRIAGEM.map((r) => r.codigo) as [RiscoTriagem, ...RiscoTriagem[]];

/** Estado nutricional da triagem final do NRS-2002 (0 a 3), com o critério de cada ponto (Kondrup, 2003). */
export const ESTADOS_NUTRICIONAIS_NRS = [
  { pontos: 0, rotulo: 'Ausente: estado nutricional normal' },
  {
    pontos: 1,
    rotulo: 'Leve: perda de peso > 5% em 3 meses ou ingestão de 50 a 75% da necessidade na última semana',
  },
  {
    pontos: 2,
    rotulo:
      'Moderado: perda de peso > 5% em 2 meses, IMC de 18,5 a 20,5 com mau estado geral ou ingestão de 25 a 60% na última semana',
  },
  {
    pontos: 3,
    rotulo:
      'Grave: perda de peso > 5% em 1 mês (> 15% em 3 meses), IMC < 18,5 com mau estado geral ou ingestão de 0 a 25% na última semana',
  },
] as const;

/** Gravidade da doença na triagem final do NRS-2002 (0 a 3). */
export const GRAVIDADES_NRS = [
  { pontos: 0, rotulo: 'Ausente: necessidade nutricional normal' },
  {
    pontos: 1,
    rotulo:
      'Leve: fratura de quadril, doente crônico com complicação aguda, hemodiálise, oncologia, diabetes',
  },
  {
    pontos: 2,
    rotulo: 'Moderada: cirurgia abdominal de grande porte, AVC, pneumonia grave, neoplasia hematológica',
  },
  {
    pontos: 3,
    rotulo:
      'Grave: trauma craniano, transplante de medula, paciente crítico em terapia intensiva (APACHE > 10)',
  },
] as const;

/** Respostas do NRS-2002: a triagem inicial (quatro perguntas) e, se alguma for "sim", a final. */
export const esquemaRespostasNrs2002 = z
  .object({
    instrumento: z.literal('nrs2002'),
    imcAbaixoDe20e5: z.boolean(),
    perdaDePeso3Meses: z.boolean(),
    ingestaoReduzidaSemana: z.boolean(),
    gravementeDoente: z.boolean(),
    /** Triagem final (obrigatória quando alguma resposta inicial é "sim"). */
    estadoNutricional: z.number().int().min(0).max(3).nullable(),
    gravidade: z.number().int().min(0).max(3).nullable(),
  })
  .strict();
export type RespostasNrs2002 = z.infer<typeof esquemaRespostasNrs2002>;

/** Respostas do NUTRIC modificado (sem a interleucina 6): os valores, a idade vem do cadastro. */
export const esquemaRespostasNutric = z
  .object({
    instrumento: z.literal('nutric'),
    apache2: z.number().int().min(0).max(71),
    sofa: z.number().int().min(0).max(24),
    comorbidades: z.number().int().min(0).max(20),
    diasInternadoAntesUti: z.number().int().min(0).max(365),
  })
  .strict();
export type RespostasNutric = z.infer<typeof esquemaRespostasNutric>;

export const esquemaRespostasTriagem = z.discriminatedUnion('instrumento', [
  esquemaRespostasNrs2002,
  esquemaRespostasNutric,
]);
export type RespostasTriagem = z.infer<typeof esquemaRespostasTriagem>;

/** POST /api/nutricao/triagens: a triagem do internado (o total sempre calculado no servidor). */
export const esquemaRegistrarTriagem = z
  .object({
    internacao: id,
    respostas: esquemaRespostasTriagem,
    pesoKg: z.number().positive().max(400).nullable().default(null),
    alturaCm: z.number().int().min(30).max(250).nullable().default(null),
    conduta: livre(500).optional(),
  })
  .strict();
export type RegistrarTriagemEntrada = z.infer<typeof esquemaRegistrarTriagem>;

// ── Fila "pacientes a triar" (regra 10) ───────────────────────────────────────────────────────────

/**
 * Situação do internado na fila: `a-triar` (dentro de 24 h), `atencao` (de 24 a 48 h), `vencida` (mais de 48 h sem
 * triagem: vermelho), `reavaliar` (triado sem risco com a reavaliação vencida) e `triado` (em dia).
 */
export const SITUACOES_TRIAGEM_NUTRICIONAL = [
  'a-triar',
  'atencao',
  'vencida',
  'reavaliar',
  'triado',
] as const;
export type SituacaoTriagemNutricional = (typeof SITUACOES_TRIAGEM_NUTRICIONAL)[number];

export const esquemaTriagemNutricionalLida = z.object({
  id: z.number().int(),
  instrumento: z.enum(CODIGOS_INSTRUMENTO_TRIAGEM),
  versao: z.string(),
  total: z.number().int(),
  parcelas: z.object({
    estado: z.number().int().nullable(),
    gravidade: z.number().int().nullable(),
    idade: z.number().int().nullable(),
  }),
  risco: z.enum(CODIGOS_RISCO_TRIAGEM),
  conduta: z.string().nullable(),
  imc: z.number().nullable(),
  horasDesdeAdmissao: z.number().int(),
  dentroDoPrazo: z.boolean(),
  reavaliarEm: z.string().nullable(),
  por: z.string(),
  em: z.string(),
  /** W0-05: ativa, ou inativa pela retificação (nova versão) ou pelo estorno; a correção e a versão que esta substitui. */
  situacao: z.enum(SITUACOES_REGISTRO_CLINICO),
  correcao: esquemaCorrecaoLida.nullable(),
  substitui: z.number().int().nullable(),
});
export type TriagemNutricionalLida = z.infer<typeof esquemaTriagemNutricionalLida>;

export const esquemaItemFilaNutricao = z.object({
  internacao: z.number().int(),
  paciente: z.number().int(),
  nome: z.string(),
  leito: esquemaChaveLeito,
  unidade: z.string(),
  admissao: z.string(),
  horasDesdeAdmissao: z.number().int(),
  /** Até quando triar (48 h da admissão) e a preferência (24 h). */
  prazoEm: z.string(),
  preferencialEm: z.string(),
  situacao: z.enum(SITUACOES_TRIAGEM_NUTRICIONAL),
  /** Internado em terapia intensiva (o instrumento sugerido é o NUTRIC). */
  intensiva: z.boolean(),
  idade: z.number().int().nullable(),
  ultima: esquemaTriagemNutricionalLida.nullable(),
  /** Tem meta de terapia nutricional (EMTN) registrada. */
  emTerapia: z.boolean(),
});
export type ItemFilaNutricao = z.infer<typeof esquemaItemFilaNutricao>;

export const esquemaFilaNutricao = z.object({
  itens: z.array(esquemaItemFilaNutricao),
  contagens: z.record(z.enum(SITUACOES_TRIAGEM_NUTRICIONAL), z.number().int()),
  /** Indicadores do período: triados em 24 h e em 48 h (com as parcelas: triados no prazo e admitidos). */
  indicadores: z.object({
    admitidos: z.number().int(),
    triados24h: z.number().int(),
    triados48h: z.number().int(),
  }),
  cortada: z.boolean(),
  prazoHoras: z.number().int(),
  preferencialHoras: z.number().int(),
  lidoEm: z.string(),
});
export type FilaNutricao = z.infer<typeof esquemaFilaNutricao>;

export const esquemaResultadoTriagem = z.object({
  ok: z.literal(true),
  id: z.number().int(),
  total: z.number().int(),
  risco: z.enum(CODIGOS_RISCO_TRIAGEM),
  dentroDoPrazo: z.boolean(),
  mensagem: z.string(),
});
export type ResultadoTriagem = z.infer<typeof esquemaResultadoTriagem>;

// ── Terapia nutricional (EMTN) ────────────────────────────────────────────────────────────────────

export const VIAS_TERAPIA_NUTRICIONAL = [
  { codigo: 'enteral', rotulo: 'Enteral' },
  { codigo: 'parenteral', rotulo: 'Parenteral' },
  { codigo: 'oral', rotulo: 'Suplementação oral' },
] as const;
export type ViaTerapiaNutricional = (typeof VIAS_TERAPIA_NUTRICIONAL)[number]['codigo'];
export const CODIGOS_VIA_TERAPIA = VIAS_TERAPIA_NUTRICIONAL.map((v) => v.codigo) as [
  ViaTerapiaNutricional,
  ...ViaTerapiaNutricional[],
];

/** Por que a meta não foi atingida no dia (indicador de adequação; cap-05b §5.9). */
export const MOTIVOS_META_NAO_ATINGIDA = [
  { codigo: 'jejum-procedimento', rotulo: 'Jejum para exame ou cirurgia' },
  { codigo: 'intolerancia', rotulo: 'Intolerância (distensão, vômito, diarreia, resíduo alto)' },
  { codigo: 'pausa-cuidado', rotulo: 'Pausa para cuidado ou transporte' },
  { codigo: 'perda-acesso', rotulo: 'Perda ou troca da sonda ou do acesso' },
  { codigo: 'progressao', rotulo: 'Em progressão até a meta' },
  { codigo: 'recusa', rotulo: 'Recusa do paciente' },
  { codigo: 'outro', rotulo: 'Outro motivo (descrito)' },
] as const;
export type MotivoMetaNaoAtingida = (typeof MOTIVOS_META_NAO_ATINGIDA)[number]['codigo'];
export const CODIGOS_MOTIVO_META = MOTIVOS_META_NAO_ATINGIDA.map((m) => m.codigo) as [
  MotivoMetaNaoAtingida,
  ...MotivoMetaNaoAtingida[],
];

/** Percentual da meta abaixo do qual o dia pede o motivo (adequação calórica e proteica; padrão de mercado 80%). */
export const PARAMETRO_META_ADEQUADA_PCT = 'nutricao.metaAdequadaPct';
export const PARAMETRO_TRIAGEM_PRAZO_HORAS = 'nutricao.triagemPrazoHoras';
/**
 * Quantos cadastros de profissional um login pode ter para a categoria assistencial valer (acima, é conta
 * compartilhada: a categoria não é reconhecida e o parecer social fica sob sigilo; falha fechada).
 */
export const PARAMETRO_CADASTROS_POR_LOGIN_MAX = 'nutricao.cadastrosPorLoginMax';
export const PARAMETRO_TRIAGEM_PREFERENCIAL_HORAS = 'nutricao.triagemPreferencialHoras';
export const PARAMETRO_TRIAGEM_REAVALIACAO_DIAS = 'nutricao.triagemReavaliacaoDias';

/** POST /api/nutricao/terapias/metas: a meta da EMTN, ligada ao item de dieta prescrito (enteral ou parenteral). */
export const esquemaRegistrarMetaTerapia = z
  .object({
    internacao: id,
    via: z.enum(CODIGOS_VIA_TERAPIA),
    /** O item de dieta prescrito (item de dieta da prescrição vigente) a que a meta se refere; null na parenteral. */
    itemDieta: id.nullable(),
    pesoKg: z.number().positive().max(400),
    kcalPorKg: z.number().positive().max(60),
    proteinaGPorKg: z.number().positive().max(4),
    /** Densidade calórica da fórmula (kcal/mL) e proteína (g/L), para o volume-alvo e o percentual. */
    densidadeKcalMl: z.number().positive().max(3),
    proteinaGL: z.number().min(0).max(150),
    observacao: livre(500).optional(),
  })
  .strict();
export type RegistrarMetaTerapiaEntrada = z.infer<typeof esquemaRegistrarMetaTerapia>;

/** POST /api/nutricao/terapias/acompanhamentos: o dia da terapia (o volume infundido vem da checagem quando há). */
export const esquemaRegistrarAcompanhamentoTerapia = z
  .object({
    internacao: id,
    meta: z.number().int().positive(),
    data: esquemaDataIso,
    /** Volume informado à mão (só quando a checagem do dia não traz o volume); null usa a checagem. */
    volumeInformadoMl: z.number().min(0).max(10_000).nullable().default(null),
    motivo: z.enum(CODIGOS_MOTIVO_META).nullable().default(null),
    observacao: livre(500).optional(),
  })
  .strict();
export type RegistrarAcompanhamentoTerapiaEntrada = z.infer<typeof esquemaRegistrarAcompanhamentoTerapia>;

export const esquemaDietaEnteralLida = z.object({
  /** Item de dieta prescrito (o detalhe da dieta). */
  itemDieta: z.number().int(),
  item: z.number().int(),
  prescricao: z.number().int(),
  dieta: z.string(),
  via: z.enum(CODIGOS_VIA_TERAPIA),
  quantidadeMl: z.number().nullable(),
  velocidadeMlH: z.number().nullable(),
  vigenciaInicio: z.string(),
  vigenciaFim: z.string(),
  /** Categoria de quem prescreveu (a nutricionista prescreve a dieta enteral, regra 10 do M24). */
  prescritor: z.enum(['medico', 'residente', 'nutricionista', 'dentista', 'enfermeiro', 'outro']),
  suspensa: z.boolean(),
});
export type DietaEnteralLida = z.infer<typeof esquemaDietaEnteralLida>;

export const esquemaMetaTerapiaLida = z.object({
  id: z.number().int(),
  via: z.enum(CODIGOS_VIA_TERAPIA),
  itemDieta: z.number().int().nullable(),
  pesoKg: z.number(),
  kcalPorKg: z.number(),
  proteinaGPorKg: z.number(),
  metaKcal: z.number(),
  metaProteinaG: z.number(),
  densidadeKcalMl: z.number(),
  proteinaGL: z.number(),
  metaVolumeMl: z.number(),
  por: z.string(),
  em: z.string(),
  /** W0-05: a terapia ligada ao item prescrito ou informada na ficha EMTN (a NPT sem a ordem na prescrição). */
  origemTerapia: z.enum(ORIGENS_TERAPIA),
  observacao: z.string().nullable(),
  /** Vigente, substituída pela versão nova (alterada) ou encerrada; a correção e a versão que esta substitui. */
  situacao: z.enum(SITUACOES_META_TERAPIA),
  correcao: esquemaCorrecaoLida.nullable(),
  substitui: z.number().int().nullable(),
  /** A avaliação farmacêutica da formulação da NPT (só na parenteral). */
  avaliacaoNpt: esquemaAvaliacaoNptLida.nullable(),
});
export type MetaTerapiaLida = z.infer<typeof esquemaMetaTerapiaLida>;

export const esquemaAcompanhamentoLido = z.object({
  id: z.number().int(),
  meta: z.number().int(),
  data: z.string(),
  volumePrescritoMl: z.number().nullable(),
  volumeInfundidoMl: z.number(),
  origemVolume: z.enum(ORIGENS_VOLUME),
  kcalAtingida: z.number(),
  proteinaAtingidaG: z.number(),
  pctKcal: z.number(),
  pctProteina: z.number(),
  motivo: z.enum(CODIGOS_MOTIVO_META).nullable(),
  observacao: z.string().nullable(),
  por: z.string(),
  em: z.string(),
  /** W0-05: ativa, ou inativa pela retificação (nova versão) ou pelo estorno; a correção e a versão que esta substitui. */
  situacao: z.enum(SITUACOES_REGISTRO_CLINICO),
  correcao: esquemaCorrecaoLida.nullable(),
  substitui: z.number().int().nullable(),
});
export type AcompanhamentoLido = z.infer<typeof esquemaAcompanhamentoLido>;

/** O volume da dieta checado no dia (os horários administrados da checagem, com a quantidade quando informada). */
export const esquemaVolumeChecado = z.object({
  data: z.string(),
  horariosAdministrados: z.number().int(),
  horariosPrevistos: z.number().int(),
  /** Soma das quantidades administradas informadas na checagem (mL); null quando nenhuma veio com quantidade. */
  volumeMl: z.number().nullable(),
});
export type VolumeChecado = z.infer<typeof esquemaVolumeChecado>;

export const esquemaTerapiaNutricional = z.object({
  internacao: z.number().int(),
  paciente: z.number().int(),
  nome: z.string(),
  leito: esquemaChaveLeito,
  admissao: z.string(),
  dietas: z.array(esquemaDietaEnteralLida),
  metas: z.array(esquemaMetaTerapiaLida),
  acompanhamentos: z.array(esquemaAcompanhamentoLido),
  /** Os dias com checagem da dieta (os últimos 7), para o acompanhamento sem redigitação. */
  checagens: z.array(esquemaVolumeChecado),
  /** Horas entre a admissão e a primeira checagem administrada da dieta enteral (meta: 24 a 48 h); null sem início. */
  horasAteIniciar: z.number().int().nullable(),
  /** Avaliações e evoluções da ficha nutricional do prontuário (modelo NUT01) do paciente: quantas e a mais recente. */
  fichas: z.object({ quantidade: z.number().int(), ultima: z.string().nullable() }),
  metaAdequadaPct: z.number().int(),
  /** W0-05: o percentual por dia e o acumulado da meta vigente (só os acompanhamentos ativos), com as parcelas. */
  progresso: z.array(esquemaProgressoMeta),
  /** O alerta de meta não atingida (dias seguidos abaixo do adequado, padrão 3); null sem alerta. */
  alerta: esquemaAlertaMeta.nullable(),
  /** O volume da parenteral lido do balanço hídrico por dia (os últimos 7). */
  balanco: z.array(esquemaVolumeBalanco),
  /** De onde vem a NPT: a ficha EMTN (terapia informada) ou a ordem da prescrição (parâmetro). */
  nptOrigem: z.enum(['ficha-emtn', 'cpoe']),
  lidoEm: z.string(),
});
export type TerapiaNutricional = z.infer<typeof esquemaTerapiaNutricional>;

export const esquemaResultadoTerapia = z.object({
  ok: z.literal(true),
  id: z.number().int(),
  mensagem: z.string(),
  pctKcal: z.number().nullable(),
  pctProteina: z.number().nullable(),
});
export type ResultadoTerapia = z.infer<typeof esquemaResultadoTerapia>;

/** A funcionalidade e cada ação valem agora? (liberação e permissão; categoria conferida na hora). */
export const esquemaGravacaoNutricao = z.object({
  ligada: z.boolean(),
  motivo: z.string().nullable(),
  operacoes: z.record(z.string(), z.object({ pode: z.boolean(), motivo: z.string().nullable() })),
  categoria: z.string().nullable(),
});
export type GravacaoNutricao = z.infer<typeof esquemaGravacaoNutricao>;
