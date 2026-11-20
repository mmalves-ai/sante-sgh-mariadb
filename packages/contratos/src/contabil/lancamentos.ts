// Contabilidade, etapa 2 (M54-F2; ficha, seções 2, 6, 7 e regras 3 e 5): os lançamentos gravados (automáticos, a
// partir dos fatos; manuais; estornos), a conciliação de contas e o encerramento do período com bloqueio. Tudo só em
// SGH_CTB_LANCAMENTO, SGH_CTB_PARTIDA, SGH_CTB_PERIODO e SGH_CTB_CONCILIACAO (scripts 0543 e 0544); nenhuma tabela do
// banco anterior é escrita (regra 1). Valores sempre em CENTAVOS inteiros. Os textos vistos pelo usuário nunca trazem
// nome de tabela.
//   - Lançamento é imutável: nunca se altera nem se apaga; a correção é o estorno (outro lançamento, que inverte as
//     partidas e aponta para o original) e um lançamento novo (D-ESTORNO-54, regra 3).
//   - Período encerrado não aceita lançamento (o banco recusa na mesma transação, com a linha do período travada); o fato
//     de competência encerrada vai ao primeiro período aberto (`dataContabil`), com a data original no histórico.
import { z } from 'zod';
import { textoCp1252 } from '../texto-cp1252.js';
import { CODIGO_CONTA } from './entradas.js';
import type { LadoPartida, OrigemLancamento, SituacaoFato, TipoFato } from './vocabulario.js';

const DATA = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Data no formato AAAA-MM-DD.');
const COMPETENCIA = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'Competência no formato AAAA-MM.');
const JUSTIFICATIVA = textoCp1252(500).refine(
  (s) => s.trim().length >= 10,
  'Justificativa com ao menos 10 caracteres.',
);

// ── Vocabulário ───────────────────────────────────────────────────────────────────────────────────

/** Tipo do lançamento gravado. */
export const TIPOS_LANCAMENTO = {
  automatico: 'Automático (dos módulos)',
  manual: 'Manual',
  estorno: 'Estorno',
  /** Etapa 3 (F3): o encerramento das contas de resultado do exercício contra o patrimônio líquido (0976). */
  apuracao: 'Apuração do resultado',
} as const;
export type TipoLancamento = keyof typeof TIPOS_LANCAMENTO;
export const CODIGOS_TIPO_LANCAMENTO = Object.keys(TIPOS_LANCAMENTO) as TipoLancamento[];

/** Situação do período contábil (SGH_CTB_PERIODO). Sem linha, o período é aberto. */
export const SITUACOES_PERIODO = { aberto: 'Aberto', encerrado: 'Encerrado' } as const;
export type SituacaoPeriodo = keyof typeof SITUACOES_PERIODO;

/** Situação da conciliação: a desfeita fica registrada (quem e quando), e as partidas voltam a ficar pendentes. */
export const SITUACOES_CONCILIACAO = { ativa: 'Conciliada', desfeita: 'Desfeita' } as const;
export type SituacaoConciliacao = keyof typeof SITUACOES_CONCILIACAO;

/** Tetos das leituras (ficha, seção 4: paginado, p95 < 2 s). */
export const TETO_LANCAMENTOS_PAGINA = 200;
/** Movimentos por página do razão (a ficha pede o razão paginado; os totais do período vêm à parte). */
export const TETO_RAZAO_MOVIMENTOS = 2_000;
export const TETO_PARTIDAS_CONCILIACAO = 500;
/** Fatos contabilizados por chamada (a tela repete enquanto houver pendentes; o worker, a cada ciclo). */
export const LOTE_CONTABILIZACAO = 500;
/** Partidas de um lançamento manual. */
export const MAX_PARTIDAS_MANUAL = 40;

// ── Rotas ─────────────────────────────────────────────────────────────────────────────────────────

