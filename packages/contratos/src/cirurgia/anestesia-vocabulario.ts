// Vocabulário da anestesia no bloco (ficha do M46, etapa 1: APA, ficha anestésica e SRPA; cap-05a §5.5; Resolução CFM
// 2.174/2017). O que o novo decide sozinho como padrão de mercado (POL-1; ajustar com o anestesista chave-usuário,
// DP-3): classes ASA, Mallampati, jejum (ASA 2017), risco cardíaco de Lee, sinais monitorados na ficha, gases, vias,
// fluidos, perdas, eventos, marcos de tempo e o índice de Aldrete-Kroulik da recuperação.
//
// O que vem do banco (domínios lidos, nunca gravados pelo novo nesta etapa; IDs do outro estabelecimento podem
// diferir, por isso a tela lê a tabela e não fixa o ID): tipo de anestesia (TBANESTESIA, 17 na cópia pc), posição
// cirúrgica (PRFA_CAD_POSICAO_CIR, 9), modo respiratório (PRFA_CAD_MODO_RESPIR, 3), função na equipe
// (PRTIPO_PROFISSIONAL, 9) e utilização (PRFA_UTILIZACAO, 3). Os cadastros de gás (PRFA_CAD_GAS), de incidente
// (PRFA_CAD_INCIDENTE) e de sinal vital (PRSINALVITAL) estão VAZIOS na cópia pc (0 linhas): por isso gases, eventos e
// sinais da ficha são vocabulário do novo, com a sigla do cadastro antigo quando ele existe (PRFA_TIPO_SINAL: FC,
// PAS, PAD).

// ── APA ──────────────────────────────────────────────────────────────────────────────────────────────────────────

/** Estado físico ASA (I a VI); o "E" (emergência) é um modificador à parte. */
export const CLASSES_ASA = [
  { classe: 1, rotulo: 'ASA I', descricao: 'Paciente saudável' },
  { classe: 2, rotulo: 'ASA II', descricao: 'Doença sistêmica leve' },
  { classe: 3, rotulo: 'ASA III', descricao: 'Doença sistêmica grave' },
  { classe: 4, rotulo: 'ASA IV', descricao: 'Doença sistêmica grave, ameaça constante à vida' },
  { classe: 5, rotulo: 'ASA V', descricao: 'Moribundo, sem expectativa de sobreviver sem a cirurgia' },
  { classe: 6, rotulo: 'ASA VI', descricao: 'Morte encefálica, doador de órgãos' },
] as const;
export type ClasseAsa = (typeof CLASSES_ASA)[number]['classe'];

/** Mallampati modificado (I a IV). */
export const CLASSES_MALLAMPATI = [1, 2, 3, 4] as const;
export type ClasseMallampati = (typeof CLASSES_MALLAMPATI)[number];

/**
 * Jejum pré-operatório (ASA 2017, padrão de mercado; parâmetro conferido pelo anestesista): horas mínimas desde a
 * última ingestão de cada tipo.
 */
export const JEJUM_MINIMO_HORAS = {
  liquidosClaros: 2,
  leiteMaterno: 4,
  refeicaoLeve: 6,
  refeicaoGordurosa: 8,
} as const;
export type TipoIngestao = keyof typeof JEJUM_MINIMO_HORAS;
export const TIPOS_INGESTAO = Object.keys(JEJUM_MINIMO_HORAS) as TipoIngestao[];

/** Índice de risco cardíaco revisado de Lee (RCRI): um ponto por critério; classe I (0) a IV (3 ou mais). */
export const CRITERIOS_LEE = [
  {
    codigo: 'cirurgia-alto-risco',
    rotulo: 'Cirurgia intraperitoneal, intratorácica ou vascular suprainguinal',
  },
  { codigo: 'cardiopatia-isquemica', rotulo: 'Cardiopatia isquêmica' },
  { codigo: 'insuficiencia-cardiaca', rotulo: 'Insuficiência cardíaca' },
  { codigo: 'doenca-cerebrovascular', rotulo: 'Doença cerebrovascular' },
  { codigo: 'diabetes-insulina', rotulo: 'Diabetes em uso de insulina' },
  { codigo: 'creatinina-alta', rotulo: 'Creatinina acima de 2 mg/dL' },
] as const;
export type CriterioLee = (typeof CRITERIOS_LEE)[number]['codigo'];

