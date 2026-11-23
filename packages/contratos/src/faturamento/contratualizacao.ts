// Contratualização SUS (ficha do M55, fatia F5; seções 3, 4, 6, 7 e 8; regra 11; cap-07 §7.3; DP-13, DP-35 e DP-47.4,
// decididas em 2026-10-19: construída completa e DESLIGADA por estabelecimento, chave `contratualizacao`, POL-3). O
// contrato com o gestor do SUS (esfera, orçamento pré-fixado e pós-fixado, incentivos, habilitação), as metas
// quantitativas por grupo SIGTAP e qualitativas por indicador, com periodicidade, pontos e escore, e o painel produção ×
// meta alimentado pelo faturamento SUS (M51) ou, sem ele, pelas contas SUS do motor de convênios.
// Compatível com o que já existe: os códigos dos 11 domínios (esfera do gestor, componente do orçamento,
// periodicidade, grupo do indicador, formato da resposta, fonte da aferição, escore, rede de atenção, bloco de
// financiamento, tipo de dado e incentivo) são os mesmos do sistema anterior, lidos onde estão. As tabelas de domínio
// recusam toda gravação (D-DOM-555): o
// novo só lê; contrato, metas e apurações ficam em `SGH_SUS_*` (script 0555). Os rótulos aqui são os do produto.
import { z } from 'zod';
import { textoCp1252 } from '../texto-cp1252.js';
import { esquemaCompetenciaSus } from './sus.js';
import { idBancoOuZero } from '../validacao/id-banco.js';

export const CHAVE_LIBERACAO_CONTRATUALIZACAO = 'contratualizacao';
/** Teto das listas (contratos e metas de um contrato). */
export const TETO_CONTRATUALIZACAO = 200;
/** Teto de competências de um painel (a maior periodicidade aceita é a bianual). */
export const COMPETENCIAS_MAXIMAS_PAINEL = 24;

// ── Vocabulário (códigos dos domínios CM*; rótulos do produto) ─────────────────────────────────────

/** A esfera do gestor contratante. */
export const ESFERAS_CONTRATO_SUS = [
  { codigo: 1, rotulo: 'Federal' },
  { codigo: 2, rotulo: 'Estadual' },
  { codigo: 3, rotulo: 'Municipal' },
] as const;
export type EsferaContratoSus = (typeof ESFERAS_CONTRATO_SUS)[number]['codigo'];

/** As duas partes do orçamento do contrato. */
export const TIPOS_ORCAMENTO_SUS = [
  { codigo: 1, rotulo: 'Pré-fixado' },
  { codigo: 2, rotulo: 'Pós-fixado' },
] as const;

/**
 * A periodicidade da meta. `meses` é o tamanho do período em competências; as submensais (diária, semanal,
 * quinzenal) não servem para meta, porque a produção SUS é apurada por competência mensal (D-PER-555).
 */
export const PERIODICIDADES_META_SUS = [
  { codigo: 5, rotulo: 'Mensal', meses: 1 },
  { codigo: 3, rotulo: 'Bimestral', meses: 2 },
  { codigo: 10, rotulo: 'Trimestral', meses: 3 },
  { codigo: 6, rotulo: 'Quadrimestral', meses: 4 },
  { codigo: 11, rotulo: 'Cinco meses', meses: 5 },
  { codigo: 9, rotulo: 'Semestral', meses: 6 },
  { codigo: 12, rotulo: 'Sete meses', meses: 7 },
  { codigo: 13, rotulo: 'Oito meses', meses: 8 },
  { codigo: 14, rotulo: 'Nove meses', meses: 9 },
  { codigo: 15, rotulo: 'Dez meses', meses: 10 },
  { codigo: 16, rotulo: 'Onze meses', meses: 11 },
  { codigo: 1, rotulo: 'Anual', meses: 12 },
  { codigo: 2, rotulo: 'Bianual', meses: 24 },
] as const;
/** Os códigos de periodicidade que não servem para meta (diária 4, quinzenal 7, semanal 8). */
export const PERIODICIDADES_SUBMENSAIS = [4, 7, 8] as const;
export type PeriodicidadeMetaSus = (typeof PERIODICIDADES_META_SUS)[number]['codigo'];

