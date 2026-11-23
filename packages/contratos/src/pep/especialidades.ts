// Especialidades sob demanda (M45, etapa 6; ficha, seções 4 a 8 e 12; DP-32): oftalmologia (exame e acuidade visual),
// oncologia (protocolos de quimioterapia publicados e imutáveis, ciclos com a dose calculada e a validação farmacêutica
// com dupla checagem), obstetrícia e neonatologia (partograma e recém-nascido) e o lactário (ordem de produção de
// fórmulas com a conferência por outra pessoa e a etiqueta). Tudo construído completo e DESLIGADO por chave em
// SGH_CFG_LIBERACAO (`pep.especialidade.*` e `nutricao.lactario`), ligado quando a área pedir (POL-1, POL-3). Os
// valores codificados (acuidade, exame, graduação, tipo de protocolo, tipo de parto) vêm dos cadastros do
// estabelecimento e valor nunca visto é recusado (regra 15). Nenhum nome de tabela nem de coluna aqui.
import { z } from 'zod';
import { ANDAMENTOS_CICLO, esquemaAlteracaoHotLida, esquemaEventoOncoLido } from './correcao-base.js';
import { esquemaChaveLeito } from '../internacao/adt.js';
import { esquemaDataIso } from '../preco/entradas.js';
import { textoCp1252 } from '../texto-cp1252.js';
import { idBanco } from '../validacao/id-banco.js';

const id = idBanco;
const livre = (max: number) => textoCp1252(max).overwrite((t) => t.replace(/\s+/g, ' ').trim());
const longo = (max: number) => textoCp1252(max).overwrite((t) => t.replace(/[ \t]+/g, ' ').trim());
/** Instante civil "AAAA-MM-DDTHH:MM" (o relógio do estabelecimento). */
export const esquemaInstanteCivil = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}T([01]\d|2[0-3]):[0-5]\d$/, 'Data e hora no formato AAAA-MM-DDTHH:MM.')
  .refine((v) => esquemaDataIso.safeParse(v.slice(0, 10)).success, 'Data inexistente.');

// ── Chaves de liberação (ficha, seção 12; DP-32) ─────────────────────────────────────────────────

export const CHAVE_LIBERACAO_OFTALMOLOGIA = 'pep.especialidade.oftalmologia';
export const CHAVE_LIBERACAO_ONCOLOGIA = 'pep.especialidade.oncologia';
export const CHAVE_LIBERACAO_OBSTETRICIA = 'pep.especialidade.obstetricia';
export const CHAVE_LIBERACAO_LACTARIO = 'nutricao.lactario';

export const ESPECIALIDADES_SOB_DEMANDA = ['oftalmologia', 'oncologia', 'obstetricia', 'lactario'] as const;
export type EspecialidadeSobDemanda = (typeof ESPECIALIDADES_SOB_DEMANDA)[number];

export const CHAVE_DA_ESPECIALIDADE: Readonly<Record<EspecialidadeSobDemanda, string>> = {
  oftalmologia: CHAVE_LIBERACAO_OFTALMOLOGIA,
  oncologia: CHAVE_LIBERACAO_ONCOLOGIA,
  obstetricia: CHAVE_LIBERACAO_OBSTETRICIA,
  lactario: CHAVE_LIBERACAO_LACTARIO,
};

/** O estado da gravação de uma especialidade para a tela (a chave, cada ação e a categoria do vínculo da sessão). */
export const esquemaGravacaoEspecialidade = z.object({
  ligada: z.boolean(),
  motivo: z.string().nullable(),
  operacoes: z.record(z.string(), z.object({ pode: z.boolean(), motivo: z.string().nullable() })),
  categoria: z.string().nullable(),
});
export type GravacaoEspecialidade = z.infer<typeof esquemaGravacaoEspecialidade>;

