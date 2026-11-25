// Prescrição eletrônica (CPOE) (M24; ficha, seções 4, 5, 7 e 8; cap-11 §11.2; cap-05b §5.7). O contrato é o que
// a tela e a API trocam: os itens por tipo (medicamento, solução, dieta, cuidado, glicemia, ventilação,
// hemoterapia), a frequência, os horários previstos, os alertas de apoio à decisão com a decisão do prescritor, a
// prescrição gravada e as listas (prescrições do atendimento, protocolos e kits, prescrição futura, reconciliação,
// fichas de antimicrobiano). Sem nome de tabela nem de coluna do legado (fronteira): os códigos de domínio (tipo do
// item, frequência, via, unidade) são os do cadastro do estabelecimento, exibidos pelo nome.
import { z } from 'zod';
import { textoCp1252 } from '../texto-cp1252.js';

// ── Tipos de item e quem prescreve ───────────────────────────────────────────────────────────────────

/**
 * Tipos de item oferecidos (os usados em 2026 na cópia: 11 dos 19 tipos do cadastro). Os demais (dieta parenteral,
 * nível de atividade, oxigênio em respiração espontânea, sinais vitais, item avulso de balanço, nome comercial,
 * produtos de leite e o item não padronizado como tipo próprio) aparecem só em consulta.
 */
export const TIPOS_ITEM_PRESCRICAO = [
  'medicamento',
  'solucao',
  'jejum',
  'dieta-livre',
  'dieta-oral',
  'dieta-enteral',
  'procedimento',
  'glicemia',
  'vni',
  'vmi',
  'hemoterapia',
] as const;
export type TipoItemPrescricao = (typeof TIPOS_ITEM_PRESCRICAO)[number];

/** Grupo do editor (abas): o grupo "hemoterapia" é a aba própria da ficha. */
export const GRUPOS_ITEM_PRESCRICAO = [
  'medicamentos',
  'solucoes',
  'dietas',
  'cuidados',
  'oxigenio',
  'hemoterapia',
] as const;
export type GrupoItemPrescricao = (typeof GRUPOS_ITEM_PRESCRICAO)[number];

export const GRUPO_DO_TIPO: Readonly<Record<TipoItemPrescricao, GrupoItemPrescricao>> = {
  medicamento: 'medicamentos',
  solucao: 'solucoes',
  jejum: 'dietas',
  'dieta-livre': 'dietas',
  'dieta-oral': 'dietas',
  'dieta-enteral': 'dietas',
  procedimento: 'cuidados',
  glicemia: 'cuidados',
  vni: 'oxigenio',
  vmi: 'oxigenio',
  hemoterapia: 'hemoterapia',
};

/**
 * POL-3: os tipos de item que a inclusão numa prescrição já assinada (adendo, pep.incluirItem) e a correção do item
 * (pep.suspenderItem) gravam com a receita completa; os demais são recusados antes de gravar (`tipo-nao-liberado`)
 * e a tela não os oferece. "Se necessário" só no medicamento do adendo.
 */
export const TIPOS_ADENDO: readonly TipoItemPrescricao[] = [
  'medicamento',
  'jejum',
  'dieta-livre',
  'dieta-oral',
  'dieta-enteral',
  'procedimento',
];
export const TIPOS_CORRECAO: readonly TipoItemPrescricao[] = ['medicamento', 'procedimento'];
export const SE_NECESSARIO_ADENDO: readonly TipoItemPrescricao[] = ['medicamento'];

export const ROTULOS_TIPO_ITEM: Readonly<Record<TipoItemPrescricao, string>> = {
  medicamento: 'Medicamento',
  solucao: 'Solução',
  jejum: 'Jejum',
  'dieta-livre': 'Dieta livre',
  'dieta-oral': 'Dieta oral',
  'dieta-enteral': 'Dieta enteral',
  procedimento: 'Cuidado ou procedimento',
  glicemia: 'Glicemia capilar com escala',
  vni: 'Ventilação não invasiva',
  vmi: 'Ventilação mecânica invasiva',
  hemoterapia: 'Hemoterapia',
};

/** Categoria de quem prescreve (regra 10; cap-08 §8.4), pelo CBO do profissional da sessão. */
export const CATEGORIAS_PRESCRITOR = [
  'medico',
  'residente',
  'nutricionista',
  'dentista',
  'enfermeiro',
  'outro',
] as const;
export type CategoriaPrescritor = (typeof CATEGORIAS_PRESCRITOR)[number];

/** Código do tipo de lançamento do cadastro do legado para cada tipo oferecido (tipo de item da prescrição; os 11 usados em 2026). */
export const PLANO_DO_TIPO: Readonly<Record<TipoItemPrescricao, number>> = {
  jejum: 1,
  'dieta-livre': 2,
  'dieta-oral': 3,
  'dieta-enteral': 4,
  medicamento: 6,
  solucao: 7,
  hemoterapia: 8,
  vni: 11,
  vmi: 12,
  procedimento: 13,
  glicemia: 14,
};

