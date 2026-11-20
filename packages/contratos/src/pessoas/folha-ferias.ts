// Férias e 13º salário (M53-F3; ficha do M53, seções 1, 6 a 8, regras 7 e 8): os períodos aquisitivos do vínculo com o
// direito pela escala das faltas (CLT art. 130), o saldo, a programação da concessão (até três frações, o abono
// pecuniário e o adiantamento do 13º), o recibo de férias calculado (um processamento `ferias` com a memória por rubrica)
// e as duas parcelas do 13º (processamentos `decimo1` e `decimo2` da empresa). Valores em centavos; nenhuma resposta traz
// CPF ou nome: só vínculo (ID), matrícula, datas e valores.
import { z } from 'zod';
import { textoCp1252 } from '../texto-cp1252.js';
import type {
  CabecalhoProcessoFolha,
  ColaboradorCalculado,
  ConferenciaCalculoFolha,
  LinhaCalculoFolha,
  PendenciaCalculo,
  ResultadoCalculoFolha,
  ResumoProcessoFolha,
} from './folha-calculo.js';

const data = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Data no formato AAAA-MM-DD.');
const id = z.coerce.number().int().positive();
const smallint = z.coerce.number().int().min(0).max(32_767);

// ── Períodos aquisitivos e saldo ──────────────────────────────────────────────────────────────────────────────

/**
 * Situação do período aquisitivo:
 * - em-aquisicao: o período ainda não terminou (sem direito a gozo; CLT art. 130);
 * - aberto: completo, com saldo, dentro do período concessivo (os 12 meses seguintes; art. 134);
 * - vencido: o período concessivo passou com saldo (o gozo que restar sai em dobro; art. 137);
 * - quitado: sem saldo (gozado, vendido em abono ou perdido pelas faltas).
 */
export const SITUACOES_PERIODO_AQUISITIVO = ['em-aquisicao', 'aberto', 'vencido', 'quitado'] as const;
export type SituacaoPeriodoAquisitivo = (typeof SITUACOES_PERIODO_AQUISITIVO)[number];

/**
 * Avisos do período (não barram; a tela traduz por `folha.ferias.aviso.<codigo>`):
 * - afastamento-longo: mais de 180 dias de afastamento a cargo da Previdência no período (art. 133, IV): o DP confere
 *   se o direito se perdeu e cancela a programação, se for o caso;
 * - competencias-sem-calculo: há competência do período sem folha mensal calculada (as faltas e as médias contam só
 *   as competências calculadas).
 */
export const AVISOS_PERIODO_FERIAS = ['afastamento-longo', 'competencias-sem-calculo'] as const;
export type AvisoPeriodoFerias = (typeof AVISOS_PERIODO_FERIAS)[number];

export interface PeriodoAquisitivo {
  readonly inicio: string;
  readonly fim: string;
  /** Último dia do período concessivo (fim + 12 meses). */
  readonly concessivoFim: string;
  readonly situacao: SituacaoPeriodoAquisitivo;
  /** Faltas injustificadas do período, em dias (minutos de falta das folhas calculadas ÷ jornada diária). */
  readonly faltas: number;
  /** Dias de direito pela escala do art. 130 (30, 24, 18, 12 ou 0). */
  readonly direito: number;
  /** Dias de gozo e de abono já calculados (recibo) e só programados, fora os cancelados. */
  readonly gozados: number;
  readonly abono: number;
  readonly programados: number;
  readonly saldo: number;
  readonly avisos: readonly AvisoPeriodoFerias[];
  /** Competências do período sem folha mensal calculada do vínculo. */
  readonly competenciasSemCalculo: readonly string[];
}

export const SITUACOES_FERIAS = ['programada', 'calculada', 'cancelada'] as const;
export type SituacaoFerias = (typeof SITUACOES_FERIAS)[number];

/** Uma concessão de férias (SGH_PES_FERIAS): a programação e, depois do cálculo, o recibo (processamento `ferias`). */
export interface FeriasDoVinculo {
  readonly id: number;
  readonly vinculo: number;
  readonly empresa: number;
  readonly aquisitivoInicio: string;
  readonly aquisitivoFim: string;
  readonly inicio: string;
  readonly fim: string;
  readonly dias: number;
  readonly abono: number;
  /** Dias de gozo depois do fim do período concessivo (pagos em dobro; art. 137). */
  readonly dobra: number;
  readonly adiantarDecimo: boolean;
  /** Pagamento até dois dias antes do início do gozo (art. 145). */
  readonly pagamento: string;
  readonly situacao: SituacaoFerias;
  /** O processamento do recibo (situação `calculada`); null antes do cálculo. */
  readonly processo: number | null;
  readonly motivo: string | null;
  readonly registradoPor: string;
  readonly registradoEm: string;
  readonly situacaoPor: string | null;
  readonly situacaoEm: string | null;
  readonly versao: number;
}