export function mesesDaPeriodicidade(codigo: number): number | null {
  return PERIODICIDADES_META_SUS.find((p) => p.codigo === codigo)?.meses ?? null;
}

/** O grupo do indicador qualitativo (o 0 "não informado" do domínio não é aceito numa meta). */
export const TIPOS_INDICADOR_SUS = [
  { codigo: 1, rotulo: 'Condicionantes da remuneração' },
  { codigo: 2, rotulo: 'Qualidade da assistência' },
  { codigo: 3, rotulo: 'Qualidade da informação' },
  { codigo: 4, rotulo: 'Gestão clínica' },
  { codigo: 5, rotulo: 'Humanização' },
  { codigo: 6, rotulo: 'Manutenção e conservação' },
  { codigo: 7, rotulo: 'Formação continuada' },
] as const;
const CODIGOS_INDICADOR = TIPOS_INDICADOR_SUS.map((t) => t.codigo);

/**
 * O formato da resposta do indicador. Só os mensuráveis entram numa meta: sim ou não (2), valor decimal
 * (6) e valor inteiro (7). Título, texto, texto fixo e respostas (1, 3, 4, 5) são da montagem de questionário.
 */
export const FORMATOS_INDICADOR_SUS = [
  { codigo: 2, rotulo: 'Sim ou não' },
  { codigo: 6, rotulo: 'Valor decimal' },
  { codigo: 7, rotulo: 'Valor inteiro' },
] as const;
export type FormatoIndicadorSus = (typeof FORMATOS_INDICADOR_SUS)[number]['codigo'];
const CODIGOS_FORMATO = FORMATOS_INDICADOR_SUS.map((f) => f.codigo);

/** De onde vem o dado que comprova o indicador (rótulo do produto no código 1, D-AFER-555). */
export const AFERICOES_SUS = [
  { codigo: 1, rotulo: 'Sistema de gestão do hospital' },
  { codigo: 2, rotulo: 'Sistemas do DATASUS' },
  { codigo: 3, rotulo: 'Sistemas de terceiros' },
  { codigo: 4, rotulo: 'Planilhas eletrônicas' },
] as const;
const CODIGOS_AFERICAO = AFERICOES_SUS.map((a) => a.codigo);

/** O escore do período, da faixa de cumprimento (4 é o melhor). */
export const ESCORES_SUS = [
  { codigo: 4, rotulo: 'Ótimo' },
  { codigo: 3, rotulo: 'Bom' },
  { codigo: 2, rotulo: 'Regular' },
  { codigo: 1, rotulo: 'Ruim' },
] as const;
export type EscoreSus = (typeof ESCORES_SUS)[number]['codigo'];

/** A rede de atenção do contrato (0 = não informada). */
export const REDES_ASSISTENCIA_SUS = [
  { codigo: 0, rotulo: 'Não informada' },
  { codigo: 1, rotulo: 'Rede Cegonha' },
  { codigo: 2, rotulo: 'Rede de Urgência e Emergência' },
  { codigo: 3, rotulo: 'Rede de Atenção Psicossocial' },
  { codigo: 4, rotulo: 'Rede de Cuidado à Pessoa com Deficiência' },
  { codigo: 5, rotulo: 'Rede de Atenção à Saúde das Pessoas com Doenças Crônicas' },
] as const;
const CODIGOS_REDE = REDES_ASSISTENCIA_SUS.map((r) => r.codigo);

/** O bloco de financiamento da meta quantitativa (informativo; a produção vem da SIGTAP). */
export const COMPLEXIDADES_SUS = [
  { codigo: 1, rotulo: 'Teto MAC' },
  { codigo: 2, rotulo: 'Alta complexidade ambulatorial' },
  { codigo: 3, rotulo: 'Média complexidade ambulatorial' },
  { codigo: 4, rotulo: 'Alta complexidade hospitalar' },
  { codigo: 5, rotulo: 'Média complexidade hospitalar' },
  { codigo: 6, rotulo: 'Extra teto ambulatorial' },
  { codigo: 7, rotulo: 'Extra teto hospitalar' },
] as const;
const CODIGOS_COMPLEXIDADE = COMPLEXIDADES_SUS.map((c) => c.codigo);

