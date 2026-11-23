// Escores de enfermagem (M45, etapa 2; ficha, seções 5, 7 e 8, regras 1 a 4, 9 e 16; cap-05b §5.8; cap-11 §11.1): o
// vocabulário das escalas calculadas pelo sistema (NEWS2 a cada aferição, Braden, Morse, Glasgow, RASS, CAM-ICU e dor),
// as faixas versionadas, os gatilhos de conduta, a reavaliação programada de Braden e Morse, os cuidados preventivos e a
// classificação de pacientes por turno (Fugulin e NAS, COFEN 543/2017). O cálculo é do domínio (@sgh/dominio-enfermagem);
// aqui ficam os itens com os pontos (o mesmo para a tela, a API e o domínio) e as entradas e respostas das telas. Os
// itens são de domínio público (publicações originais); nenhum conteúdo licenciado. Nenhum nome de tabela nem do
// sistema anterior em texto visto pelo usuário (ADR 0023).
import { z } from 'zod';
import { textoCp1252 } from '../texto-cp1252.js';
import { TURNOS } from './vocabulario.js';
import {
  ESCALAS_TEV,
  ITENS_BRADEN_Q,
  ITENS_CAPRINI,
  ITENS_FLACC,
  ITENS_HUMPTY,
  ITENS_MEOWS,
  ITENS_NIPS,
  ITENS_PADUA,
  ITENS_PEWS,
  PERFIS_TEV,
  type DecisaoProfilaxia,
  type EscalaTev,
} from './escalas-mercado.js';
import { idBanco } from '../validacao/id-banco.js';

// ── Escalas ───────────────────────────────────────────────────────────────────────────────────

export const ESCALAS_ESCORE = [
  'news2',
  'braden',
  'morse',
  'glasgow',
  'rass',
  'camicu',
  'dor',
  // W0-03, mercado M1: risco de TEV, pediatria e neonatologia, obstetrícia (nomes de até 10 caracteres).
  'caprini',
  'padua',
  'pews',
  'bradenq',
  'humpty',
  'nips',
  'flacc',
  'meows',
] as const;
export type EscalaEscore = (typeof ESCALAS_ESCORE)[number];

export const ROTULOS_ESCALA: Readonly<Record<EscalaEscore, string>> = {
  news2: 'NEWS2 (alerta precoce)',
  braden: 'Braden (risco de lesão por pressão)',
  morse: 'Morse (risco de queda)',
  glasgow: 'Glasgow (nível de consciência)',
  rass: 'RASS (agitação e sedação)',
  camicu: 'CAM-ICU (delirium)',
  dor: 'Dor',
  caprini: 'Caprini (risco de TEV, cirúrgico)',
  padua: 'Padua (risco de TEV, clínico)',
  pews: 'PEWS (alerta precoce pediátrico)',
  bradenq: 'Braden Q (lesão por pressão, pediatria)',
  humpty: 'Humpty Dumpty (risco de queda, pediatria)',
  nips: 'NIPS (dor no recém-nascido)',
  flacc: 'FLACC (dor na criança)',
  meows: 'MEOWS (alerta precoce obstétrico)',
};

/** Escalas registradas na tela (o NEWS2 nasce da aferição dos sinais vitais). */
export const ESCALAS_DA_TELA = [
  'braden',
  'morse',
  'glasgow',
  'rass',
  'camicu',
  'dor',
  'caprini',
  'padua',
  'pews',
  'bradenq',
  'humpty',
  'nips',
  'flacc',
  'meows',
] as const;
/** As escalas do mercado M1 (W0-03), agrupadas na tela. */
export const ESCALAS_MERCADO_M1 = [
  'caprini',
  'padua',
  'pews',
  'bradenq',
  'humpty',
  'nips',
  'flacc',
  'meows',
] as const;
/** Escalas com reavaliação programada (regra 4). */
export const ESCALAS_REAVALIADAS = ['braden', 'morse'] as const;
export type EscalaReavaliada = (typeof ESCALAS_REAVALIADAS)[number];

export interface OpcaoItemEscala {
  readonly valor: number;
  readonly rotulo: string;
}
export interface ItemEscala {
  readonly codigo: string;
  readonly rotulo: string;
  readonly opcoes: readonly OpcaoItemEscala[];
}

const op = (valor: number, rotulo: string): OpcaoItemEscala => ({ valor, rotulo });

/** Braden (Bergstrom e Braden, 1987): seis subescalas, total de 6 a 23. */
export const ITENS_BRADEN: readonly ItemEscala[] = [
  {
    codigo: 'percepcao',
    rotulo: 'Percepção sensorial',
    opcoes: [
      op(1, 'Totalmente limitada'),
      op(2, 'Muito limitada'),
      op(3, 'Levemente limitada'),
      op(4, 'Nenhuma limitação'),
    ],
  },
  {
    codigo: 'umidade',
    rotulo: 'Umidade',
    opcoes: [
      op(1, 'Constantemente úmida'),
      op(2, 'Muito úmida'),
      op(3, 'Ocasionalmente úmida'),
      op(4, 'Raramente úmida'),
    ],
  },
  {
    codigo: 'atividade',
    rotulo: 'Atividade',
    opcoes: [
      op(1, 'Acamado'),
      op(2, 'Confinado à cadeira'),
      op(3, 'Anda ocasionalmente'),
      op(4, 'Anda frequentemente'),
    ],
  },
  {
    codigo: 'mobilidade',
    rotulo: 'Mobilidade',
    opcoes: [
      op(1, 'Totalmente imóvel'),
      op(2, 'Bastante limitada'),
      op(3, 'Levemente limitada'),
      op(4, 'Não apresenta limitações'),
    ],
  },
  {
    codigo: 'nutricao',
    rotulo: 'Nutrição',
    opcoes: [op(1, 'Muito pobre'), op(2, 'Provavelmente inadequada'), op(3, 'Adequada'), op(4, 'Excelente')],
  },
  {
    codigo: 'friccao',
    rotulo: 'Fricção e cisalhamento',
    opcoes: [op(1, 'Problema'), op(2, 'Problema em potencial'), op(3, 'Nenhum problema')],
  },
];