export const ROTAS_CONTABIL_F2 = {
  apoio: { caminho: 'contabil/lancamentos/apoio', permissao: 'contabil.lancamento.ler' },
  lancamentos: { caminho: 'contabil/lancamentos', permissao: 'contabil.lancamento.ler' },
  detalhe: { caminho: 'contabil/lancamentos/detalhe', permissao: 'contabil.lancamento.ler' },
  razao: { caminho: 'contabil/razao', permissao: 'contabil.lancamento.ler' },
  incluir: { caminho: 'contabil/lancamentos/manual', permissao: 'contabil.lancamento.criar' },
  contabilizar: { caminho: 'contabil/lancamentos/contabilizar', permissao: 'contabil.lancamento.criar' },
  estornar: { caminho: 'contabil/lancamentos/estornar', permissao: 'contabil.lancamento.estornar' },
  pendentesConciliacao: {
    caminho: 'contabil/conciliacao/pendentes',
    permissao: 'contabil.lancamento.ler',
  },
  conciliacoes: { caminho: 'contabil/conciliacao', permissao: 'contabil.lancamento.ler' },
  conciliar: { caminho: 'contabil/conciliacao/registrar', permissao: 'contabil.conciliacao.registrar' },
  desfazerConciliacao: {
    caminho: 'contabil/conciliacao/desfazer',
    permissao: 'contabil.conciliacao.registrar',
  },
  periodos: { caminho: 'contabil/periodos', permissao: 'contabil.lancamento.ler' },
  situacaoPeriodo: { caminho: 'contabil/periodos/situacao', permissao: 'contabil.lancamento.ler' },
  encerrar: { caminho: 'contabil/periodos/encerrar', permissao: 'contabil.periodo.encerrar' },
  reabrir: { caminho: 'contabil/periodos/reabrir', permissao: 'contabil.periodo.reabrir' },
} as const;

// ── Entradas ──────────────────────────────────────────────────────────────────────────────────────

export const esquemaPartidaManual = z.object({
  lado: z.enum(['D', 'C']),
  conta: CODIGO_CONTA,
  valorCentavos: z.number().int().positive().max(99_999_999_999),
  centroCusto: z.number().int().positive().nullable().default(null),
  historico: textoCp1252(120).nullable().default(null),
});
export type PartidaManual = z.output<typeof esquemaPartidaManual>;

/** Lançamento manual: o período da data tem de estar aberto (regra 3); débitos = créditos (regra 5). */
export const esquemaLancamentoManual = z.object({
  empresa: z.number().int().positive(),
  data: DATA,
  historico: textoCp1252(200).refine((s) => s.trim().length >= 3, 'Histórico com ao menos 3 caracteres.'),
  partidas: z.array(esquemaPartidaManual).min(2).max(MAX_PARTIDAS_MANUAL),
  /** Chave gerada pela tela (UUID): o envio repetido não duplica o lançamento. */
  idempotencia: z.string().uuid(),
});
export type LancamentoManual = z.output<typeof esquemaLancamentoManual>;

/** Estorno: outro lançamento, que inverte as partidas do original e aponta para ele; um estorno por lançamento. */
export const esquemaEstornarLancamento = z.object({
  empresa: z.number().int().positive(),
  id: z.number().int().positive(),
  /** Data do estorno (período aberto). Sem data, hoje; se o período do original estiver aberto, pode ser a dele. */
  data: DATA.optional(),
  justificativa: JUSTIFICATIVA,
});

/** Contabilizar os fatos pendentes (e os sem regra ou sem conta, depois de corrigida a regra ou o de-para). */
export const esquemaContabilizar = z.object({
  empresa: z.number().int().positive(),
  competencia: COMPETENCIA.optional(),
  /** Também os fatos sem regra e sem conta (depois de publicar a regra ou completar o de-para). */
  incluirRecusados: z.boolean().default(false),
});

export const esquemaFiltroLancamentos = z.object({
  empresa: z.number().int().positive(),
  competencia: COMPETENCIA.optional(),
  tipo: z.enum(CODIGOS_TIPO_LANCAMENTO as [TipoLancamento, ...TipoLancamento[]]).optional(),
  conta: CODIGO_CONTA.optional(),
  pagina: z.number().int().min(1).default(1),
  tamanho: z.number().int().min(1).max(TETO_LANCAMENTOS_PAGINA).default(50),
});
export type FiltroLancamentos = z.output<typeof esquemaFiltroLancamentos>;

/** Razão de uma conta analítica num intervalo de datas (no máximo 12 meses). */
export const esquemaFiltroRazao = z
  .object({
    empresa: z.number().int().positive(),
    conta: CODIGO_CONTA,
    de: DATA,
    ate: DATA,
    centroCusto: z.number().int().positive().optional(),
    /** A página dos movimentos (TETO_RAZAO_MOVIMENTOS por página; correção da revisão do M54.2: paginado). */
    pagina: z.number().int().min(1).max(10_000).default(1),
  })
  .refine((f) => f.de <= f.ate, 'O início é depois do fim.')
  .refine((f) => {
    const [a1, m1] = f.de.split('-').map(Number) as [number, number];
    const [a2, m2] = f.ate.split('-').map(Number) as [number, number];
    return (a2 - a1) * 12 + (m2 - m1) < 12;
  }, 'O razão abrange no máximo 12 meses.');
export type FiltroRazao = z.output<typeof esquemaFiltroRazao>;