/** O nível da SIGTAP de uma meta quantitativa e o tamanho do código (grupo 2, subgrupo 4, forma 6, procedimento 10). */
export const NIVEIS_SIGTAP_META = [
  { codigo: 'grupo', rotulo: 'Grupo', digitos: 2 },
  { codigo: 'subgrupo', rotulo: 'Subgrupo', digitos: 4 },
  { codigo: 'forma', rotulo: 'Forma de organização', digitos: 6 },
  { codigo: 'procedimento', rotulo: 'Procedimento', digitos: 10 },
] as const;
export type NivelSigtapMeta = (typeof NIVEIS_SIGTAP_META)[number]['codigo'];
const CODIGOS_NIVEL = NIVEIS_SIGTAP_META.map((n) => n.codigo) as [NivelSigtapMeta, ...NivelSigtapMeta[]];

export const MODALIDADES_PRODUCAO_SUS = [
  { codigo: 'ambulatorial', rotulo: 'Ambulatorial (BPA e APAC)' },
  { codigo: 'hospitalar', rotulo: 'Hospitalar (AIH)' },
  { codigo: 'todas', rotulo: 'Ambulatorial e hospitalar' },
] as const;
export type ModalidadeProducaoSus = (typeof MODALIDADES_PRODUCAO_SUS)[number]['codigo'];
const CODIGOS_MODALIDADE = MODALIDADES_PRODUCAO_SUS.map((m) => m.codigo) as [
  ModalidadeProducaoSus,
  ...ModalidadeProducaoSus[],
];

export const TIPOS_META_SUS = [
  { codigo: 'quantitativa', rotulo: 'Quantitativa (produção por grupo SIGTAP)' },
  { codigo: 'qualitativa', rotulo: 'Qualitativa (indicador)' },
] as const;
export type TipoMetaSus = (typeof TIPOS_META_SUS)[number]['codigo'];

export const SENTIDOS_INDICADOR_SUS = [
  { codigo: 'maior', rotulo: 'Quanto maior, melhor' },
  { codigo: 'menor', rotulo: 'Quanto menor, melhor' },
] as const;
export type SentidoIndicadorSus = (typeof SENTIDOS_INDICADOR_SUS)[number]['codigo'];

export const SITUACOES_CONTRATO_SUS = [
  { codigo: 'ativo', rotulo: 'Ativo' },
  { codigo: 'encerrado', rotulo: 'Encerrado' },
] as const;
export type SituacaoContratoSus = (typeof SITUACOES_CONTRATO_SUS)[number]['codigo'];

/** De onde veio a produção do painel (regra 11). */
export const FONTES_PRODUCAO_SUS = [
  { codigo: 'faturamento-sus', rotulo: 'Faturamento SUS (BPA, APAC e AIH gerados)' },
  { codigo: 'contas-sus', rotulo: 'Contas SUS do faturamento de convênios (procedimentos com SIGTAP)' },
] as const;
export type FonteProducaoSus = (typeof FONTES_PRODUCAO_SUS)[number]['codigo'];

/** A origem do realizado de uma apuração. */
export const ORIGENS_APURACAO_SUS = [
  { codigo: 'faturamento-sus', rotulo: 'Faturamento SUS' },
  { codigo: 'contas-sus', rotulo: 'Contas SUS' },
  { codigo: 'informado', rotulo: 'Informado pelo analista' },
] as const;
export type OrigemApuracaoSus = (typeof ORIGENS_APURACAO_SUS)[number]['codigo'];

/** Rótulo de produto de um código de domínio (as listas acima), ou o código quando não há. */
export function rotuloDominioSus(
  lista: readonly { readonly codigo: number | string; readonly rotulo: string }[],
  codigo: number | string | null,
): string {
  if (codigo === null) return '';
  return lista.find((x) => x.codigo === codigo)?.rotulo ?? String(codigo);
}

// ── Recusas (o texto que a tela mostra) ───────────────────────────────────────────────────────────

