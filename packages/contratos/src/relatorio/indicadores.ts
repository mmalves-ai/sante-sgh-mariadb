// Contratos dos indicadores hospitalares e dos painéis gerenciais (M16; ficha, seções 7 e 8; cap-07 §7.5.3). A
// base mensal é calculada pelo motor da internação (@sgh/dominio-internacao) a partir da trajetória do paciente;
// as fichas técnicas e as fórmulas ficam em @sgh/dominio-relatorio (regra 11: cada valor mostra o numerador e o
// denominador). Nada aqui é dado de pessoa: só contagens agregadas por período e recorte.
import { z } from 'zod';
import type { GrupoMotivoAlta } from '../legendas/legendas.js';

/** Códigos dos indicadores com ficha (a ficha em si é versionada em @sgh/dominio-relatorio). */
export const CODIGOS_INDICADOR = [
  'taxaOcupacao',
  'taxaOcupacaoIntensiva',
  'mediaPermanencia',
  'mediaDiariasFaturadas',
  'mediaPacientesDia',
  'giroLeito',
  'intervaloSubstituicao',
  'taxaMortalidadeGeral',
  'taxaMortalidadeInstitucional',
  'taxaReinternacao7',
  'taxaReinternacao30',
  'admissoes',
  'percentualUrgencia',
] as const;
export type CodigoIndicador = (typeof CODIGOS_INDICADOR)[number];

/**
 * Nome de cada indicador como na ficha técnica (o rótulo dos parâmetros de meta; @sgh/dominio-relatorio confere
 * que é o mesmo nome da ficha).
 */
export const NOME_INDICADOR: Readonly<Record<CodigoIndicador, string>> = {
  taxaOcupacao: 'Taxa de ocupação hospitalar',
  taxaOcupacaoIntensiva: 'Taxa de ocupação da terapia intensiva',
  mediaPermanencia: 'Média de permanência (Portaria 312)',
  mediaDiariasFaturadas: 'Média de diárias faturáveis por saída',
  mediaPacientesDia: 'Média de pacientes-dia (censo médio diário)',
  giroLeito: 'Índice de rotatividade (giro do leito)',
  intervaloSubstituicao: 'Intervalo de substituição',
  taxaMortalidadeGeral: 'Taxa de mortalidade geral',
  taxaMortalidadeInstitucional: 'Taxa de mortalidade institucional',
  taxaReinternacao7: 'Taxa de reinternação em até 7 dias',
  taxaReinternacao30: 'Taxa de reinternação em até 30 dias',
  admissoes: 'Internações (admissões)',
  percentualUrgencia: 'Internações de urgência',
};

/** Formato aceito na meta de um indicador: "sem meta" ou um número com vírgula ou ponto decimal (ex.: 85 ou 85,5). */
export const FORMATO_META_INDICADOR = '^(?:sem meta|-?\\d+(?:[.,]\\d+)?)$';

export const UNIDADES_INDICADOR = ['percentual', 'dias', 'razao', 'quantidade'] as const;
export type UnidadeIndicador = (typeof UNIDADES_INDICADOR)[number];

export const POLARIDADES_INDICADOR = ['maior-melhor', 'menor-melhor', 'faixa', 'neutra'] as const;
export type PolaridadeIndicador = (typeof POLARIDADES_INDICADOR)[number];

/** Grandezas da base mensal que as fórmulas usam (numerador e denominador nomeados). */
export const GRANDEZAS_BASE = [
  'dias',
  'pacientesDia',
  'leitosDia',
  'pacientesDiaIntensiva',
  'leitosDiaIntensiva',
  'admissoes',
  'admissoesUrgencia',
  'saidas',
  'obitos',
  'obitosInstitucionais',
  'saidasVivas',
  'reinternacoes7',
  'reinternacoes30',
  'diariasFaturadas',
  'leitosOperacionaisMedios',
  /** Leito-dia sem paciente (leito-dia − paciente-dia; intervalo de substituição). */
  'leitosDiaOciosos',
] as const;
export type GrandezaBase = (typeof GRANDEZAS_BASE)[number];

export const esquemaFichaIndicador = z.object({
  codigo: z.enum(CODIGOS_INDICADOR),
  nome: z.string().min(3),
  /** Fórmula em texto (como a ficha impressa mostra). */
  formula: z.string().min(3),
  numerador: z.object({ grandeza: z.enum(GRANDEZAS_BASE), descricao: z.string().min(3) }),
  /** null: indicador de contagem (o valor é o numerador). */
  denominador: z.object({ grandeza: z.enum(GRANDEZAS_BASE), descricao: z.string().min(3) }).nullable(),
  /** Multiplicador do quociente (100 nos percentuais). */
  fator: z.number().positive(),
  unidade: z.enum(UNIDADES_INDICADOR),
  fonte: z.string().min(3),
  referencia: z.string().min(3),
  periodicidade: z.literal('mensal'),
  polaridade: z.enum(POLARIDADES_INDICADOR),
  responsavel: z.string().min(3),
  versao: z.number().int().positive(),
  /** Limitações declaradas (regra 10: o leito-dia operacional usa a situação atual do leito). */
  limitacoes: z.array(z.string()),
  /** Recortes em que o denominador existe. */
  recortes: z.array(z.enum(['acomodacao', 'tipoAcomodacao', 'clinica'])),
});
export type FichaIndicador = z.infer<typeof esquemaFichaIndicador>;