export function tipoDoPlano(plano: number): TipoItemPrescricao | null {
  for (const [t, p] of Object.entries(PLANO_DO_TIPO)) if (p === plano) return t as TipoItemPrescricao;
  return null;
}

export const TIPOS_DIETA: readonly TipoItemPrescricao[] = [
  'jejum',
  'dieta-livre',
  'dieta-oral',
  'dieta-enteral',
];
export const ehDieta = (t: TipoItemPrescricao): boolean => TIPOS_DIETA.includes(t);

/**
 * Categoria pelo código CBO da ocupação: médicos 2251, 2252 e 2253; médico residente 2231 (CBO 2231-F9);
 * cirurgião-dentista 2232; nutricionista 2237; enfermeiro 2235. As demais não prescrevem na CPOE. Medido na cópia
 * (2026): 225125 em 11.027 prescrições, 223710 (nutricionista) em 2.120 (só dieta oral e enteral), 223268
 * (cirurgião-dentista bucomaxilofacial) em 11 (medicamento, cuidado, solução, dieta oral e jejum).
 */
export function categoriaPorOcupacao(cbo: string | null | undefined): CategoriaPrescritor {
  const c = (cbo ?? '').replace(/[^0-9A-Za-z]/g, '');
  if (c.startsWith('2231')) return 'residente';
  if (/^225[123]/.test(c)) return 'medico';
  if (c.startsWith('2232')) return 'dentista';
  if (c.startsWith('2237')) return 'nutricionista';
  if (c.startsWith('2235')) return 'enfermeiro';
  return 'outro';
}

const DO_DENTISTA: readonly TipoItemPrescricao[] = [
  'medicamento',
  'solucao',
  'procedimento',
  'jejum',
  'dieta-oral',
];

/**
 * Quem prescreve o quê (regra 10): médico e residente todos; nutricionista só dieta e jejum; dentista no escopo;
 * enfermeiro só o cuidado de enfermagem (M45, etapa 4).
 */
export function podePrescrever(categoria: CategoriaPrescritor, tipo: TipoItemPrescricao): boolean {
  switch (categoria) {
    case 'medico':
    case 'residente':
      return true;
    case 'nutricionista':
      return ehDieta(tipo);
    case 'dentista':
      return DO_DENTISTA.includes(tipo);
    // M45 (etapa 4; ficha, seção 5, cenário condicional): o perfil da cópia mostra o enfermeiro como autor de prescrição
    // com cuidado de enfermagem (procedimento do cadastro de enfermagem); só esse tipo (COFEN 736/2024: a prescrição de
    // enfermagem; medicamento pelo enfermeiro é a receita própria da COFEN 801/2026).
    case 'enfermeiro':
      return tipo === 'procedimento';
    default:
      return false;
  }
}

/** O mesmo pela código do tipo de lançamento (o adaptador confere no estado relido). */
export function planoPermitido(categoria: CategoriaPrescritor, plano: number): boolean {
  const t = tipoDoPlano(plano);
  return t !== null && podePrescrever(categoria, t);
}

export const exigeCoassinatura = (c: CategoriaPrescritor): boolean => c === 'residente';

// ── Frequência ───────────────────────────────────────────────────────────────────────────────────────

/** Natureza da frequência (tipos fechados que cobrem as frequências usadas em 2026, inclusive "sem frequência"). */
export const NATUREZAS_FREQUENCIA = [
  'intervalo',
  'unica',
  'continua',
  'acm',
  'acm-continua',
  'relativa',
  'livre-demanda',
  'outras',
  'sem',
] as const;
export type NaturezaFrequencia = (typeof NATUREZAS_FREQUENCIA)[number];

export const esquemaFrequencia = z.object({
  id: z.number().int().positive(),
  nome: z.string(),
  natureza: z.enum(NATUREZAS_FREQUENCIA),
  /** Doses no período de 24 h (o que o cadastro diz; null nas que dependem do prescritor). */
  doses: z.number().int().nullable(),
  intervaloHoras: z.number().nullable(),
});
export type Frequencia = z.infer<typeof esquemaFrequencia>;

// ── Itens (entrada) ──────────────────────────────────────────────────────────────────────────────────

const ID = z.number().int().positive();
const QUANTIDADE = z.number().positive().max(1_000_000);
/** Unidade de consumo do cadastro (código de até 10 letras). */
const UNIDADE = z.string().trim().min(1).max(10);
/** Via de administração do cadastro (código de até 10 letras). */
const VIA = z.string().trim().min(1).max(10);
const HORA_DO_DIA = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);

/** Produto do cadastro de materiais e medicamentos (o item padronizado do estabelecimento). */
export const esquemaProdutoPrescrito = z.object({
  produto: ID,
  /** Item fora da lista de padronizados: exige justificativa e CID (como hoje). */
  naoPadronizado: z
    .object({ justificativa: textoCp1252(500).pipe(z.string().min(10)), cid: z.string().max(10) })
    .optional(),
});