/** Conclusão da APA. "apto" e "apto-ressalvas" fecham a pendência de APA do agendamento (M18). */
export const CONCLUSOES_APA = [
  { codigo: 'apto', rotulo: 'Apto' },
  { codigo: 'apto-ressalvas', rotulo: 'Apto com ressalvas' },
  { codigo: 'reavaliar', rotulo: 'Reavaliar antes da cirurgia' },
  { codigo: 'inapto', rotulo: 'Inapto no momento' },
] as const;
export type ConclusaoApa = (typeof CONCLUSOES_APA)[number]['codigo'];

// ── Ficha anestésica ─────────────────────────────────────────────────────────────────────────────────────────────

/** Intervalo máximo entre registros de sinais vitais na ficha (regra 3: a cada 5 minutos). */
export const INTERVALO_SINAIS_FICHA_MIN = 5;

/**
 * Sinais monitorados na ficha: unidade, faixa plausível (fora dela é erro de digitação) e se a grade de 5 minutos
 * cobra o sinal (obrigatório). A sigla do cadastro antigo (PRFA_TIPO_SINAL) vai junto quando existe.
 */
export const SINAIS_FICHA = {
  pas: {
    rotulo: 'Pressão arterial sistólica',
    unidade: 'mmHg',
    minimo: 20,
    maximo: 300,
    obrigatorio: true,
    sigla: 'PAS',
  },
  pad: {
    rotulo: 'Pressão arterial diastólica',
    unidade: 'mmHg',
    minimo: 10,
    maximo: 200,
    obrigatorio: true,
    sigla: 'PAD',
  },
  pam: {
    rotulo: 'Pressão arterial média',
    unidade: 'mmHg',
    minimo: 15,
    maximo: 250,
    obrigatorio: false,
    sigla: null,
  },
  fc: {
    rotulo: 'Frequência cardíaca',
    unidade: 'bpm',
    minimo: 10,
    maximo: 300,
    obrigatorio: true,
    sigla: 'FC',
  },
  spo2: {
    rotulo: 'Saturação de oxigênio',
    unidade: '%',
    minimo: 30,
    maximo: 100,
    obrigatorio: true,
    sigla: null,
  },
  etco2: { rotulo: 'CO₂ expirado', unidade: 'mmHg', minimo: 0, maximo: 120, obrigatorio: false, sigla: null },
  fr: {
    rotulo: 'Frequência respiratória',
    unidade: 'irpm',
    minimo: 0,
    maximo: 70,
    obrigatorio: false,
    sigla: null,
  },
  temperatura: {
    rotulo: 'Temperatura',
    unidade: '°C',
    minimo: 25,
    maximo: 43,
    obrigatorio: false,
    sigla: null,
  },
  bis: {
    rotulo: 'Índice bispectral',
    unidade: '0 a 100',
    minimo: 0,
    maximo: 100,
    obrigatorio: false,
    sigla: null,
  },
} as const;
export type SinalFicha = keyof typeof SINAIS_FICHA;
export const TIPOS_SINAL_FICHA = Object.keys(SINAIS_FICHA) as SinalFicha[];
export const SINAIS_FICHA_OBRIGATORIOS = TIPOS_SINAL_FICHA.filter((s) => SINAIS_FICHA[s].obrigatorio);

/** Gases e agentes inalatórios (o cadastro antigo de gases está vazio). */
export const GASES_FICHA = {
  o2: { rotulo: 'Oxigênio', unidade: 'L/min' },
  ar: { rotulo: 'Ar comprimido', unidade: 'L/min' },
  n2o: { rotulo: 'Óxido nitroso', unidade: 'L/min' },
  sevoflurano: { rotulo: 'Sevoflurano', unidade: '%' },
  isoflurano: { rotulo: 'Isoflurano', unidade: '%' },
  desflurano: { rotulo: 'Desflurano', unidade: '%' },
} as const;
export type GasFicha = keyof typeof GASES_FICHA;
export const TIPOS_GAS_FICHA = Object.keys(GASES_FICHA) as GasFicha[];

