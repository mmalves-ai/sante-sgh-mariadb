// Vocabulário do atendimento externo: ambulatório, pronto atendimento, central de exames e requisição de laboratório
// (M20; ficha, seções 5 e 8). Os códigos são os do sistema anterior (tipo do atendimento, caráter, tipo de guia do
// SADT, laboratório e motivo de alta); o novo só grava valores já vistos no perfil passivo da cópia. Perfil da cópia pc
// (só agregados, fichas incluídas de 2025-10 a 2026-09, 31.714):
//   - TIPO_ATE 4 consulta 20.132, 23 exame 9.488 (9.448 delas requisição de laboratório: LAB S, ESPEC 0), 11 pronto
//     socorro 1.714, 5 exame ambulatorial 151, 3, 2, 0 (44, "não informado"), 20, 1, 15, 21;
//   - CARACTERS (o caráter do faturamento menos 1 é o caráter TISS: o gatilho grava a ocorrência U quando é 3) 2 em
//     24.554, 3 em 7.115; 0, 1 e 4 raros (lidos como "não informado");
//   - TIPO_SADT H 24.256, E 7.111, S 254, vazio 93 (DP-46.6: a confirmar);
//   - SAIDA e HRSAI iguais a DT_ATE e HORAS em 100% (a saída gravada é cópia da entrada: o desfecho fica no novo).
// Nenhum nome de tabela do legado sai daqui para a tela: os rótulos são de produto (ADR 0023).

/** Tipo de atendimento que a tela oferece, com o que o legado grava em cada um. */
export const TIPOS_ATENDIMENTO = [
  {
    codigo: 'consulta',
    rotulo: 'Consulta ambulatorial',
    tipoAte: 4,
    laboratorio: false,
    tipoSadt: 'H',
    tpconst: 2,
    tpsait: 0,
  },
  {
    codigo: 'pa',
    rotulo: 'Pronto atendimento',
    tipoAte: 11,
    laboratorio: false,
    tipoSadt: 'E',
    tpconst: 1,
    tpsait: 0,
  },
  {
    codigo: 'exame',
    rotulo: 'Exame ambulatorial (central de exames)',
    tipoAte: 23,
    laboratorio: false,
    tipoSadt: 'H',
    tpconst: 1,
    tpsait: 0,
  },
  {
    codigo: 'requisicaoLab',
    rotulo: 'Requisição de laboratório (sem consulta)',
    tipoAte: 23,
    laboratorio: true,
    tipoSadt: 'H',
    tpconst: 0,
    tpsait: 1,
  },
] as const;
export type TipoAtendimento = (typeof TIPOS_ATENDIMENTO)[number]['codigo'];
export const CODIGOS_TIPO_ATENDIMENTO = TIPOS_ATENDIMENTO.map((t) => t.codigo) as [
  TipoAtendimento,
  ...TipoAtendimento[],
];

export function tipoAtendimento(codigo: string): (typeof TIPOS_ATENDIMENTO)[number] | undefined {
  return TIPOS_ATENDIMENTO.find((t) => t.codigo === codigo);
}

/** Tipos de atendimento: os do sistema anterior lidos nas listas (0 só lido: "não informado"; 23 existe desde 07/2023). */
export const TIPOS_ATE_LEGADO: Readonly<Record<number, string>> = Object.freeze({
  0: 'Não informado',
  1: 'Remoção',
  2: 'Pequena cirurgia',
  3: 'Outras terapias',
  4: 'Consulta',
  5: 'Exame ambulatorial',
  7: 'Internação',
  11: 'Pronto atendimento',
  13: 'Pequeno atendimento',
  15: 'Saúde ocupacional',
  20: 'Saúde ocupacional',
  21: 'Saúde ocupacional',
  23: 'Exame',
});

export function rotuloTipoAte(tipoAte: number | null): string {
  return (tipoAte !== null && TIPOS_ATE_LEGADO[tipoAte]) || 'Não informado';
}

/** Caráter do atendimento (obrigatório no novo): gravado como o legado grava em CARACTERS (TISS + 1). */
export const CARATERES = [
  { codigo: 'eletivo', rotulo: 'Eletivo', gravado: 2, tiss: 1 },
  { codigo: 'urgencia', rotulo: 'Urgência ou emergência', gravado: 3, tiss: 2 },
] as const;
export type Carater = (typeof CARATERES)[number]['codigo'];
export const CODIGOS_CARATER = CARATERES.map((c) => c.codigo) as [Carater, ...Carater[]];

