// Apuração do custo do mês, custo por conta e por paciente, margem e exportação (M54-F5; ficha, seções 4, 6, 7 e 8,
// regras 7 a 10 e 15). Custeio por absorção com rateio sequencial (os auxiliares e administrativos repartem, na ordem de
// SGH_CUS_CENTRO, aos centros que vêm depois, pelo critério de cada um); custo final = direto + rateios recebidos, com as
// parcelas. O custo do centro produtivo chega à conta pela razão custo/receita do centro na competência (o que a conta
// faturou no centro × custo final do centro ÷ o que o centro faturou). Valores em centavos (inteiros); quantidades em
// centésimos. Nenhum dado pessoal: a conta aparece pelo ID e pelo número, nunca pelo nome do paciente.
import { z } from 'zod';
import { textoCp1252 } from '../texto-cp1252.js';
import { type ClasseCentroCusto, type CodigoEstatistica, esquemaCompetenciaCustos } from './estrutura.js';

// ── Custo direto ──────────────────────────────────────────────────────────────────────────────────────────────────────

/** Grupos do custo direto do centro (as parcelas que a apuração imprime). */
export const GRUPOS_CUSTO_DIRETO = ['pessoal', 'materiais', 'despesas'] as const;
export type GrupoCustoDireto = (typeof GRUPOS_CUSTO_DIRETO)[number];

export const ROTULOS_GRUPO_CUSTO_DIRETO: Readonly<Record<GrupoCustoDireto, string>> = {
  pessoal: 'Pessoal (folha do mês por lotação)',
  materiais: 'Materiais e medicamentos (saídas pelo preço médio)',
  despesas: 'Despesas do financeiro com centro de custo',
};

/** As fontes cuja competência precisa estar completa para o custeio ser confiável (regra 8). */
export const FONTES_COMPLETUDE = ['estoque', 'financeiro', 'faturamento', 'pessoal'] as const;
export type FonteCompletude = (typeof FONTES_COMPLETUDE)[number];

export const ROTULOS_FONTE_COMPLETUDE: Readonly<Record<FonteCompletude, string>> = {
  estoque: 'Estoque',
  financeiro: 'Financeiro',
  faturamento: 'Faturamento',
  pessoal: 'Pessoal',
};

export interface CompletudeFonte {
  readonly fonte: FonteCompletude;
  readonly presente: boolean;
  /** Contagem agregada que sustenta a marca (ex.: "95.520 saídas"). */
  readonly detalhe: string;
}

export interface SituacaoCompletude {
  readonly fontes: readonly CompletudeFonte[];
  readonly parcial: boolean;
  /** "parcial (sem pessoal)", "parcial (sem pessoal e faturamento)"; null quando completa. */
  readonly rotulo: string | null;
}

/**
 * Limite padrão do valor de UMA linha de saída de estoque (quantidade × preço médio): acima dele a linha é atípica e
 * fica fora do custo direto, contada e somada à parte (na cópia do pc, 100 linhas de março de 2026 passam de R$ 1
 * milhão cada e somam R$ 5,46 bilhões, contra R$ 3,1 milhões das demais 95.420).
 */
export const LIMITE_LINHA_SAIDA_PADRAO_CENTAVOS = 10_000_000;

// ── Apuração ──────────────────────────────────────────────────────────────────────────────────────────────────────────

export const SITUACOES_APURACAO = ['apurada', 'aprovada', 'substituida'] as const;
export type SituacaoApuracao = (typeof SITUACOES_APURACAO)[number];

export const ROTULOS_SITUACAO_APURACAO: Readonly<Record<SituacaoApuracao, string>> = {
  apurada: 'Apurada (aguarda aprovação)',
  aprovada: 'Aprovada',
  substituida: 'Substituída por apuração mais nova',
};

/** Um rateio recebido de um centro que veio antes na sequência. */
export interface ParcelaRateio {
  /** Id do centro de custo que repartiu. */
  readonly de: number;
  readonly centavos: number;
}