/** A internação de que a tela trata (o cabeçalho com os dois identificadores). */
export const esquemaInternacaoEspecialidade = z.object({
  internacao: z.number().int(),
  paciente: z.number().int(),
  prontuario: z.number().int(),
  nome: z.string(),
  nascimento: z.string().nullable(),
  idade: z.number().int().nullable(),
  sexo: z.enum(['M', 'F', 'I']),
  leito: esquemaChaveLeito,
  admissao: z.string(),
  aberta: z.boolean(),
});
export type InternacaoEspecialidade = z.infer<typeof esquemaInternacaoEspecialidade>;

/** A busca das internações abertas para escolher o paciente (nome, prontuário ou número). */
export const esquemaListaInternacoesEspecialidade = z.object({
  itens: z.array(
    z.object({
      internacao: z.number().int(),
      prontuario: z.number().int(),
      nome: z.string(),
      leito: esquemaChaveLeito,
      entrada: z.string(),
    }),
  ),
  cortada: z.boolean(),
});
export type ListaInternacoesEspecialidade = z.infer<typeof esquemaListaInternacoesEspecialidade>;

export const esquemaResultadoEspecialidade = z.object({
  ok: z.literal(true),
  id: z.number().int(),
  alertas: z.array(z.string()),
  mensagem: z.string(),
});
export type ResultadoEspecialidade = z.infer<typeof esquemaResultadoEspecialidade>;

// ── Oftalmologia (exames e acuidade) ─────────────────────────────────────────────────────────────

export const OLHOS = ['od', 'oe'] as const;
export type Olho = (typeof OLHOS)[number];
export const LADOS_EXAME = ['od', 'oe', 'ao'] as const;
export type LadoExame = (typeof LADOS_EXAME)[number];

export const METODOS_PIO = [
  { codigo: 'aplanacao', rotulo: 'Tonometria de aplanação' },
  { codigo: 'sopro', rotulo: 'Tonometria de sopro (sem contato)' },
  { codigo: 'rebote', rotulo: 'Tonometria de rebote' },
] as const;
export type MetodoPio = (typeof METODOS_PIO)[number]['codigo'];
const CODIGOS_METODO_PIO = METODOS_PIO.map((m) => m.codigo) as [MetodoPio, ...MetodoPio[]];

export const CLASSIFICACOES_VISUAIS = ['normal', 'reduzida', 'baixa-visao', 'cegueira', 'sem-dado'] as const;
export type ClassificacaoVisual = (typeof CLASSIFICACOES_VISUAIS)[number];

const esquemaOlhoExame = z
  .object({
    /** Acuidade visual sem correção e com correção: o tipo do cadastro de acuidade do estabelecimento. */
    acuidadeSemCorrecao: id.nullable().default(null),
    acuidadeComCorrecao: id.nullable().default(null),
    /** Pressão intraocular em mmHg (uma casa). */
    pio: z.number().min(0).max(80).nullable().default(null),
    /** Gonioscopia: a graduação do ângulo do cadastro. */
    gonioscopia: id.nullable().default(null),
  })
  .strict();

/** POST /api/especialidades/oftalmologia/exames: o exame oftalmológico com a acuidade, a PIO e os exames. */
export const esquemaRegistrarExameOftalmologico = z
  .object({
    internacao: id,
    od: esquemaOlhoExame,
    oe: esquemaOlhoExame,
    metodoPio: z.enum(CODIGOS_METODO_PIO).nullable().default(null),
    exames: z
      .array(
        z
          .object({
            exame: id,
            lado: z.enum(LADOS_EXAME),
            resultado: longo(500).pipe(z.string().min(1, 'Escreva o resultado do exame.')),
          })
          .strict(),
      )
      .max(35)
      .default([]),
    conduta: longo(1000).optional(),
  })
  .strict();
export type RegistrarExameOftalmologicoEntrada = z.infer<typeof esquemaRegistrarExameOftalmologico>;

