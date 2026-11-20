// Protocolos gerenciados no pronto atendimento (M44, etapa 3; ficha, seções 5 a 8, regra 8; cap-05a §5.3; cap-05b
// §5.11): a definição versionada de sepse, dor torácica, AVC e trauma (critério de inclusão, metas com prazo e o
// checklist), a inclusão do paciente (pelo enfermeiro, pelo médico ou sugerida pelo discriminador da classificação) e o
// relógio das metas (ECG em até 10 min na dor torácica; antibiótico na primeira hora na sepse). Meta perdida exige o
// motivo. Só do novo: o sistema anterior não tem protocolo gerenciado (nenhuma tabela, nenhuma opção). A definição é
// dado (como o protocolo de classificação, regra 2): versão publicada imutável, com autor e aprovador (diretoria
// clínica); a inclusão guarda a versão usada. Conteúdo clínico de produção é da diretoria clínica: o código só traz a
// definição SINTÉTICA de teste (o nome o diz).
import { z } from 'zod';
import { textoCp1252 } from '../texto-cp1252.js';

// ── Vocabulário ────────────────────────────────────────────────────────────────────────────────

/** Os protocolos gerenciados da ficha (o código é o mesmo que o discriminador da classificação sugere). */
export const TIPOS_PROTOCOLO_GERENCIADO = [
  { codigo: 'sepse', rotulo: 'Sepse' },
  { codigo: 'dor-toracica', rotulo: 'Dor torácica' },
  { codigo: 'avc', rotulo: 'AVC' },
  { codigo: 'trauma', rotulo: 'Trauma' },
  // W0-03 (mercado M3): o protocolo de tromboembolismo venoso do paciente internado (também disponível ao PA).
  { codigo: 'tev', rotulo: 'TEV (tromboembolismo venoso)' },
] as const;
export type TipoProtocoloGerenciado = (typeof TIPOS_PROTOCOLO_GERENCIADO)[number]['codigo'];
export const CODIGOS_TIPO_GERENCIADO = TIPOS_PROTOCOLO_GERENCIADO.map((t) => t.codigo) as [
  TipoProtocoloGerenciado,
  ...TipoProtocoloGerenciado[],
];

/** Quem incluiu o paciente no protocolo (regra 8). */
export const ORIGENS_INCLUSAO_PROTOCOLO = [
  { codigo: 'enfermeiro', rotulo: 'Incluído pelo enfermeiro' },
  { codigo: 'medico', rotulo: 'Incluído pelo médico' },
  { codigo: 'sugerido', rotulo: 'Sugerido pela classificação de risco' },
] as const;
export type OrigemInclusaoProtocolo = (typeof ORIGENS_INCLUSAO_PROTOCOLO)[number]['codigo'];
export const CODIGOS_ORIGEM_INCLUSAO = ORIGENS_INCLUSAO_PROTOCOLO.map((o) => o.codigo) as [
  OrigemInclusaoProtocolo,
  ...OrigemInclusaoProtocolo[],
];

/** De onde corre o prazo da meta: da chegada ao PA (porta → ECG) ou da inclusão no protocolo (tempo zero). */
export const REFERENCIAS_META = ['chegada', 'inclusao'] as const;
export type ReferenciaMeta = (typeof REFERENCIAS_META)[number];

/** Situação de uma meta no relógio (a tela mostra com o nome escrito, nunca só a cor). */
export const SITUACOES_META_PROTOCOLO = [
  { codigo: 'no_prazo', rotulo: 'No prazo' },
  { codigo: 'vencendo', rotulo: 'Vencendo' },
  { codigo: 'vencida', rotulo: 'Prazo vencido, sem registro' },
  { codigo: 'cumprida', rotulo: 'Cumprida' },
  { codigo: 'perdida', rotulo: 'Perdida (com o motivo)' },
] as const;
export type SituacaoMetaProtocolo = (typeof SITUACOES_META_PROTOCOLO)[number]['codigo'];