export const esquemaMedicamento = z.object({
  tipo: z.literal('medicamento'),
  item: esquemaProdutoPrescrito,
  dose: QUANTIDADE,
  unidade: UNIDADE,
  via: VIA,
  frequencia: ID.nullable(),
  /** Horários relativos às refeições (frequência relativa). */
  relativos: z.array(ID).max(13).default([]),
  /** "Se necessário": condição objetiva (motivos do cadastro) e intervalo mínimo em horas (regra 9). */
  seNecessario: z
    .object({
      motivos: z.array(ID).min(1).max(5),
      intervaloMinimoHoras: z.number().positive().max(48),
      /** Dose máxima no período (horas), opcional. */
      doseMaxima: z.object({ dose: QUANTIDADE, periodoHoras: z.number().int().min(1).max(72) }).optional(),
    })
    .optional(),
  iniciarAgora: z.boolean().default(false),
  /** A enfermagem não ajusta o esquema de horários. */
  naoAjustar: z.boolean().default(false),
  tempoInfusaoMinutos: z.number().int().positive().max(1_440).optional(),
  /** Primeiro horário escolhido (desloca a grade pelo intervalo). */
  primeiroHorario: HORA_DO_DIA.optional(),
});

export const esquemaComponenteSolucao = z.object({
  produto: ID,
  dose: QUANTIDADE,
  unidade: UNIDADE,
  principal: z.boolean(),
  /** Etapa do esquema em que o componente entra (ausente: a primeira). */
  etapa: z.number().int().min(1).max(24).optional(),
});

export const esquemaSolucao = z.object({
  tipo: z.literal('solucao'),
  via: VIA,
  frequencia: ID.nullable(),
  volumeTotal: QUANTIDADE.optional(),
  unidade: UNIDADE.optional(),
  tipoInfusao: ID.optional(),
  componentes: z.array(esquemaComponenteSolucao).min(1).max(20),
  /** Etapas com a velocidade de infusão (derivada do volume e do tempo, quando calculada). */
  etapas: z
    .array(z.object({ etapa: z.number().int().min(1).max(24), velocidade: QUANTIDADE, unidadeInfusao: ID }))
    .min(1)
    .max(24),
  iniciarAgora: z.boolean().default(false),
  naoAjustar: z.boolean().default(false),
});

const esquemaDietaBase = {
  dieta: ID,
  frequencia: ID.nullable(),
  via: VIA.optional(),
  caracteristicas: z
    .array(z.object({ caracteristica: ID, resposta: textoCp1252(100).optional() }))
    .max(20)
    .default([]),
  /**
   * Composição por refeição do dia (03-PEP L112): em cada refeição (horário de refeição do estabelecimento), o
   * alimento, a quantidade, a medida caseira e o substituto (posição 1..n do titular anterior da mesma refeição). Só a
   * dieta oral e a livre têm refeições; a coerência é do domínio (conferirRefeicoesDieta).
   */
  refeicoes: z
    .array(
      z.object({
        refeicao: ID,
        alimento: ID,
        quantidade: QUANTIDADE,
        unidade: ID.nullable().default(null),
        medidaCaseira: ID.nullable().default(null),
        quantidadeMedidaCaseira: QUANTIDADE.nullable().default(null),
        substitui: z.number().int().min(1).max(60).nullable().default(null),
        percentualDiario: z.number().min(0).max(100).nullable().default(null),
        calorias: z.number().min(0).max(20_000).nullable().default(null),
      }),
    )
    .max(60)
    .default([]),
};

export const esquemaDieta = z.discriminatedUnion('tipo', [
  z.object({ tipo: z.literal('jejum'), ...esquemaDietaBase }),
  z.object({ tipo: z.literal('dieta-livre'), ...esquemaDietaBase }),
  z.object({ tipo: z.literal('dieta-oral'), ...esquemaDietaBase, quantidade: QUANTIDADE }),
  z.object({
    tipo: z.literal('dieta-enteral'),
    ...esquemaDietaBase,
    viaDieta: ID,
    quantidade: QUANTIDADE,
    unidade: UNIDADE,
    tipoInfusao: ID,
    velocidade: QUANTIDADE.optional(),
    unidadeInfusao: ID.optional(),
  }),
]);

export const esquemaProcedimento = z.object({
  tipo: z.literal('procedimento'),
  /** Cuidado ou procedimento de enfermagem do cadastro. */
  procedimento: ID,
  frequencia: ID.nullable(),
  relativos: z.array(ID).max(13).default([]),
  seNecessario: z
    .object({ motivos: z.array(ID).min(1).max(5), intervaloMinimoHoras: z.number().positive().max(48) })
    .optional(),
  iniciarAgora: z.boolean().default(false),
  naoAjustar: z.boolean().default(false),
  primeiroHorario: HORA_DO_DIA.optional(),
});