export const MENSAGENS_CONTRATUALIZACAO = {
  desligado:
    'A contratualização SUS ainda não foi liberada neste estabelecimento: as telas ficam em consulta. A liberação é feita pelo administrador em Funcionalidades por estabelecimento, quando houver contrato com o gestor do SUS.',
  'contrato-inexistente': 'O contrato não existe neste estabelecimento.',
  'contrato-encerrado': 'O contrato está encerrado: metas e apurações não mudam mais.',
  'contrato-fora-da-vigencia': 'A competência está fora da vigência do contrato.',
  'contrato-nao-vigente': 'O contrato não está vigente hoje: confira o início e o fim.',
  'habilitacao-ausente': 'Informe a habilitação SUS do estabelecimento (o número ou a portaria) no contrato.',
  'habilitacao-vencida': 'A habilitação SUS informada no contrato venceu: atualize a validade.',
  'cnes-ausente': 'Informe o CNES do estabelecimento no contrato.',
  'cnes-divergente':
    'O CNES do contrato difere do CNES cadastrado para o estabelecimento no faturamento SUS.',
  'fim-antes-do-inicio': 'O fim da vigência não pode ser anterior ao início.',
  'numero-duplicado': 'Já existe um contrato com este número neste estabelecimento.',
  'orcamento-zerado': 'Informe o valor pré-fixado ou o pós-fixado mensal do contrato.',
  'parte-qualitativa-sem-pre': 'A parte ligada às metas qualitativas só existe com valor pré-fixado.',
  'incentivo-fora-da-vigencia': 'O incentivo tem de estar dentro da vigência do contrato.',
  'incentivo-repetido': 'O mesmo incentivo aparece duas vezes no contrato.',
  'periodicidade-submensal':
    'A meta é apurada por competência: escolha periodicidade mensal ou maior (a diária, a semanal e a quinzenal não servem).',
  'periodicidade-invalida': 'Escolha a periodicidade da meta.',
  'sigtap-obrigatorio':
    'Informe o código SIGTAP da meta (grupo, subgrupo, forma de organização ou procedimento).',
  'sigtap-tamanho': 'O código SIGTAP não tem o tamanho do nível escolhido.',
  'sigtap-inexistente': 'Nenhum procedimento SIGTAP começa com este código.',
  'indicador-obrigatorio': 'Escolha o grupo do indicador e informe o nome do indicador.',
  'formato-obrigatorio': 'Escolha o formato da resposta do indicador.',
  'meta-sim-nao': 'Num indicador sim ou não, a meta é 1 (sim) e o sentido é "quanto maior, melhor".',
  'meta-inteira': 'Num indicador de valor inteiro, a meta é um número inteiro.',
  'campos-de-outro-tipo': 'Há campos que não são deste tipo de meta: limpe-os antes de gravar.',
  'meta-fora-da-vigencia': 'A meta tem de começar e terminar dentro da vigência do contrato.',
  'meta-inexistente': 'A meta não existe neste contrato.',
  'meta-inativa': 'A meta está inativa.',
  'competencia-nao-fecha-periodo':
    'A apuração é registrada na última competência do período da meta: escolha a competência que fecha o período.',
  'competencia-futura':
    'O período ainda não terminou: a apuração só é registrada depois da última competência.',
  'realizado-obrigatorio': 'Informe o resultado do indicador no período.',
  'realizado-de-meta-quantitativa':
    'O realizado da meta quantitativa vem da produção do período: não o informe à mão.',
  'realizado-sim-nao': 'Num indicador sim ou não, o resultado é 1 (sim) ou 0 (não).',
  'apuracao-repetida': 'Este período já tem apuração registrada: abra-a para corrigir pela versão.',
  'chave-de-outro-registro': 'A chave do pedido já foi usada em outro registro.',
  'versao-desatualizada': 'O registro mudou desde que foi aberto: atualize a tela e confira.',
  'faixas-invalidas':
    'As faixas de cumprimento do estabelecimento estão mal configuradas: confira o parâmetro em Parâmetros.',
} as const;
export type CodigoRecusaContratualizacao = Exclude<keyof typeof MENSAGENS_CONTRATUALIZACAO, 'desligado'>;

// ── Entradas ─────────────────────────────────────────────────────────────────────────────────────