export const esquemaCadastrosOftalmologia = z.object({
  grupos: z.array(z.object({ codigo: z.number().int(), nome: z.string() })),
  exames: z.array(z.object({ codigo: z.number().int(), grupo: z.number().int(), nome: z.string() })),
  acuidades: z.array(
    z.object({
      codigo: z.number().int(),
      nome: z.string(),
      /** Decimal (Snellen) quando a tabela traz; null nas medidas qualitativas (conta dedos, percepção de luz). */
      decimal: z.number().nullable(),
    }),
  ),
  graduacoes: z.array(z.object({ codigo: z.number().int(), sigla: z.string(), nome: z.string() })),
  tiposArquivo: z.array(z.string()),
  /** O limite da PIO (parâmetro) para o alerta. */
  pioLimite: z.number(),
});
export type CadastrosOftalmologia = z.infer<typeof esquemaCadastrosOftalmologia>;

export const esquemaExameOftalmologicoLido = z.object({
  id: z.number().int(),
  od: z.object({
    acuidadeSemCorrecao: z.string().nullable(),
    acuidadeComCorrecao: z.string().nullable(),
    pio: z.number().nullable(),
    gonioscopia: z.string().nullable(),
  }),
  oe: z.object({
    acuidadeSemCorrecao: z.string().nullable(),
    acuidadeComCorrecao: z.string().nullable(),
    pio: z.number().nullable(),
    gonioscopia: z.string().nullable(),
  }),
  metodoPio: z.string().nullable(),
  exames: z.array(z.object({ exame: z.string(), lado: z.enum(LADOS_EXAME), resultado: z.string() })),
  classificacao: z.enum(CLASSIFICACOES_VISUAIS),
  alertas: z.array(z.string()),
  conduta: z.string().nullable(),
  por: z.string(),
  em: z.string(),
});
export type ExameOftalmologicoLido = z.infer<typeof esquemaExameOftalmologicoLido>;

export const esquemaOftalmologiaPaciente = z.object({
  internacao: esquemaInternacaoEspecialidade,
  exames: z.array(esquemaExameOftalmologicoLido),
});
export type OftalmologiaPaciente = z.infer<typeof esquemaOftalmologiaPaciente>;

// ── Oncologia (protocolos de quimioterapia e ciclos) ─────────────────────────────────────────────

export const UNIDADES_DOSE_ONCO = [
  { codigo: 'mg/m2', rotulo: 'mg/m² (superfície corporal)' },
  { codigo: 'mg/kg', rotulo: 'mg/kg (peso)' },
  { codigo: 'auc', rotulo: 'AUC (Calvert, pela função renal)' },
  { codigo: 'mg', rotulo: 'mg (dose fixa)' },
] as const;
export type UnidadeDoseOnco = (typeof UNIDADES_DOSE_ONCO)[number]['codigo'];
const CODIGOS_UNIDADE_DOSE = UNIDADES_DOSE_ONCO.map((u) => u.codigo) as [
  UnidadeDoseOnco,
  ...UnidadeDoseOnco[],
];

export const VIAS_ONCO = [
  { codigo: 'iv', rotulo: 'Endovenosa' },
  { codigo: 'vo', rotulo: 'Oral' },
  { codigo: 'sc', rotulo: 'Subcutânea' },
  { codigo: 'im', rotulo: 'Intramuscular' },
  { codigo: 'it', rotulo: 'Intratecal' },
] as const;
export type ViaOnco = (typeof VIAS_ONCO)[number]['codigo'];
const CODIGOS_VIA_ONCO = VIAS_ONCO.map((v) => v.codigo) as [ViaOnco, ...ViaOnco[]];

export const esquemaFarmacoProtocolo = z
  .object({
    /** Nome genérico (Denominação Comum Brasileira). */
    nome: livre(60).pipe(z.string().min(3, 'Informe o fármaco pelo nome genérico.')),
    dose: z.number().positive().max(10_000),
    unidade: z.enum(CODIGOS_UNIDADE_DOSE),
    via: z.enum(CODIGOS_VIA_ONCO),
    /** Os dias do ciclo em que o fármaco é administrado (D1, D8...). */
    dias: z.array(z.number().int().min(1).max(56)).min(1).max(28),
    /** Diluição e tempo de infusão (texto do protocolo). */
    administracao: livre(120).optional(),
  })
  .strict();
