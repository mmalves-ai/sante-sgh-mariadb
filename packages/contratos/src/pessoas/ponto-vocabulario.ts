// Vocabulário do ponto, fatia F4 (M52.4; ficha do M52, seções 6 a 8, regras 11 a 15; cap-07 §7.1.3; Portaria MTP
// 671/2021): importação e validação do AFD dos relógios de mercado, marcações só de inclusão, ajustes e justificativas
// com aprovador, apuração contra a escala publicada, banco de horas por regra, espelho com a ciência do colaborador e o
// AEJ. Recurso novo: as estruturas de AFD do outro sistema estão vazias e não se usam (ficha, seção 6); os domínios do
// ramo (classificação de horas, tipos de integração com a folha, banco de horas, motivos e períodos de justificativa,
// tipos de movimento e modelos de relógio) são lidos onde estão, pelo código. A tela mostra o rótulo, nunca o código cru
// nem o nome da tabela (ADR 0023). O Sante SGH NÃO é REP-P por padrão: trata as marcações dos relógios (regra 11).

/** Chave de liberação do ponto (SGH_CFG_LIBERACAO; ficha, seção 12). */
export const CHAVE_PESSOAS_PONTO = 'pessoas.ponto';
/** Parâmetro da biometria no ponto (regra 15; DP-45): desligado por padrão, só com a base legal registrada pelo DPO. */
export const PARAMETRO_BIOMETRIA_PONTO = 'pessoas.ponto.biometria';

/** Tipo do registrador (Portaria 671/2021, art. 75): convencional, alternativo (acordo coletivo) ou por programa. */
export const TIPOS_REP = {
  'REP-C': 'Relógio convencional (REP-C)',
  'REP-A': 'Registrador alternativo (REP-A, por acordo coletivo)',
  'REP-P': 'Registrador por programa (REP-P)',
} as const;
export type TipoRep = keyof typeof TIPOS_REP;
export const CODIGOS_TIPO_REP = Object.keys(TIPOS_REP) as TipoRep[];

/** Situação do arquivo importado (regra 12: com qualquer defeito, o arquivo inteiro fica em quarentena). */
export const SITUACOES_AFD = {
  importado: 'Importado',
  quarentena: 'Em quarentena (nenhuma marcação entrou)',
} as const;
export type SituacaoAfd = keyof typeof SITUACOES_AFD;

/**
 * Motivos da quarentena (regra 12; ficha, campo 10: "AFD sintético com falhas"). O relatório leva o motivo e o número
 * da linha, nunca o conteúdo da linha (que tem o CPF do empregado).
 */
export const FALHAS_AFD = {
  vazio: 'Arquivo vazio',
  'sem-cabecalho': 'Falta o registro de cabeçalho (tipo 1) na primeira linha',
  'cabecalho-invalido': 'Cabeçalho com campo inválido',
  'leiaute-nao-suportado': 'Versão do leiaute diferente da configurada',
  'tipo-desconhecido': 'Linha com tipo de registro desconhecido',
  tamanho: 'Linha com tamanho diferente do leiaute do tipo de registro',
  'sequencia-quebrada': 'Sequência dos números dos registros (NSR) quebrada',
  'nsr-duplicado': 'Número de registro (NSR) repetido',
  'marcacao-duplicada': 'Marcação repetida (mesmo empregado, mesmo instante)',
  crc: 'Código de verificação (CRC-16) da linha não confere',
  'data-invalida': 'Data e hora inválidas',
  'fora-do-periodo': 'Marcação fora do período declarado no cabeçalho',
  'cpf-invalido': 'CPF do empregado inválido',
  'sem-trailer': 'Falta o registro final (trailer)',
  'trailer-divergente': 'Contagem do registro final não confere com as linhas do arquivo',
  'depois-do-trailer': 'Linha depois do registro final',
  'hash-invalido': 'Código hash da marcação do REP-P inválido',
} as const;
export type FalhaAfd = keyof typeof FALHAS_AFD;
export const CODIGOS_FALHA_AFD = Object.keys(FALHAS_AFD) as FalhaAfd[];