const dataIso = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Data no formato AAAA-MM-DD.');
const livre = (max: number) => textoCp1252(max).overwrite((t) => t.replace(/\s+/g, ' ').trim());
const opcional = (max: number) =>
  livre(max)
    .nullable()
    .default(null)
    .transform((t) => (t ? t : null));
const chave = z.string().regex(/^[A-Za-z0-9._:-]{8,80}$/, 'Chave do pedido inválida.');
const centavos = z.number().int().min(0).max(99_999_999_999);
const umDe = (codigos: readonly number[], mensagem: string) =>
  z
    .number()
    .int()
    .refine((n) => codigos.includes(n), { message: mensagem });

export const esquemaIncentivoSus = z
  .object({
    /** Código do incentivo quando o incentivo está no domínio; null para o incentivo só com o nome. */
    incentivo: idBancoOuZero.nullable().default(null),
    nome: livre(120).pipe(z.string().min(3, 'Informe o nome do incentivo.')),
    valorMensalCentavos: centavos.refine((n) => n > 0, { message: 'Informe o valor mensal do incentivo.' }),
    inicio: dataIso,
    fim: dataIso.nullable().default(null),
  })
  .strict();
export type IncentivoSusEntrada = z.infer<typeof esquemaIncentivoSus>;

/** POST /api/faturamento/sus/contratualizacao/contratos e PUT .../contratos/:id. */
export const esquemaContratoSus = z
  .object({
    chave,
    numero: livre(30).pipe(z.string().min(1, 'Informe o número do contrato.')),
    esfera: umDe(
      ESFERAS_CONTRATO_SUS.map((e) => e.codigo),
      'Escolha a esfera do gestor.',
    ),
    gestor: livre(120).pipe(z.string().min(3, 'Informe o gestor contratante (a secretaria de saúde).')),
    objeto: livre(500).pipe(z.string().min(5, 'Descreva o objeto do contrato.')),
    inicio: dataIso,
    fim: dataIso,
    cnes: z
      .string()
      .regex(/^\d{7}$/, 'O CNES tem 7 dígitos.')
      .nullable()
      .default(null),
    habilitacao: opcional(200),
    habilitacaoValidade: dataIso.nullable().default(null),
    redeAssistencia: umDe(CODIGOS_REDE, 'Escolha a rede de atenção.').default(0),
    valorPreMensalCentavos: centavos.default(0),
    valorPosMensalCentavos: centavos.default(0),
    /** A parte do pré-fixado condicionada às metas qualitativas, em % (o resto é das quantitativas). */
    parteQualitativaPct: z.number().int().min(0).max(100).default(40),
    incentivos: z.array(esquemaIncentivoSus).max(30).default([]),
    observacao: opcional(500),
    versaoVista: z.number().int().positive().nullable().default(null),
  })
  .strict();
export type ContratoSusEntrada = z.infer<typeof esquemaContratoSus>;

/** POST .../contratos/:id/encerramento. */
export const esquemaEncerrarContratoSus = z
  .object({
    versaoVista: z.number().int().positive(),
    motivo: livre(300).pipe(z.string().min(10, 'Explique o motivo do encerramento.')),
  })
  .strict();
export type EncerrarContratoSusEntrada = z.infer<typeof esquemaEncerrarContratoSus>;

