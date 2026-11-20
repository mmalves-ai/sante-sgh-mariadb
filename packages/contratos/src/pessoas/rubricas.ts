// Rubricas, incidências e tabelas legais da folha (M53, etapa F1; ficha, seção 4 "Rubricas e incidências vigentes" e
// "Tabelas legais vigentes", seção 7 tela "Rubricas, incidências e tabelas legais", seção 8 regra 7). O que a API devolve
// à tela e ao cálculo (F2): a rubrica com as incidências lidas onde estão (as letras da própria rubrica e os códigos de
// incidência do eSocial dos vínculos), e a tabela legal da vigência (IRRF, INSS, salário-família, salário mínimo).
// Valores em CENTAVOS inteiros e alíquotas em CENTÉSIMOS de ponto percentual (7,5% = 750), como no contrato da
// interface com a folha externa: nada de ponto flutuante na regra (a tabela do outro sistema guarda DOUBLE; a leitura
// arredonda ao centavo). A gravação é a do CRUD genérico (receita genérica, operações `pessoas.alterarRubrica`,
// `pessoas.incluirTabelaLegalFolha` e afins); nenhum nome de tabela do outro sistema aparece aqui.
import { z } from 'zod';

const DATA = /^\d{4}-\d{2}-\d{2}$/;
const COMPETENCIA = /^\d{4}-(0[1-9]|1[0-2])$/;

export const esquemaCompetenciaRubricas = z.string().regex(COMPETENCIA, 'competência no formato AAAA-MM');

/** Tipo da rubrica (as letras do domínio de tipos de evento da folha). */
export const TIPOS_RUBRICA_FOLHA = [
  'provento',
  'desconto',
  'base',
  'informativa',
  'informativaDedutora',
] as const;
export type TipoRubricaFolha = (typeof TIPOS_RUBRICA_FOLHA)[number];

/** Como a quantidade da rubrica é lida (domínio de tipos de referência). */
export const REFERENCIAS_RUBRICA_FOLHA = ['valor', 'hora', 'dia', 'referencia', 'percentual'] as const;
export type ReferenciaRubricaFolha = (typeof REFERENCIAS_RUBRICA_FOLHA)[number];

/**
 * As incidências marcadas na própria rubrica (Sim/Não), com o nome de produto. A ordem é a da tela; as demais letras
 * da rubrica (médias, estornos) ficam no cadastro genérico.
 */
export const INCIDENCIAS_RUBRICA_FOLHA = [
  'inss',
  'irrf',
  'fgts',
  'inss13',
  'irrf13',
  'fgts13',
  'inssFerias',
  'irrfFerias',
  'dsr',
  'salarioFamilia',
  'valeTransporte',
  'pensao',
  'pis',
  'contribuicaoSindical',
  'rais',
  'informeRendimentos',
  'mediaFerias',
  'media13',
  'mediaRescisao',
  'rescisao',
] as const;
export type IncidenciaRubricaFolha = (typeof INCIDENCIAS_RUBRICA_FOLHA)[number];

/** Os quatro vínculos de incidência do eSocial (tabelas de incidência por rubrica). */
export const TRIBUTOS_INCIDENCIA_ESOCIAL = ['inss', 'irrf', 'fgts', 'sindical'] as const;
export type TributoIncidenciaEsocial = (typeof TRIBUTOS_INCIDENCIA_ESOCIAL)[number];

/** Em que folhas a rubrica entra. */
export const USOS_RUBRICA_FOLHA = ['mensal', 'ferias', 'rescisao'] as const;
export type UsoRubricaFolha = (typeof USOS_RUBRICA_FOLHA)[number];

export const esquemaCodigoIncidenciaEsocial = z
  .object({
    /** Código oficial do eSocial (ex.: "11" base mensal do INSS). */
    codigo: z.string().min(1).max(5),
    rotulo: z.string(),
  })
  .strict();
export type CodigoIncidenciaEsocial = z.infer<typeof esquemaCodigoIncidenciaEsocial>;

export const esquemaVigenciaRubrica = z
  .object({
    inicio: z.string().regex(DATA).nullable(),
    fim: z.string().regex(DATA).nullable(),
  })
  .strict();
export type VigenciaRubrica = z.infer<typeof esquemaVigenciaRubrica>;

