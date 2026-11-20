// Periódicos do eSocial e fechamento da folha (M53-F6; ficha do M53, seções 1, 6 a 8; regras 1, 7, 9 e 10; cap-07
// §7.1 e §7.1.5). O departamento pessoal FECHA o período de apuração da folha da empresa (`pessoas.folha.fechar`): o
// mensal (AAAA-MM: a folha mensal, os recibos de férias e as rescisões calculados na competência, com a data de
// pagamento da folha mensal) e o anual (AAAA: o 13º salário). Fechado, nenhum processamento do período se recalcula,
// descarta ou inclui até a reabertura, com motivo. Do período fechado saem os periódicos do eSocial: o S-1200
// (remuneração do trabalhador, um por colaborador e período), o S-1210 (pagamentos, um por colaborador e mês do
// pagamento), o S-1299 (fechamento dos periódicos do empregador, depois de todos aceitos) e o S-1298 (reabertura).
// Nenhuma resposta traz CPF ou nome: vínculo (ID), matrícula, quantidades e valores agregados.
import { z } from 'zod';
import { textoCp1252 } from '../texto-cp1252.js';
import type { PendenciaEsocial } from './folha-esocial.js';
import type { TipoProcessoFolha } from './folha-calculo.js';

const data = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Data no formato AAAA-MM-DD.');
const id = z.coerce.number().int().positive();
const smallint = z.coerce.number().int().min(0).max(32_767);
const motivo = textoCp1252(200).pipe(z.string().trim().min(5, 'Informe o motivo (ao menos 5 letras).'));

// ── Período de apuração ───────────────────────────────────────────────────────────────────────────────────────

/** A apuração do período (o `indApuracao` do eSocial: 1 mensal, 2 anual, o 13º salário). */
export const APURACOES_FOLHA = ['mensal', 'anual'] as const;
export type ApuracaoFolha = (typeof APURACOES_FOLHA)[number];
export const INDICADOR_APURACAO: Readonly<Record<ApuracaoFolha, 1 | 2>> = { mensal: 1, anual: 2 };

/** AAAA-MM na apuração mensal; AAAA na anual. */
export const PERIODO_MENSAL = /^\d{4}-(0[1-9]|1[0-2])$/;
export const PERIODO_ANUAL = /^\d{4}$/;
export const periodoValido = (apuracao: ApuracaoFolha, periodo: string): boolean =>
  (apuracao === 'mensal' ? PERIODO_MENSAL : PERIODO_ANUAL).test(periodo);

const comPeriodo = <T extends { apuracao: ApuracaoFolha; periodo: string }>(x: T, ctx: z.RefinementCtx) => {
  if (!periodoValido(x.apuracao, x.periodo))
    ctx.addIssue({
      code: 'custom',
      path: ['periodo'],
      message:
        x.apuracao === 'mensal' ? 'Período mensal no formato AAAA-MM.' : 'Período anual no formato AAAA.',
    });
};

const campoPeriodo = {
  empresa: smallint,
  apuracao: z.enum(APURACOES_FOLHA),
  periodo: z.string().min(4).max(7),
};

export const esquemaPeriodoFolha = z.object(campoPeriodo).strict().superRefine(comPeriodo);
export type PeriodoFolha = z.infer<typeof esquemaPeriodoFolha>;

/**
 * O período de apuração de cada tipo de processamento: as parcelas do 13º são do período anual (o ano da
 * competência); a folha mensal, as férias e a rescisão, do mensal da competência.
 */
export const APURACAO_DO_TIPO: Readonly<Record<TipoProcessoFolha, ApuracaoFolha>> = {
  mensal: 'mensal',
  ferias: 'mensal',
  rescisao: 'mensal',
  decimo1: 'anual',
  decimo2: 'anual',
};

// ── Fechamento da folha ───────────────────────────────────────────────────────────────────────────────────────

export const SITUACOES_FECHAMENTO_FOLHA = ['fechada', 'reaberta'] as const;
export type SituacaoFechamentoFolha = (typeof SITUACOES_FECHAMENTO_FOLHA)[number];

/** Um processamento que o fechamento fixou (o resumo é a soma de verificação das linhas dele). */
export interface ProcessoNoFechamento {
  readonly id: number;
  readonly tipo: TipoProcessoFolha;
  readonly competencia: string;
  readonly numero: number;
  readonly resumo: string;
  /** Data do pagamento (a da folha mensal é a do fechamento). */
  readonly pagamento: string | null;
  readonly colaboradores: number;
  /** O líquido do processamento; null no recibo de férias e na rescisão sem `pessoas.salario.ler` (um colaborador só). */
  readonly liquido: number | null;
}

export interface TotaisFechamentoFolha {
  readonly processos: number;
  readonly proventos: number;
  readonly descontos: number;
  readonly liquido: number;
  readonly inss: number;
  readonly irrf: number;
  readonly fgts: number;
  /** Encargos da empresa: INSS patronal + RAT + terceiros. */
  readonly encargos: number;
}