/** Leiaute do AFD aceito por padrão (Portaria 671/2021, Anexo V: versão "003"); parâmetro `pessoas.ponto.leiauteAfd`. */
export const LEIAUTE_AFD_PADRAO = '003';
/** Teto do arquivo AFD por envio, em caracteres (o corpo HTTP é de 1 MiB; um relógio exporta por período). */
export const TETO_ARQUIVO_AFD = 1_000_000;

/**
 * Classificação das horas da apuração (domínio de tipos de hora do ramo, 9; ref 02). O rótulo lido no domínio vale; este é o
 * padrão quando a linha não existir. A apuração usa sempre estes códigos.
 */
export const CLASSES_HORA = {
  1: 'Horas trabalhadas',
  2: 'Atrasos e débitos',
  3: 'Horas extras (trabalho em descanso semanal)',
  4: 'Horas extras (trabalho em feriado)',
  5: 'Horas extras (períodos excedentes)',
  6: 'Horas extras (intervalo intrajornada não concedido)',
  7: 'Falta',
  8: 'Falta abonada',
  9: 'Tolerância (atrasos e débitos)',
} as const;
export type ClasseHora = keyof typeof CLASSES_HORA;
export const CODIGOS_CLASSE_HORA = Object.keys(CLASSES_HORA).map(Number) as ClasseHora[];

/**
 * Tipos de integração com a folha (domínio de tipos de integração do ramo, 13; ref 02; regra 13). A exportação leva os
 * minutos de cada tipo; a folha do M53 (DP-10) consome os mesmos códigos.
 */
export const EVENTOS_FOLHA = {
  1: 'Horas trabalhadas',
  2: 'Descanso semanal remunerado (desconto)',
  3: 'Faltas',
  4: 'Atrasos',
  5: 'Adicional noturno',
  6: '1ª faixa de hora extra em feriado',
  7: '2ª faixa de hora extra em feriado',
  8: '1ª faixa de hora extra em descanso semanal',
  9: '2ª faixa de hora extra em descanso semanal',
  10: '1ª faixa de hora extra',
  11: '2ª faixa de hora extra',
  12: '3ª faixa de hora extra',
  13: '4ª faixa de hora extra',
} as const;
export type EventoFolha = keyof typeof EVENTOS_FOLHA;
export const CODIGOS_EVENTO_FOLHA = Object.keys(EVENTOS_FOLHA).map(Number) as EventoFolha[];

/** Destino das horas no banco (domínio de destinos do banco de horas do ramo, 4; regra 14). */
export const DESTINOS_BANCO = {
  1: 'Não se aplica (sem banco de horas)',
  2: 'Banco de horas',
  3: 'Folha de pagamento',
  4: 'Expiração de horas negativas do banco de horas',
} as const;
export type DestinoBanco = keyof typeof DESTINOS_BANCO;

/** Como o banco começa cada ciclo (domínio de inícios do ciclo do ramo, 4; regra 14). */
export const INICIOS_BANCO = {
  1: 'Saldo zerado',
  2: 'Saldo residual positivo do ciclo anterior',
  3: 'Saldo residual negativo do ciclo anterior',
  4: 'Saldo residual positivo e negativo do ciclo anterior',
} as const;
export type InicioBanco = keyof typeof INICIOS_BANCO;

/** Origem do movimento do banco de horas (SGH_PES_BANCO_HORAS.ORIGEM; só inclusão; saldo = soma). */
export const ORIGENS_BANCO = {
  apuracao: 'Fechamento do período',
  acerto: 'Acerto manual aprovado',
  'inicio-ciclo': 'Início do ciclo do banco',
  'pago-folha': 'Saldo positivo pago na folha',
  expiracao: 'Expiração de horas negativas',
} as const;
export type OrigemBanco = keyof typeof ORIGENS_BANCO;

/**
 * Tipo do ajuste (regra 11): a marcação original NUNCA muda; o ajuste é um registro novo com motivo e aprovador.
 *   - `inclusao`: marcação que faltou (esquecimento, relógio parado), com o instante e o período da jornada;
 *   - `desconsiderar`: marcação original que não vale na apuração (duplicada no relógio, batida por engano);
 *   - `justificativa`: abono de atraso, saída antecipada ou falta pelo tipo de movimento do ramo (atestado, folga...).
 */