/** Escala de insulina: faixas de glicemia com a dose do produto. */
export const esquemaGlicemia = z.object({
  tipo: z.literal('glicemia'),
  procedimento: ID,
  frequencia: ID.nullable(),
  faixas: z
    .array(
      z.object({
        de: z.number().int().min(0).max(1_000),
        ate: z.number().int().min(0).max(1_000),
        produto: ID,
        dose: QUANTIDADE,
        unidade: UNIDADE,
        via: VIA,
      }),
    )
    .min(1)
    .max(12),
  iniciarAgora: z.boolean().default(false),
  naoAjustar: z.boolean().default(false),
});

export const esquemaVentilacao = z.object({
  tipo: z.enum(['vni', 'vmi']),
  viaAerea: ID,
  modo: ID,
  frequencia: ID.nullable(),
  fio2: z.number().min(21).max(100).optional(),
  /** VNI: pressões inspiratória e expiratória; VMI: PEEP, volume corrente e frequência respiratória. */
  pressaoInspiratoria: z.number().min(0).max(80).optional(),
  pressaoExpiratoria: z.number().min(0).max(40).optional(),
  peep: z.number().min(0).max(40).optional(),
  volumeCorrente: z.number().min(0).max(3_000).optional(),
  frequenciaRespiratoria: z.number().int().min(0).max(80).optional(),
  /** VMI: tempos inspiratório e expiratório (s); VNI: pressão de suporte e duração da sessão (min). */
  tempoInspiratorio: z.number().positive().max(10).optional(),
  tempoExpiratorio: z.number().positive().max(10).optional(),
  pressaoSuporte: z.number().min(0).max(40).optional(),
  duracaoMinutos: z.number().int().positive().max(1_440).optional(),
});

export const esquemaHemoterapia = z.object({
  tipo: z.literal('hemoterapia'),
  /** Hemocomponente prescritível (procedimento do cadastro). */
  hemocomponente: z.object({ ato: z.number().int().min(0), codigo: z.string().trim().min(1).max(20) }),
  dose: QUANTIDADE,
  unidade: UNIDADE,
  frequencia: ID.nullable(),
  indicacao: textoCp1252(2_000).pipe(z.string().min(10)),
  velocidade: QUANTIDADE.optional(),
  unidadeInfusao: ID.optional(),
  iniciarAgora: z.boolean().default(false),
});

export const esquemaDetalheItem = z.union([
  esquemaMedicamento,
  esquemaSolucao,
  esquemaDieta,
  esquemaProcedimento,
  esquemaGlicemia,
  esquemaVentilacao,
  esquemaHemoterapia,
]);
export type DetalheItem = z.infer<typeof esquemaDetalheItem>;

/** Decisão do prescritor diante de um alerta (registro de apoio à decisão; regra 6). */
export const esquemaDecisaoAlerta = z.object({
  alerta: z.string().min(1).max(120),
  decisao: z.enum(['mantido', 'retirado']),
  justificativa: textoCp1252(500).optional(),
});
export type DecisaoAlerta = z.infer<typeof esquemaDecisaoAlerta>;

export const esquemaItemPrescricao = z.object({
  /** Identificador do item na tela (as decisões de alerta apontam para ele). */
  chave: z.string().min(1).max(40),
  detalhe: esquemaDetalheItem,
  /** Nota para a enfermagem (vai para a checagem). */
  observacaoEnfermagem: textoCp1252(2_000).optional(),
  /** Item vindo de protocolo ou kit (vínculo do protocolo só para indicador; regra 2). */
  protocolo: ID.optional(),
  /** Campos preenchidos automaticamente (protocolo ou kit): a marca do legado. */
  autopreenchido: z
    .array(z.enum(['dose', 'quantidade-itens', 'etapa']))
    .max(3)
    .default([]),
  /** Na cópia ou renovação: o item de origem e se foi mantido igual (classe de cópia) ou alterado. */
  origem: z.object({ item: ID, alterado: z.boolean() }).optional(),
  /** Peso, altura e clearance usados no cálculo de dose (com a data do dado). */
  calculo: z
    .object({
      regra: z.enum(['por-kg', 'por-m2', 'por-clearance', 'fixa']),
      peso: z.number().positive().max(500).optional(),
      altura: z.number().positive().max(250).optional(),
      clearance: z.number().positive().max(250).optional(),
      dataDado: z.string().max(19).optional(),
      dosePorUnidade: z.number().positive().optional(),
    })
    .optional(),
  decisoes: z.array(esquemaDecisaoAlerta).max(20).default([]),
  /** Ficha de antimicrobiano (indicação, sítio, empírico ou dirigido, cultura, dia de tratamento). */
  antimicrobiano: z
    .object({
      indicacao: textoCp1252(500).pipe(z.string().min(3)),
      sitio: textoCp1252(100).pipe(z.string().min(2)),
      tipo: z.enum(['empirico', 'dirigido', 'profilatico']),
      culturaColhida: z.boolean(),
      diaTratamento: z.number().int().min(1).max(180),
      duracaoPrevistaDias: z.number().int().min(1).max(180).optional(),
    })
    .optional(),
});
export type ItemPrescricao = z.infer<typeof esquemaItemPrescricao>;