/** Morse (Morse, 1989): seis itens, total de 0 a 125. */
export const ITENS_MORSE: readonly ItemEscala[] = [
  { codigo: 'historiaQueda', rotulo: 'Histórico de quedas', opcoes: [op(0, 'Não'), op(25, 'Sim')] },
  {
    codigo: 'diagnosticoSecundario',
    rotulo: 'Diagnóstico secundário',
    opcoes: [op(0, 'Não'), op(15, 'Sim')],
  },
  {
    codigo: 'auxilioDeambulacao',
    rotulo: 'Auxílio na deambulação',
    opcoes: [
      op(0, 'Nenhum, acamado ou auxiliado por profissional'),
      op(15, 'Muletas, bengala ou andador'),
      op(30, 'Apoia-se no mobiliário'),
    ],
  },
  {
    codigo: 'terapiaEndovenosa',
    rotulo: 'Terapia endovenosa ou dispositivo endovenoso salinizado',
    opcoes: [op(0, 'Não'), op(20, 'Sim')],
  },
  {
    codigo: 'marcha',
    rotulo: 'Marcha',
    opcoes: [
      op(0, 'Normal, sem deambulação, acamado ou cadeira de rodas'),
      op(10, 'Fraca'),
      op(20, 'Comprometida ou cambaleante'),
    ],
  },
  {
    codigo: 'estadoMental',
    rotulo: 'Estado mental',
    opcoes: [
      op(0, 'Orientado e capaz quanto à própria capacidade'),
      op(15, 'Superestima a capacidade ou esquece as limitações'),
    ],
  },
];

/** Glasgow (Teasdale e Jennett, 1974): abertura ocular, resposta verbal e motora, total de 3 a 15. */
export const ITENS_GLASGOW: readonly ItemEscala[] = [
  {
    codigo: 'ocular',
    rotulo: 'Abertura ocular',
    opcoes: [
      op(1, 'Nenhuma'),
      op(2, 'Com estímulo doloroso'),
      op(3, 'Com estímulo verbal'),
      op(4, 'Espontânea'),
    ],
  },
  {
    codigo: 'verbal',
    rotulo: 'Melhor resposta verbal',
    opcoes: [
      op(1, 'Nenhuma resposta'),
      op(2, 'Sons incompreensíveis'),
      op(3, 'Palavras impróprias'),
      op(4, 'Confuso'),
      op(5, 'Orientado'),
    ],
  },
  {
    codigo: 'motora',
    rotulo: 'Melhor resposta motora',
    opcoes: [
      op(1, 'Nenhuma resposta'),
      op(2, 'Extensão anormal'),
      op(3, 'Flexão anormal'),
      op(4, 'Retirada à dor'),
      op(5, 'Localiza a dor'),
      op(6, 'Obedece a comandos'),
    ],
  },
];

/** RASS (Sessler et al., 2002): de +4 (combativo) a -5 (não desperta). */
export const ITENS_RASS: readonly ItemEscala[] = [
  {
    codigo: 'rass',
    rotulo: 'Nível de agitação e sedação',
    opcoes: [
      op(4, '+4 Combativo'),
      op(3, '+3 Muito agitado'),
      op(2, '+2 Agitado'),
      op(1, '+1 Inquieto'),
      op(0, '0 Alerta e calmo'),
      op(-1, '-1 Sonolento'),
      op(-2, '-2 Sedação leve'),
      op(-3, '-3 Sedação moderada'),
      op(-4, '-4 Sedação profunda'),
      op(-5, '-5 Não desperta'),
    ],
  },
];

/** CAM-ICU (Ely et al., 2001): as quatro características; delirium = 1 e 2 e (3 ou 4). */
export const ITENS_CAMICU: readonly ItemEscala[] = [
  {
    codigo: 'inicioAgudo',
    rotulo: '1. Início agudo ou curso flutuante do estado mental',
    opcoes: [op(0, 'Ausente'), op(1, 'Presente')],
  },
  {
    codigo: 'desatencao',
    rotulo: '2. Desatenção (erros no teste das letras)',
    opcoes: [op(0, '0 a 2 erros'), op(1, '3 erros ou mais')],
  },
  {
    codigo: 'consciencia',
    rotulo: '3. Nível de consciência alterado (RASS diferente de zero)',
    opcoes: [op(0, 'RASS zero'), op(1, 'RASS diferente de zero')],
  },
  {
    codigo: 'pensamento',
    rotulo: '4. Pensamento desorganizado (perguntas e comando)',
    opcoes: [op(0, '0 ou 1 erro'), op(1, '2 erros ou mais')],
  },
];

