// Enfermagem beira-leito (M25; ficha, seções 5 a 8): o vocabulário da checagem, do aprazamento, dos sinais vitais, da
// infusão e da passagem de plantão. As situações de checagem do horário são as 14 do cadastro de situações do banco do
// estabelecimento, sensíveis a maiúsculas (`P` Prescrito × `p` Parcial; `E` Em infusão × `e` Executado; `N` Não
// administrado × `n` Pendente): a comparação é sempre binária. O novo grava só `A` e `N` (as únicas com profissional
// de checagem no perfil, ao lado de `S`, que vem da suspensão do M24); `p`, `E` e a situação do aprazamento nunca vistas
// ficam recusadas até o cenário controlado (convencoes §5: valor nunca visto numa coluna é recusado por padrão).
// Nenhum nome de tabela nem de coluna em texto visto pelo usuário.

/** As 14 situações de checagem do horário (código sensível a maiúsculas → rótulo de produto). */
export const SITUACOES_CHECAGEM = {
  P: 'Prescrito',
  p: 'Parcialmente administrado',
  A: 'Administrado',
  N: 'Não administrado',
  S: 'Suspenso',
  X: 'Não administrar',
  C: 'Suspenso por correção',
  O: 'Oculto',
  I: 'Incluído',
  E: 'Em infusão',
  B: 'Horário de balanço hídrico',
  e: 'Executado',
  n: 'Pendente',
  l: 'Salvo',
} as const satisfies Record<string, string>;
export type SituacaoChecagem = keyof typeof SITUACOES_CHECAGEM;
export const CODIGOS_SITUACAO_CHECAGEM = Object.keys(SITUACOES_CHECAGEM) as SituacaoChecagem[];

/** O que o novo grava no horário neste marco (vistos no perfil com profissional de checagem). */
export const SITUACOES_GRAVADAS_PELO_NOVO = ['A', 'N'] as const;
/** Nunca vistas no perfil: recusadas até o cenário controlado (M36) e a decisão registrada. */
export const SITUACOES_NUNCA_VISTAS = ['p', 'E', 'e', 'n', 'l', 'X', 'I', 'B'] as const;
/** Situação de "pendente de checagem" (a única que aceita a checagem). */
export const SITUACAO_PENDENTE: SituacaoChecagem = 'P';

/** Situação do aprazamento (cadastro de 5): o horário nasce "Sem aprazamento da enfermagem" (1) em 100%. */
export const SITUACOES_APRAZAMENTO = {
  1: 'Sem aprazamento da enfermagem',
  2: 'Aprazamento pendente',
  3: 'Aprazado',
  4: 'Suprimido por aprazamento',
  5: 'Reaprazado',
} as const;
export type SituacaoAprazamento = keyof typeof SITUACOES_APRAZAMENTO;

/** Estado do horário na linha do tempo do turno (o que a enfermagem vê). */
export const ESTADOS_HORARIO_ENFERMAGEM = [
  'pendente',
  'atrasada',
  'omitida',
  'administrada',
  'naoAdministrada',
  'suspensa',
  'outro',
] as const;
export type EstadoHorario = (typeof ESTADOS_HORARIO_ENFERMAGEM)[number];

export const ROTULOS_ESTADO_HORARIO: Readonly<Record<EstadoHorario, string>> = {
  pendente: 'A checar',
  atrasada: 'Atrasada',
  omitida: 'Omitida',
  administrada: 'Administrada',
  naoAdministrada: 'Não administrada',
  suspensa: 'Suspensa',
  outro: 'Outra situação',
};

/** Tipo do que o horário pede (do item prescrito). */
export const TIPOS_HORARIO = [
  'medicamento',
  'material',
  'solucao',
  'cuidado',
  'glicemia',
  'dieta',
  'hemoterapia',
  'ventilacao',
  'outro',
] as const;
export type TipoHorario = (typeof TIPOS_HORARIO)[number];

export const ROTULOS_TIPO_HORARIO: Readonly<Record<TipoHorario, string>> = {
  medicamento: 'Medicamento',
  material: 'Material do kit',
  solucao: 'Solução',
  cuidado: 'Cuidado ou procedimento',
  glicemia: 'Glicemia',
  dieta: 'Dieta',
  hemoterapia: 'Hemocomponente',
  ventilacao: 'Ventilação',
  outro: 'Outro',
};

/** Motivos da não administração (regra 6; lista do mercado, conferida com a enfermagem na validação). */
export const MOTIVOS_NAO_ADMINISTRACAO = {
  recusa: 'Recusa do paciente',
  jejum: 'Paciente em jejum',
  ausente: 'Paciente ausente do leito',
  faltaItem: 'Falta do item',
  intercorrencia: 'Intercorrência clínica',
  suspensaoMedica: 'Suspensão médica verbal (aguardando o registro)',
} as const;
export type MotivoNaoAdministracao = keyof typeof MOTIVOS_NAO_ADMINISTRACAO;
export const CODIGOS_MOTIVO_NAO_ADMINISTRACAO = Object.keys(
  MOTIVOS_NAO_ADMINISTRACAO,
) as MotivoNaoAdministracao[];

/** Motivos de checar sem ler a pulseira (regra 5: vai para a trilha e para o indicador). */
export const MOTIVOS_SEM_PULSEIRA = {
  pulseiraIlegivel: 'Pulseira ilegível ou danificada',
  semPulseira: 'Paciente sem pulseira (providenciar a reimpressão)',
  leitorIndisponivel: 'Leitor ou câmera indisponível',
  urgencia: 'Urgência (administração imediata)',
} as const;
export type MotivoSemPulseira = keyof typeof MOTIVOS_SEM_PULSEIRA;