// ── Prescrever, copiar, renovar ──────────────────────────────────────────────────────────────────────

const HORA_LOCAL = z.string().regex(/^\d{4}-\d{2}-\d{2}T([01]\d|2[0-3]):[0-5]\d$/);

export const PERIODOS_PRESCRICAO = ['atual', 'seguinte'] as const;
export type PeriodoPrescricao = (typeof PERIODOS_PRESCRICAO)[number];

export const PRIORIDADES_PRESCRICAO = ['rotina', 'urgente'] as const;

export const esquemaPrescrever = z
  .object({
    paciente: ID,
    atendimento: ID,
    /** Período de vigência (o atual ou o seguinte, pela regra do horário de medicação da unidade). */
    periodo: z.enum(PERIODOS_PRESCRICAO),
    /** Horário clínico da prescrição (hora local do estabelecimento). */
    dataHora: HORA_LOCAL,
    justificativaRetroativo: textoCp1252(255).optional(),
    observacaoGeral: textoCp1252(4_000).optional(),
    prioridade: z.enum(PRIORIDADES_PRESCRICAO).default('rotina'),
    itens: z.array(esquemaItemPrescricao).min(1).max(150),
    /** Cópia ou renovação: a prescrição de origem, relida e conferida na gravação. */
    origem: z.object({ prescricao: ID, modo: z.enum(['copia', 'renovacao']) }).optional(),
    /** Prescrição futura efetivada nesta prescrição. */
    futuras: z.array(ID).max(50).default([]),
  })
  .strict();
export type PrescreverEntrada = z.infer<typeof esquemaPrescrever>;

export const esquemaIncluirItem = z
  .object({ prescricao: ID, dataHora: HORA_LOCAL, item: esquemaItemPrescricao })
  .strict();
export type IncluirItemEntrada = z.infer<typeof esquemaIncluirItem>;

export const esquemaSuspenderItem = z
  .object({
    senha: z.string().min(1).max(100),
    prescricao: ID,
    item: ID,
    justificativa: textoCp1252(255).pipe(z.string().min(10)),
    /** Correção: o item novo que substitui o suspenso ("suspenso por correção"). */
    correcao: esquemaItemPrescricao.optional(),
  })
  .strict();
export type SuspenderItemEntrada = z.infer<typeof esquemaSuspenderItem>;

export const esquemaSuspenderPrescricao = z
  .object({
    senha: z.string().min(1).max(100),
    prescricao: ID,
    justificativa: textoCp1252(255).pipe(z.string().min(10)),
  })
  .strict();
export type SuspenderPrescricaoEntrada = z.infer<typeof esquemaSuspenderPrescricao>;

export const esquemaCoassinarPrescricao = z
  .object({ senha: z.string().min(1).max(100), prescricao: ID })
  .strict();

// ── Alertas (apoio à decisão) ────────────────────────────────────────────────────────────────────────

export const TIPOS_ALERTA = [
  'alergia',
  'duplicidade',
  'dose-maxima',
  'dose-minima',
  'ajuste-renal',
  'interacao',
  'via-forma',
  'alto-alerta',
  'antimicrobiano',
  'controlado',
  'cobertura',
  'se-necessario',
  'dieta-de-outro',
  'categoria',
  'base-nao-contratada',
] as const;
export type TipoAlerta = (typeof TIPOS_ALERTA)[number];

/** Comportamento da regra (versionada): só avisa, bloqueia até justificar, ou bloqueia sem exceção. */
export const NIVEIS_ALERTA = ['aviso', 'justificar', 'bloqueio'] as const;
export type NivelAlerta = (typeof NIVEIS_ALERTA)[number];

export const esquemaAlertaPrescricao = z.object({
  /** Identificador estável do alerta no item (`tipo:detalhe`), a que a decisão se refere. */
  id: z.string(),
  item: z.string(),
  tipo: z.enum(TIPOS_ALERTA),
  nivel: z.enum(NIVEIS_ALERTA),
  titulo: z.string(),
  detalhe: z.string(),
  /** Regra que disparou e a versão (registro de apoio à decisão). */
  regra: z.string(),
  versaoRegra: z.number().int().positive(),
  /** Decisão já registrada para este alerta (na tela, a justificativa digitada). */
  decisao: esquemaDecisaoAlerta.nullable(),
  /** O item de outra prescrição a que o alerta se refere (a dieta ativa de outro profissional, para suspender). */
  referencia: z.object({ prescricao: ID, item: ID }).optional(),
});
export type AlertaPrescricao = z.infer<typeof esquemaAlertaPrescricao>;