export const esquemaRubricaFolha = z
  .object({
    /** Identificador interno (a chave do cadastro genérico, `pessoas.rubrica`). */
    id: z.number().int().positive(),
    empresa: z.number().int().nonnegative(),
    codigo: z.number().int().nonnegative(),
    descricao: z.string(),
    tipo: z.enum(TIPOS_RUBRICA_FOLHA).nullable(),
    referencia: z.enum(REFERENCIAS_RUBRICA_FOLHA).nullable(),
    /** Percentual de incidência da rubrica, em centésimos de ponto (50% = 5000). */
    percentual: z.number().int().nonnegative(),
    prioridade: z.number().int().nullable(),
    ativa: z.boolean(),
    vigencia: esquemaVigenciaRubrica,
    usos: z.array(z.enum(USOS_RUBRICA_FOLHA)),
    incidencias: z.record(z.enum(INCIDENCIAS_RUBRICA_FOLHA), z.boolean()),
    /** Código de incidência do eSocial de cada tributo (null: a rubrica não tem o vínculo). */
    esocial: z.record(z.enum(TRIBUTOS_INCIDENCIA_ESOCIAL), z.string().nullable()),
    /** Natureza da rubrica do eSocial (tabela 3), pelo identificador do domínio oficial. */
    natureza: z.number().int().nullable(),
  })
  .strict();
export type RubricaFolha = z.infer<typeof esquemaRubricaFolha>;

/** Divergência da conferência das incidências (regra pura `conferirIncidenciasRubrica`). */
export const CODIGOS_CONFERENCIA_RUBRICA = [
  /** A rubrica incide no tributo, mas o código do eSocial diz que ela não é base. */
  'incide-sem-base-esocial',
  /** O código do eSocial diz que é base, mas a rubrica não incide no tributo. */
  'base-esocial-sem-incidencia',
  /** A rubrica incide no tributo e não tem o código de incidência do eSocial. */
  'sem-codigo-esocial',
  /** Rubrica em uso sem natureza do eSocial (tabela 3). */
  'sem-natureza-esocial',
  /** Vigência com fim antes do início. */
  'vigencia-invertida',
] as const;
export type CodigoConferenciaRubrica = (typeof CODIGOS_CONFERENCIA_RUBRICA)[number];

export const esquemaConferenciaRubrica = z
  .object({
    rubrica: z.number().int(),
    codigo: z.enum(CODIGOS_CONFERENCIA_RUBRICA),
    tributo: z.enum(TRIBUTOS_INCIDENCIA_ESOCIAL).nullable(),
  })
  .strict();
export type ConferenciaRubrica = z.infer<typeof esquemaConferenciaRubrica>;

/** Resposta de `GET /api/pessoas/folha/rubricas?competencia=AAAA-MM`. */
export const esquemaRubricasDaCompetencia = z
  .object({
    competencia: z.string().regex(COMPETENCIA),
    /** Data em que a vigência é lida (primeiro dia da competência, regra 7). */
    dataReferencia: z.string().regex(DATA),
    rubricas: z.array(esquemaRubricaFolha),
    /** Rubricas fora de vigência na competência (só a contagem; a lista completa traz `todas=1`). */
    foraDeVigencia: z.number().int().nonnegative(),
    conferencia: z.array(esquemaConferenciaRubrica),
  })
  .strict();
export type RubricasDaCompetencia = z.infer<typeof esquemaRubricasDaCompetencia>;

// ---------------------------------------------------------------------------------------------------------------
// Tabelas legais (regra 7: com vigência, nunca constante no código).

/** Faixa progressiva: até `ate` centavos (null = sem limite, a última), com alíquota e parcela a deduzir. */
export const esquemaFaixaTabelaLegal = z
  .object({
    de: z.number().int().nonnegative(),
    ate: z.number().int().nonnegative().nullable(),
    aliquota: z.number().int().min(0).max(10_000),
    deducao: z.number().int().nonnegative(),
  })
  .strict();
export type FaixaTabelaLegal = z.infer<typeof esquemaFaixaTabelaLegal>;

export const esquemaFaixaSalarioFamilia = z
  .object({
    de: z.number().int().nonnegative(),
    ate: z.number().int().nonnegative(),
    cota: z.number().int().nonnegative(),
  })
  .strict();
export type FaixaSalarioFamilia = z.infer<typeof esquemaFaixaSalarioFamilia>;

export const esquemaTabelaLegalFolha = z
  .object({
    /** Início da vigência (a chave do cadastro genérico `pessoas.tabelaLegalFolha`). */
    inicio: z.string().regex(DATA),
    irrf: z
      .object({
        faixas: z.array(esquemaFaixaTabelaLegal),
        deducaoDependente: z.number().int().nonnegative(),
        descontoSimplificado: z.number().int().nonnegative(),
        /** Redução do imposto da lei de 2026 (zero quando a vigência não a tem). */
        reducao: z
          .object({
            isencaoAte: z.number().int().nonnegative(),
            reducaoDe: z.number().int().nonnegative(),
            reducaoAte: z.number().int().nonnegative(),
            valor: z.number().int().nonnegative(),
            semReducaoAcimaDe: z.number().int().nonnegative(),
          })
          .strict(),
      })
      .strict(),
    inss: z
      .object({
        faixas: z.array(esquemaFaixaTabelaLegal),
        /** Teto do salário de contribuição. */
        teto: z.number().int().nonnegative(),
      })
      .strict(),
    salarioFamilia: z.array(esquemaFaixaSalarioFamilia),
    salarioMinimo: z.number().int().nonnegative(),
    /** Contribuinte individual (autônomo do repasse): alíquota e teto. */
    contribuinteIndividual: z
      .object({
        aliquota: z.number().int().min(0).max(10_000),
        teto: z.number().int().nonnegative(),
      })
      .strict(),
  })
  .strict();