/** Leitura do caráter gravado (nulos, 0, 1 e 4 antigos: "não informado", regra 5). */
export function caraterLido(gravado: number | null | undefined): Carater | null {
  return CARATERES.find((c) => c.gravado === gravado)?.codigo ?? null;
}

/** Tipo de guia do SADT (SADT: serviço de apoio ao diagnóstico e terapia): só os valores vistos, com a legenda "a confirmar" (DP-46.6). */
export const TIPOS_SADT = [
  { codigo: 'H', rotulo: 'Guia H (a confirmar)' },
  { codigo: 'E', rotulo: 'Guia E (a confirmar)' },
  { codigo: 'S', rotulo: 'Guia S (a confirmar)' },
] as const;
export type TipoSadt = (typeof TIPOS_SADT)[number]['codigo'];

/** Termo de consentimento do cabeçalho (TCLE: termo de consentimento livre e esclarecido): 1 em 100% do perfil; constante 1 (DP-46.7). */
export const TCLE_VISTO = 1 as const;

/**
 * Desfecho codificado do atendimento externo (SGH_ATD_DESFECHO; ficha, `encerrarAtendimento`). O legado não codifica
 * o desfecho do externo desde 04/2020 (o registro de alta parou): o motivo de alta do legado que corresponde a cada um
 * fica junto no novo para os indicadores. Ato médico (Lei 12.842/2013): alta, encaminhamento, internação,
 * transferência e óbito só por profissional com conselho ativo; a recepção registra a evasão e o encerramento
 * administrativo.
 */
export const DESFECHOS = [
  { codigo: 'alta', rotulo: 'Alta', motivoAlta: 12, atoMedico: true },
  { codigo: 'encaminhamento', rotulo: 'Encaminhamento', motivoAlta: 15, atoMedico: true },
  { codigo: 'internacao', rotulo: 'Internação', motivoAlta: null, atoMedico: true },
  { codigo: 'transferencia', rotulo: 'Transferência externa', motivoAlta: 31, atoMedico: true },
  { codigo: 'evasao', rotulo: 'Evasão', motivoAlta: 16, atoMedico: false },
  { codigo: 'obito', rotulo: 'Óbito', motivoAlta: 41, atoMedico: true },
  { codigo: 'administrativo', rotulo: 'Encerramento administrativo', motivoAlta: 51, atoMedico: false },
] as const;
export type Desfecho = (typeof DESFECHOS)[number]['codigo'];
export const CODIGOS_DESFECHO = DESFECHOS.map((d) => d.codigo) as [Desfecho, ...Desfecho[]];
/** Evasão: motivo 16 do cadastro de motivos de alta (regra 8). */
export const MOTIVO_ALTA_EVASAO = 16 as const;

export function desfecho(codigo: string): (typeof DESFECHOS)[number] | undefined {
  return DESFECHOS.find((d) => d.codigo === codigo);
}

/**
 * Etapas do pronto atendimento (SGH_PA_ETAPA): as marcas de tempo que o legado não guarda (a saída gravada é cópia
 * da entrada). A chegada é a emissão da senha; a cor de risco entra na Fase 5 (M44).
 */
export const ETAPAS_PA = [
  { codigo: 'chegada', rotulo: 'Chegada', coluna: 'aguardando' },
  { codigo: 'abertura', rotulo: 'Ficha aberta', coluna: 'aguardando' },
  { codigo: 'chamada', rotulo: 'Chamado ao consultório', coluna: 'aguardando' },
  { codigo: 'atendimentoMedico', rotulo: 'Em atendimento médico', coluna: 'atendimento' },
  { codigo: 'exames', rotulo: 'Em exames', coluna: 'exames' },
  { codigo: 'reavaliacao', rotulo: 'Aguardando reavaliação', coluna: 'reavaliacao' },
  { codigo: 'observacao', rotulo: 'Em observação', coluna: 'observacao' },
  { codigo: 'decisao', rotulo: 'Decisão registrada', coluna: 'decisao' },
  { codigo: 'saida', rotulo: 'Saída', coluna: 'saida' },
] as const;
export type EtapaPa = (typeof ETAPAS_PA)[number]['codigo'];
export const CODIGOS_ETAPA_PA = ETAPAS_PA.map((e) => e.codigo) as [EtapaPa, ...EtapaPa[]];
/** Etapas que a equipe registra no quadro (as demais nascem das operações: abertura, chamada, desfecho, observação). */
export const ETAPAS_PA_MANUAIS = ['atendimentoMedico', 'exames', 'reavaliacao'] as const;
export type EtapaPaManual = (typeof ETAPAS_PA_MANUAIS)[number];