export const esquemaVerificacao = z.object({
  alertas: z.array(esquemaAlertaPrescricao),
  /** Há alerta de bloqueio total ou de justificar sem justificativa: não assina. */
  impede: z.boolean(),
  /** Horários previstos de cada item (AAAA-MM-DDTHH:MM), pela grade da unidade. */
  horarios: z.record(z.string(), z.array(z.string())),
  vigencia: z.object({ inicio: z.string(), fim: z.string() }),
  baseInteracoes: z.enum(['contratada', 'nao-contratada']),
});
export type Verificacao = z.infer<typeof esquemaVerificacao>;

// ── Leitura ──────────────────────────────────────────────────────────────────────────────────────────

export const SITUACOES_ITEM = ['ativo', 'suspenso', 'suspenso-correcao', 'vencido'] as const;
export type SituacaoItem = (typeof SITUACOES_ITEM)[number];

export const SITUACOES_PRESCRICAO = ['vigente', 'futura', 'vencida', 'suspensa'] as const;
export type SituacaoPrescricao = (typeof SITUACOES_PRESCRICAO)[number];

export const esquemaHorarioItem = z.object({
  id: z.number().int(),
  dataHora: z.string(),
  /** Situação da checagem como o cadastro guarda (sensível a maiúsculas: P prescrito, p parcial…). */
  situacao: z.string(),
  rotulo: z.string(),
});

export const esquemaItemLido = z.object({
  id: z.number().int(),
  tipo: z.string(),
  tipoNome: z.string(),
  descricao: z.string(),
  dose: z.string().nullable(),
  via: z.string().nullable(),
  frequencia: z.string().nullable(),
  observacaoEnfermagem: z.string().nullable(),
  situacao: z.enum(SITUACOES_ITEM),
  incluidoDepois: z.boolean(),
  /** O item do cadastro (para alertas e para copiar). */
  produto: z.number().int().nullable(),
  principiosAtivos: z.array(z.number().int()),
  horarios: z.array(esquemaHorarioItem),
  /** Na suspensão por correção: o item que corrige. */
  corrigidoPor: z.number().int().nullable(),
  /** O detalhe como a tela de cópia pede de volta (quando o tipo é oferecido). */
  detalhe: esquemaDetalheItem.nullable(),
});
export type ItemLido = z.infer<typeof esquemaItemLido>;

export const esquemaPrescricaoResumo = z.object({
  id: z.number().int(),
  atendimento: z.number().int(),
  dataHora: z.string(),
  vigencia: z.object({ inicio: z.string(), fim: z.string() }),
  situacao: z.enum(SITUACOES_PRESCRICAO),
  prescritor: z.string(),
  itens: z.number().int(),
  /** Feita pelo novo (prova guardada) ou no outro sistema. */
  feitaNoNovo: z.boolean(),
  coassinaturaPendente: z.boolean(),
});
export type PrescricaoResumo = z.infer<typeof esquemaPrescricaoResumo>;

export const esquemaPrescricaoLida = esquemaPrescricaoResumo.extend({
  itensLidos: z.array(esquemaItemLido),
  observacaoGeral: z.string().nullable(),
  suspensao: z.object({ por: z.string(), em: z.string(), justificativa: z.string() }).nullable(),
  prova: z.enum(['confere', 'alterado', 'sem-prova']),
  alertasDecididos: z.array(
    z.object({
      item: z.number().int().nullable(),
      tipo: z.string(),
      decisao: z.string(),
      justificativa: z.string().nullable(),
    }),
  ),
});
export type PrescricaoLida = z.infer<typeof esquemaPrescricaoLida>;

export const esquemaPrescricaoGravada = z.object({
  prescricao: z.number().int(),
  vigencia: z.object({ inicio: z.string(), fim: z.string() }),
  itens: z.number().int(),
  horarios: z.number().int(),
});
export type PrescricaoGravada = z.infer<typeof esquemaPrescricaoGravada>;

/** Item encontrado na busca do editor (padronizado primeiro, princípio ativo e nome comercial). */
export const esquemaItemBuscado = z.object({
  produto: z.number().int(),
  nome: z.string(),
  unidade: z.string().nullable(),
  padronizado: z.boolean(),
  principiosAtivos: z.array(z.object({ id: z.number().int(), nome: z.string() })),
  altoAlerta: z.boolean(),
  controlado: z.boolean(),
  antimicrobiano: z.boolean(),
  doseMinima: z.number().nullable(),
  doseMaxima: z.number().nullable(),
});
export type ItemBuscado = z.infer<typeof esquemaItemBuscado>;

export const esquemaProtocoloResumo = z.object({
  id: z.number().int(),
  nome: z.string(),
  tipo: z.enum(['protocolo', 'kit-medicamento', 'kit-solucao']),
  itens: z.number().int(),
  aplicavel: z.boolean(),
  motivo: z.string().nullable(),
});
export type ProtocoloResumo = z.infer<typeof esquemaProtocoloResumo>;