export const VIAS_FICHA = [
  { codigo: 'ev', rotulo: 'Endovenosa' },
  { codigo: 'im', rotulo: 'Intramuscular' },
  { codigo: 'sc', rotulo: 'Subcutânea' },
  { codigo: 'inalatoria', rotulo: 'Inalatória' },
  { codigo: 'peridural', rotulo: 'Peridural' },
  { codigo: 'intratecal', rotulo: 'Intratecal' },
  { codigo: 'perineural', rotulo: 'Perineural' },
  { codigo: 'topica', rotulo: 'Tópica' },
  { codigo: 'oral', rotulo: 'Oral' },
] as const;
export type ViaFicha = (typeof VIAS_FICHA)[number]['codigo'];

/** Ganhos (fluidos e hemoderivados): vão ao balanço hídrico do M45 uma vez só (regra 3). */
export const FLUIDOS_FICHA = [
  { codigo: 'cristaloide', rotulo: 'Cristaloide', hemocomponente: false },
  { codigo: 'coloide', rotulo: 'Coloide', hemocomponente: false },
  { codigo: 'concentrado-hemacias', rotulo: 'Concentrado de hemácias', hemocomponente: true },
  { codigo: 'plasma', rotulo: 'Plasma fresco congelado', hemocomponente: true },
  { codigo: 'plaquetas', rotulo: 'Concentrado de plaquetas', hemocomponente: true },
  { codigo: 'crioprecipitado', rotulo: 'Crioprecipitado', hemocomponente: true },
  { codigo: 'outro', rotulo: 'Outro fluido', hemocomponente: false },
] as const;
export type FluidoFicha = (typeof FLUIDOS_FICHA)[number]['codigo'];

export const PERDAS_FICHA = [
  { codigo: 'sangramento', rotulo: 'Sangramento' },
  { codigo: 'diurese', rotulo: 'Diurese' },
  { codigo: 'aspiracao', rotulo: 'Aspiração' },
  { codigo: 'outra', rotulo: 'Outra perda' },
] as const;
export type PerdaFicha = (typeof PERDAS_FICHA)[number]['codigo'];

/** Eventos e intercorrências (o cadastro antigo de incidentes está vazio). */
export const EVENTOS_FICHA = [
  { codigo: 'intubacao', rotulo: 'Intubação', intercorrencia: false },
  { codigo: 'extubacao', rotulo: 'Extubação', intercorrencia: false },
  { codigo: 'via-aerea-dificil', rotulo: 'Via aérea difícil', intercorrencia: true },
  { codigo: 'hipotensao', rotulo: 'Hipotensão', intercorrencia: true },
  { codigo: 'hipertensao', rotulo: 'Hipertensão', intercorrencia: true },
  { codigo: 'bradicardia', rotulo: 'Bradicardia', intercorrencia: true },
  { codigo: 'arritmia', rotulo: 'Arritmia', intercorrencia: true },
  { codigo: 'broncoespasmo', rotulo: 'Broncoespasmo', intercorrencia: true },
  { codigo: 'laringoespasmo', rotulo: 'Laringoespasmo', intercorrencia: true },
  { codigo: 'dessaturacao', rotulo: 'Dessaturação', intercorrencia: true },
  { codigo: 'reacao-alergica', rotulo: 'Reação alérgica', intercorrencia: true },
  { codigo: 'parada-cardiaca', rotulo: 'Parada cardiorrespiratória', intercorrencia: true },
  { codigo: 'outro', rotulo: 'Outro evento', intercorrencia: false },
] as const;
export type EventoFicha = (typeof EVENTOS_FICHA)[number]['codigo'];

/** Marcos de tempo da ficha, na ordem em que acontecem (a incisão é a mesma do registro do M18). */
export const MARCOS_FICHA = [
  { codigo: 'entradaSala', rotulo: 'Entrada na sala' },
  { codigo: 'inicioAnestesia', rotulo: 'Início da anestesia' },
  { codigo: 'inicioCirurgia', rotulo: 'Início da cirurgia (incisão)' },
  { codigo: 'fimCirurgia', rotulo: 'Fim da cirurgia' },
  { codigo: 'fimAnestesia', rotulo: 'Fim da anestesia' },
  { codigo: 'saidaSala', rotulo: 'Saída da sala' },
] as const;
export type MarcoFicha = (typeof MARCOS_FICHA)[number]['codigo'];