export const TIPOS_AJUSTE = {
  inclusao: 'Inclusão de marcação que faltou',
  desconsiderar: 'Desconsiderar marcação',
  justificativa: 'Justificativa ou abono',
} as const;
export type TipoAjuste = keyof typeof TIPOS_AJUSTE;
export const CODIGOS_TIPO_AJUSTE = Object.keys(TIPOS_AJUSTE) as TipoAjuste[];

export const SITUACOES_AJUSTE = {
  pendente: 'Aguardando aprovação',
  aprovado: 'Aprovado',
  recusado: 'Recusado',
  /** W0-06: o próprio solicitante desistiu enquanto estava pendente (com o motivo; nada se apaga). */
  desistido: 'Desistência do solicitante',
} as const;
export type SituacaoAjuste = keyof typeof SITUACOES_AJUSTE;

/** O que a trilha do período registra (SGH_PES_PONTO_FECHAMENTO; só inclusão). */
export const ACOES_FECHAMENTO = {
  fechado: 'Período fechado',
  reaberto: 'Período reaberto',
  ciencia: 'Ciência do colaborador',
} as const;
export type AcaoFechamento = keyof typeof ACOES_FECHAMENTO;

/** Origem da marcação no espelho e no AEJ (Portaria 671/2021, AEJ: O original, I incluída por ajuste). */
export const FONTES_MARCACAO = {
  O: 'Original do relógio',
  I: 'Incluída por ajuste aprovado',
} as const;
export type FonteMarcacao = keyof typeof FONTES_MARCACAO;

/** Inconsistências do dia que impedem o fechamento do período. */
export const INCONSISTENCIAS_PONTO = {
  'marcacao-impar': 'Número ímpar de marcações (falta uma entrada ou uma saída)',
  'ajuste-pendente': 'Ajuste aguardando aprovação',
} as const;
export type InconsistenciaPonto = keyof typeof INCONSISTENCIAS_PONTO;

/** Alertas do dia (não impedem o fechamento; a coordenação confere). */
export const ALERTAS_PONTO = {
  'extra-acima-do-limite': 'Mais horas extras no dia do que o limite legal (CLT, art. 59)',
  'interjornada-menor': 'Descanso entre jornadas menor que o mínimo do regime',
  'sem-escala': 'Trabalho em dia sem plantão na escala publicada',
} as const;
export type AlertaPonto = keyof typeof ALERTAS_PONTO;

/** Padrões dos parâmetros do ponto (o estabelecimento troca em SGH_CFG_PARAMETRO, sem mudar código). */
export const PADROES_PONTO = {
  /** CLT, art. 58, §1º: variação de até 5 min por marcação, no máximo 10 min no dia, não conta. */
  toleranciaMarcacaoMin: 5,
  toleranciaDiariaMin: 10,
  /** CLT, art. 73: hora noturna das 22 h às 5 h, reduzida (52 min 30 s); prorrogação pela Súmula 60 do TST. */
  noturnoInicio: 22 * 60,
  noturnoFim: 5 * 60,
  /** Distância máxima entre a marcação e o plantão para ela contar nele (antes do início ou depois do fim). */
  janelaMarcacaoMin: 240,
  /** CLT, art. 59: no máximo 2 h extras por dia (alerta). */
  limiteExtraDiarioMin: 120,
  /** Faixas de hora extra por dia (1ª até 120 min; a 2ª é o resto). 0 = sem a faixa seguinte. */
  faixa1Min: 120,
  faixa2Min: 0,
  faixa3Min: 0,
  /** Ciclo do banco de horas (CLT, art. 59, §5º: acordo individual, 6 meses). */
  cicloBancoMeses: 6,
  /** DSR descontado na semana com falta injustificada, quando o regime não tiver a duração do plantão. */
  dsrPadraoMin: 440,
} as const;

/** Eventos da SGH_OUTBOX (a folha do M53 consome o fechamento; a F6 consome a ciência). */
export const EVENTO_AFD_IMPORTADO = 'PESSOAS_AFD_IMPORTADO';
export const EVENTO_PONTO_FECHADO = 'PESSOAS_PONTO_FECHADO';
export const EVENTO_PONTO_REABERTO = 'PESSOAS_PONTO_REABERTO';
