// Contrato de interface com a folha externa (M53-F0; ficha do M53, seções 1, 6 e 8, regras 3 a 6; cap-07 §7.1.5).
// Enquanto a folha roda em outro sistema, o Sante SGH exporta, por empresa e competência, um lote com colaboradores,
// lotação, afastamentos, eventos de ponto e plantões; o sistema de folha devolve um lote de retorno com a folha
// líquida e os encargos, que nasce como títulos a pagar (M32) e como custo de pessoal (M54).
//
// Regras do contrato:
// - regra 4: na exportação, o sistema externo é dono dos dados contratuais (salário, rubricas, encargos) e o Sante SGH
//   dos assistenciais (conselho, escala, habilitação); por isso o lote exportado NÃO leva salário nem rubrica, e o
//   retorno NÃO traz conselho, escala nem habilitação;
// - regra 5: os eventos de ponto saem pelos 13 tipos de integração da folha (PETP_INTEGR_EVENTO.COD_INTEGR_EVENTO) e a
//   origem de cada um pelos tipos de hora da apuração (POTPHORA.ID);
// - regra 6: os dois lotes têm contagem e soma conferíveis (o retorno ecoa os totais que recebeu); qualquer divergência
//   barra o lançamento dos títulos (a conferência é do @sgh/dominio-pessoas);
// - valores em centavos inteiros (soma exata, sem arredondamento de ponto flutuante); tempo em minutos inteiros.
//
// O CPF é a chave que os dois sistemas têm em comum: vai no arquivo do lote e em nenhum outro lugar (nunca em log,
// nunca em resposta de lista; convencoes.md §11). O nome do colaborador não vai: o sistema de folha já o tem.
import { z } from 'zod';
import { cpfValido } from '../validacao/cpf.js';

/** Versão do leiaute do lote (sobe a cada mudança incompatível; o simulador do Pact confere). */
export const VERSAO_LEIAUTE_FOLHA_INTERFACE = '1.0' as const;

/** Sentido do lote em SGH_PES_FOLHA_INTERFACE. */
export const SENTIDOS_LOTE_FOLHA = ['exportado', 'recebido'] as const;
export type SentidoLoteFolha = (typeof SENTIDOS_LOTE_FOLHA)[number];

/**
 * Situação do lote (SGH_PES_FOLHA_INTERFACE.SITUACAO):
 * - gerado: exportado e baixado, aguardando o retorno;
 * - conferido: retorno recebido, contagem e soma batem (pode lançar os títulos);
 * - divergente: retorno recebido com diferença (não lança; regra 6);
 * - lancado: títulos e apropriações gravados (M53-F8 / M32);
 * - substituido: um lote mais novo da mesma empresa e competência tomou o lugar (o antigo fica para a trilha);
 * - recusado: o retorno não passou na validação do leiaute.
 */
export const SITUACOES_LOTE_FOLHA = [
  'gerado',
  'conferido',
  'divergente',
  'lancado',
  'substituido',
  'recusado',
] as const;
export type SituacaoLoteFolha = (typeof SITUACOES_LOTE_FOLHA)[number];

/** Tipo de vínculo de trabalho (SGH_PES_VINCULO do M52; ficha do M52, seção 6). */
export const TIPOS_VINCULO_TRABALHO = [
  'clt',
  'estatutario',
  'cooperado',
  'pj',
  'residente',
  'estagiario',
  'terceiro',
] as const;
export type TipoVinculoTrabalho = (typeof TIPOS_VINCULO_TRABALHO)[number];

/** Modalidade do plantão (SGH_PES_PLANTAO do M52). */
export const MODALIDADES_PLANTAO = ['presencial', 'sobreaviso', 'diarista'] as const;
export type ModalidadePlantao = (typeof MODALIDADES_PLANTAO)[number];

/**
 * Tipos de integração de evento de ponto com a folha (PETP_INTEGR_EVENTO, 13 linhas no pc; ref 02). Os rótulos de 1 a
 * 7 são os da referência; os de 8 a 13 são lidos da tabela na hora (a tela mostra o rótulo lido, nunca o código cru).
 */