/**
 * Partes da ficha. Cada uma vira uma tabela SGH_CC_FA_<parte> com a estrutura que o cadastro antigo previu nas
 * PRFA_LANC_ANEST_<parte> (vazias e NÃO usadas: FK restritiva para o agendamento, regra 12). A tabela antiga fica só
 * como referência de estrutura.
 */
export const PARTES_FICHA = [
  { parte: 'sinal', tabelaSgh: 'SGH_CC_FA_MONITORIZ', referencia: 'PRFA_LANC_ANEST_MONITORIZ' },
  { parte: 'medicamento', tabelaSgh: 'SGH_CC_FA_MEDICAMENTO', referencia: 'PRFA_LANC_ANEST_MEDICAMENTO' },
  { parte: 'gas', tabelaSgh: 'SGH_CC_FA_CAD_GAS', referencia: 'PRFA_LANC_ANEST_CAD_GAS' },
  { parte: 'fluido', tabelaSgh: 'SGH_CC_FA_GANHO', referencia: 'PRFA_LANC_ANEST_GANHO' },
  { parte: 'perda', tabelaSgh: 'SGH_CC_FA_PERDA', referencia: 'PRFA_LANC_ANEST_PERDA' },
  { parte: 'evento', tabelaSgh: 'SGH_CC_FA_INCIDENTE', referencia: 'PRFA_LANC_ANEST_INCIDENTE' },
  {
    parte: 'modoRespiratorio',
    tabelaSgh: 'SGH_CC_FA_MODO_RESPIR',
    referencia: 'PRFA_LANC_ANEST_MODO_RESPIR',
  },
  { parte: 'posicao', tabelaSgh: 'SGH_CC_FA_POSICAO_CIR', referencia: 'PRFA_LANC_ANEST_POSICAO_CIR' },
  { parte: 'procedimento', tabelaSgh: 'SGH_CC_FA_PROCED', referencia: 'PRFA_LANC_ANEST_PROCED' },
  { parte: 'exame', tabelaSgh: 'SGH_CC_FA_EXAME', referencia: 'PRFA_LANC_ANEST_EXAME' },
  { parte: 'equipe', tabelaSgh: 'SGH_CC_FA_EQUIPE_CIR', referencia: 'PRFA_LANC_ANEST_EQUIPE_CIR' },
  { parte: 'avulso', tabelaSgh: 'SGH_CC_FA_ITEM_AVULSO', referencia: 'PRFA_LANC_ANEST_ITEM_AVULSO' },
  { parte: 'bi', tabelaSgh: 'SGH_CC_FA_BI', referencia: 'PRFA_LANC_ANEST_BI' },
] as const;
export type ParteFicha = (typeof PARTES_FICHA)[number]['parte'];

/** Situação da ficha: aberta (lançando), encerrada (fim da anestesia), assinada (imutável; correção só por adendo). */
export const SITUACOES_FICHA = ['aberta', 'encerrada', 'assinada'] as const;
export type SituacaoFicha = (typeof SITUACOES_FICHA)[number];

// ── SRPA ─────────────────────────────────────────────────────────────────────────────────────────────────────────

/** Intervalo máximo entre avaliações na recuperação (regra 4: a cada 15 minutos). */
export const INTERVALO_AVALIACAO_SRPA_MIN = 15;

/** Índice de Aldrete-Kroulik (modificado, com a saturação): cinco itens de 0 a 2; total de 0 a 10. */
export const ITENS_ALDRETE = [
  {
    item: 'atividade',
    rotulo: 'Atividade',
    niveis: ['Não move nenhum membro', 'Move dois membros', 'Move os quatro membros'],
  },
  {
    item: 'respiracao',
    rotulo: 'Respiração',
    niveis: ['Apneia', 'Dispneia ou respiração limitada', 'Respira e tosse livremente'],
  },
  {
    item: 'circulacao',
    rotulo: 'Circulação',
    niveis: [
      'Pressão arterial com variação acima de 50% do pré-anestésico',
      'Pressão arterial com variação de 20% a 50%',
      'Pressão arterial com variação de até 20%',
    ],
  },
  {
    item: 'consciencia',
    rotulo: 'Consciência',
    niveis: ['Não responde', 'Desperta ao chamado', 'Lúcido e orientado'],
  },
  {
    item: 'saturacao',
    rotulo: 'Saturação de oxigênio',
    niveis: [
      'Abaixo de 90% mesmo com oxigênio',
      'Precisa de oxigênio para manter acima de 90%',
      'Acima de 92% em ar ambiente',
    ],
  },
] as const;
export type ItemAldrete = (typeof ITENS_ALDRETE)[number]['item'];
export const CODIGOS_ITEM_ALDRETE = ITENS_ALDRETE.map((i) => i.item) as ItemAldrete[];