export type TabelaLegalFolha = z.infer<typeof esquemaTabelaLegalFolha>;

export const CODIGOS_CONFERENCIA_TABELA_LEGAL = [
  /** Faixas fora de ordem ou sobrepostas. */
  'faixas-fora-de-ordem',
  /** Buraco entre o fim de uma faixa e o começo da seguinte (mais de um centavo). */
  'faixas-com-buraco',
  /** Alíquota que diminui de uma faixa para a seguinte (tabela progressiva). */
  'aliquota-regressiva',
  /** Tabela sem faixa. */
  'sem-faixas',
  /** Teto do INSS diferente do fim da última faixa. */
  'teto-diferente-da-ultima-faixa',
  /** Salário mínimo zerado. */
  'sem-salario-minimo',
] as const;
export type CodigoConferenciaTabelaLegal = (typeof CODIGOS_CONFERENCIA_TABELA_LEGAL)[number];

export const esquemaConferenciaTabelaLegal = z
  .object({
    codigo: z.enum(CODIGOS_CONFERENCIA_TABELA_LEGAL),
    tabela: z.enum(['irrf', 'inss', 'salarioFamilia', 'geral']),
    faixa: z.number().int().nullable(),
  })
  .strict();
export type ConferenciaTabelaLegal = z.infer<typeof esquemaConferenciaTabelaLegal>;

/** Resposta de `GET /api/pessoas/folha/tabelas-legais?competencia=AAAA-MM`. */
/**
 * Dias de afastamento por doença a cargo da empresa (antes do benefício da previdência), com vigência: uma linha por
 * início de vigência (regra 7: nunca constante no código).
 */
export const esquemaDiasAfastamentoFolha = z
  .object({ inicio: z.string().regex(DATA), dias: z.number().int().min(0) })
  .strict();
export type DiasAfastamentoFolha = z.infer<typeof esquemaDiasAfastamentoFolha>;

export const esquemaTabelasLegaisDaCompetencia = z
  .object({
    competencia: z.string().regex(COMPETENCIA),
    dataReferencia: z.string().regex(DATA),
    /** A vigente na data de referência (null: nenhuma vigência começa até lá). */
    vigente: esquemaTabelaLegalFolha.nullable(),
    conferencia: z.array(esquemaConferenciaTabelaLegal),
    /** Todas as vigências, da mais nova para a mais antiga (só o início; a tela abre cada uma no cadastro). */
    vigencias: z.array(z.string().regex(DATA)),
    /** Dias de afastamento a cargo da empresa: o vigente na data de referência e todas as vigências (mais nova primeiro). */
    afastamento: z
      .object({
        vigente: esquemaDiasAfastamentoFolha.nullable(),
        vigencias: z.array(esquemaDiasAfastamentoFolha),
      })
      .strict(),
  })
  .strict();
export type TabelasLegaisDaCompetencia = z.infer<typeof esquemaTabelasLegaisDaCompetencia>;

/** Resposta de `GET /api/pessoas/folha/rubricas/apoio`: os domínios oficiais da tela (só rótulos). */
export const esquemaApoioRubricas = z
  .object({
    incidenciasEsocial: z.record(
      z.enum(TRIBUTOS_INCIDENCIA_ESOCIAL),
      z.array(esquemaCodigoIncidenciaEsocial),
    ),
    naturezas: z.array(z.object({ id: z.number().int(), codigo: z.string(), rotulo: z.string() }).strict()),
    /** A gravação das rubricas e incidências está ligada (chave `pessoas.folha`, POL-3, e `pessoas.rubrica.editar`)? */
    gravacaoLigada: z.boolean(),
    motivoDesligada: z.string().nullable(),
    /** M53.2: o usuário consulta as rubricas (`pessoas.rubrica.ler`)? Sem ela, a aba Rubricas não aparece. */
    lerRubricas: z.boolean(),
    /**
     * M53.2: a tabela legal por si (D-CHAVE-532: não depende da chave `pessoas.folha`): consulta com
     * `pessoas.tabelaLegalFolha.ler` e grava com `pessoas.tabelaLegalFolha.editar` mais `pessoas.rubrica.editar`.
     */
    tabelaLegal: z
      .object({ ler: z.boolean(), gravacaoLigada: z.boolean(), motivoDesligada: z.string().nullable() })
      .strict(),
    /** Recursos do cadastro genérico que a tela abre embutidos (`pessoas.<recurso>`). */
    cadastros: z.array(z.string()),
  })
  .strict();
export type ApoioRubricas = z.infer<typeof esquemaApoioRubricas>;