// ── Cadastros de prescrição em consulta (kits, receitas padrão, itens não padronizados, parâmetros do item) ──

/**
 * Seções de consulta dos cadastros de prescrição que não cabem no CRUD genérico (o item de estoque é buscado, não
 * listado; a receita padrão tem vigência por versão): `parametrosItem` exige o termo de busca do item.
 */
export const SECOES_CADASTRO_PRESCRICAO = [
  'kitsMedicamento',
  'kitsSolucao',
  'receitasPadrao',
  'naoPadronizados',
  'parametrosItem',
] as const;
export type SecaoCadastroPrescricao = (typeof SECOES_CADASTRO_PRESCRICAO)[number];

const valorCadastro = z.union([z.string(), z.number(), z.boolean(), z.null()]);
export const esquemaLinhaCadastroPrescricao = z.object({
  id: z.string(),
  nome: z.string(),
  ativo: z.boolean(),
  /** Campos da linha por código (a tela traduz o rótulo). */
  campos: z.record(z.string(), valorCadastro),
  /** Itens do kit, componentes da solução, vias e princípios do item não padronizado. */
  filhos: z.array(z.object({ nome: z.string(), campos: z.record(z.string(), valorCadastro) })),
});
export type LinhaCadastroPrescricao = z.infer<typeof esquemaLinhaCadastroPrescricao>;
export const esquemaConsultaCadastroPrescricao = z.object({
  secao: z.enum(SECOES_CADASTRO_PRESCRICAO),
  linhas: z.array(esquemaLinhaCadastroPrescricao),
  /** Passou do teto (200 linhas): refinar a busca. */
  truncada: z.boolean(),
});
export type ConsultaCadastroPrescricao = z.infer<typeof esquemaConsultaCadastroPrescricao>;
export const esquemaTermoCadastroPrescricao = z
  .object({ termo: z.string().trim().max(60).optional() })
  .strict();

// ── Liberação, políticas e parâmetros ────────────────────────────────────────────────────────────────

/** Chave do recurso (POL-3; ficha, seção 12): por estabelecimento e setor; recolher = desligar. */
export const CHAVE_LIBERACAO_PRESCRICAO = 'pep.prescricao.cpoe';
/** Reconciliação e ficha de antimicrobiano só em SGH_: podem ser ligadas antes (ficha, seção 12). */
export const CHAVE_LIBERACAO_RECONCILIACAO = 'pep.reconciliacao.registro';
export const CHAVE_LIBERACAO_ANTIMICROBIANO = 'pep.antimicrobiano.ficha';

export const PARAMETRO_DUPLICIDADE_CRITERIO = 'pep.prescricao.duplicidadeCriterio';
export const PARAMETRO_ALTA_VIGILANCIA = 'pep.prescricao.altaVigilancia';
export const PARAMETRO_DUPLA_CHECAGEM = 'pep.prescricao.duplaChecagem';
export const PARAMETRO_DISPENSAR_APOS_VALIDAR = 'pep.prescricao.dispensarAposValidar';
export const PARAMETRO_BASE_INTERACOES = 'pep.prescricao.baseInteracoes';

// ── Prescrição futura, reconciliação e ficha de antimicrobiano (só no novo) ──────────────────────────

export const esquemaPrescricaoFutura = z
  .object({
    paciente: ID,
    atendimento: ID,
    /** Data em que o item entra na prescrição do dia (AAAA-MM-DD). */
    aPartirDe: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    item: esquemaItemPrescricao,
    motivo: textoCp1252(255).optional(),
  })
  .strict();
export type PrescricaoFuturaEntrada = z.infer<typeof esquemaPrescricaoFutura>;

export const esquemaFuturaLida = z.object({
  id: z.number().int(),
  aPartirDe: z.string(),
  descricao: z.string(),
  situacao: z.enum(['programada', 'efetivada', 'cancelada']),
  prescricao: z.number().int().nullable(),
  item: esquemaItemPrescricao,
});
export type FuturaLida = z.infer<typeof esquemaFuturaLida>;

export const MOMENTOS_RECONCILIACAO = ['admissao', 'alta'] as const;
export const CONDUTAS_RECONCILIACAO = ['manter', 'suspender', 'substituir', 'ajustar'] as const;

export const esquemaReconciliacao = z
  .object({
    paciente: ID,
    atendimento: ID,
    momento: z.enum(MOMENTOS_RECONCILIACAO),
    medicamentos: z
      .array(
        z.object({
          descricao: textoCp1252(200).pipe(z.string().min(2)),
          produto: ID.optional(),
          dose: textoCp1252(60).optional(),
          frequencia: textoCp1252(60).optional(),
          fonte: z.enum(['paciente', 'familiar', 'receita', 'prontuario', 'outro']),
          conduta: z.enum(CONDUTAS_RECONCILIACAO),
          justificativa: textoCp1252(255).optional(),
          /** Item da prescrição em que virou (quando mantido ou substituído). */
          itemPrescricao: ID.optional(),
        }),
      )
      .min(1)
      .max(60),
  })
  .strict();