/** Náusea e vômito pós-operatório. */
export const NIVEIS_NVPO = [
  { nivel: 0, rotulo: 'Sem náusea' },
  { nivel: 1, rotulo: 'Náusea' },
  { nivel: 2, rotulo: 'Vômito' },
] as const;

export const MOMENTOS_SRPA = ['admissao', 'avaliacao', 'alta'] as const;
export type MomentoSrpa = (typeof MOMENTOS_SRPA)[number];

export const DESTINOS_ALTA_SRPA = [
  { codigo: 'unidade', rotulo: 'Unidade de internação' },
  { codigo: 'domicilio', rotulo: 'Domicílio (cirurgia ambulatorial)' },
  { codigo: 'uti', rotulo: 'Unidade de terapia intensiva' },
] as const;
export type DestinoAltaSrpa = (typeof DESTINOS_ALTA_SRPA)[number]['codigo'];

/**
 * Regra versionada da alta da SRPA (regra 4). Padrão de mercado (POL-1; o anestesista chave-usuário confirma, DP-3):
 * Aldrete-Kroulik de 9 ou mais, nenhum item em 0, dor até 3, sem vômito na última avaliação e ao menos 30 minutos
 * de permanência. A ida para a UTI não exige o índice (o paciente segue monitorado), mas exige o motivo.
 */
export interface RegraAltaSrpa {
  readonly versao: number;
  readonly vigenteDesde: string;
  readonly aldreteMinimo: number;
  readonly nenhumItemZero: boolean;
  readonly dorMaxima: number;
  readonly semVomito: boolean;
  readonly permanenciaMinimaMin: number;
  readonly destinosSemIndice: readonly DestinoAltaSrpa[];
}

export const REGRA_ALTA_SRPA_V1: RegraAltaSrpa = {
  versao: 1,
  vigenteDesde: '2026-10-24',
  aldreteMinimo: 9,
  nenhumItemZero: true,
  dorMaxima: 3,
  semVomito: true,
  permanenciaMinimaMin: 30,
  destinosSemIndice: ['uti'],
};

// ── Recusas (código → texto na tela; i18n `anestesia.recusas`) ───────────────────────────────────────────────────

export const RECUSAS_ANESTESIA = [
  'apa-asa-emergencia',
  'apa-jejum-insuficiente',
  'apa-alergias-nao-conferidas',
  'apa-agendamento-fechado',
  'ficha-assinada',
  'ficha-encerrada',
  'ficha-fora-da-janela',
  'ficha-sinal-implausivel',
  'ficha-marco-fora-de-ordem',
  'ficha-marco-repetido',
  'ficha-gas-sem-fim',
  'ficha-lacuna-sinais',
  'ficha-sem-fim-anestesia',
  'ficha-nao-e-anestesista',
  'ficha-passagem-mesmo-anestesista',
  'ficha-passagem-nao-responsavel',
  'ficha-passagem-fora-de-ordem',
  'ficha-fluido-ja-no-balanco',
  'srpa-sem-admissao',
  'srpa-ja-com-alta',
  'srpa-fora-de-ordem',
  'srpa-indice-insuficiente',
  'srpa-item-zero',
  'srpa-dor-alta',
  'srpa-vomito',
  'srpa-permanencia-curta',
  'srpa-avaliacao-vencida',
  'srpa-motivo-obrigatorio',
  'anestesia-horario-futuro',
  'apa-mudou',
  'ficha-mudou',
  'srpa-mudou',
  'ficha-lancamento-sem-fim',
  'ficha-nao-assinada',
  'ficha-sem-ficha',
] as const;
export type RecusaAnestesia = (typeof RECUSAS_ANESTESIA)[number];