/** Como termina o protocolo do paciente (o relógio para). */
export const DESFECHOS_PROTOCOLO = [
  { codigo: 'concluido', rotulo: 'Protocolo concluído' },
  { codigo: 'descartado', rotulo: 'Critério não confirmado (descartado)' },
  { codigo: 'transferido', rotulo: 'Paciente transferido ou internado' },
  { codigo: 'obito', rotulo: 'Óbito' },
] as const;
export type DesfechoProtocolo = (typeof DESFECHOS_PROTOCOLO)[number]['codigo'];
export const CODIGOS_DESFECHO_PROTOCOLO = DESFECHOS_PROTOCOLO.map((d) => d.codigo) as [
  DesfechoProtocolo,
  ...DesfechoProtocolo[],
];

/** Minutos antes do prazo em que a meta passa a "vencendo" (o relógio avisa). */
export const AVISO_META_MIN = 5;

// ── Definição (recepcao.publicarProtocoloGerenciado) ─────────────────────────────────────────────

const codigo = z
  .string()
  .trim()
  .regex(/^[a-z][a-z0-9-]{1,39}$/, 'Código em minúsculas, sem espaço (letras, números e hífen).');
const id = z.number().int().positive().max(2_147_483_647);

export const esquemaCriterioGerenciado = z
  .object({ codigo, titulo: textoCp1252(160).pipe(z.string().min(3)) })
  .strict();

export const esquemaMetaGerenciada = z
  .object({
    codigo,
    titulo: textoCp1252(120).pipe(z.string().min(3)),
    /** Prazo em minutos a partir da referência (ECG da dor torácica: 10 da chegada). */
    prazoMin: z.number().int().min(1).max(1_440),
    desde: z.enum(REFERENCIAS_META),
  })
  .strict();
export type MetaGerenciada = z.infer<typeof esquemaMetaGerenciada>;

export const esquemaItemChecklistGerenciado = z
  .object({ codigo, titulo: textoCp1252(160).pipe(z.string().min(3)) })
  .strict();

/** O conteúdo de uma versão da definição (o que a publicação congela). */
export const esquemaConteudoGerenciado = z
  .object({
    tipo: z.enum(CODIGOS_TIPO_GERENCIADO),
    nome: textoCp1252(80).pipe(z.string().min(3)),
    /** Critérios de inclusão (o que a equipe confere ao incluir; nenhum vira regra automática). */
    criterios: z.array(esquemaCriterioGerenciado).min(1).max(20),
    metas: z.array(esquemaMetaGerenciada).min(1).max(12),
    checklist: z.array(esquemaItemChecklistGerenciado).max(30).default([]),
  })
  .strict();
export type ConteudoGerenciado = z.infer<typeof esquemaConteudoGerenciado>;

export const esquemaPublicarProtocoloGerenciado = z
  .object({
    /** Quem redigiu (login): a sessão é a do aprovador (diretoria clínica); autor ≠ aprovador (como a classificação). */
    autor: z.string().trim().min(2).max(31),
    conteudo: esquemaConteudoGerenciado,
    notas: textoCp1252(1_000).pipe(z.string().min(3)),
    /** Reautenticação (permissão crítica). */
    senha: z.string().min(1).max(128),
  })
  .strict();
export type PublicarProtocoloGerenciadoEntrada = z.infer<typeof esquemaPublicarProtocoloGerenciado>;

// ── Inclusão, metas e encerramento (iniciar, registrarMeta, encerrar) ─────────────────────────────

const motivo = textoCp1252(300).pipe(z.string().trim().min(5, 'Escreva o motivo (5 caracteres ou mais).'));
/** Hora real local (AAAA-MM-DDTHH:mm), conferida no servidor: nunca no futuro nem antes da referência. */
const horaLocal = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/, 'Hora no formato AAAA-MM-DDTHH:mm.');