export type FarmacoProtocolo = z.infer<typeof esquemaFarmacoProtocolo>;

/** POST /api/especialidades/oncologia/protocolos: publica a versão do protocolo (imutável; corrigir = nova versão). */
export const esquemaPublicarProtocoloOncologico = z
  .object({
    codigo: z
      .string()
      .trim()
      .toUpperCase()
      .regex(/^[A-Z0-9][A-Z0-9-]{1,19}$/, 'Código com 2 a 20 letras, dígitos ou hífen.'),
    nome: livre(100).pipe(z.string().min(3, 'Informe o nome do protocolo.')),
    /** O tipo de protocolo do cadastro do estabelecimento. */
    tipo: id,
    intervaloDias: z.number().int().min(1).max(56),
    ciclos: z.number().int().min(1).max(24),
    farmacos: z.array(esquemaFarmacoProtocolo).min(1).max(12),
    indicacao: livre(200).optional(),
    referencia: livre(200).pipe(z.string().min(3, 'Informe a referência bibliográfica ou institucional.')),
  })
  .strict();
export type PublicarProtocoloOncologicoEntrada = z.infer<typeof esquemaPublicarProtocoloOncologico>;

export const esquemaProtocoloOncologicoLido = z.object({
  id: z.number().int(),
  codigo: z.string(),
  versao: z.number().int(),
  nome: z.string(),
  tipo: z.object({ codigo: z.number().int(), nome: z.string() }),
  intervaloDias: z.number().int(),
  ciclos: z.number().int(),
  farmacos: z.array(esquemaFarmacoProtocolo),
  indicacao: z.string().nullable(),
  referencia: z.string(),
  hash: z.string(),
  /** Vigente = a versão mais nova do código. */
  vigente: z.boolean(),
  integro: z.boolean(),
  por: z.string(),
  em: z.string(),
  /** W0-05: a versão revogada (não é oferecida a ciclos novos; os ciclos dela continuam) e o protocolo inativo. */
  revogada: z.boolean(),
  inativo: z.boolean(),
  /** Oferecida a ciclos novos: vigente, não revogada e com o protocolo ativo. */
  ofertavel: z.boolean(),
  /** Os eventos do protocolo e da versão (revogação, inativação e reativação), o mais recente primeiro. */
  eventos: z.array(esquemaEventoOncoLido),
});
export type ProtocoloOncologicoLido = z.infer<typeof esquemaProtocoloOncologicoLido>;

export const esquemaProtocolosOncologicos = z.object({
  tipos: z.array(z.object({ codigo: z.number().int(), nome: z.string() })),
  protocolos: z.array(esquemaProtocoloOncologicoLido),
});
export type ProtocolosOncologicos = z.infer<typeof esquemaProtocolosOncologicos>;

/** POST /api/especialidades/oncologia/ciclos: o ciclo do paciente (a dose calculada pelo sistema). */
export const esquemaRegistrarCicloOncologico = z
  .object({
    internacao: id,
    protocolo: id,
    numero: z.number().int().min(1).max(24),
    dataPrevista: esquemaDataIso,
    pesoKg: z.number().min(1).max(350),
    alturaCm: z.number().int().min(30).max(250),
    /** Creatinina sérica (mg/dL) do dia: obrigatória quando o protocolo tem dose por AUC. */
    creatininaMgDl: z.number().min(0.1).max(20).nullable().default(null),
    /** Redução de dose para todos os fármacos (toxicidade), com o motivo. */
    reducaoPct: z.number().int().min(0).max(75).default(0),
    motivoReducao: livre(200).optional(),
    /** Ciclo antes do intervalo do protocolo: a justificativa clínica. */
    justificativaIntervalo: livre(200).optional(),
    /** Iniciar um tratamento novo com este protocolo (recaída, nova linha): o motivo; só no ciclo 1. */
    novoTratamento: livre(200).optional(),
    /**
     * O diagnóstico oncológico do paciente (id) e a intenção do tratamento (id do cadastro de intenções) que abrem o
     * tratamento do ciclo: exigidos quando o ciclo abre um tratamento (ciclo 1 sem tratamento aberto, ou tratamento
     * novo); nos ciclos seguintes valem os do tratamento aberto. A API recusa `tratamento-sem-diagnostico` sem eles.
     */
    diagnostico: id.optional(),
    intencao: id.optional(),
  })
  .strict();