export const esquemaFiltroConciliacao = z.object({
  empresa: z.number().int().positive(),
  conta: CODIGO_CONTA,
  ate: DATA.optional(),
});

/** Conciliar: partidas da mesma conta, ainda não conciliadas, com débitos = créditos. */
export const esquemaConciliarContabil = z.object({
  empresa: z.number().int().positive(),
  conta: CODIGO_CONTA,
  partidas: z.array(z.number().int().positive()).min(2).max(TETO_PARTIDAS_CONCILIACAO),
  observacao: textoCp1252(300).nullable().default(null),
});

export const esquemaDesfazerConciliacao = z.object({
  empresa: z.number().int().positive(),
  id: z.number().int().positive(),
  justificativa: JUSTIFICATIVA,
});

export const esquemaPeriodoContabil = z.object({
  empresa: z.number().int().positive(),
  competencia: COMPETENCIA,
});

/** Encerrar: a permissão é crítica (senha de novo). Os impedimentos são conferidos na mesma transação. */
export const esquemaEncerrarPeriodoContabil = esquemaPeriodoContabil.extend({
  observacao: textoCp1252(300).nullable().default(null),
});

/** Reabrir (o "desfazer encerramento"): só o último encerrado, com justificativa; crítica. */
export const esquemaReabrirPeriodoContabil = esquemaPeriodoContabil.extend({ justificativa: JUSTIFICATIVA });

// ── Respostas ─────────────────────────────────────────────────────────────────────────────────────

export interface PartidaGravada {
  readonly id: number;
  readonly ordem: number;
  readonly lado: LadoPartida;
  readonly conta: string;
  readonly contaNome: string | null;
  readonly valorCentavos: number;
  readonly centroCusto: number | null;
  readonly historico: string;
  /** Conciliação ativa que inclui a partida (nula: pendente). */
  readonly conciliacao: number | null;
}

export interface LancamentoListado {
  readonly id: number;
  readonly empresa: number;
  readonly tipo: TipoLancamento;
  readonly tipoRotulo: string;
  readonly data: string;
  readonly competencia: string;
  readonly historico: string;
  readonly debitosCentavos: number;
  readonly creditosCentavos: number;
  /** Origem do fato (lançamento automático) e o rótulo do tipo de fato. */
  readonly origem: OrigemLancamento | null;
  readonly tipoFatoRotulo: string | null;
  /** O lançamento estornado por este (tipo estorno) e o estorno deste (quando já estornado). */
  readonly estornaId: number | null;
  readonly estornadoPor: number | null;
  readonly criadoPor: string;
  readonly criadoEm: string;
}

export interface LancamentosContabeis {
  readonly itens: readonly LancamentoListado[];
  readonly total: number;
  readonly pagina: number;
  readonly tamanho: number;
}

export interface DetalheLancamento extends LancamentoListado {
  readonly partidas: readonly PartidaGravada[];
  /** Fato de origem (automático): a fonte pelo rótulo, o documento, a data do fato e o tipo. */
  readonly fato: {
    readonly id: number;
    readonly fonte: string;
    readonly documento: string;
    readonly data: string;
    readonly tipo: TipoFato;
  } | null;
  readonly regra: { readonly nome: string; readonly versao: number } | null;
  readonly justificativa: string | null;
  /** Pode estornar: não é estorno, não foi estornado e há período aberto. */
  readonly estornavel: boolean;
  readonly motivoNaoEstornavel: string | null;
}

export interface ResultadoLancamento {
  readonly ok: true;
  readonly id: number;
  readonly competencia: string;
  readonly mensagem: string;
}

export interface ResultadoContabilizacaoLote {
  readonly empresa: number;
  readonly competencia: string | null;
  readonly fatos: number;
  readonly porSituacao: Readonly<Record<SituacaoFato, number>>;
  readonly lancamentos: number;
  /** Lançamentos levados ao primeiro período aberto (o fato era de competência encerrada). */
  readonly movidosDePeriodo: number;
  readonly totais: { readonly debitos: number; readonly creditos: number };
  /** Ainda há fatos a contabilizar (a tela chama de novo). */
  readonly restam: boolean;
  /**
   * Fatos que outra gravação mudou entre a leitura e esta (o worker ou outro Contabilizar): ficaram como estavam, sem
   * lançamento deste lote (D-CORRIDA-542).
   */
  readonly mudaramDurante: number;
  readonly mensagem: string;
}

export interface MovimentoRazao {
  readonly lancamento: number;
  readonly partida: number;
  readonly data: string;
  readonly tipo: TipoLancamento;
  readonly historico: string;
  readonly centroCusto: number | null;
  readonly debitoCentavos: number;
  readonly creditoCentavos: number;
  /** Saldo depois do movimento, no sinal da natureza da conta (positivo = saldo na natureza). */
  readonly saldoCentavos: number;
  readonly conciliado: boolean;
}