export interface SaldoFerias {
  readonly hoje: string;
  readonly vinculo: number;
  readonly matricula: string | null;
  /** false: o vínculo não tem férias pela CLT (outro tipo de vínculo); `periodos` vem vazio. */
  readonly temDireito: boolean;
  readonly periodos: readonly PeriodoAquisitivo[];
  readonly ferias: readonly FeriasDoVinculo[];
}

export const esquemaFiltroSaldoFerias = z.object({ vinculo: id }).strict();

export const esquemaFiltroFerias = z
  .object({
    vinculo: id.optional(),
    /** A empresa da escala (o filtro vai ao banco antes do teto). */
    empresa: smallint.optional(),
    /** Gozo que toca o intervalo [de, ate] (a escala de férias). */
    de: data.optional(),
    ate: data.optional(),
    situacao: z.enum(SITUACOES_FERIAS).optional(),
  })
  .strict()
  .refine((x) => !(x.de && x.ate && x.de > x.ate), {
    message: 'O início do intervalo vem antes do fim.',
    path: ['ate'],
  });
export type FiltroFerias = z.infer<typeof esquemaFiltroFerias>;

export interface ListaFerias {
  readonly itens: readonly FeriasDoVinculo[];
  readonly limitado: boolean;
}

// ── Programação ───────────────────────────────────────────────────────────────────────────────────────────────

/** Programar uma fração de férias do período aquisitivo (`pessoas.ferias.programar`). */
export const esquemaProgramarFerias = z
  .object({
    vinculo: id,
    empresa: z.number().int().min(0).max(32_767),
    /** O início do período aquisitivo a que a fração pertence. */
    aquisitivoInicio: data,
    inicio: data,
    /** Dias de gozo (cada fração tem no mínimo 5; art. 134 §1). */
    dias: z.number().int().min(1).max(30),
    /** Dias convertidos em abono pecuniário (até 1/3 do direito; art. 143). */
    abono: z.number().int().min(0).max(10),
    /** Pagar a 1ª parcela do 13º junto com as férias (Lei 4.749/1965, art. 2º §2). */
    adiantarDecimo: z.boolean(),
  })
  .strict();
export type ProgramarFeriasEntrada = z.infer<typeof esquemaProgramarFerias>;

/**
 * Recusas da programação (a tela traduz por `folha.ferias.recusa.<codigo>`):
 * - vinculo-sem-ferias: o vínculo não é CLT; periodo-inexistente: o período aquisitivo não é do vínculo;
 * - aquisitivo-incompleto: o gozo começa antes do fim do período aquisitivo;
 * - inicio-no-passado: o gozo começa antes de hoje;
 * - depois-do-desligamento: o gozo passa da data de desligamento;
 * - fracao-minima: fração com menos de 5 dias; fracao-quatorze: nenhuma fração chega a 14 dias e o saldo restante não
 *   comporta uma (art. 134 §1); tres-fracoes: o período já tem três frações;
 * - saldo-insuficiente: gozo + abono passam do saldo; abono-acima: abono acima de 1/3 do direito; abono-repetido: o
 *   período já tem abono;
 * - vespera-de-descanso: o gozo começa nos dois dias antes do repouso semanal (sexta ou sábado; art. 134 §3);
 * - sobreposicao: o gozo cruza outra fração do vínculo; adiantamento-repetido: o 13º do ano já foi adiantado.
 */
export const RECUSAS_PROGRAMACAO_FERIAS = [
  'vinculo-sem-ferias',
  'periodo-inexistente',
  'aquisitivo-incompleto',
  'inicio-no-passado',
  'depois-do-desligamento',
  'fracao-minima',
  'fracao-quatorze',
  'tres-fracoes',
  'saldo-insuficiente',
  'abono-acima',
  'abono-repetido',
  'vespera-de-descanso',
  'sobreposicao',
  'adiantamento-repetido',
] as const;
export type RecusaProgramacaoFerias = (typeof RECUSAS_PROGRAMACAO_FERIAS)[number];

/**
 * Avisos da programação (não barram):
 * - aviso-curto: menos de 30 dias entre hoje e o início (o aviso de férias é de 30 dias; art. 135);
 * - concessivo-vencido: parte do gozo cai depois do período concessivo e sai em dobro (art. 137).
 */
export const AVISOS_PROGRAMACAO_FERIAS = ['aviso-curto', 'concessivo-vencido'] as const;
export type AvisoProgramacaoFerias = (typeof AVISOS_PROGRAMACAO_FERIAS)[number];

export interface ResultadoProgramacaoFerias {
  readonly ok: true;
  readonly id: number;
  readonly mensagem: string;
  readonly avisos: readonly AvisoProgramacaoFerias[];
  readonly ferias: FeriasDoVinculo | null;
}

/** Cancelar a programação ou o recibo calculado (o recibo vai a `descartada` junto), com motivo. */
export const esquemaCancelarFerias = z
  .object({ versao: z.number().int().min(0), motivo: textoCp1252(200).trim().min(3) })
  .strict();
export type CancelarFeriasEntrada = z.infer<typeof esquemaCancelarFerias>;

// ── Recibo de férias ──────────────────────────────────────────────────────────────────────────────────────────

