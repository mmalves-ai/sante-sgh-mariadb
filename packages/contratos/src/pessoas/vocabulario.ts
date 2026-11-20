// Vocabulário da gestão de pessoas, fatia F1 (M52; ficha, seções 5 a 8; cap-07 §7.1.1): colaborador, vínculo de
// trabalho, lotação, desligamento ligado ao acesso e validade do conselho. Os códigos lidos do outro sistema foram
// levantados na cópia do pc em 24/10/2026, só contagens. A tela mostra o rótulo, nunca o código cru nem o nome da
// tabela (ADR 0023).

/** Tipo do vínculo de trabalho (SGH_PES_VINCULO.TIPO; ficha, seção 6). Recurso novo: não há tabela no outro sistema. */
export const TIPOS_VINCULO = {
  clt: 'CLT',
  estatutario: 'Estatutário',
  cooperado: 'Cooperado',
  pj: 'Pessoa jurídica',
  residente: 'Residente',
  estagiario: 'Estagiário',
  terceiro: 'Terceiro',
} as const;
export type TipoVinculo = keyof typeof TIPOS_VINCULO;
export const CODIGOS_TIPO_VINCULO = Object.keys(TIPOS_VINCULO) as TipoVinculo[];

/**
 * Tipos de vínculo que entram no repasse como prestador e nunca na folha do Sante SGH (ficha, seção 5, "Só para
 * prestador (não CLT)"). O cooperado e a PJ recebem pelo repasse; o terceiro é da empresa contratada.
 */
export const VINCULOS_PRESTADOR: readonly TipoVinculo[] = ['cooperado', 'pj', 'terceiro'];

/** Estado do vínculo (derivado das datas: não é coluna editável). */
export const ESTADOS_VINCULO = ['ativo', 'desligado'] as const;
export type EstadoVinculo = (typeof ESTADOS_VINCULO)[number];

/**
 * `TBPROFIS.SITUACAO` (DP-46.1; ref 02; Anexo A): na cópia do pc, O 758, F 109 e E 4 profissionais. Baixa confiança:
 * NÃO define vínculo trabalhista (regra 4). A tela mostra a legenda com "a confirmar" ao lado.
 */
export const SITUACOES_PROFISSIONAL_LEGADO = {
  O: 'Outro (a confirmar)',
  F: 'Funcionário (a confirmar)',
  E: 'Externo (a confirmar)',
} as const;
export type SituacaoProfissionalLegado = keyof typeof SITUACOES_PROFISSIONAL_LEGADO;

/**
 * Conselhos de classe vistos em `TBCBOPRO.CONS_PROF` na cópia do pc (2.095 registros: CRM 1.211, COREN 694,
 * CREFITO 54, CRF 46, CRO 46, CRN 24, CRP 8, OUT 6, CRB <5, CRBIO <5, vazio <5). "OUT" é "outro conselho".
 */
export const CONSELHOS_CLASSE = {
  CRM: 'Conselho Regional de Medicina',
  COREN: 'Conselho Regional de Enfermagem',
  CREFITO: 'Conselho Regional de Fisioterapia e Terapia Ocupacional',
  CRF: 'Conselho Regional de Farmácia',
  CRO: 'Conselho Regional de Odontologia',
  CRN: 'Conselho Regional de Nutricionistas',
  CRP: 'Conselho Regional de Psicologia',
  CRB: 'Conselho Regional de Biblioteconomia (a confirmar)',
  CRBIO: 'Conselho Regional de Biologia',
  OUT: 'Outro conselho',
} as const;
export type ConselhoClasse = keyof typeof CONSELHOS_CLASSE;

/** Situação da habilitação no conselho acompanhada pelo RH (SGH_PES_HABILITACAO; regra 3). */
export const SITUACOES_HABILITACAO = {
  valida: 'Válida',
  aVencer: 'Vence em breve',
  vencida: 'Vencida',
  semValidade: 'Validade não informada',
} as const;
export type SituacaoHabilitacao = keyof typeof SITUACOES_HABILITACAO;

/** Janela do alerta de vencimento do conselho (ficha, seção 4: "vencimento nos próximos 60 dias"). */
export const JANELA_ALERTA_CONSELHO_DIAS = 60;

/** Evento do outbox do desligamento (ficha, seção 5, passo 3). */
export const EVENTO_COLABORADOR_DESLIGADO = 'PESSOAS_COLABORADOR_DESLIGADO';
/** Evento do outbox da admissão (o M53 consome para a folha; DP-10). */
export const EVENTO_COLABORADOR_ADMITIDO = 'PESSOAS_COLABORADOR_ADMITIDO';

/** O que o histórico funcional registra (SGH_PES_HISTORICO; só inclusão). */
export const TIPOS_EVENTO_HISTORICO = {
  admissao: 'Admissão',
  cargo: 'Mudança de cargo',
  funcao: 'Mudança de função',
  lotacao: 'Mudança de lotação',
  jornada: 'Mudança de jornada',
  desligamento: 'Desligamento',
  /** W0-06: correção cadastral (nome, matrícula, tipo de vínculo ou admissão) com motivo. */
  correcao: 'Correção cadastral',
} as const;
export type TipoEventoHistorico = keyof typeof TIPOS_EVENTO_HISTORICO;

/**
 * Parentesco do dependente (SGH_PES_DEPENDENTE): os códigos do eSocial (tabela 07), os mesmos que o domínio de tipos
 * de dependente do ramo (11 linhas no pc) usa; o M53 confere com o domínio lido na hora da folha.
 */
export const PARENTESCOS_DEPENDENTE = {
  '01': 'Cônjuge',
  '02': 'Companheiro(a) com quem tenha filho ou viva há mais de 5 anos',
  '03': 'Filho(a) ou enteado(a)',
  '04': 'Filho(a) ou enteado(a) universitário(a) ou cursando escola técnica, até 24 anos',
  '06': 'Irmão(ã), neto(a) ou bisneto(a) com guarda judicial',
  '09': 'Pais, avós e bisavós',
  '10': 'Menor pobre do qual detenha a guarda judicial',
  '11': 'A pessoa absolutamente incapaz da qual seja tutor ou curador',
  '12': 'Ex-cônjuge',
  '99': 'Agregado/Outros',
} as const;
export type ParentescoDependente = keyof typeof PARENTESCOS_DEPENDENTE;