export interface LinhaApuracaoCentro {
  /** Id do centro de custo. */
  readonly centro: number;
  readonly codigo: number;
  readonly nome: string;
  readonly classe: ClasseCentroCusto;
  readonly ordemRateio: number | null;
  readonly criterio: CodigoEstatistica | null;
  /** Custo direto por grupo. */
  readonly direto: Readonly<Record<GrupoCustoDireto, number>>;
  /** A parte das despesas sem centro de custo que coube ao centro (proporcional ao custo direto). */
  readonly despesasGerais: number;
  /** direto (pessoal + materiais + despesas) + despesasGerais. */
  readonly diretoTotal: number;
  readonly recebidos: readonly ParcelaRateio[];
  readonly recebidoTotal: number;
  /** Auxiliar e administrativo: quanto repartiu aos centros seguintes. */
  readonly repassado: number;
  /** Auxiliar e administrativo sem base para repartir (nenhum centro seguinte com a estatística): fica parado. */
  readonly naoRateado: number;
  /** Produtivo: diretoTotal + recebidoTotal. Auxiliar e administrativo: o que não conseguiu repartir. */
  readonly custoFinal: number;
  /** A base do critério do centro na competência (centésimos), quando reparte. */
  readonly baseCriterioCent: number | null;
  /** A estatística de produção (paciente-dia, horas de sala, exames...) e a quantidade em centésimos. */
  readonly producao: { readonly codigo: CodigoEstatistica; readonly quantidadeCent: number } | null;
  /** custoFinal ÷ produção (centavos por unidade), arredondado; null sem produção. */
  readonly custoUnitario: number | null;
  /** O que as contas fecharam da competência faturaram no centro (base da razão custo/receita). */
  readonly receita: number;
}

export const TIPOS_PENDENCIA_APURACAO_CUSTOS = [
  'estrutura',
  'sem-base',
  'centro-fora-do-custeio',
  'linhas-atipicas',
  'despesas-sem-centro',
  'despesas-nao-distribuidas',
  'produtivo-sem-receita',
  'sem-producao',
  'parcial',
] as const;
export type TipoPendenciaApuracaoCustos = (typeof TIPOS_PENDENCIA_APURACAO_CUSTOS)[number];

export interface PendenciaApuracaoCustos {
  readonly tipo: TipoPendenciaApuracaoCustos;
  /** Bloqueia a apuração (só a estrutura bloqueia; as demais ficam impressas no resultado). */
  readonly bloqueia: boolean;
  readonly centros: readonly number[];
  readonly centavos: number;
  readonly mensagem: string;
}

/**
 * A prova de que nada se perdeu: custo direto lido = custo final dos produtivos + não rateado dos auxiliares +
 * despesas não distribuídas. `foraDoCusteio` e `atipicas` ficam fora do custo direto e aparecem só para conferência.
 */
export interface TotaisApuracao {
  readonly direto: Readonly<Record<GrupoCustoDireto, number>>;
  readonly despesasSemCentro: number;
  readonly diretoTotal: number;
  readonly custoFinalProdutivos: number;
  readonly naoRateado: number;
  readonly despesasNaoDistribuidas: number;
  readonly foraDoCusteio: number;
  readonly atipicas: { readonly linhas: number; readonly centavos: number };
  /**
   * Devoluções ao estoque da competência, já descontadas dos materiais (D-DEVOLUCAO-545); as das saídas atípicas ficam
   * fora, como a saída. Ausente nas apurações gravadas antes da correção (lê-se como zero).
   */
  readonly devolucoes?: {
    readonly linhas: number;
    readonly centavos: number;
    readonly linhasAtipicas: number;
    readonly centavosAtipicas: number;
  };
  /** Custo que chegou às contas (soma do custo das contas). */
  readonly custoNasContas: number;
  /** Custo dos produtivos sem receita no mês (não chega a nenhuma conta). */
  readonly custoSemConta: number;
  readonly receitaBruta: number;
  readonly receitaLiquida: number;
  readonly contas: number;
}

export interface ApuracaoCustos {
  readonly id: number;
  readonly competencia: string;
  readonly situacao: SituacaoApuracao;
  readonly versao: number;
  readonly completude: SituacaoCompletude;
  readonly limiteLinhaSaida: number;
  readonly totais: TotaisApuracao;
  readonly linhas: readonly LinhaApuracaoCentro[];
  readonly pendencias: readonly PendenciaApuracaoCustos[];
  /** SHA-256 do resultado canônico (reapurar com os mesmos dados dá a mesma impressão). */
  readonly impressao: string;
  readonly justificativa: string | null;
  readonly apuradaPor: string;
  readonly apuradaEm: string;
  readonly aprovadaPor: string | null;
  readonly aprovadaEm: string | null;
  readonly duracaoMs: number;
}

export interface ResumoApuracao {
  readonly id: number;
  readonly competencia: string;
  readonly situacao: SituacaoApuracao;
  readonly parcial: boolean;
  readonly rotuloParcial: string | null;
  readonly custoFinalProdutivos: number;
  readonly impressao: string;
  readonly apuradaPor: string;
  readonly apuradaEm: string;
  readonly aprovadaPor: string | null;
  readonly aprovadaEm: string | null;
}