/** Dor: escala numérica (0 a 10) ou comportamental para o paciente sedado (BPS, Payen et al., 2001; 3 a 12). */
export const MODOS_DOR = ['numerica', 'comportamental'] as const;
export type ModoDor = (typeof MODOS_DOR)[number];
export const ITENS_DOR_NUMERICA: readonly ItemEscala[] = [
  {
    codigo: 'intensidade',
    rotulo: 'Intensidade da dor (0 sem dor, 10 a pior dor imaginável)',
    opcoes: Array.from({ length: 11 }, (_, i) => op(i, String(i))),
  },
];
export const ITENS_DOR_COMPORTAMENTAL: readonly ItemEscala[] = [
  {
    codigo: 'expressao',
    rotulo: 'Expressão facial',
    opcoes: [op(1, 'Relaxada'), op(2, 'Parcialmente tensa'), op(3, 'Totalmente tensa'), op(4, 'Careta')],
  },
  {
    codigo: 'membros',
    rotulo: 'Membros superiores',
    opcoes: [
      op(1, 'Sem movimento'),
      op(2, 'Parcialmente fletidos'),
      op(3, 'Totalmente fletidos'),
      op(4, 'Permanentemente retraídos'),
    ],
  },
  {
    codigo: 'ventilacao',
    rotulo: 'Adaptação à ventilação',
    opcoes: [
      op(1, 'Tolera o movimento'),
      op(2, 'Tosse, mas tolera a maior parte do tempo'),
      op(3, 'Briga com o ventilador'),
      op(4, 'Impossível controlar a ventilação'),
    ],
  },
];

/** Itens de cada escala da tela (o NEWS2 vem dos sinais vitais). */
export function itensDaEscala(escala: EscalaEscore, modo: ModoDor = 'numerica'): readonly ItemEscala[] {
  switch (escala) {
    case 'braden':
      return ITENS_BRADEN;
    case 'morse':
      return ITENS_MORSE;
    case 'glasgow':
      return ITENS_GLASGOW;
    case 'rass':
      return ITENS_RASS;
    case 'camicu':
      return ITENS_CAMICU;
    case 'dor':
      return modo === 'comportamental' ? ITENS_DOR_COMPORTAMENTAL : ITENS_DOR_NUMERICA;
    case 'caprini':
      return ITENS_CAPRINI;
    case 'padua':
      return ITENS_PADUA;
    case 'pews':
      return ITENS_PEWS;
    case 'bradenq':
      return ITENS_BRADEN_Q;
    case 'humpty':
      return ITENS_HUMPTY;
    case 'nips':
      return ITENS_NIPS;
    case 'flacc':
      return ITENS_FLACC;
    case 'meows':
      return ITENS_MEOWS;
    default:
      return [];
  }
}

// ── Faixas versionadas (regra 2) ──────────────────────────────────────────────────────────────

export const esquemaFaixaEscore = z
  .object({
    codigo: z.string().regex(/^[a-z][a-zA-Z0-9-]{1,19}$/, 'Código da faixa em minúsculas.'),
    rotulo: textoCp1252(60).pipe(z.string().min(2)),
    minimo: z.number().int().min(-10).max(200),
    maximo: z.number().int().min(-10).max(200),
    /** Faixa de risco: aciona o gatilho da escala (prevenção, aviso, reavaliação). */
    risco: z.boolean(),
  })
  .strict()
  .refine((f) => f.minimo <= f.maximo, { message: 'O mínimo da faixa passa do máximo.', path: ['maximo'] });
export type FaixaEscore = z.infer<typeof esquemaFaixaEscore>;

export interface RegraEscore {
  readonly escala: EscalaEscore;
  readonly versao: number;
  readonly faixas: readonly FaixaEscore[];
  /** Versão histórica: lida para entender os registros antigos, nunca usada em registro novo. */
  readonly historica: boolean;
  readonly origem: string;
  readonly impressao: string | null;
  readonly publicadoEm: string | null;
  readonly autor: string | null;
}

export const esquemaPublicarRegraEscore = z
  .object({
    escala: z.enum(ESCALAS_ESCORE),
    faixas: z.array(esquemaFaixaEscore).min(2).max(10),
    notas: textoCp1252(1_000).pipe(z.string().min(10, 'Explique a mudança (10 caracteres ou mais).')),
    /** Reautenticação (permissão crítica). */
    senha: z.string().min(1).max(128),
  })
  .strict();
export type PublicarRegraEscoreEntrada = z.infer<typeof esquemaPublicarRegraEscore>;

// ── Gatilhos (regras 1, 2 e 4) ────────────────────────────────────────────────────────────────

export const GATILHOS_ESCORE = [
  'nenhum',
  'avisar-medico',
  'trr',
  'sepse',
  'prevencao',
  'reavaliar',
  /** W0-03, M1: risco de TEV — a profilaxia sugerida vira pendência visível ao prescritor. */
  'profilaxia',
] as const;
export type GatilhoEscore = (typeof GATILHOS_ESCORE)[number];
export const ROTULOS_GATILHO: Readonly<Record<GatilhoEscore, string>> = {
  nenhum: 'Sem conduta adicional',
  'avisar-medico': 'Avisar o médico: avaliação clínica urgente',
  trr: 'Acionar o Time de Resposta Rápida agora',
  sepse: 'Suspeita de infecção com NEWS2 alto: abrir o protocolo de sepse',
  prevencao: 'Paciente em risco: aplicar os cuidados preventivos',
  reavaliar: 'Reavaliar depois da conduta',
  profilaxia: 'Risco de TEV: profilaxia sugerida ao prescritor',
};

