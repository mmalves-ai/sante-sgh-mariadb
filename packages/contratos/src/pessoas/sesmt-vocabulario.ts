// Vocabulário do SESMT, fatia F5 (M52; ficha, seções 6 a 8, regras 16 a 19 e 22; cap-07 §7.1.4; NR-32, NR-7). Os
// códigos dos domínios do outro sistema (tipos e resultados do ASO, vacinas e doses, CAT, grupos de risco,
// FPEPC) foram levantados na cópia do pc em 26/10/2026 (só os rótulos dos domínios; nenhum dado de pessoa). A tela
// mostra o rótulo, nunca o código cru nem o nome da tabela (ADR 0023).

/**
 * Natureza do ASO (regra 17; NR-7 item 7.5.8) pelo código do domínio de tipos de ASO do outro sistema (6 linhas no pc:
 * 0 admissional, 1 periódico, 2 retorno ao trabalho, 3 mudança de função, 4 monitoração pontual, 8 demissional; o
 * eSocial S-2220 usa 9 para o demissional e o domínio do pc usa 8: os dois valem). Código fora da lista: "outro".
 */
export const NATUREZAS_ASO = {
  admissional: 'Admissional',
  periodico: 'Periódico',
  retorno: 'Retorno ao trabalho',
  'mudanca-funcao': 'Mudança de função',
  monitoracao: 'Monitoração pontual',
  demissional: 'Demissional',
  outro: 'Outro',
} as const;
export type NaturezaAso = keyof typeof NATUREZAS_ASO;

const NATUREZA_POR_CODIGO: Readonly<Record<number, NaturezaAso>> = {
  0: 'admissional',
  1: 'periodico',
  2: 'retorno',
  3: 'mudanca-funcao',
  4: 'monitoracao',
  8: 'demissional',
  9: 'demissional',
};
export function naturezaAso(codigo: number): NaturezaAso {
  return NATUREZA_POR_CODIGO[codigo] ?? 'outro';
}

/** Conclusão do ASO pelo domínio de resultados (2 linhas no pc: 1 apto, 2 inapto). */
export const CONCLUSAO_APTO = 1;
export const CONCLUSAO_INAPTO = 2;

/** Resultado de um exame do PCMSO ligado ao ASO (o laudo fica no laboratório; aqui só a leitura do médico do trabalho). */
export const RESULTADOS_EXAME_OCUPACIONAL = { normal: 'Normal', alterado: 'Alterado' } as const;
export type ResultadoExameOcupacional = keyof typeof RESULTADOS_EXAME_OCUPACIONAL;

/** Periodicidade padrão do ASO periódico (NR-7, Anexo; parâmetro `pessoas.sesmt.periodicidadeAsoMeses`). */
export const PERIODICIDADE_ASO_MESES = 12;
/** Janela do alerta de ASO a vencer (parâmetro `pessoas.sesmt.alertaAsoDias`). */
export const JANELA_ALERTA_ASO_DIAS = 30;

/**
 * Vacinas do programa do SESMT (NR-32 32.2.4.17: tétano, difteria e hepatite B obrigatórias e gratuitas; as demais do
 * PCMSO). `termos` são as expressões (sem acento, em maiúsculas, pontuação vira espaço) que casam a vacina com uma linha do domínio de vacinas
 * editável no CRUD genérico, lido na hora (D-VAC-525: nada de código fixo; sem casamento único, o código fica vazio);
 * `esquema` é o número de doses do esquema básico (0: sem esquema fixo); `reforcoAnos`, o reforço periódico; `anual`,
 * a campanha anual.
 */