export type RegistrarCicloOncologicoEntrada = z.infer<typeof esquemaRegistrarCicloOncologico>;

/** POST /api/especialidades/oncologia/ciclos/:id/validar: a dupla checagem independente do farmacêutico. */
export const esquemaValidarCicloOncologico = z
  .object({
    /** A dose final (mg) que o farmacêutico calculou, fármaco a fármaco, na ordem do protocolo. */
    doses: z.array(z.number().positive().max(100_000)).min(1).max(12),
    observacao: livre(200).optional(),
  })
  .strict();
export type ValidarCicloOncologicoEntrada = z.infer<typeof esquemaValidarCicloOncologico>;

export const esquemaDoseCalculada = z.object({
  farmaco: z.string(),
  via: z.enum(CODIGOS_VIA_ONCO),
  dias: z.array(z.number().int()),
  /** A dose do protocolo e a unidade. */
  prescrita: z.number(),
  unidade: z.enum(CODIGOS_UNIDADE_DOSE),
  /** A base do cálculo (SC em m², peso em kg, TFG + 25 em mL/min, 1 na dose fixa). */
  base: z.number(),
  /** A dose antes da redução e a final (mg), as parcelas impressas na tela. */
  calculada: z.number(),
  final: z.number(),
  conta: z.string(),
});
export type DoseCalculada = z.infer<typeof esquemaDoseCalculada>;

export const SITUACOES_CICLO = ['prescrito', 'validado'] as const;
export type SituacaoCiclo = (typeof SITUACOES_CICLO)[number];

export const esquemaCicloOncologicoLido = z.object({
  id: z.number().int(),
  protocolo: z.object({
    id: z.number().int(),
    codigo: z.string(),
    versao: z.number().int(),
    nome: z.string(),
  }),
  numero: z.number().int(),
  dataPrevista: z.string(),
  pesoKg: z.number(),
  alturaCm: z.number().int(),
  superficieM2: z.number(),
  creatininaMgDl: z.number().nullable(),
  clearanceMlMin: z.number().nullable(),
  reducaoPct: z.number().int(),
  motivoReducao: z.string().nullable(),
  justificativaIntervalo: z.string().nullable(),
  doses: z.array(esquemaDoseCalculada),
  situacao: z.enum(SITUACOES_CICLO),
  por: z.string(),
  em: z.string(),
  validadoPor: z.string().nullable(),
  validadoEm: z.string().nullable(),
  /** O tratamento (curso) do ciclo, 1 no primeiro, e o motivo do tratamento novo. */
  curso: z.number().int(),
  motivoCurso: z.string().nullable(),
  /** O número (id da prescrição) das prescrições gerais ligadas ao ciclo. */
  prescricoes: z.array(z.number().int()),
  /** W0-05: ativo, suspenso ou cancelado (fato novo com o motivo); os eventos do ciclo, o mais recente primeiro. */
  andamento: z.enum(ANDAMENTOS_CICLO),
  eventos: z.array(esquemaEventoOncoLido),
});
export type CicloOncologicoLido = z.infer<typeof esquemaCicloOncologicoLido>;