/** Cuidados preventivos sugeridos ao paciente em risco (regra 4: o enfermeiro aceita ou recusa com motivo). */
export const CUIDADOS_PREVENTIVOS: Readonly<
  Record<EscalaReavaliada, readonly { codigo: string; rotulo: string }[]>
> = {
  braden: [
    { codigo: 'mudancaDecubito', rotulo: 'Mudança de decúbito a cada 2 horas' },
    { codigo: 'superficieRedistribuicao', rotulo: 'Colchão ou superfície de redistribuição de pressão' },
    { codigo: 'hidratacaoPele', rotulo: 'Hidratação da pele e controle da umidade' },
    { codigo: 'protecaoProeminencias', rotulo: 'Proteção das proeminências ósseas' },
    { codigo: 'avaliacaoNutricional', rotulo: 'Pedir a avaliação nutricional' },
  ],
  morse: [
    { codigo: 'gradesElevadas', rotulo: 'Grades da cama elevadas' },
    { codigo: 'pulseiraRisco', rotulo: 'Pulseira de risco de queda' },
    { codigo: 'camaBaixa', rotulo: 'Cama baixa e travada' },
    { codigo: 'acompanharDeambulacao', rotulo: 'Acompanhar na deambulação e no banheiro' },
    { codigo: 'orientarFamilia', rotulo: 'Orientar o paciente e o acompanhante' },
  ],
};

// ── Reavaliação (regra 4) ─────────────────────────────────────────────────────────────────────

export const MOTIVOS_REAVALIACAO = ['admissao', 'diaria', 'mudanca-quadro'] as const;
export type MotivoReavaliacao = (typeof MOTIVOS_REAVALIACAO)[number];
export const ROTULOS_MOTIVO_REAVALIACAO: Readonly<Record<MotivoReavaliacao, string>> = {
  admissao: 'Admissão',
  diaria: 'Reavaliação diária',
  'mudanca-quadro': 'Mudança do quadro clínico',
};
export const SITUACOES_REAVALIACAO = ['pendente', 'cumprida', 'dispensada'] as const;
export type SituacaoReavaliacao = (typeof SITUACOES_REAVALIACAO)[number];

// ── Entradas ──────────────────────────────────────────────────────────────────────────────────

const id = idBanco;
const livre = (max: number) => textoCp1252(max).overwrite((t) => t.replace(/\s+/g, ' ').trim());
const dataHoraLocal = z
  .string()
  .regex(
    /^\d{4}-\d{2}-\d{2}T([01]\d|2[0-3]):[0-5]\d(?::[0-5]\d)?$/,
    'Data e hora no formato AAAA-MM-DDTHH:mm.',
  );
const unidade = z
  .string()
  .trim()
  .regex(/^[A-Za-z0-9 ._-]{1,5}$/, 'Unidade inválida.');

/** O paciente internado do escore (ID do cadastro, atendimento e número da internação). */
const esquemaPacienteEscore = {
  paciente: id,
  atendimento: id.nullable(),
  reg: id.nullable(),
  unidade: unidade.nullable(),
};

export const esquemaDecisaoCuidado = z
  .object({
    codigo: z.string().min(2).max(40),
    decisao: z.enum(['aceito', 'recusado']),
    motivo: livre(300).optional(),
  })
  .strict()
  .refine((d) => d.decisao === 'aceito' || (d.motivo ?? '').length >= 5, {
    message: 'A recusa do cuidado preventivo exige o motivo (5 caracteres ou mais).',
    path: ['motivo'],
  });
export type DecisaoCuidado = z.infer<typeof esquemaDecisaoCuidado>;

/** enfermagem.registrarEscore pela tela (Braden, Morse, Glasgow, RASS, CAM-ICU e dor). */
export const esquemaRegistrarEscore = z
  .object({
    ...esquemaPacienteEscore,
    escala: z.enum(ESCALAS_DA_TELA),
    modoDor: z.enum(MODOS_DOR).optional(),
    /** Os pontos de cada item (o total é sempre calculado no servidor; regra 3). */
    itens: z.record(z.string().min(2).max(40), z.number().int().min(-5).max(30)),
    aferidoEm: dataHoraLocal.nullable().optional(),
    cuidados: z.array(esquemaDecisaoCuidado).max(10).default([]),
    /** W0-03, M1: o perfil do paciente na escala de TEV (o parâmetro diz a escala do clínico e a do cirúrgico). */
    perfilTev: z.enum(PERFIS_TEV).optional(),
  })
  .strict()
  .refine((e) => !(ESCALAS_TEV as readonly string[]).includes(e.escala) || e.perfilTev !== undefined, {
    message: 'Informe se o paciente é clínico ou cirúrgico (a escala de TEV depende do perfil).',
    path: ['perfilTev'],
  });
export type RegistrarEscoreEntrada = z.infer<typeof esquemaRegistrarEscore>;