export const VACINAS_SESMT = {
  'hepatite-b': { rotulo: 'Hepatite B', termos: ['HEPATITE B'], esquema: 3, reforcoAnos: null, anual: false },
  'dupla-adulto': {
    rotulo: 'Dupla adulto (difteria e tétano)',
    termos: ['DUPLA', 'DIFTERIA'],
    esquema: 3,
    reforcoAnos: 10,
    anual: false,
  },
  'triplice-viral': {
    rotulo: 'Tríplice viral (sarampo, caxumba e rubéola)',
    termos: ['TRIPLICE VIRAL', 'SARAMPO', 'SCR'],
    esquema: 2,
    reforcoAnos: null,
    anual: false,
  },
  influenza: {
    rotulo: 'Influenza',
    termos: ['INFLUENZA', 'GRIPE'],
    esquema: 0,
    reforcoAnos: null,
    anual: true,
  },
  varicela: {
    rotulo: 'Varicela',
    termos: ['VARICELA', 'CATAPORA'],
    esquema: 2,
    reforcoAnos: null,
    anual: false,
  },
  'febre-amarela': {
    rotulo: 'Febre amarela',
    termos: ['FEBRE AMARELA', 'AMARILICA'],
    esquema: 1,
    reforcoAnos: null,
    anual: false,
  },
  'covid-19': {
    rotulo: 'Covid-19',
    termos: ['COVID', 'CORONAVIRUS', 'SARS COV 2'],
    esquema: 0,
    reforcoAnos: null,
    anual: false,
  },
} as const;
export type VacinaSesmt = keyof typeof VACINAS_SESMT;
export const CODIGOS_VACINA_SESMT = Object.keys(VACINAS_SESMT) as VacinaSesmt[];
/** As vacinas cujo esquema incompleto vira pendência no painel (NR-32: hepatite B, difteria e tétano). */
export const VACINAS_OBRIGATORIAS_NR32: readonly VacinaSesmt[] = ['hepatite-b', 'dupla-adulto'];

/**
 * Dose aplicada; `termos` casam a dose com a linha do domínio de doses editável no CRUD genérico, lido na hora
 * (D-VAC-525), pela descrição sem acento e em maiúsculas.
 */
export const DOSES_VACINA_SESMT = {
  '1': { rotulo: '1ª dose', termos: ['1A DOSE', '1O DOSE', '1 DOSE', 'PRIMEIRA DOSE', 'DOSE 1'] },
  '2': { rotulo: '2ª dose', termos: ['2A DOSE', '2O DOSE', '2 DOSE', 'SEGUNDA DOSE', 'DOSE 2'] },
  '3': { rotulo: '3ª dose', termos: ['3A DOSE', '3O DOSE', '3 DOSE', 'TERCEIRA DOSE', 'DOSE 3'] },
  reforco: { rotulo: 'Reforço', termos: ['REFORCO'] },
  unica: { rotulo: 'Dose única', termos: ['UNICA'] },
} as const;
export type DoseVacinaSesmt = keyof typeof DOSES_VACINA_SESMT;
export const CODIGOS_DOSE_VACINA_SESMT = Object.keys(DOSES_VACINA_SESMT) as DoseVacinaSesmt[];

/** Anti-HBs reagente (imune) a partir de 10 mUI/mL (Ministério da Saúde, manual dos CRIE). */
export const ANTI_HBS_PROTETOR = 10;

export const TIPOS_ACIDENTE = {
  tipico: 'Típico (no trabalho)',
  trajeto: 'De trajeto',
  doenca: 'Doença relacionada ao trabalho',
} as const;
export type TipoAcidente = keyof typeof TIPOS_ACIDENTE;

export const EXPOSICOES_BIOLOGICAS = {
  percutanea: 'Percutânea (agulha, lâmina)',
  mucosa: 'Mucosa (olhos, boca)',
  'pele-nao-integra': 'Pele não íntegra',
  'pele-integra': 'Pele íntegra',
} as const;
export type ExposicaoBiologica = keyof typeof EXPOSICOES_BIOLOGICAS;

export const MATERIAIS_BIOLOGICOS = {
  sangue: 'Sangue',
  'fluido-com-sangue': 'Fluido com sangue',
  'fluido-sem-sangue': 'Fluido sem sangue visível',
  outro: 'Outro material',
} as const;
export type MaterialBiologico = keyof typeof MATERIAIS_BIOLOGICOS;

/** A fonte do material biológico: nunca o paciente (nenhum identificador), só se é conhecida e o teste rápido dela. */
export const FONTES_EXPOSICAO = { conhecida: 'Fonte conhecida', desconhecida: 'Fonte desconhecida' } as const;
export type FonteExposicao = keyof typeof FONTES_EXPOSICAO;
export const TESTES_FONTE = {
  reagente: 'Teste rápido da fonte reagente',
  'nao-reagente': 'Teste rápido da fonte não reagente',
  'nao-testada': 'Fonte não testada',
} as const;
export type TesteFonte = keyof typeof TESTES_FONTE;

/** Profilaxia pós-exposição (regra 18; PCDT de PEP do Ministério da Saúde). */
export const SITUACOES_PROFILAXIA = {
  'nao-indicada': 'Não indicada',
  indicada: 'Indicada (a iniciar)',
  iniciada: 'Iniciada',
  recusada: 'Recusada pelo colaborador',
} as const;
export type SituacaoProfilaxia = keyof typeof SITUACOES_PROFILAXIA;