export const CODIGOS_EVENTO_PONTO_FOLHA = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13] as const;
export type CodigoEventoPontoFolha = (typeof CODIGOS_EVENTO_PONTO_FOLHA)[number];
export const ROTULOS_EVENTO_PONTO_CONHECIDOS: Readonly<Partial<Record<CodigoEventoPontoFolha, string>>> = {
  1: 'Horas trabalhadas',
  2: 'DSR',
  3: 'Faltas',
  4: 'Atrasos',
  5: 'Adicional noturno',
  6: '1ª hora extra em feriado',
  7: '2ª hora extra em feriado',
};

/** Tipos de hora da apuração (POTPHORA, 9 linhas no pc; ref 02). Rótulos de 1 a 5 da referência; os demais, lidos. */
export const CODIGOS_TIPO_HORA = [1, 2, 3, 4, 5, 6, 7, 8, 9] as const;
export type CodigoTipoHora = (typeof CODIGOS_TIPO_HORA)[number];
export const ROTULOS_TIPO_HORA_CONHECIDOS: Readonly<Partial<Record<CodigoTipoHora, string>>> = {
  1: 'Horas trabalhadas',
  2: 'Atrasos e débitos',
  3: 'Horas extras (trabalho em DSR)',
  4: 'Horas extras (trabalho em feriado)',
  5: 'Horas extras (período excedente)',
};

/** Natureza de uma rubrica no retorno (a rubrica é do sistema externo; regra 4). */
export const NATUREZAS_RUBRICA_RETORNO = ['provento', 'desconto', 'informativa'] as const;
export type NaturezaRubricaRetorno = (typeof NATUREZAS_RUBRICA_RETORNO)[number];

/** Encargos que viram título a pagar próprio (cenário `origem-encargo` do M32). */
export const TIPOS_ENCARGO_FOLHA = ['inss', 'fgts', 'irrf', 'sindical', 'outro'] as const;
export type TipoEncargoFolha = (typeof TIPOS_ENCARGO_FOLHA)[number];

/** Teto de linhas por lote (o maior hospital da Rede tem pouco mais de mil pessoas; folga de 10 vezes). */
export const TETO_LINHAS_LOTE_FOLHA = 20_000;

const id = z.number().int().positive();
const smallint = z.number().int().min(0).max(32_767);
const competencia = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'Competência no formato AAAA-MM.');
const data = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Data no formato AAAA-MM-DD.');
const instante = z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?(\.\d+)?(Z|[+-]\d{2}:\d{2})$/);
const minutos = z
  .number()
  .int()
  .min(0)
  .max(744 * 60);
const centavos = z.number().int().min(0).max(99_999_999_999);
const cpf = z
  .string()
  .regex(/^\d{11}$/, 'CPF com 11 dígitos, sem pontuação.')
  .refine(cpfValido, 'CPF inválido.');
const lista = <T extends z.ZodType>(t: T) => z.array(t).max(TETO_LINHAS_LOTE_FOLHA);

/** Conselho profissional (dado assistencial: o Sante SGH é o dono; regra 4). */
export const esquemaConselhoInterface = z
  .object({
    sigla: z.string().min(2).max(10),
    numero: z.string().min(1).max(20),
    uf: z.string().regex(/^[A-Z]{2}$/),
    validade: data.nullable(),
  })
  .strict();

/** Colaborador no lote exportado: identificação, vínculo, lotação e o lado assistencial. Sem salário (regra 4). */
export const esquemaColaboradorExportado = z
  .object({
    /** SGH_PES_VINCULO.ID (M52). */
    vinculo: id,
    cpf,
    /** Matrícula no sistema de folha, quando já conhecida (devolvida no primeiro retorno). */
    matriculaExterna: z.string().min(1).max(30).nullable(),
    tipoVinculo: z.enum(TIPOS_VINCULO_TRABALHO),
    admissao: data,
    desligamento: data.nullable(),
    /** Lotação: centro de custo (TBCENCUS.ID) e setor (TBUNIDAD.ID), na competência. */
    centroCusto: id,
    setor: id.nullable(),
    cbo: z
      .string()
      .regex(/^\d{6}$/)
      .nullable(),
    conselho: esquemaConselhoInterface.nullable(),
  })
  .strict();