export const esquemaIniciarProtocoloGerenciado = z
  .object({
    /** Número do atendimento do PA (RECADATE.REG). */
    atendimento: id,
    tipo: z.enum(CODIGOS_TIPO_GERENCIADO),
    /** A versão vigente vista na tela (a inclusão a guarda; colisão se outra foi publicada no meio). */
    versao: id,
    /** Sugerido: o discriminador da classificação que sugeriu (a sessão ainda é de enfermeiro ou médico). */
    sugeridoPor: codigo.nullable().default(null),
    /** Critérios conferidos na inclusão (ao menos um). */
    criterios: z.array(codigo).min(1).max(20),
  })
  .strict();
export type IniciarProtocoloGerenciadoEntrada = z.infer<typeof esquemaIniciarProtocoloGerenciado>;

export const esquemaRegistrarMetaProtocolo = z
  .object({
    /** A meta (código da definição) ou o item do checklist. */
    item: codigo,
    tipo: z.enum(['meta', 'checklist']),
    /** Feita (na hora informada) ou não feita (perdida). */
    feita: z.boolean(),
    /** Quando foi feita (hora real); obrigatória quando feita. */
    quando: horaLocal.nullable().default(null),
    /** Obrigatório quando a meta fica perdida (não feita ou feita depois do prazo; regra 8). */
    motivo: motivo.nullable().default(null),
  })
  .strict()
  .superRefine((v, ctx) => {
    if (v.feita && !v.quando)
      ctx.addIssue({ code: 'custom', path: ['quando'], message: 'Informe quando foi feito.' });
  });
export type RegistrarMetaProtocoloEntrada = z.infer<typeof esquemaRegistrarMetaProtocolo>;

export const esquemaEncerrarProtocoloGerenciado = z
  .object({
    desfecho: z.enum(CODIGOS_DESFECHO_PROTOCOLO),
    /** Obrigatório no descarte e quando há meta sem registro (o que aconteceu). */
    motivo: motivo.nullable().default(null),
  })
  .strict();
export type EncerrarProtocoloGerenciadoEntrada = z.infer<typeof esquemaEncerrarProtocoloGerenciado>;

// ── Respostas ──────────────────────────────────────────────────────────────────────────────────

const txt = z.string();
const n = z.number();

export const esquemaVersaoGerenciadoResumo = z.object({
  id: n,
  tipo: z.enum(CODIGOS_TIPO_GERENCIADO),
  versao: n,
  nome: txt,
  autor: txt,
  aprovador: txt,
  publicadoEm: txt,
  impressao: txt,
  vigente: z.boolean(),
});
export type VersaoGerenciadoResumo = z.infer<typeof esquemaVersaoGerenciadoResumo>;

export const esquemaGerenciadoComConteudo = z.object({
  versao: esquemaVersaoGerenciadoResumo,
  conteudo: esquemaConteudoGerenciado,
  notas: txt,
});
export type GerenciadoComConteudo = z.infer<typeof esquemaGerenciadoComConteudo>;

export const esquemaMetaNoRelogio = z.object({
  codigo: txt,
  titulo: txt,
  tipo: z.enum(['meta', 'checklist']),
  /** Prazo (ISO local); null no checklist. */
  prazoEm: txt.nullable(),
  /** Minutos até o prazo (negativo: vencido); null no checklist e na meta registrada. */
  minutosRestantes: n.nullable(),
  situacao: z.enum(['no_prazo', 'vencendo', 'vencida', 'cumprida', 'perdida', 'pendente', 'feito']),
  registradoEm: txt.nullable(),
  quando: txt.nullable(),
  motivo: txt.nullable(),
  por: txt.nullable(),
});
export type MetaNoRelogio = z.infer<typeof esquemaMetaNoRelogio>;