export type ReconciliacaoEntrada = z.infer<typeof esquemaReconciliacao>;

export const esquemaReconciliacaoLida = z.object({
  id: z.number().int(),
  momento: z.enum(MOMENTOS_RECONCILIACAO),
  registradoEm: z.string(),
  registradoPor: z.string(),
  medicamentos: esquemaReconciliacao.shape.medicamentos,
});
export type ReconciliacaoLida = z.infer<typeof esquemaReconciliacaoLida>;

export const esquemaFichaAntimicrobiano = z.object({
  id: z.number().int(),
  paciente: z.number().int(),
  item: z.number().int().nullable(),
  produto: z.string(),
  indicacao: z.string(),
  sitio: z.string(),
  tipo: z.string(),
  culturaColhida: z.boolean(),
  diaTratamento: z.number().int(),
  registradaEm: z.string(),
  origem: z.enum(['novo', 'anterior']),
});
export type FichaAntimicrobiano = z.infer<typeof esquemaFichaAntimicrobiano>;

/** Mensagens das recusas da prescrição (Problem Details, em português). */
export const MENSAGENS_PRESCRICAO: Readonly<Record<string, string>> = {
  'outra-ativa-no-periodo':
    'Já existe prescrição ativa deste atendimento no período escolhido. Abra a prescrição vigente para incluir itens ou renove para o período seguinte.',
  'atendimento-fechado': 'O atendimento não está aberto: não é possível prescrever.',
  'categoria-nao-prescreve': 'A sua categoria profissional não prescreve este tipo de item.',
  'alerta-sem-justificativa':
    'Há alerta que exige justificativa: registre a justificativa ou retire o item antes de assinar.',
  'alerta-bloqueio': 'Há alerta de bloqueio total: retire o item para assinar.',
  'origem-alterada':
    'A prescrição de origem mudou depois que a tela foi aberta (item suspenso ou incluído): revise os itens antes de assinar.',
  'item-ja-checado': 'Horário já checado não muda: a suspensão fica pendente para a enfermagem.',
  'suspensao-incompleta':
    'A suspensão exige quem suspende, quando, o fuso, o horário de verão e a justificativa, juntos.',
  'prescricao-nao-vigente': 'A prescrição não está vigente (suspensa ou vencida).',
  'item-nao-ativo': 'O item não está ativo (já suspenso).',
  'periodo-ocupado': 'O período seguinte já tem prescrição ativa.',
};

// ── Marcadores do documento da trilha (o documento é montado antes da gravação; os IDs entram depois) ──

export const MARCADOR_PRESCRICAO = '{{PRESCRICAO}}';
export const MARCADOR_GRAVACAO = '{{GRAVACAO}}';
export const marcadorItem = (k: string): string => `{{ITEM:${k}}}`;
export const marcadorDetalhe = (k: string): string => `{{DETALHE:${k}}}`;
export const marcadorChecagem = (chave: string): string => `{{CHECAGEM:${chave}}}`;

/** Troca os marcadores pelos IDs gravados (o adaptador chama na mesma transação da gravação). */
export function preencherMarcadoresPrescricao(
  xml: string,
  ids: {
    readonly prescricao: number;
    readonly gravacao: string;
    readonly itens: ReadonlyMap<string, number>;
    readonly detalhes: ReadonlyMap<string, number>;
    readonly checagens: ReadonlyMap<string, number>;
  },
): string {
  return xml
    .split(MARCADOR_PRESCRICAO)
    .join(String(ids.prescricao))
    .split(MARCADOR_GRAVACAO)
    .join(ids.gravacao)
    .replace(/\{\{(ITEM|DETALHE|CHECAGEM):([^}]+)\}\}/g, (_m, tipo: string, chave: string) => {
      const mapa = tipo === 'ITEM' ? ids.itens : tipo === 'DETALHE' ? ids.detalhes : ids.checagens;
      const v = mapa.get(chave);
      if (v === undefined) throw new Error(`Marcador sem ID gravado: ${tipo}:${chave}`);
      return String(v);
    });
}

// ── Receita de alta (regra 15) ────────────────────────────────────────────────────────────────────────

/** Proposta das receitas da alta: uma por receituário (a emissão é a do receituário do prontuário, M23). */
export const esquemaReceitaAlta = z.object({
  atendimento: z.number().int(),
  receitas: z.array(
    z.object({
      chave: z.string(),
      tipo: z.enum(['simples', 'controle-especial', 'antimicrobiano']),
      receituario: z.string(),
      aviso: z.string().nullable(),
      itens: z.array(
        z.object({
          item: z.number().int(),
          medicamento: z.string(),
          via: z.string().nullable(),
          posologia: z.string(),
        }),
      ),
    }),
  ),
});
export type ReceitaAlta = z.infer<typeof esquemaReceitaAlta>;