export const esquemaOncologiaPaciente = z.object({
  internacao: esquemaInternacaoEspecialidade,
  ciclos: z.array(esquemaCicloOncologicoLido),
  protocolos: z.array(esquemaProtocoloOncologicoLido),
});
export type OncologiaPaciente = z.infer<typeof esquemaOncologiaPaciente>;

/** POST /api/especialidades/oncologia/ciclos/:id/prescricoes: liga a prescrição geral (pelo id) ao ciclo. */
export const esquemaVincularPrescricaoCiclo = z.object({ prescricao: id }).strict();
export type VincularPrescricaoCicloEntrada = z.infer<typeof esquemaVincularPrescricaoCiclo>;

/** GET /api/especialidades/oncologia/ciclos/:id/prescricoes: as prescrições da internação que valem no dia previsto. */
export const esquemaPrescricoesDoCiclo = z.object({
  ciclo: z.number().int(),
  dataPrevista: z.string(),
  itens: z.array(
    z.object({
      id: z.number().int(),
      inicio: z.string(),
      fim: z.string().nullable(),
      suspensa: z.boolean(),
      itens: z.number().int(),
      vinculada: z.boolean(),
    }),
  ),
});
export type PrescricoesDoCiclo = z.infer<typeof esquemaPrescricoesDoCiclo>;

/** A fila da validação farmacêutica (ciclos prescritos ainda não validados). */
export const esquemaFilaValidacaoOnco = z.object({
  itens: z.array(
    z.object({
      ciclo: esquemaCicloOncologicoLido,
      internacao: z.number().int(),
      nome: z.string(),
      prontuario: z.number().int(),
    }),
  ),
});
export type FilaValidacaoOnco = z.infer<typeof esquemaFilaValidacaoOnco>;

// ── Obstetrícia e neonatologia (partograma e recém-nascido) ──────────────────────────────────────

export const BOLSAS = ['integra', 'rota'] as const;
export type Bolsa = (typeof BOLSAS)[number];
export const LIQUIDOS_AMNIOTICOS = [
  { codigo: 'claro', rotulo: 'Claro' },
  { codigo: 'meconial', rotulo: 'Meconial' },
  { codigo: 'sanguinolento', rotulo: 'Sanguinolento' },
  { codigo: 'ausente', rotulo: 'Ausente' },
] as const;
export type LiquidoAmniotico = (typeof LIQUIDOS_AMNIOTICOS)[number]['codigo'];
const CODIGOS_LIQUIDO = LIQUIDOS_AMNIOTICOS.map((l) => l.codigo) as [LiquidoAmniotico, ...LiquidoAmniotico[]];

/** POST /api/especialidades/obstetricia/partograma: uma observação do trabalho de parto (só inclusão). */
export const esquemaRegistrarPartograma = z
  .object({
    internacao: id,
    em: esquemaInstanteCivil,
    dilatacaoCm: z.number().min(0).max(10).nullable().default(null),
    /** Altura da apresentação (planos de De Lee, -3 a +3). */
    alturaApresentacao: z.number().int().min(-3).max(3).nullable().default(null),
    bcf: z.number().int().min(50).max(220).nullable().default(null),
    contracoes10min: z.number().int().min(0).max(10).nullable().default(null),
    duracaoContracaoS: z.number().int().min(0).max(180).nullable().default(null),
    bolsa: z.enum(BOLSAS).nullable().default(null),
    liquido: z.enum(CODIGOS_LIQUIDO).nullable().default(null),
    paSistolica: z.number().int().min(50).max(260).nullable().default(null),
    paDiastolica: z.number().int().min(20).max(160).nullable().default(null),
    temperatura: z.number().min(33).max(43).nullable().default(null),
    /** Ocitocina em infusão (mUI/min). */
    ocitocina: z.number().min(0).max(40).nullable().default(null),
    observacao: livre(300).optional(),
  })
  .strict();