export interface PainelApuracao {
  readonly competencia: string;
  /** A apuração vigente (aprovada ou apurada); null quando a competência ainda não foi apurada. */
  readonly apuracao: ApuracaoCustos | null;
  /** As apurações da competência, da mais nova para a mais velha (histórico). */
  readonly historico: readonly ResumoApuracao[];
  /** A estrutura bloqueia a apuração? (pendências da etapa 4). */
  readonly bloqueios: readonly PendenciaApuracaoCustos[];
}

const justificativa = textoCp1252(400).pipe(
  z.string().trim().min(10, 'Justifique com ao menos 10 caracteres.'),
);

export const esquemaConsultaApuracao = z.object({ competencia: esquemaCompetenciaCustos }).strict();
export type ConsultaApuracao = z.infer<typeof esquemaConsultaApuracao>;

export const esquemaApurarCustos = z
  .object({
    competencia: esquemaCompetenciaCustos,
    /** Limite do valor de uma linha de saída (centavos); acima dele a linha é atípica e fica fora. */
    limiteLinhaSaida: z
      .number()
      .int()
      .min(100)
      .max(100_000_000_000)
      .default(LIMITE_LINHA_SAIDA_PADRAO_CENTAVOS),
    /** Obrigatória para refazer a competência que já tem apuração aprovada. */
    justificativa: justificativa.nullable().default(null),
  })
  .strict();
export type ApurarCustos = z.infer<typeof esquemaApurarCustos>;

export const esquemaAprovarApuracao = z.object({ versao: z.number().int().min(0) }).strict();
export type AprovarApuracao = z.infer<typeof esquemaAprovarApuracao>;

// ── Custo por conta e resultado ───────────────────────────────────────────────────────────────────────────────────────

export interface CustoConta {
  /** Id da conta do paciente. */
  readonly conta: number;
  /** O número da conta. */
  readonly numero: number;
  readonly tipoConta: string | null;
  readonly convenio: number | null;
  readonly procedimento: string | null;
  readonly receitaBruta: number;
  readonly glosa: number;
  readonly recurso: number;
  /** bruta − glosa + recurso (a glosa e o recurso são ajustes de receita, regra 4). */
  readonly receitaLiquida: number;
  readonly custo: number;
  readonly margem: number;
  /** Margem sobre a receita líquida, em centésimos de ponto percentual; null sem receita líquida. */
  readonly margemPercentualCent: number | null;
  /** As parcelas do custo: centro produtivo, o que a conta faturou nele e o custo que ele passou. */
  readonly parcelas: readonly { readonly centro: number; readonly receita: number; readonly custo: number }[];
  /**
   * O prontuário do paciente da conta (pelo registro do atendimento da conta; D-PACIENTE-545), lido na consulta, só
   * dentro do Sante (com `custos.resultado.ler` e a trilha da leitura); nunca no relatório nem na exportação. Null sem
   * prontuário; ausente fora da consulta das contas.
   */
  readonly prontuario?: number | null;
}

export const AGRUPAMENTOS_RESULTADO = [
  'convenio',
  'procedimento',
  'centro',
  'tipoConta',
  'paciente',
] as const;
export type AgrupamentoResultado = (typeof AGRUPAMENTOS_RESULTADO)[number];

export const ROTULOS_AGRUPAMENTO_RESULTADO: Readonly<Record<AgrupamentoResultado, string>> = {
  convenio: 'Convênio',
  procedimento: 'Procedimento principal da conta',
  centro: 'Unidade (centro produtivo)',
  tipoConta: 'Tipo de conta (internação ou externa)',
  paciente: 'Paciente (pelo prontuário)',
};

export interface GrupoResultado {
  readonly chave: string;
  readonly rotulo: string;
  readonly contas: number;
  readonly receitaBruta: number;
  readonly glosa: number;
  readonly recurso: number;
  readonly receitaLiquida: number;
  readonly custo: number;
  readonly margem: number;
  readonly margemPercentualCent: number | null;
}

/** Indicador econômico com a ficha técnica (regra 15): consolidado = Σ numeradores ÷ Σ denominadores. */
export interface IndicadorEconomico {
  readonly codigo: string;
  readonly rotulo: string;
  readonly formula: string;
  readonly numerador: number;
  readonly denominador: number;
  /** numerador ÷ denominador (centavos por unidade), arredondado; null com denominador zero. */
  readonly valor: number | null;
  readonly parcelas: readonly {
    readonly centro: number;
    readonly numerador: number;
    readonly denominador: number;
  }[];
}