/** Marcos do acompanhamento sorológico após material biológico (dias depois do acidente; PCDT de PEP). */
export const MARCOS_SOROLOGIA = {
  d0: { rotulo: 'No dia do acidente', dias: 0 },
  d30: { rotulo: '30 dias', dias: 30 },
  d90: { rotulo: '90 dias', dias: 90 },
  d180: { rotulo: '180 dias', dias: 180 },
} as const;
export type MarcoSorologia = keyof typeof MARCOS_SOROLOGIA;
export const CODIGOS_MARCO_SOROLOGIA = Object.keys(MARCOS_SOROLOGIA) as MarcoSorologia[];

export const RESULTADOS_SOROLOGIA = {
  'sem-alteracao': 'Sem soroconversão',
  soroconversao: 'Soroconversão (encaminhar ao infectologista)',
  'nao-realizada': 'Não realizada (colaborador não compareceu)',
} as const;
export type ResultadoSorologia = keyof typeof RESULTADOS_SOROLOGIA;

/**
 * Prazo da CAT em dias úteis depois do acidente (regra 18; Lei 8.213/1991, art. 22: até o primeiro dia útil seguinte;
 * óbito: imediato). Parâmetro `pessoas.sesmt.prazoCatDiasUteis`, a confirmar pelo SESMT e pelo jurídico.
 */
export const PRAZO_CAT_DIAS_UTEIS = 1;

export const ESTADOS_ACIDENTE = { aberto: 'Em acompanhamento', encerrado: 'Encerrado' } as const;
export type EstadoAcidente = keyof typeof ESTADOS_ACIDENTE;

/** Linha do mapa de riscos por função: o fator de risco ou o EPI exigido. */
export const TIPOS_LINHA_RISCO = { risco: 'Fator de risco', epi: 'EPI exigido' } as const;
export type TipoLinhaRisco = keyof typeof TIPOS_LINHA_RISCO;

/** Registro da tela de EPI: entrega de EPI, leitura do dosímetro e exposição a quimioterápico (regra 19; NR-32). */
export const TIPOS_REGISTRO_EPI = {
  epi: 'Entrega de EPI',
  dosimetria: 'Leitura do dosímetro',
  quimio: 'Exposição a quimioterápico',
} as const;
export type TipoRegistroEpi = keyof typeof TIPOS_REGISTRO_EPI;

export const ASSINATURAS_EPI = { pendente: 'Aguardando assinatura', assinada: 'Assinada' } as const;
export type AssinaturaEpi = keyof typeof ASSINATURAS_EPI;

/**
 * Limites de dose efetiva do trabalhador (CNEN NN 3.01, 5.4.2.1): 20 mSv por ano em média de 5 anos, sem passar de
 * 50 mSv em nenhum ano. O painel avisa ao passar do anual médio e alerta ao passar do teto.
 */
export const LIMITE_DOSE_ANUAL_MSV = 20;
export const TETO_DOSE_ANUAL_MSV = 50;

/** Pendências do SESMT (painel e ficha do colaborador). */
export const PENDENCIAS_SESMT = {
  'sem-aso': 'Sem ASO registrado',
  'aso-vencido': 'ASO vencido',
  'aso-a-vencer': 'ASO a vencer',
  inapto: 'Último ASO inapto',
  'hepatite-b-incompleta': 'Hepatite B: esquema incompleto',
  'anti-hbs-pendente': 'Anti-HBs pendente',
  'anti-hbs-nao-protetor': 'Anti-HBs abaixo de 10 mUI/mL',
  'dupla-incompleta': 'Dupla adulto: esquema incompleto',
  'dupla-reforco': 'Dupla adulto: reforço vencido',
  'epi-assinatura': 'EPI entregue sem assinatura',
  'epi-faltando': 'EPI exigido pela função sem entrega',
  'cat-prazo': 'CAT a emitir',
  'cat-atrasada': 'CAT fora do prazo',
  'profilaxia-indicada': 'Profilaxia indicada a iniciar',
  'sorologia-atrasada': 'Sorologia atrasada',
  'dose-acima-limite': 'Dose de radiação acima do limite anual',
} as const;
export type PendenciaSesmt = keyof typeof PENDENCIAS_SESMT;
export const CODIGOS_PENDENCIA_SESMT = Object.keys(PENDENCIAS_SESMT) as PendenciaSesmt[];
export type GravidadePendencia = 'alerta' | 'aviso';