export type RegistrarPartogramaEntrada = z.infer<typeof esquemaRegistrarPartograma>;

export const esquemaPontoPartograma = z.object({
  id: z.number().int(),
  em: z.string(),
  dilatacaoCm: z.number().nullable(),
  alturaApresentacao: z.number().int().nullable(),
  bcf: z.number().int().nullable(),
  contracoes10min: z.number().int().nullable(),
  duracaoContracaoS: z.number().int().nullable(),
  bolsa: z.enum(BOLSAS).nullable(),
  liquido: z.enum(CODIGOS_LIQUIDO).nullable(),
  paSistolica: z.number().int().nullable(),
  paDiastolica: z.number().int().nullable(),
  temperatura: z.number().nullable(),
  ocitocina: z.number().nullable(),
  observacao: z.string().nullable(),
  alertas: z.array(z.string()),
  por: z.string(),
  registradoEm: z.string(),
});
export type PontoPartograma = z.infer<typeof esquemaPontoPartograma>;

export const SEXOS_RN = ['M', 'F', 'I'] as const;
export type SexoRn = (typeof SEXOS_RN)[number];

/** POST /api/especialidades/obstetricia/recem-nascidos: o registro do recém-nascido (só inclusão). */
export const esquemaRegistrarRecemNascido = z
  .object({
    internacao: id,
    nascimentoEm: esquemaInstanteCivil,
    sexo: z.enum(SEXOS_RN),
    pesoG: z.number().int().min(300).max(7000),
    comprimentoCm: z.number().min(20).max(65).nullable().default(null),
    perimetroCefalicoCm: z.number().min(18).max(45).nullable().default(null),
    apgar1: z.number().int().min(0).max(10),
    apgar5: z.number().int().min(0).max(10),
    /** Obrigatório quando o Apgar do 5º minuto é menor que 7. */
    apgar10: z.number().int().min(0).max(10).nullable().default(null),
    igSemanas: z.number().int().min(20).max(45),
    igDias: z.number().int().min(0).max(6),
    /** O tipo de parto do cadastro do estabelecimento. */
    tipoParto: id,
    reanimacao: z.boolean(),
    observacao: livre(300).optional(),
  })
  .strict();
export type RegistrarRecemNascidoEntrada = z.infer<typeof esquemaRegistrarRecemNascido>;

export const esquemaRecemNascidoLido = z.object({
  id: z.number().int(),
  nascimentoEm: z.string(),
  sexo: z.enum(SEXOS_RN),
  pesoG: z.number().int(),
  comprimentoCm: z.number().nullable(),
  perimetroCefalicoCm: z.number().nullable(),
  apgar1: z.number().int(),
  apgar5: z.number().int(),
  apgar10: z.number().int().nullable(),
  igSemanas: z.number().int(),
  igDias: z.number().int(),
  tipoParto: z.string(),
  reanimacao: z.boolean(),
  classificacaoIg: z.string(),
  classificacaoPeso: z.string(),
  classificacaoApgar: z.string(),
  observacao: z.string().nullable(),
  por: z.string(),
  em: z.string(),
});
export type RecemNascidoLido = z.infer<typeof esquemaRecemNascidoLido>;

/** As linhas do partograma (a partir do início da fase ativa). */
export const esquemaLinhasPartograma = z.object({
  /** O instante e a dilatação em que a fase ativa começou; null antes dela. */
  inicioFaseAtiva: z.object({ em: z.string(), dilatacaoCm: z.number() }).nullable(),
  /** A linha de alerta (1 cm/h) e a de ação (4 h à direita): os dois pontos de cada uma. */
  alerta: z.array(z.object({ horas: z.number(), dilatacaoCm: z.number() })),
  acao: z.array(z.object({ horas: z.number(), dilatacaoCm: z.number() })),
});
export type LinhasPartograma = z.infer<typeof esquemaLinhasPartograma>;