/** POST .../contratos/:id/metas e PUT .../metas/:id. */
export const esquemaMetaSus = z
  .object({
    chave,
    tipo: z.enum(['quantitativa', 'qualitativa']),
    descricao: livre(200).pipe(z.string().min(3, 'Descreva a meta.')),
    periodicidade: z.number().int().min(1).max(99),
    /** A primeira e a última competência em que a meta vale (a última pode ficar em aberto). */
    inicio: esquemaCompetenciaSus,
    fim: esquemaCompetenciaSus.nullable().default(null),
    /** Pontos da meta (o peso na parte do pré-fixado do seu tipo). */
    pontos: z.number().int().min(1).max(1000).default(10),
    // Quantitativa.
    nivelSigtap: z.enum(CODIGOS_NIVEL).nullable().default(null),
    codigoSigtap: z
      .string()
      .regex(/^\d{2,10}$/, 'Só os dígitos do código SIGTAP.')
      .nullable()
      .default(null),
    modalidade: z.enum(CODIGOS_MODALIDADE).nullable().default(null),
    complexidade: umDe(CODIGOS_COMPLEXIDADE, 'Escolha o bloco de financiamento.').nullable().default(null),
    // Qualitativa.
    indicador: umDe(CODIGOS_INDICADOR, 'Escolha o grupo do indicador.').nullable().default(null),
    formato: umDe(CODIGOS_FORMATO, 'Escolha o formato da resposta.').nullable().default(null),
    sentido: z.enum(['maior', 'menor']).nullable().default(null),
    unidade: opcional(20),
    afericao: umDe(CODIGOS_AFERICAO, 'Escolha a fonte da aferição.').nullable().default(null),
    /**
     * A meta: na quantitativa, a quantidade POR COMPETÊNCIA (a do período é ela vezes os meses); na qualitativa, o valor
     * do indicador no período (sim ou não: 1).
     */
    valorMeta: z.number().positive('A meta tem de ser maior que zero.').max(999_999_999),
    ativa: z.boolean().default(true),
    versaoVista: z.number().int().positive().nullable().default(null),
  })
  .strict();
export type MetaSusEntrada = z.infer<typeof esquemaMetaSus>;

/**
 * POST .../metas/:id/apuracoes: o fechamento do período da meta. Sem versaoVista registra a apuração; com a versão da
 * apuração já registrada no período (ResultadoMetaSus.apuracaoRegistrada.versao), corrige-a.
 */
export const esquemaApuracaoSus = z
  .object({
    chave,
    /** A última competência do período. */
    competencia: esquemaCompetenciaSus,
    /** Só na qualitativa (o resultado do indicador); na quantitativa o servidor lê a produção. */
    realizado: z.number().min(0).max(999_999_999).nullable().default(null),
    observacao: opcional(500),
    versaoVista: z.number().int().positive().nullable().default(null),
  })
  .strict();
export type ApuracaoSusEntrada = z.infer<typeof esquemaApuracaoSus>;

/** GET .../contratos/:id/painel?competencia=AAAAMM: produção × meta do período que contém a competência. */
export const esquemaFiltroPainelSus = z.object({ competencia: esquemaCompetenciaSus }).strict();

/** GET .../sigtap?termo=: a busca do código SIGTAP da meta (grupo, subgrupo, forma ou procedimento). */
export const esquemaBuscaSigtapMeta = z
  .object({ termo: z.string().trim().min(2, 'Digite ao menos 2 caracteres.').max(60) })
  .strict();

// ── Respostas ────────────────────────────────────────────────────────────────────────────────────

export interface IncentivoSus {
  readonly incentivo: number | null;
  readonly nome: string;
  readonly valorMensalCentavos: number;
  readonly inicio: string;
  readonly fim: string | null;
}

export interface ContratoSus {
  readonly id: number;
  readonly numero: string;
  readonly esfera: EsferaContratoSus;
  readonly gestor: string;
  readonly objeto: string;
  readonly inicio: string;
  readonly fim: string;
  readonly cnes: string | null;
  readonly habilitacao: string | null;
  readonly habilitacaoValidade: string | null;
  readonly redeAssistencia: number;
  readonly valorPreMensalCentavos: number;
  readonly valorPosMensalCentavos: number;
  readonly parteQualitativaPct: number;
  readonly incentivos: readonly IncentivoSus[];
  readonly observacao: string | null;
  readonly situacao: SituacaoContratoSus;
  readonly motivoEncerramento: string | null;
  readonly encerradoPor: string | null;
  readonly encerradoEm: string | null;
  readonly criadoPor: string;
  readonly criadoEm: string;
  readonly alteradoPor: string | null;
  readonly alteradoEm: string | null;
  readonly versao: number;
}