/** A aferição dos sinais vitais com o NEWS2 calculado na mesma gravação (regra 1). */
export const esquemaAfericaoNews2 = z
  .object({
    ...esquemaPacienteEscore,
    sinais: z
      .object({
        fr: z.number().min(4).max(70),
        spo2: z.number().min(50).max(100),
        /** Oxigênio suplementar em L/min (0 = ar ambiente). */
        o2: z.number().min(0).max(60),
        pas: z.number().min(40).max(300),
        fc: z.number().min(20).max(250),
        /** ACVPU: 0 alerta, 1 confusão nova, 2 voz, 3 dor, 4 sem resposta. */
        acvpu: z.number().int().min(0).max(4),
        temperatura: z.number().min(30).max(43),
      })
      .strict(),
    /** Escala 2 da saturação: só para insuficiência respiratória hipercápnica documentada (prescrição médica). */
    escalaSpo2: z.union([z.literal(1), z.literal(2)]).default(1),
    suspeitaInfeccao: z.boolean().default(false),
    confirmadoForaDaFaixa: z.boolean().default(false),
    aferidoEm: dataHoraLocal.nullable().optional(),
  })
  .strict();
export type AfericaoNews2Entrada = z.infer<typeof esquemaAfericaoNews2>;

/** enfermagem.programarReavaliacao: a admissão e a mudança de quadro (a diária nasce do escore). */
export const esquemaProgramarReavaliacao = z
  .object({
    ...esquemaPacienteEscore,
    escala: z.enum(ESCALAS_REAVALIADAS),
    motivo: z.enum(['admissao', 'mudanca-quadro']),
    observacao: livre(300).optional(),
  })
  .strict();
export type ProgramarReavaliacaoEntrada = z.infer<typeof esquemaProgramarReavaliacao>;

export const esquemaDispensarReavaliacao = z
  .object({ motivo: livre(300).pipe(z.string().min(10, 'Explique a dispensa (10 caracteres ou mais).')) })
  .strict();

// ── Classificação de pacientes (regra 9) ──────────────────────────────────────────────────────

export const INSTRUMENTOS_CLASSIFICACAO = ['fugulin', 'nas'] as const;
export type InstrumentoClassificacao = (typeof INSTRUMENTOS_CLASSIFICACAO)[number];
export const ROTULOS_INSTRUMENTO: Readonly<Record<InstrumentoClassificacao, string>> = {
  fugulin: 'Fugulin (unidade de internação)',
  nas: 'NAS (terapia intensiva)',
};

/** Fugulin, Gaidzinski e Kurcgant (2005): doze áreas de cuidado, de 1 a 4 pontos; total de 12 a 48. */
export const AREAS_FUGULIN: readonly ItemEscala[] = (
  [
    [
      'estadoMental',
      'Estado mental',
      [
        'Orientação no tempo e no espaço',
        'Períodos de desorientação',
        'Períodos de inconsciência',
        'Inconsciente',
      ],
    ],
    [
      'oxigenacao',
      'Oxigenação',
      [
        'Não depende de oxigênio',
        'Uso intermitente de máscara ou cateter',
        'Uso contínuo de máscara ou cateter',
        'Ventilação mecânica',
      ],
    ],
    [
      'sinaisVitais',
      'Sinais vitais',
      [
        'Controle de rotina (8 horas)',
        'Controle a cada 6 horas',
        'Controle a cada 4 horas',
        'Controle em intervalos menores que 2 horas',
      ],
    ],
    [
      'motilidade',
      'Motilidade',
      [
        'Movimenta todos os segmentos',
        'Limitação de movimentos',
        'Dificuldade de movimentar segmentos',
        'Incapaz de movimentar qualquer segmento',
      ],
    ],
    [
      'deambulacao',
      'Deambulação',
      [
        'Ambulante',
        'Necessita de auxílio para deambular',
        'Locomoção por cadeira de rodas',
        'Restrito ao leito',
      ],
    ],
    [
      'alimentacao',
      'Alimentação',
      ['Autossuficiente', 'Por boca, com auxílio', 'Por sonda nasogástrica', 'Por cateter central'],
    ],
    [
      'cuidadoCorporal',
      'Cuidado corporal',
      [
        'Autossuficiente',
        'Auxílio no banho de chuveiro ou higiene oral',
        'Banho de chuveiro e higiene oral feitos pela enfermagem',
        'Banho no leito e higiene oral feitos pela enfermagem',
      ],
    ],
    [
      'eliminacao',
      'Eliminação',
      [
        'Autossuficiente',
        'Uso de vaso sanitário com auxílio',
        'Uso de comadre ou eliminações no leito',
        'Evacuação no leito e sonda vesical de demora',
      ],
    ],
    [
      'terapeutica',
      'Terapêutica',
      [
        'Medicação por via intramuscular ou oral',
        'Endovenosa intermitente',
        'Endovenosa contínua ou por sonda',
        'Uso de drogas vasoativas para manutenção da pressão',
      ],
    ],
    [
      'integridadeCutanea',
      'Integridade cutâneo-mucosa',
      [
        'Pele íntegra',
        'Alteração da cor da pele ou solução de continuidade em uma área',
        'Solução de continuidade em mais de uma área',
        'Destruição da derme, epiderme, músculos e articulações',
      ],
    ],
    [
      'curativo',
      'Curativo',
      [
        'Sem curativo ou uma vez ao dia',
        'Duas vezes ao dia pela enfermagem',
        'Três vezes ao dia pela enfermagem',
        'Mais de três vezes ao dia pela enfermagem',
      ],
    ],
    [
      'tempoCurativo',
      'Tempo utilizado na realização dos curativos',
      ['Sem curativo ou até 5 minutos', 'De 5 a 15 minutos', 'De 15 a 30 minutos', 'Mais de 30 minutos'],
    ],
  ] as const
).map(([codigo, rotulo, nomes]) => ({ codigo, rotulo, opcoes: nomes.map((n, i) => op(i + 1, n)) }));