export type ColaboradorExportado = z.infer<typeof esquemaColaboradorExportado>;

/** Afastamento na competência (motivo de FPMOTAFAST.ID, 21 linhas no pc). */
export const esquemaAfastamentoExportado = z
  .object({
    vinculo: id,
    motivo: smallint,
    inicio: data,
    fim: data.nullable(),
  })
  .strict();
export type AfastamentoExportado = z.infer<typeof esquemaAfastamentoExportado>;

/** Evento de ponto apurado e já fechado (regra 5): um por vínculo e tipo de integração. */
export const esquemaEventoPontoExportado = z
  .object({
    vinculo: id,
    evento: z
      .number()
      .int()
      .refine(
        (n) => (CODIGOS_EVENTO_PONTO_FOLHA as readonly number[]).includes(n),
        'Tipo de evento desconhecido.',
      ),
    minutos,
  })
  .strict();
export type EventoPontoExportado = z.infer<typeof esquemaEventoPontoExportado>;

/**
 * Minutos do período fechado por tipo de hora da apuração (POTPHORA; regra 5): a classificação de que os eventos de
 * integração saíram, para a folha externa conferir. Informativo: o que se paga são os eventos (não entra na soma).
 */
export const esquemaHoraPontoExportada = z
  .object({
    vinculo: id,
    tipoHora: z
      .number()
      .int()
      .refine((n) => (CODIGOS_TIPO_HORA as readonly number[]).includes(n), 'Tipo de hora desconhecido.'),
    minutos,
  })
  .strict();
export type HoraPontoExportada = z.infer<typeof esquemaHoraPontoExportada>;

/** Plantão realizado (SGH_PES_PLANTAO do M52), para o sistema de folha pagar adicional ou hora de plantão. */
export const esquemaPlantaoExportado = z
  .object({
    vinculo: id,
    plantao: id,
    modalidade: z.enum(MODALIDADES_PLANTAO),
    inicio: instante,
    fim: instante,
    minutos,
    centroCusto: id,
  })
  .strict();
export type PlantaoExportado = z.infer<typeof esquemaPlantaoExportado>;

/** Totais declarados do lote exportado (contagem e soma conferíveis; regra 6). */
export const esquemaTotaisExportacao = z
  .object({
    colaboradores: z.number().int().min(0),
    afastamentos: z.number().int().min(0),
    eventosPonto: z.number().int().min(0),
    minutosPonto: z.number().int().min(0),
    plantoes: z.number().int().min(0),
    minutosPlantao: z.number().int().min(0),
  })
  .strict();
export type TotaisExportacao = z.infer<typeof esquemaTotaisExportacao>;

/** Lote exportado à folha externa (o arquivo que o DP baixa e entrega ao sistema de folha). */
export const esquemaLoteExportacaoFolha = z
  .object({
    leiaute: z.literal(VERSAO_LEIAUTE_FOLHA_INTERFACE),
    /** Identificador do lote (SGH_PES_FOLHA_INTERFACE.ID). */
    lote: id,
    /** Empresa do outro sistema (TBEMPHOS.COD_EMP) e estabelecimento da Rede. */
    empresa: smallint,
    estabelecimento: z.string().min(1).max(10),
    competencia,
    periodo: z.object({ inicio: data, fim: data }).strict(),
    geradoEm: instante,
    colaboradores: lista(esquemaColaboradorExportado),
    afastamentos: lista(esquemaAfastamentoExportado),
    eventosPonto: lista(esquemaEventoPontoExportado),
    /** Os mesmos minutos fechados, por tipo de hora (informativo; não entra na soma). */
    horasPonto: lista(esquemaHoraPontoExportada),
    plantoes: lista(esquemaPlantaoExportado),
    totais: esquemaTotaisExportacao,
  })
  .strict();
export type LoteExportacaoFolha = z.infer<typeof esquemaLoteExportacaoFolha>;

/** Rubrica de um colaborador no retorno (código e descrição são do sistema externo). */
export const esquemaRubricaRetorno = z
  .object({
    codigo: z.string().min(1).max(20),
    natureza: z.enum(NATUREZAS_RUBRICA_RETORNO),
    valor: centavos,
  })
  .strict();