export interface FechamentoFolha {
  readonly id: number;
  readonly empresa: number;
  readonly apuracao: ApuracaoFolha;
  readonly periodo: string;
  readonly numero: number;
  readonly situacao: SituacaoFechamentoFolha;
  /** Data de pagamento da folha mensal (null no anual). */
  readonly pagamento: string | null;
  readonly processos: readonly ProcessoNoFechamento[];
  readonly totais: TotaisFechamentoFolha;
  /** SHA-256 da lista dos processamentos fixados (ID e resumo de cada um). */
  readonly resumo: string;
  readonly fechadoPor: string;
  readonly fechadoEm: string;
  readonly reabertoPor: string | null;
  readonly reabertoEm: string | null;
  readonly motivo: string | null;
  readonly versao: number;
}

/**
 * Pendências que barram o fechamento (a tela traduz por `folha.fechamento.pendencia.<codigo>`):
 * - periodo-em-curso: o período ainda não terminou;
 * - sem-folha-mensal: o mensal sem a folha mensal calculada;
 * - sem-decimo-final: o anual sem a 2ª parcela do 13º calculada;
 * - ja-fechado: o período já está fechado (reabra antes);
 * - pagamento-obrigatorio: o mensal sem a data de pagamento da folha mensal;
 * - pagamento-fora-do-periodo: a data de pagamento antes do início da competência ou depois do fim do mês seguinte;
 * - sem-pagamento: um recibo de férias, 13º ou rescisão sem data de pagamento.
 */
export const CODIGOS_PENDENCIA_FECHAMENTO = [
  'periodo-em-curso',
  'sem-folha-mensal',
  'sem-decimo-final',
  'ja-fechado',
  'pagamento-obrigatorio',
  'pagamento-fora-do-periodo',
  'sem-pagamento',
] as const;
export type CodigoPendenciaFechamento = (typeof CODIGOS_PENDENCIA_FECHAMENTO)[number];

export interface PendenciaFechamentoFolha {
  readonly codigo: CodigoPendenciaFechamento;
  readonly mensagem: string;
  readonly processo: number | null;
}

/** Prova da soma do fechamento (parcelas impressas: o líquido de cada processamento e o total). */
export interface ConferenciaFechamentoFolha {
  readonly ok: boolean;
  readonly parcelas: readonly { readonly rotulo: string; readonly valor: number }[];
  readonly divergencias: readonly string[];
}

/** Fechar o período (`pessoas.folha.fechar`); `simular` devolve a prévia sem gravar. */
export const esquemaFecharFolha = z
  .object({
    ...campoPeriodo,
    /** Data de pagamento da folha mensal (obrigatória no mensal; ignorada no anual). */
    pagamento: data.nullable().default(null),
    simular: z.boolean().default(false),
  })
  .strict()
  .superRefine(comPeriodo);
export type FecharFolhaEntrada = z.infer<typeof esquemaFecharFolha>;

export interface ResultadoFechamentoFolha {
  readonly fechado: boolean;
  readonly simulado: boolean;
  readonly fechamento: FechamentoFolha | null;
  /** Os processamentos que o fechamento fixa (a prévia mostra os mesmos). */
  readonly processos: readonly ProcessoNoFechamento[];
  readonly totais: TotaisFechamentoFolha;
  readonly pendencias: readonly PendenciaFechamentoFolha[];
  readonly conferencia: ConferenciaFechamentoFolha;
}

/** Reabrir o período fechado (`pessoas.folha.fechar`), com motivo. */
export const esquemaReabrirFolha = z.object({ versao: z.number().int().min(0), motivo }).strict();
export type ReabrirFolhaEntrada = z.infer<typeof esquemaReabrirFolha>;

export const esquemaFiltroFechamentosFolha = z
  .object({
    empresa: smallint.optional(),
    apuracao: z.enum(APURACOES_FOLHA).optional(),
    /** O ano (os períodos mensais e o anual dele). */
    ano: z.string().regex(PERIODO_ANUAL, 'Ano com 4 dígitos.').optional(),
  })
  .strict();
export type FiltroFechamentosFolha = z.infer<typeof esquemaFiltroFechamentosFolha>;

export interface ListaFechamentosFolha {
  readonly itens: readonly FechamentoFolha[];
  readonly limitado: boolean;
}

// ── Periódicos do eSocial ─────────────────────────────────────────────────────────────────────────────────────

/** S-1200 do período fechado; `vinculos` vazio = todos os colaboradores dos processamentos fixados. */
export const esquemaGerarRemuneracaoEsocial = z
  .object({
    ...campoPeriodo,
    vinculos: z.array(id).max(2_000).default([]),
    gravar: z.boolean(),
  })
  .strict()
  .superRefine(comPeriodo);