/** Colunas do quadro do PA, na ordem. */
export const COLUNAS_QUADRO_PA = [
  { codigo: 'aguardando', rotulo: 'Aguardando atendimento' },
  { codigo: 'atendimento', rotulo: 'Em atendimento médico' },
  { codigo: 'exames', rotulo: 'Em exames' },
  { codigo: 'reavaliacao', rotulo: 'Reavaliação' },
  { codigo: 'observacao', rotulo: 'Observação' },
  { codigo: 'decisao', rotulo: 'Decisão' },
] as const;
export type ColunaQuadroPa = (typeof COLUNAS_QUADRO_PA)[number]['codigo'];

/** Observação do PA: limite de 24 horas (Portaria SAS 312/2002; regra 7) e o aviso antes do limite. */
export const OBSERVACAO_LIMITE_HORAS = 24 as const;
export const OBSERVACAO_AVISO_HORAS = 20 as const;

/** Situação da conta externa (fechamento e emissão) e o que permite (regra 2). */
export const SITUACOES_CONTA = [
  { codigo: 'aberta', rotulo: 'Conta aberta', permiteLancar: true },
  { codigo: 'fechada', rotulo: 'Conta fechada', permiteLancar: false },
  { codigo: 'apresentada', rotulo: 'Conta apresentada ao convênio', permiteLancar: false },
  { codigo: 'emitida', rotulo: 'Conta emitida', permiteLancar: false },
  { codigo: 'semConta', rotulo: 'Atendimento sem conta (SUS ou sem faturamento)', permiteLancar: false },
] as const;
export type SituacaoConta = (typeof SITUACOES_CONTA)[number]['codigo'];

/** Impressos do atendimento: ficha, etiqueta e pulseira (ZPL pelo agente local; PDF pela geração de documentos). */
export const IMPRESSOS_ATENDIMENTO = [
  { codigo: 'ficha', rotulo: 'Ficha de atendimento', formatos: ['pdf'] },
  { codigo: 'etiqueta', rotulo: 'Etiquetas de identificação', formatos: ['zpl', 'pdf'] },
  { codigo: 'pulseira', rotulo: 'Pulseira de identificação', formatos: ['zpl'] },
] as const;
export type ImpressoAtendimento = (typeof IMPRESSOS_ATENDIMENTO)[number]['codigo'];
export const CODIGOS_IMPRESSO = IMPRESSOS_ATENDIMENTO.map((i) => i.codigo) as [
  ImpressoAtendimento,
  ...ImpressoAtendimento[],
];

/** Herança do atendimento anterior: o campo da ficha e a chave da regra gravada (regra_heranca_campo.campo). */
export const HERANCAS = [
  { chave: 'fonte_pagadora', campo: 'convenio', rotulo: 'Convênio' },
  { chave: 'profissional', campo: 'profissional', rotulo: 'Profissional' },
  { chave: 'centro_custo', campo: 'centroCusto', rotulo: 'Centro de custo' },
  { chave: 'unidade', campo: 'unidade', rotulo: 'Unidade' },
  { chave: 'carteira', campo: 'matricula', rotulo: 'Carteirinha' },
  { chave: 'guia', campo: 'guia', rotulo: 'Guia' },
  { chave: 'plano', campo: 'plano', rotulo: 'Plano' },
  { chave: 'clinica', campo: 'clinica', rotulo: 'Clínica' },
  { chave: 'especialidade', campo: 'especialidade', rotulo: 'Especialidade' },
  { chave: 'empresa', campo: 'empresa', rotulo: 'Empresa' },
  { chave: 'validade_carteira', campo: 'validadeCarteira', rotulo: 'Validade da carteirinha' },
  { chave: 'titular', campo: 'titular', rotulo: 'Titular do convênio' },
] as const;
export type CampoHerdado = (typeof HERANCAS)[number]['campo'];