export interface RazaoConta {
  readonly empresa: number;
  readonly conta: string;
  readonly contaNome: string;
  readonly natureza: 'devedora' | 'credora';
  readonly de: string;
  readonly ate: string;
  readonly saldoAnteriorCentavos: number;
  readonly debitosCentavos: number;
  readonly creditosCentavos: number;
  readonly saldoFinalCentavos: number;
  /** Conferência impressa: saldo anterior + débitos − créditos (ou o inverso na credora) = saldo final. */
  readonly conferencia: string;
  readonly movimentos: readonly MovimentoRazao[];
  /** A página mostrada (1 = a primeira) e o saldo antes do primeiro movimento dela, na natureza da conta. */
  readonly pagina: number;
  readonly saldoInicialPaginaCentavos: number;
  /** Há movimentos depois desta página (a tela pede a seguinte); os totais do período são sempre inteiros. */
  readonly parcial: boolean;
}

export interface PartidaParaConciliar {
  readonly id: number;
  readonly lancamento: number;
  readonly data: string;
  readonly lado: LadoPartida;
  readonly valorCentavos: number;
  readonly historico: string;
  readonly centroCusto: number | null;
}

export interface PendentesConciliacao {
  readonly empresa: number;
  readonly conta: string;
  readonly contaNome: string;
  readonly itens: readonly PartidaParaConciliar[];
  readonly debitosCentavos: number;
  readonly creditosCentavos: number;
  readonly parcial: boolean;
}

export interface ConciliacaoListada {
  readonly id: number;
  readonly conta: string;
  readonly situacao: SituacaoConciliacao;
  readonly partidas: number;
  readonly valorCentavos: number;
  readonly observacao: string | null;
  readonly criadaPor: string;
  readonly criadaEm: string;
  readonly desfeitaPor: string | null;
  readonly desfeitaEm: string | null;
}

export interface ResultadoConciliacao {
  readonly ok: true;
  readonly id: number;
  readonly mensagem: string;
}

/** Impedimento do encerramento (o motivo e a contagem; a tela mostra a lista e o caminho para resolver). */
export interface ImpedimentoEncerramento {
  readonly codigo:
    | 'fatos-pendentes'
    | 'fatos-sem-regra'
    | 'fatos-sem-conta'
    | 'desequilibrio'
    | 'anterior-aberto'
    | 'ja-encerrado'
    | 'futuro';
  readonly mensagem: string;
  readonly quantidade: number;
}

export interface PeriodoListado {
  readonly competencia: string;
  readonly situacao: SituacaoPeriodo;
  readonly lancamentos: number;
  readonly debitosCentavos: number;
  readonly creditosCentavos: number;
  readonly encerradoPor: string | null;
  readonly encerradoEm: string | null;
}

export interface PeriodosContabeis {
  readonly empresa: number;
  readonly itens: readonly PeriodoListado[];
}

export interface SituacaoDoPeriodo extends PeriodoListado {
  readonly empresa: number;
  /** Débitos e créditos por tipo de lançamento (as parcelas do total). */
  readonly parcelas: readonly {
    readonly tipo: TipoLancamento;
    readonly lancamentos: number;
    readonly debitosCentavos: number;
    readonly creditosCentavos: number;
  }[];
  readonly fatos: Readonly<Partial<Record<SituacaoFato, number>>>;
  readonly impedimentos: readonly ImpedimentoEncerramento[];
  readonly podeEncerrar: boolean;
  readonly podeReabrir: boolean;
  readonly motivoNaoReabre: string | null;
}

export interface ResultadoPeriodo {
  readonly ok: true;
  readonly competencia: string;
  readonly situacao: SituacaoPeriodo;
  readonly mensagem: string;
}

export interface ApoioLancamentos {
  readonly ligada: boolean;
  readonly motivo: string | null;
  readonly empresas: readonly number[];
  readonly hoje: string;
  readonly podeVerFatos: boolean;
  readonly podeLancar: boolean;
  readonly podeEstornar: boolean;
  readonly podeConciliar: boolean;
  readonly podeEncerrar: boolean;
  readonly podeReabrir: boolean;
  readonly tipos: readonly { readonly codigo: TipoLancamento; readonly rotulo: string }[];
  /** As contas analíticas ativas (para o formulário do lançamento e o razão). */
  readonly contas: readonly {
    readonly codigo: string;
    readonly nome: string;
    readonly natureza: 'devedora' | 'credora';
    readonly exigeCentroCusto: boolean;
  }[];
}