export interface ResultadoCustos {
  readonly competencia: string;
  readonly apuracao: ResumoApuracao | null;
  readonly agrupamento: AgrupamentoResultado;
  readonly grupos: readonly GrupoResultado[];
  /** A soma dos grupos (as parcelas são os grupos impressos). */
  readonly total: Omit<GrupoResultado, 'chave' | 'rotulo'>;
  readonly indicadores: readonly IndicadorEconomico[];
}

export const esquemaConsultaResultado = z
  .object({
    competencia: esquemaCompetenciaCustos,
    agrupamento: z.enum(AGRUPAMENTOS_RESULTADO).default('convenio'),
  })
  .strict();
export type ConsultaResultado = z.infer<typeof esquemaConsultaResultado>;

export const TAMANHO_PAGINA_CONTAS_CUSTO = 50;

export const esquemaConsultaContasCusto = z
  .object({
    competencia: esquemaCompetenciaCustos,
    convenio: z.coerce.number().int().min(0).max(999_999).optional(),
    procedimento: textoCp1252(20).pipe(z.string().trim().min(1)).optional(),
    /** O número da conta. */
    numero: z.coerce.number().int().min(1).max(999_999_999).optional(),
    /** O prontuário do paciente: as contas dele na competência (D-PACIENTE-545). */
    prontuario: z.coerce.number().int().min(1).max(999_999_999).optional(),
    /** Só as contas com margem negativa. */
    negativas: z
      .enum(['sim', 'nao'])
      .default('nao')
      .transform((v) => v === 'sim'),
    pagina: z.coerce.number().int().min(1).max(10_000).default(1),
  })
  .strict();
export type ConsultaContasCusto = z.infer<typeof esquemaConsultaContasCusto>;

export interface PaginaContasCusto {
  readonly competencia: string;
  readonly pagina: number;
  readonly tamanho: number;
  readonly total: number;
  readonly contas: readonly CustoConta[];
}

// ── Exportação (regra 10) ─────────────────────────────────────────────────────────────────────────────────────────────

/** Os destinos da exportação, pelos grupos de exportação do banco (1 Próprio, 2 ApuraSUS, 3 Federassantas). */
export const DESTINOS_EXPORTACAO_CUSTOS = ['proprio', 'apurasus', 'federassantas'] as const;
export type DestinoExportacaoCustos = (typeof DESTINOS_EXPORTACAO_CUSTOS)[number];

export const ID_GRUPO_EXPORTACAO: Readonly<Record<DestinoExportacaoCustos, number>> = {
  proprio: 1,
  apurasus: 2,
  federassantas: 3,
};

export const ROTULOS_DESTINO_EXPORTACAO: Readonly<Record<DestinoExportacaoCustos, string>> = {
  proprio: 'Próprio (planilha do hospital)',
  apurasus: 'ApuraSUS',
  federassantas: 'Federassantas',
};

export const esquemaExportarCustos = z
  .object({ competencia: esquemaCompetenciaCustos, destino: z.enum(DESTINOS_EXPORTACAO_CUSTOS) })
  .strict();
export type ExportarCustos = z.infer<typeof esquemaExportarCustos>;

export interface ArquivoExportacaoCustos {
  readonly destino: DestinoExportacaoCustos;
  readonly competencia: string;
  readonly nomeArquivo: string;
  /** Texto do arquivo (CSV com ponto e vírgula, decimal com vírgula, CRLF). */
  readonly conteudo: string;
  readonly linhas: number;
  /** SHA-256 do conteúdo. */
  readonly sha256: string;
  /** Centros sem o código exigido pelo destino (ficam no arquivo com o código em branco e aqui listados). */
  readonly semCodigo: readonly number[];
  /** O arquivo é só gerado: o envio ao destino só existe em produção (regra 10) e não é feito pela tela. */
  readonly envio: 'somente-producao';
  readonly avisos: readonly string[];
}

// ── Apoio da tela ─────────────────────────────────────────────────────────────────────────────────────────────────────

export interface ApoioApuracaoCustos {
  readonly grupos: readonly { readonly valor: GrupoCustoDireto; readonly rotulo: string }[];
  readonly situacoes: readonly { readonly valor: SituacaoApuracao; readonly rotulo: string }[];
  readonly agrupamentos: readonly { readonly valor: AgrupamentoResultado; readonly rotulo: string }[];
  readonly destinos: readonly {
    readonly valor: DestinoExportacaoCustos;
    readonly rotulo: string;
    readonly ativo: boolean;
  }[];
  readonly limiteLinhaSaidaPadrao: number;
  readonly acoes: {
    readonly apurar: boolean;
    readonly aprovar: boolean;
    readonly exportar: boolean;
    readonly resultado: boolean;
  };
  readonly liberacao: { readonly ligada: boolean };
}