/** Eventos de infusão contínua (regra 11). */
export const EVENTOS_INFUSAO = {
  inicio: 'Início',
  pausa: 'Pausa',
  retomada: 'Retomada',
  trocaBolsa: 'Troca de bolsa',
  velocidade: 'Mudança de velocidade',
  fim: 'Fim',
} as const;
export type EventoInfusao = keyof typeof EVENTOS_INFUSAO;

/** Sinais vitais e controles estruturados (regra 13): unidade padronizada e faixa plausível. */
export const SINAIS_VITAIS = {
  pas: { rotulo: 'Pressão arterial sistólica', unidade: 'mmHg', minimo: 40, maximo: 300, alerta: [90, 180] },
  pad: { rotulo: 'Pressão arterial diastólica', unidade: 'mmHg', minimo: 20, maximo: 200, alerta: [50, 110] },
  fc: { rotulo: 'Frequência cardíaca', unidade: 'bpm', minimo: 20, maximo: 250, alerta: [50, 120] },
  fr: { rotulo: 'Frequência respiratória', unidade: 'irpm', minimo: 4, maximo: 70, alerta: [10, 25] },
  temperatura: { rotulo: 'Temperatura', unidade: '°C', minimo: 30, maximo: 43, alerta: [35.5, 37.8] },
  spo2: { rotulo: 'Saturação de oxigênio', unidade: '%', minimo: 50, maximo: 100, alerta: [92, 100] },
  o2: { rotulo: 'Oxigênio suplementar', unidade: 'L/min', minimo: 0, maximo: 60, alerta: [0, 15] },
  acvpu: { rotulo: 'Nível de consciência (ACVPU)', unidade: 'escala', minimo: 0, maximo: 4, alerta: [0, 0] },
  dor: { rotulo: 'Dor', unidade: '0 a 10', minimo: 0, maximo: 10, alerta: [0, 6] },
  glicemia: { rotulo: 'Glicemia capilar', unidade: 'mg/dL', minimo: 10, maximo: 900, alerta: [70, 250] },
  peso: { rotulo: 'Peso', unidade: 'kg', minimo: 0.3, maximo: 400, alerta: [0.3, 400] },
  altura: { rotulo: 'Altura', unidade: 'cm', minimo: 20, maximo: 250, alerta: [20, 250] },
  diurese: { rotulo: 'Diurese', unidade: 'mL', minimo: 0, maximo: 10000, alerta: [0, 10000] },
} as const;
export type TipoSinalVital = keyof typeof SINAIS_VITAIS;
export const TIPOS_SINAL_VITAL = Object.keys(SINAIS_VITAIS) as TipoSinalVital[];

/** ACVPU: Alerta, Confusão nova, Voz, Dor, sem resposta (Unresponsive), de 0 a 4. */
export const ESCALA_ACVPU = [
  'Alerta',
  'Confusão nova',
  'Responde à voz',
  'Responde à dor',
  'Sem resposta',
] as const;

/** Métodos de aferição (opcional). */
export const METODOS_SINAL = [
  'manual',
  'monitor',
  'capilar',
  'axilar',
  'timpanica',
  'oral',
  'invasiva',
] as const;
export type MetodoSinal = (typeof METODOS_SINAL)[number];

/** Turnos de 12 h da enfermagem (padrão do mercado; a janela do turno vem do parâmetro da unidade). */
export const TURNOS = ['diurno', 'noturno'] as const;
export type Turno = (typeof TURNOS)[number];

/** Partes da nota SBAR da passagem de plantão (regra 14). */
export const PARTES_SBAR = {
  situacao: 'Situação',
  historia: 'Breve histórico',
  avaliacao: 'Avaliação',
  recomendacao: 'Recomendação',
} as const;
export type ParteSbar = keyof typeof PARTES_SBAR;

/** Tipos de pendência herdada na passagem de plantão. */
export const PENDENCIAS_PLANTAO = {
  doseAtrasada: 'Dose atrasada',
  doseOmitida: 'Dose omitida',
  exameColher: 'Exame a colher',
  cuidadoNaoFeito: 'Cuidado não feito',
  conflito: 'Conflito de sincronização aberto',
} as const;
export type PendenciaPlantao = keyof typeof PENDENCIAS_PLANTAO;

/** Resolução de um conflito de sincronização (regra 8: nunca sobrescreve). */
export const RESOLUCOES_CONFLITO = {
  descartado: 'Ato descartado (o horário já estava resolvido)',
  registradoComoNota: 'Registrado como anotação de enfermagem',
  farmaciaAvisada: 'Farmácia avisada (devolução da dose)',
} as const;
export type ResolucaoConflito = keyof typeof RESOLUCOES_CONFLITO;

/** Mensagens de produto da beira do leito (nunca o nome do outro sistema nem da tabela). */
export const MENSAGENS_ENFERMAGEM = {
  horarioMudou:
    'O horário mudou desde que a tela foi aberta (suspensão ou checagem feita em outro terminal): nada foi gravado. Abra o horário de novo.',
  horarioEmEdicao:
    'O horário está sendo checado em outro terminal neste momento: tente de novo em instantes.',
  situacaoNuncaVista:
    'Esta situação de checagem ainda não é gravada pela beira do leito: use administrado ou não administrado.',
  aprazamentoGravado: 'Aprazamento gravado no horário da prescrição.',
  estornoGravado:
    'Checagem estornada: o horário voltou a não checado e o estorno fica no histórico com o motivo.',
  estornoComDevolucaoPendente:
    'Checagem estornada com a devolução da dose pendente: a farmácia vê a pendência até a devolução.',
  semRede:
    'Sem rede: a checagem, o sinal vital e a anotação ficam guardados neste aparelho e são enviados na ordem quando a rede voltar.',
} as const;