/** Base mensal de um recorte: as grandezas que as fórmulas consomem. */
export interface BaseMensal {
  readonly periodo: string;
  readonly parcial: boolean;
  readonly grandezas: Readonly<Record<GrandezaBase, number>>;
  readonly altasPorGrupo: Readonly<Record<GrupoMotivoAlta, number>>;
}

export const RECORTES_INDICADOR = ['todos', 'acomodacao', 'tipoAcomodacao', 'clinica'] as const;
export type RecorteIndicador = (typeof RECORTES_INDICADOR)[number];

export const esquemaValorIndicador = z.object({
  periodo: z.string(),
  numerador: z.number(),
  denominador: z.number().nullable(),
  valor: z.number().nullable(),
  parcial: z.boolean(),
});
export type ValorIndicador = z.infer<typeof esquemaValorIndicador>;

export const SITUACOES_META = ['na-meta', 'fora-da-meta', 'sem-meta', 'sem-valor'] as const;
export type SituacaoMeta = (typeof SITUACOES_META)[number];

export const esquemaFichaComMeta = esquemaFichaIndicador.extend({
  /** Meta do parâmetro `relatorio.meta.<codigo>` (null = sem meta definida). */
  meta: z.number().nullable(),
});
export type FichaComMeta = z.infer<typeof esquemaFichaComMeta>;

export const esquemaResumoIndicador = z.object({
  ficha: esquemaFichaComMeta,
  ultimo: esquemaValorIndicador.nullable(),
  situacao: z.enum(SITUACOES_META),
});
export type ResumoIndicador = z.infer<typeof esquemaResumoIndicador>;

export const esquemaIndiceIndicadores = z.object({
  periodo: z.object({ de: z.string(), ate: z.string() }),
  indicadores: z.array(esquemaResumoIndicador),
  dadosAte: z.string(),
  /** Último dia com movimento (AAAA-MM-DD); null nos painéis da cópia diária. */
  ultimoMovimento: z.string().nullable(),
});
export type IndiceIndicadores = z.infer<typeof esquemaIndiceIndicadores>;

export const esquemaSerieIndicador = z.object({
  ficha: esquemaFichaComMeta,
  recorte: z.enum(RECORTES_INDICADOR),
  valorRecorte: z.string().nullable(),
  opcoesRecorte: z.array(z.object({ valor: z.string(), rotulo: z.string() })),
  valores: z.array(esquemaValorIndicador),
  /** O mesmo mês do ano anterior (comparar). */
  anoAnterior: z.array(esquemaValorIndicador),
  /** Detalhar: o período escolhido aberto pelo recorte. */
  detalhe: z.array(
    z.object({
      chave: z.string(),
      rotulo: z.string(),
      numerador: z.number(),
      denominador: z.number().nullable(),
      valor: z.number().nullable(),
    }),
  ),
  periodoDetalhe: z.string().nullable(),
  dadosAte: z.string(),
  /** Último dia com movimento (AAAA-MM-DD); null nos painéis da cópia diária. */
  ultimoMovimento: z.string().nullable(),
});
export type SerieIndicador = z.infer<typeof esquemaSerieIndicador>;

/** Mês "AAAA-MM" (01 a 12). */
const MES = /^\d{4}-(0[1-9]|1[0-2])$/;

export const esquemaConsultaIndicador = z
  .object({
    de: z.string().regex(MES).optional(),
    ate: z.string().regex(MES).optional(),
    recorte: z.enum(RECORTES_INDICADOR).default('todos'),
    valor: z.string().max(40).optional(),
    detalhar: z.string().regex(MES).optional(),
  })
  .strict();
export type ConsultaIndicador = z.infer<typeof esquemaConsultaIndicador>;

// ── Painéis gerenciais ───────────────────────────────────────────────────────────────────────────────

export const PAINEIS_GERENCIAIS = ['assistencial', 'operacional', 'financeiro'] as const;
export type PainelGerencial = (typeof PAINEIS_GERENCIAIS)[number];

/** Réguas da receita (regra 13): pela data do item e pela competência da conta. */
export const REGUAS_RECEITA = ['data-do-item', 'competencia'] as const;
export type ReguaReceita = (typeof REGUAS_RECEITA)[number];

export const esquemaSeriePainel = z.object({
  codigo: z.string(),
  rotulo: z.string(),
  unidade: z.enum(['percentual', 'dias', 'razao', 'quantidade', 'reais']),
  /** Régua da série financeira (o nome da régua aparece na tela). */
  regua: z.enum(REGUAS_RECEITA).nullable(),
  valores: z.array(
    z.object({
      periodo: z.string(),
      valor: z.number().nullable(),
      numerador: z.number().nullable(),
      denominador: z.number().nullable(),
      parcial: z.boolean(),
    }),
  ),
});
export type SeriePainel = z.infer<typeof esquemaSeriePainel>;

export const esquemaPainelGerencial = z.object({
  painel: z.enum(PAINEIS_GERENCIAIS),
  /** ao-vivo: tabelas pequenas lidas na hora; copia-diaria: a cópia (DP-15; em dev, a cópia local). */
  fonte: z.enum(['ao-vivo', 'copia-diaria']),
  periodo: z.object({ de: z.string(), ate: z.string() }),
  dadosAte: z.string(),
  series: z.array(esquemaSeriePainel),
  notas: z.array(z.string()),
  ultimoMovimento: z.string().nullable(),
});
export type PainelGerencialDados = z.infer<typeof esquemaPainelGerencial>;

export const esquemaConsultaPainel = z
  .object({
    de: z.string().regex(MES).optional(),
    ate: z.string().regex(MES).optional(),
  })
  .strict();