export type GerarRemuneracaoEsocialEntrada = z.infer<typeof esquemaGerarRemuneracaoEsocial>;

/** S-1210 dos pagamentos feitos no mês (AAAA-MM: o mês da data de pagamento, que é o período do S-1210). */
export const esquemaGerarPagamentosEsocial = z
  .object({
    empresa: smallint,
    periodo: z.string().regex(PERIODO_MENSAL, 'Período mensal no formato AAAA-MM.'),
    vinculos: z.array(id).max(2_000).default([]),
    gravar: z.boolean(),
  })
  .strict();
export type GerarPagamentosEsocialEntrada = z.infer<typeof esquemaGerarPagamentosEsocial>;

/** S-1299 (fechamento) ou S-1298 (reabertura) dos periódicos do empregador no período. */
export const esquemaGerarFechamentoEsocial = z
  .object({ ...campoPeriodo, gravar: z.boolean() })
  .strict()
  .superRefine(comPeriodo);
export type GerarFechamentoEsocialEntrada = z.infer<typeof esquemaGerarFechamentoEsocial>;

export const esquemaFiltroPeriodicosEsocial = esquemaPeriodoFolha;
export type FiltroPeriodicosEsocial = PeriodoFolha;

/** A situação de um tipo de periódico no período (contagens por situação, nunca o trabalhador). */
export interface ContagemPeriodicoEsocial {
  /** Colaboradores que devem ter o evento no período (dos processamentos fixados ou dos pagamentos do mês). */
  readonly esperados: number;
  /** Eventos em vigor por situação (gerado, validado, em-lote, enviado, aceito, rejeitado, inválido). */
  readonly porSituacao: Readonly<Record<string, number>>;
  /** Vínculos esperados sem evento em vigor (até 50, para a tela gerar). */
  readonly semEvento: readonly number[];
  readonly aceitos: number;
}

/** A situação dos periódicos do empregador no período: o S-1299 só sai com tudo aceito. */
export const SITUACOES_PERIODO_ESOCIAL = ['aberto', 'fechando', 'fechado', 'reabrindo'] as const;
export type SituacaoPeriodoEsocial = (typeof SITUACOES_PERIODO_ESOCIAL)[number];

/**
 * O fechamento da folha como o painel dos periódicos do eSocial o mostra (correção da revisão do M53.7): quem abre o
 * painel tem `pessoas.esocial.ler`, que não dá a folha. Vão só o número, a situação, a data de pagamento e quem fechou
 * e quando; os totais e a lista dos processamentos (com o líquido de cada um) só com `pessoas.folha.ler`, e aí com a
 * máscara de `pessoas.salario.ler` no líquido de férias e de rescisão, como na tela da folha. Sem a permissão: null.
 */
export interface ResumoFechamentoNoPainel {
  readonly id: number;
  readonly numero: number;
  readonly situacao: SituacaoFechamentoFolha;
  /** Data de pagamento da folha mensal (null no anual). */
  readonly pagamento: string | null;
  readonly fechadoPor: string;
  readonly fechadoEm: string;
  /** Só com `pessoas.folha.ler`. */
  readonly totais: TotaisFechamentoFolha | null;
  /** Só com `pessoas.folha.ler`. */
  readonly processos: readonly ProcessoNoFechamento[] | null;
}

export interface PainelPeriodicosEsocial {
  readonly empresa: number;
  readonly apuracao: ApuracaoFolha;
  readonly periodo: string;
  /** O fechamento da folha em vigor no período (null: período aberto na folha); valores só com `pessoas.folha.ler`. */
  readonly folha: ResumoFechamentoNoPainel | null;
  readonly remuneracao: ContagemPeriodicoEsocial;
  /** Só no mensal (o S-1210 é do mês do pagamento). */
  readonly pagamentos: ContagemPeriodicoEsocial | null;
  /** Recibos de pagamento a autônomo do repasse no período (entram nos periódicos do mesmo transmissor). */
  readonly repasse: number;
  readonly situacao: SituacaoPeriodoEsocial;
  /** O S-1299 em vigor (ou o S-1298, na reabertura). */
  readonly eventoFechamento: number | null;
  readonly pendencias: readonly PendenciaEsocial[];
  readonly acoes: {
    readonly gerar: boolean;
    readonly fecharEsocial: boolean;
    readonly reabrirEsocial: boolean;
    readonly fecharFolha: boolean;
    readonly reabrirFolha: boolean;
  };
}

// ── Recusas ───────────────────────────────────────────────────────────────────────────────────────────────────

export const RECUSAS_FECHAMENTO_FOLHA = [
  'competencia-fechada',
  'fechamento-com-pendencias',
  'periodo-ja-fechado',
  'periodo-nao-fechado',
  'esocial-fechado',
  'folha-nao-fechada',
  'periodicos-pendentes',
] as const;
export type RecusaFechamentoFolha = (typeof RECUSAS_FECHAMENTO_FOLHA)[number];