export const esquemaObstetriciaPaciente = z.object({
  internacao: esquemaInternacaoEspecialidade,
  pontos: z.array(esquemaPontoPartograma),
  linhas: esquemaLinhasPartograma,
  recemNascidos: z.array(esquemaRecemNascidoLido),
  tiposParto: z.array(z.object({ codigo: z.number().int(), nome: z.string() })),
  faseAtivaCm: z.number(),
  /** O relógio do estabelecimento ("AAAA-MM-DDTHH:MM"): o padrão da hora dos registros. */
  agora: z.string(),
});
export type ObstetriciaPaciente = z.infer<typeof esquemaObstetriciaPaciente>;

// ── Lactário (ordem de produção, conferência e etiqueta) ─────────────────────────────────────────

const esquemaHorario = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Horário no formato HH:MM.');

/** POST /api/nutricao/lactario/ordens: a ordem de produção das porções de uma fórmula para o paciente. */
export const esquemaRegistrarOrdemLactario = z
  .object({
    internacao: id,
    formula: livre(60).pipe(z.string().min(3, 'Informe a fórmula.')),
    volumeMl: z.number().int().min(5).max(500),
    horarios: z.array(esquemaHorario).min(1).max(12),
    preparoEm: esquemaInstanteCivil,
    lote: livre(30).optional(),
    observacao: livre(200).optional(),
  })
  .strict();
export type RegistrarOrdemLactarioEntrada = z.infer<typeof esquemaRegistrarOrdemLactario>;

export const SITUACOES_ORDEM_LACTARIO = ['preparada', 'conferida'] as const;
export type SituacaoOrdemLactario = (typeof SITUACOES_ORDEM_LACTARIO)[number];

export const esquemaOrdemLactarioLida = z.object({
  id: z.number().int(),
  internacao: z.number().int(),
  nome: z.string(),
  prontuario: z.number().int(),
  nascimento: z.string().nullable(),
  leito: esquemaChaveLeito,
  formula: z.string(),
  volumeMl: z.number().int(),
  horarios: z.array(z.string()),
  preparoEm: z.string(),
  validadeEm: z.string(),
  lote: z.string().nullable(),
  observacao: z.string().nullable(),
  situacao: z.enum(SITUACOES_ORDEM_LACTARIO),
  /** Vencida: a validade já passou no relógio do estabelecimento. */
  vencida: z.boolean(),
  por: z.string(),
  em: z.string(),
  conferidoPor: z.string().nullable(),
  conferidoEm: z.string().nullable(),
  /** W0-05: a ordem cancelada continua visível, com quem, quando e o motivo; a hora da primeira etiqueta emitida. */
  cancelada: z.boolean(),
  canceladaPor: z.string().nullable(),
  canceladaEm: z.string().nullable(),
  motivoCancelamento: z.string().nullable(),
  etiquetaEm: z.string().nullable(),
  /** O log das alterações (antes da conferência), do cancelamento e das etiquetas. */
  historico: z.array(esquemaAlteracaoHotLida),
});
export type OrdemLactarioLida = z.infer<typeof esquemaOrdemLactarioLida>;

export const esquemaProducaoLactario = z.object({
  data: z.string(),
  ordens: z.array(esquemaOrdemLactarioLida),
  /** Total de porções e de volume do dia, com as parcelas por fórmula. */
  totais: z.array(z.object({ formula: z.string(), porcoes: z.number().int(), volumeMl: z.number().int() })),
  validadeHoras: z.number().int(),
  lidoEm: z.string(),
});
export type ProducaoLactario = z.infer<typeof esquemaProducaoLactario>;

export const esquemaEtiquetasLactario = z.object({
  formato: z.literal('zpl'),
  conteudo: z.string(),
  nomeArquivo: z.string(),
  etiquetas: z.number().int(),
  fila: z.object({ id: z.string(), novo: z.boolean() }).nullable(),
});
export type EtiquetasLactario = z.infer<typeof esquemaEtiquetasLactario>;