/** NAS (Miranda et al., 2003): 23 itens; os itens 1, 4, 6, 7 e 8 têm subitens exclusivos; o peso é % do tempo de 24 h. */
export interface ItemNas {
  readonly codigo: string;
  readonly rotulo: string;
  /** Subitens exclusivos (escolhe um ou nenhum) ou o peso do item marcado. */
  readonly subitens?: readonly { readonly codigo: string; readonly rotulo: string; readonly peso: number }[];
  readonly peso?: number;
}
export const ITENS_NAS: readonly ItemNas[] = [
  {
    codigo: '1',
    rotulo: '1. Monitorização e controles',
    subitens: [
      { codigo: '1a', rotulo: 'Sinais vitais horários, registro e cálculo do balanço', peso: 4.5 },
      { codigo: '1b', rotulo: 'Presença à beira do leito por 2 horas ou mais em algum plantão', peso: 12.1 },
      { codigo: '1c', rotulo: 'Presença à beira do leito por 4 horas ou mais em algum plantão', peso: 19.6 },
    ],
  },
  { codigo: '2', rotulo: '2. Investigações laboratoriais', peso: 4.3 },
  { codigo: '3', rotulo: '3. Medicação, exceto drogas vasoativas', peso: 5.6 },
  {
    codigo: '4',
    rotulo: '4. Procedimentos de higiene',
    subitens: [
      { codigo: '4a', rotulo: 'Procedimentos de higiene de rotina', peso: 4.1 },
      { codigo: '4b', rotulo: 'Higiene por mais de 2 horas em algum plantão', peso: 16.5 },
      { codigo: '4c', rotulo: 'Higiene por mais de 4 horas em algum plantão', peso: 20.0 },
    ],
  },
  { codigo: '5', rotulo: '5. Cuidados com drenos, exceto sonda gástrica', peso: 1.8 },
  {
    codigo: '6',
    rotulo: '6. Mobilização e posicionamento',
    subitens: [
      { codigo: '6a', rotulo: 'Até três vezes em 24 horas', peso: 5.5 },
      { codigo: '6b', rotulo: 'Mais de três vezes ou com dois profissionais', peso: 12.4 },
      { codigo: '6c', rotulo: 'Com três ou mais profissionais', peso: 17.0 },
    ],
  },
  {
    codigo: '7',
    rotulo: '7. Suporte e cuidados aos familiares e ao paciente',
    subitens: [
      { codigo: '7a', rotulo: 'Cerca de 1 hora em algum plantão', peso: 4.0 },
      { codigo: '7b', rotulo: '3 horas ou mais em algum plantão', peso: 32.0 },
    ],
  },
  {
    codigo: '8',
    rotulo: '8. Tarefas administrativas e gerenciais',
    subitens: [
      { codigo: '8a', rotulo: 'Tarefas de rotina', peso: 4.2 },
      { codigo: '8b', rotulo: 'Cerca de 2 horas em algum plantão', peso: 23.2 },
      { codigo: '8c', rotulo: 'Cerca de 4 horas ou mais em algum plantão', peso: 30.0 },
    ],
  },
  { codigo: '9', rotulo: '9. Suporte respiratório', peso: 1.4 },
  { codigo: '10', rotulo: '10. Cuidados com via aérea artificial', peso: 1.8 },
  { codigo: '11', rotulo: '11. Tratamento para melhora da função pulmonar', peso: 4.4 },
  { codigo: '12', rotulo: '12. Medicação vasoativa', peso: 1.2 },
  { codigo: '13', rotulo: '13. Reposição endovenosa de grandes perdas de fluidos', peso: 2.5 },
  { codigo: '14', rotulo: '14. Monitorização do átrio esquerdo', peso: 1.7 },
  { codigo: '15', rotulo: '15. Reanimação cardiorrespiratória nas últimas 24 horas', peso: 7.1 },
  { codigo: '16', rotulo: '16. Técnicas de hemofiltração ou dialíticas', peso: 7.7 },
  { codigo: '17', rotulo: '17. Medida quantitativa do débito urinário', peso: 7.0 },
  { codigo: '18', rotulo: '18. Medida da pressão intracraniana', peso: 1.6 },
  { codigo: '19', rotulo: '19. Tratamento de acidose ou alcalose metabólica complicada', peso: 1.3 },
  { codigo: '20', rotulo: '20. Nutrição parenteral', peso: 2.8 },
  { codigo: '21', rotulo: '21. Nutrição enteral', peso: 1.3 },
  { codigo: '22', rotulo: '22. Intervenções específicas na unidade de terapia intensiva', peso: 2.8 },
  { codigo: '23', rotulo: '23. Intervenções específicas fora da unidade de terapia intensiva', peso: 1.9 },
];

/** Categorias de cuidado do Fugulin com as horas de enfermagem em 24 h da COFEN 543/2017. */
export const CATEGORIAS_FUGULIN = [
  { codigo: 'minimos', rotulo: 'Cuidados mínimos', minimo: 12, maximo: 17, horas: 4 },
  { codigo: 'intermediarios', rotulo: 'Cuidados intermediários', minimo: 18, maximo: 22, horas: 6 },
  { codigo: 'altaDependencia', rotulo: 'Alta dependência', minimo: 23, maximo: 28, horas: 10 },
  { codigo: 'semiIntensivos', rotulo: 'Cuidados semi-intensivos', minimo: 29, maximo: 34, horas: 10 },
  { codigo: 'intensivos', rotulo: 'Cuidados intensivos', minimo: 35, maximo: 48, horas: 18 },
] as const;