/** Calcular o recibo da programação (`pessoas.ferias.calcular`); `simular` devolve a prévia sem gravar. */
export const esquemaCalcularFerias = z
  .object({ versao: z.number().int().min(0), simular: z.boolean().default(false) })
  .strict();
export type CalcularFeriasEntrada = z.infer<typeof esquemaCalcularFerias>;

/**
 * Avisos do cálculo do recibo (não barram):
 * - folha-mensal-calculada: a folha mensal de uma competência do gozo já está calculada sem estas férias (recalcule-a
 *   depois de gravar o recibo, para os dias de férias saírem do salário do mês);
 * - competencias-sem-calculo: há competência do período aquisitivo sem folha calculada (as médias contam só as
 *   calculadas).
 */
export const AVISOS_CALCULO_FERIAS = ['folha-mensal-calculada', 'competencias-sem-calculo'] as const;
export type AvisoCalculoFerias = (typeof AVISOS_CALCULO_FERIAS)[number];

export interface ResultadoCalculoFerias {
  readonly calculado: boolean;
  readonly simulado: boolean;
  readonly ferias: FeriasDoVinculo;
  readonly processo: ResumoProcessoFolha | null;
  readonly pendencias: readonly PendenciaCalculo[];
  readonly avisos: readonly {
    readonly codigo: AvisoCalculoFerias;
    readonly competencias: readonly string[];
  }[];
  readonly resumo: ColaboradorCalculado | null;
  readonly linhas: readonly LinhaCalculoFolha[];
  readonly conferencia: ConferenciaCalculoFolha | null;
}

export interface DetalheFerias {
  readonly ferias: FeriasDoVinculo;
  /** Sem `pessoas.salario.ler`, o cabeçalho vem sem os totais e sem o resumo (D-PERM-SAL-533). */
  readonly processo: CabecalhoProcessoFolha | null;
  /** Vazia sem `pessoas.salario.ler` (D-PERM-SAL-533): os valores do recibo revelam o salário. */
  readonly linhas: readonly LinhaCalculoFolha[];
  readonly linhasOcultas: boolean;
}

// ── 13º salário ───────────────────────────────────────────────────────────────────────────────────────────────

export const PARCELAS_DECIMO = [1, 2] as const;
export type ParcelaDecimo = (typeof PARCELAS_DECIMO)[number];

/** Calcular uma parcela do 13º da empresa (`pessoas.decimo.calcular`); `simular` devolve a prévia sem gravar. */
export const esquemaCalcularDecimo = z
  .object({
    empresa: z.number().int().min(0).max(32_767),
    ano: z.number().int().min(2000).max(2100),
    parcela: z.union([z.literal(1), z.literal(2)]),
    pagamento: data,
    simular: z.boolean().default(false),
  })
  .strict()
  .refine((x) => x.pagamento.startsWith(`${x.ano}-`), {
    message: 'A data de pagamento é do ano do 13º.',
    path: ['pagamento'],
  });
export type CalcularDecimoEntrada = z.infer<typeof esquemaCalcularDecimo>;

/**
 * Avisos do 13º (não barram):
 * - pagamento-fora-do-prazo: a 1ª parcela fora de fevereiro a 30 de novembro, ou a 2ª depois de 20 de dezembro
 *   (Lei 4.749/1965, arts. 1º e 2º);
 * - competencias-sem-calculo: competência do ano (até novembro) sem folha mensal calculada de algum vínculo (as médias
 *   contam só as calculadas).
 */
export const AVISOS_DECIMO = ['pagamento-fora-do-prazo', 'competencias-sem-calculo'] as const;
export type AvisoDecimo = (typeof AVISOS_DECIMO)[number];

export interface ResultadoCalculoDecimo extends ResultadoCalculoFolha {
  readonly avisos: readonly { readonly codigo: AvisoDecimo; readonly competencias: readonly string[] }[];
}

export const esquemaFiltroDecimo = z
  .object({ empresa: smallint.optional(), ano: z.coerce.number().int().min(2000).max(2100).optional() })
  .strict();
export type FiltroDecimo = z.infer<typeof esquemaFiltroDecimo>;

/** O apoio da tela de férias e 13º: o que a sessão pode fazer. */
export interface ApoioFeriasDecimo {
  readonly hoje: string;
  readonly gravacao: { readonly ligada: boolean; readonly motivo: string | null };
  readonly acoes: {
    readonly programar: boolean;
    readonly calcularFerias: boolean;
    readonly calcularDecimo: boolean;
    readonly verSalario: boolean;
    readonly motivo: string | null;
  };
  readonly empresas: readonly { readonly codigo: number; readonly rotulo: string }[];
}

// ── Autosserviço ──────────────────────────────────────────────────────────────────────────────────────────────

export const esquemaFiltroMinhasFerias = z.object({ vinculo: id.optional() }).strict();

/** As férias do próprio colaborador (`pessoas.autoatendimento.ler`, só o próprio; leitura auditada). */
export interface MinhasFerias {
  readonly hoje: string;
  readonly disponivel: boolean;
  readonly mensagem: string | null;
  readonly saldo: SaldoFerias | null;
}