export const esquemaProtocoloDoPaciente = z.object({
  id: n,
  reg: n,
  paciente: txt,
  senha: txt.nullable(),
  tipo: z.enum(CODIGOS_TIPO_GERENCIADO),
  nomeTipo: txt,
  versao: n,
  origem: z.enum(CODIGOS_ORIGEM_INCLUSAO),
  sugeridoPor: txt.nullable(),
  criterios: z.array(txt),
  chegadaEm: txt,
  incluidoEm: txt,
  incluidoPor: txt,
  /** Minutos desde a inclusão (o relógio). */
  minutosDesdeInclusao: n,
  metas: z.array(esquemaMetaNoRelogio),
  /** A meta pendente mais próxima do prazo (o chip do quadro do PA). */
  proxima: z.object({ titulo: txt, minutosRestantes: n, situacao: txt }).nullable(),
  atrasadas: n,
  encerrado: z
    .object({ desfecho: z.enum(CODIGOS_DESFECHO_PROTOCOLO), em: txt, por: txt, motivo: txt.nullable() })
    .nullable(),
});
export type ProtocoloDoPaciente = z.infer<typeof esquemaProtocoloDoPaciente>;

/** Atendimento com protocolo sugerido pela classificação e ainda não incluído (a tela oferece incluir). */
export const esquemaSugestaoProtocolo = z.object({
  reg: n,
  paciente: txt,
  senha: txt.nullable(),
  tipo: z.enum(CODIGOS_TIPO_GERENCIADO),
  nomeTipo: txt,
  discriminador: txt,
  tituloDiscriminador: txt,
  classificadoEm: txt,
});
export type SugestaoProtocolo = z.infer<typeof esquemaSugestaoProtocolo>;

/** Adesão às metas no período (cada uma com numerador e denominador; o painel do NSP é do M48). */
export const esquemaAdesaoMeta = z.object({
  tipo: z.enum(CODIGOS_TIPO_GERENCIADO),
  meta: txt,
  titulo: txt,
  cumpridas: n,
  registradas: n,
  percentual: n.nullable(),
});
export type AdesaoMeta = z.infer<typeof esquemaAdesaoMeta>;

/** Teto de inclusões lidas no período da adesão (revisão do M44.3); acima dele, `adesaoPeriodo.truncado`. */
export const TETO_PROTOCOLOS_DO_PERIODO = 5_000;

export const esquemaRelogioProtocolos = z.object({
  ativos: z.array(esquemaProtocoloDoPaciente),
  encerradosHoje: z.array(esquemaProtocoloDoPaciente),
  sugestoes: z.array(esquemaSugestaoProtocolo),
  /** Os atendimentos abertos do PA que podem ser incluídos (a escolha na tela). */
  atendimentos: z.array(z.object({ reg: n, paciente: txt, senha: txt.nullable(), chegada: txt })),
  vigentes: z.array(esquemaGerenciadoComConteudo),
  adesao: z.array(esquemaAdesaoMeta),
  /**
   * O universo da adesão: o início efetivo (o dos 30 dias, ou o da inclusão mais antiga lida quando o teto cortou), as
   * inclusões contadas e se o período foi cortado (revisão do M44.3: o corte não fica escondido).
   */
  adesaoPeriodo: z.object({ desde: txt, inclusoes: n, truncado: z.boolean() }),
  acoes: z.object({ iniciar: z.boolean(), registrar: z.boolean(), motivo: txt.nullable() }),
  liberada: z.boolean(),
  motivoLiberacao: txt.nullable(),
  lidoEm: txt,
});
export type RelogioProtocolos = z.infer<typeof esquemaRelogioProtocolos>;

/** O chip do protocolo no cartão do quadro do PA (ficha, seção 4: o quadro lê SGH_PA_PROTOC_PACIENTE). */
export const esquemaProtocoloNoQuadro = z.object({
  tipo: z.enum(CODIGOS_TIPO_GERENCIADO),
  nomeTipo: txt,
  proxima: z.object({ titulo: txt, minutosRestantes: n, situacao: txt }).nullable(),
  atrasadas: n,
});
export type ProtocoloNoQuadro = z.infer<typeof esquemaProtocoloNoQuadro>;

export const esquemaResultadoProtocoloGerenciado = z.object({ id: n, mensagem: txt, avisos: z.array(txt) });
export type ResultadoProtocoloGerenciado = z.infer<typeof esquemaResultadoProtocoloGerenciado>;