export const esquemaClassificarPaciente = z
  .object({
    paciente: id,
    atendimento: id.nullable(),
    reg: id,
    unidade,
    data: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Data no formato AAAA-MM-DD.'),
    turno: z.enum(TURNOS),
    instrumento: z.enum(INSTRUMENTOS_CLASSIFICACAO),
    /** Fugulin: a área → pontos (1 a 4). NAS: o item → subitem escolhido ("1b") ou "sim" para o item simples. */
    itens: z.record(
      z.string().min(1).max(30),
      z.union([z.number().int().min(1).max(4), z.string().min(1).max(4)]),
    ),
  })
  .strict();
export type ClassificarPacienteEntrada = z.infer<typeof esquemaClassificarPaciente>;

// ── Respostas das telas ───────────────────────────────────────────────────────────────────────

/**
 * W0-03: o estorno (lançado errado) ou a invalidação (paciente errado ou relançado) de um escore, classificação ou
 * índice de UTI. O registro fica inativo, tachado e visível, com o motivo, no histórico e na exportação. No NEWS2, o
 * alerta já disparado é reavaliado: `encerrado` (nenhum outro NEWS2 válido das últimas 12 h com gatilho) ou `mantido`
 * (pelo escore `escoreMantem`).
 */
export interface EstornoDoRegistro {
  readonly tipo: 'estorno' | 'invalidacao';
  readonly motivo: string;
  readonly usuario: string;
  readonly em: string;
  readonly alerta: 'sem-alerta' | 'encerrado' | 'mantido' | null;
  readonly escoreMantem: number | null;
}

/**
 * W0-03, M1: a profilaxia de TEV sugerida pelo escore de Caprini ou Padua em risco, pendente até o prescritor decidir
 * (prescrita, ou não prescrita com o motivo). A ordem na prescrição é da CPOE; aqui fica a pendência e a decisão.
 */
export interface PendenciaProfilaxia {
  readonly escore: number;
  readonly paciente: number;
  readonly atendimento: number | null;
  readonly leito: string | null;
  readonly nome: string | null;
  readonly escala: EscalaTev;
  readonly versaoRegra: number;
  readonly total: number;
  readonly faixa: string;
  readonly rotuloFaixa: string;
  readonly sugestao: string;
  readonly aferidoEm: string;
  readonly usuario: string;
  /** Nula enquanto pendente (revisão W0-03: também depois da anulação, que reabre a pendência). */
  readonly decisao: {
    readonly decisao: DecisaoProfilaxia;
    readonly motivo: string | null;
    readonly usuario: string;
    readonly em: string;
  } | null;
  /** Revisão W0-03: a decisão original e as correções (a mais antiga primeiro), legíveis. */
  readonly historico?: readonly {
    readonly decisao: DecisaoProfilaxia | 'anulada';
    readonly motivo: string | null;
    readonly justificativa: string | null;
    readonly usuario: string;
    readonly em: string;
  }[];
}

/**
 * Revisão W0-03: a correção da decisão pelo próprio autor (fato novo com a justificativa): outra decisão, ou a anulação
 * (lançada por engano), que reabre a pendência.
 */
export const esquemaRetificarProfilaxia = z
  .object({
    decisao: z.enum(['prescrita', 'nao-prescrita', 'anulada']),
    motivo: livre(300).optional(),
    justificativa: livre(300).pipe(z.string().min(10, 'Descreva a justificativa (10 caracteres ou mais).')),
  })
  .strict()
  .refine((d) => d.decisao !== 'nao-prescrita' || (d.motivo ?? '').length >= 10, {
    message: 'Explique por que a profilaxia não foi prescrita (10 caracteres ou mais).',
    path: ['motivo'],
  });
export type RetificarProfilaxiaEntrada = z.infer<typeof esquemaRetificarProfilaxia>;

/** A decisão do prescritor sobre a profilaxia sugerida (a não prescrita exige o motivo). */
export const esquemaDecidirProfilaxia = z
  .object({
    decisao: z.enum(['prescrita', 'nao-prescrita']),
    motivo: livre(300).optional(),
  })
  .strict()
  .refine((d) => d.decisao === 'prescrita' || (d.motivo ?? '').length >= 10, {
    message: 'Explique por que a profilaxia não foi prescrita (10 caracteres ou mais).',
    path: ['motivo'],
  });
export type DecidirProfilaxiaEntrada = z.infer<typeof esquemaDecidirProfilaxia>;

export interface EscoreLido {
  readonly id: number;
  readonly paciente: number;
  readonly reg: number | null;
  readonly unidade: string | null;
  readonly escala: EscalaEscore;
  readonly versaoRegra: number;
  readonly itens: Readonly<Record<string, number>>;
  readonly total: number;
  readonly faixa: string;
  readonly rotuloFaixa: string;
  readonly risco: boolean;
  readonly gatilho: GatilhoEscore;
  readonly suspeitaInfeccao: boolean;
  readonly origem: 'afericao' | 'tela';
  readonly aferidoEm: string;
  readonly usuario: string;
  /** W0-03: presente quando estornado (o escore fica inativo e visível). */
  readonly estorno?: EstornoDoRegistro | null;
}