export type RubricaRetorno = z.infer<typeof esquemaRubricaRetorno>;

/** Folha de um colaborador no retorno: rubricas e líquido (líquido = proventos − descontos; regra 6). */
export const esquemaColaboradorRetorno = z
  .object({
    vinculo: id,
    matriculaExterna: z.string().min(1).max(30),
    rubricas: z.array(esquemaRubricaRetorno).min(1).max(300),
    liquido: centavos,
  })
  .strict();
export type ColaboradorRetorno = z.infer<typeof esquemaColaboradorRetorno>;

/** Encargo da competência, que vira título próprio (INSS, FGTS, IRRF, contribuição sindical). */
export const esquemaEncargoRetorno = z
  .object({
    tipo: z.enum(TIPOS_ENCARGO_FOLHA),
    valor: centavos,
    vencimento: data,
    /** Centro de custo de apropriação; null: rateado pela lotação dos colaboradores. */
    centroCusto: id.nullable(),
  })
  .strict();
export type EncargoRetorno = z.infer<typeof esquemaEncargoRetorno>;

/** Totais declarados do retorno. */
export const esquemaTotaisRetorno = z
  .object({
    colaboradores: z.number().int().min(0),
    proventos: centavos,
    descontos: centavos,
    liquido: centavos,
    encargos: centavos,
  })
  .strict();
export type TotaisRetorno = z.infer<typeof esquemaTotaisRetorno>;

/** Lote de retorno da folha externa (o arquivo que o DP importa; permissão pessoas.folha.importar). */
export const esquemaLoteRetornoFolha = z
  .object({
    leiaute: z.literal(VERSAO_LEIAUTE_FOLHA_INTERFACE),
    /** Lote exportado a que este retorno responde. */
    loteExportado: id,
    empresa: smallint,
    competencia,
    /** Eco dos totais que o sistema de folha recebeu (conferência nos dois sentidos; regra 6). */
    recebido: esquemaTotaisExportacao,
    colaboradores: lista(esquemaColaboradorRetorno),
    encargos: z.array(esquemaEncargoRetorno).max(100),
    /** Vencimento do título da folha líquida. */
    vencimentoLiquido: data,
    totais: esquemaTotaisRetorno,
  })
  .strict();
export type LoteRetornoFolha = z.infer<typeof esquemaLoteRetornoFolha>;

/** Entrada da tela: gerar a exportação da competência (permissão pessoas.folha.exportar). */
export const esquemaGerarExportacaoFolha = z
  .object({
    empresa: smallint,
    competencia,
  })
  .strict();
export type GerarExportacaoFolha = z.infer<typeof esquemaGerarExportacaoFolha>;

/** Divergência encontrada na conferência de um lote (sem dado pessoal: só o campo, os números e o vínculo). */
export const esquemaDivergenciaLoteFolha = z
  .object({
    codigo: z.string().min(1),
    campo: z.string().min(1),
    declarado: z.number(),
    calculado: z.number(),
    vinculo: id.nullable(),
  })
  .strict();
export type DivergenciaLoteFolha = z.infer<typeof esquemaDivergenciaLoteFolha>;

/** Linha da lista de lotes da tela (sem CPF, sem nome; só contagens, somas e situação). */
export const esquemaResumoLoteFolha = z
  .object({
    id,
    sentido: z.enum(SENTIDOS_LOTE_FOLHA),
    empresa: smallint,
    competencia,
    situacao: z.enum(SITUACOES_LOTE_FOLHA),
    geradoEm: instante,
    geradoPor: z.string().min(1),
    colaboradores: z.number().int().min(0),
    /** Exportado: minutos de ponto + plantão; recebido: líquido + encargos, em centavos. */
    soma: z.number().int().min(0),
    divergencias: z.array(esquemaDivergenciaLoteFolha),
    /** Resumo SHA-256 do arquivo do lote (conferível pelo sistema de folha). */
    resumo: z.string().regex(/^[0-9a-f]{64}$/),
  })
  .strict();
export type ResumoLoteFolha = z.infer<typeof esquemaResumoLoteFolha>;