export interface MetaSus {
  readonly id: number;
  readonly contrato: number;
  readonly tipo: TipoMetaSus;
  readonly descricao: string;
  readonly periodicidade: number;
  readonly inicio: string;
  readonly fim: string | null;
  readonly pontos: number;
  readonly nivelSigtap: NivelSigtapMeta | null;
  readonly codigoSigtap: string | null;
  readonly modalidade: ModalidadeProducaoSus | null;
  readonly complexidade: number | null;
  readonly indicador: number | null;
  readonly formato: number | null;
  readonly sentido: SentidoIndicadorSus | null;
  readonly unidade: string | null;
  readonly afericao: number | null;
  readonly valorMeta: number;
  readonly ativa: boolean;
  readonly por: string;
  readonly em: string;
  readonly versao: number;
}

export interface ApuracaoSus {
  readonly id: number;
  readonly meta: number;
  readonly competencia: string;
  /** A primeira competência do período apurado. */
  readonly inicioPeriodo: string;
  readonly metaPeriodo: number;
  readonly realizado: number;
  readonly cumprimentoPct: number;
  readonly escore: EscoreSus;
  readonly origem: OrigemApuracaoSus;
  readonly observacao: string | null;
  readonly por: string;
  readonly em: string;
  readonly versao: number;
}

/** Uma linha da produção SUS agregada: competência, modalidade, código SIGTAP de 10 dígitos e a quantidade. */
export interface ProducaoSigtapSus {
  readonly competencia: string;
  readonly modalidade: 'ambulatorial' | 'hospitalar';
  readonly codigo: string;
  readonly quantidade: number;
}

/** O período de uma meta: as competências e se ele já terminou na competência de referência. */
export interface PeriodoMetaSus {
  readonly inicio: string;
  readonly fim: string;
  readonly competencias: readonly string[];
  readonly meses: number;
}

/** A faixa de cumprimento: a partir de `minimoPct`, o escore e o repasse da parte em %. */
export interface FaixaCumprimentoSus {
  readonly minimoPct: number;
  readonly escore: EscoreSus;
  readonly repassePct: number;
}

/** Resultado de uma meta no período, com as parcelas impressas (regra 11). */
export interface ResultadoMetaSus {
  readonly meta: number;
  readonly tipo: TipoMetaSus;
  readonly descricao: string;
  readonly periodo: PeriodoMetaSus;
  readonly metaPeriodo: number;
  readonly realizado: number | null;
  readonly realizadoPorCompetencia: readonly { readonly competencia: string; readonly quantidade: number }[];
  readonly cumprimentoPct: number | null;
  readonly escore: EscoreSus | null;
  readonly pontos: number;
  /** Pontos obtidos (qualitativa: os pontos se cumpriu; quantitativa: os pontos × cumprimento limitado a 100%). */
  readonly pontosObtidos: number | null;
  readonly origem: OrigemApuracaoSus | null;
  readonly apurada: boolean;
  /** A apuração registrada do período, com a versão que a correção envia como versaoVista (null se não há). */
  readonly apuracaoRegistrada: {
    readonly id: number;
    readonly versao: number;
    readonly observacao: string | null;
  } | null;
  readonly conta: readonly string[];
}

/** A parte do repasse pré-fixado de um tipo de meta no período. */
export interface ParteRepasseSus {
  readonly tipo: TipoMetaSus;
  readonly valorCentavos: number;
  readonly pontosPossiveis: number;
  readonly pontosObtidos: number;
  readonly cumprimentoPct: number | null;
  readonly escore: EscoreSus | null;
  readonly repassePct: number | null;
  readonly repasseCentavos: number | null;
  readonly conta: readonly string[];
}

export interface RepasseEstimadoSus {
  readonly meses: number;
  readonly preFixadoCentavos: number;
  readonly partes: readonly ParteRepasseSus[];
  readonly incentivosCentavos: number;
  readonly posFixadoEstimadoCentavos: number;
  /** null enquanto alguma meta do período não tem resultado (a qualitativa sem apuração). */
  readonly totalEstimadoCentavos: number | null;
  readonly conta: readonly string[];
}

export interface PainelContratualizacaoSus {
  readonly contrato: ContratoSus;
  readonly competencia: string;
  readonly fonte: FonteProducaoSus;
  readonly resultados: readonly ResultadoMetaSus[];
  readonly repasse: RepasseEstimadoSus | null;
  readonly faixas: readonly FaixaCumprimentoSus[];
  readonly avisos: readonly string[];
}