export interface ReavaliacaoLida {
  readonly id: number | null;
  readonly paciente: number;
  readonly escala: EscalaReavaliada;
  readonly motivo: MotivoReavaliacao;
  readonly devidaEm: string;
  readonly prazoEm: string;
  readonly situacao: SituacaoReavaliacao;
  readonly vencida: boolean;
  /** Calculada na hora (a admissão sem escore registrado ainda): sem linha gravada. */
  readonly calculada: boolean;
  readonly cumpridaEm: string | null;
  readonly cumpridaPor: 'escore' | 'formulario' | null;
}

export interface ResultadoEscore {
  readonly id: number;
  readonly total: number;
  readonly faixa: string;
  readonly rotuloFaixa: string;
  readonly gatilho: GatilhoEscore;
  readonly conduta: string;
  readonly avisos: readonly string[];
  readonly mensagem: string;
}

/** O NEWS2 calculado na aferição pela tela dos sinais vitais (M25; regra 1): a conduta e os avisos, ou o motivo. */
export type News2DaAfericao =
  | {
      readonly id: number;
      readonly total: number;
      readonly faixa: string;
      readonly rotuloFaixa: string;
      readonly gatilho: GatilhoEscore;
      readonly conduta: string;
      readonly avisos: readonly string[];
    }
  | { readonly id: null; readonly motivo: string };

export interface EscoresDoPaciente {
  readonly paciente: number;
  readonly agora: string;
  readonly ultimos: readonly EscoreLido[];
  readonly historico: readonly EscoreLido[];
  readonly reavaliacoes: readonly ReavaliacaoLida[];
  /** W0-03, M1: a profilaxia de TEV do último escore de Caprini ou Padua válido em risco (pendente ou decidida). */
  readonly profilaxia?: PendenciaProfilaxia | null;
  readonly formularios: readonly {
    readonly registro: number;
    readonly modelo: string;
    readonly escala: EscalaReavaliada | 'lesoes';
    readonly quando: string | null;
    /** O total gravado (Braden) ou somado das respostas do formulário (Morse, com todos os itens respondidos). */
    readonly total: number | null;
    /** A categoria de risco escolhida no formulário (Morse); nula nos formulários que gravam o total. */
    readonly faixaFormulario: string | null;
  }[];
}

export interface PacienteEscoresUnidade {
  readonly paciente: number;
  readonly atendimento: number;
  readonly reg: number;
  readonly nome: string;
  readonly leito: string;
  readonly ultimos: Readonly<Partial<Record<EscalaEscore, EscoreLido>>>;
  readonly reavaliacoesVencidas: number;
  readonly reavaliacoes: readonly ReavaliacaoLida[];
  readonly gatilhoAberto: GatilhoEscore | null;
}

export interface EscoresDaUnidade {
  readonly unidade: string;
  readonly agora: string;
  readonly turno: { readonly nome: 'diurno' | 'noturno'; readonly inicio: string; readonly fim: string };
  readonly pacientes: readonly PacienteEscoresUnidade[];
  readonly resumo: { readonly vencidas: number; readonly emRisco: number; readonly news2Alto: number };
  readonly gravacao: {
    readonly ligada: boolean;
    readonly motivo: string | null;
    readonly registrar: boolean;
    /** Aceitar ou recusar os cuidados preventivos (só o enfermeiro; D-CUIDADO-45). */
    readonly decidirCuidados: boolean;
    readonly publicar: boolean;
    /** W0-03, M1: decidir a profilaxia de TEV sugerida (o prescritor). */
    readonly decidirProfilaxia?: boolean;
  };
  readonly regras: readonly RegraEscore[];
  /** W0-03, M1: as profilaxias de TEV pendentes na unidade (visíveis ao prescritor). */
  readonly profilaxiasPendentes?: readonly PendenciaProfilaxia[];
}

export interface ClassificacaoLida {
  readonly id: number;
  readonly paciente: number;
  readonly reg: number;
  readonly instrumento: InstrumentoClassificacao;
  readonly itens: Readonly<Record<string, number | string>>;
  readonly total: number;
  readonly categoria: string;
  readonly rotuloCategoria: string;
  readonly horas24h: number;
  readonly usuario: string;
  readonly criadoEm: string;
  /** W0-03: presente quando estornada (inativa e visível; relança-se no mesmo turno). */
  readonly estorno?: EstornoDoRegistro | null;
}

export interface CargaDaUnidade {
  readonly unidade: string;
  readonly data: string;
  readonly turno: 'diurno' | 'noturno';
  readonly pacientes: readonly {
    readonly paciente: number;
    readonly atendimento: number;
    readonly reg: number;
    readonly nome: string;
    readonly leito: string;
    readonly classificacoes: readonly ClassificacaoLida[];
  }[];
  /** A carga somada com as parcelas impressas (toda conta agregada mostra as parcelas). */
  readonly carga: {
    readonly fugulin: {
      readonly porCategoria: readonly { codigo: string; rotulo: string; pacientes: number; horas: number }[];
      readonly horas24h: number;
    };
    readonly nas: {
      readonly pacientes: number;
      readonly soma: number;
      readonly profissionaisPorTurno: number;
    };
    readonly naoClassificados: number;
  };
  readonly gravacao: {
    readonly ligada: boolean;
    readonly motivo: string | null;
    readonly registrar: boolean;
  };
}
