// Formas lidas e gravadas pela persistência da contabilidade (comuns à API e ao worker). A API as reexporta em
// apps/api/src/modulos/contabil/tipos.ts.
import type {
  ContaPlano,
  FatoContabil,
  LadoPartida,
  PartidaGerada,
  RegraContabil,
  SituacaoFato,
  SituacaoPeriodo,
  TipoLancamento,
} from '@sgh/contratos';

export interface ContaPlanoVersionada extends ContaPlano {
  readonly versao: number;
  readonly alteradoPor: string;
  readonly alteradoEm: string;
}

export interface FatoRegistrado extends FatoContabil {
  readonly idFato: number;
  readonly situacao: SituacaoFato;
  readonly motivo: string | null;
  readonly regraId: number | null;
  readonly lidoEm: string;
}

/** O lançamento a gravar (a forma do LancamentoNovo de @sgh/dominio-contabil). */
export interface LancamentoParaGravar {
  readonly chave: string;
  readonly tipo: TipoLancamento;
  readonly empresa: number;
  readonly data: string;
  readonly competencia: string;
  readonly historico: string;
  readonly partidas: readonly PartidaGerada[];
  readonly fatoId: number | null;
  readonly regraId: number | null;
  readonly regra: { readonly nome: string; readonly versao: number } | null;
  readonly estornaId: number | null;
  readonly justificativa: string | null;
}

export interface RegraPublicada {
  readonly id: number;
  readonly regra: RegraContabil;
  readonly impressao: string;
  readonly justificativa: string;
  readonly publicadaPor: string;
  readonly publicadaEm: string;
}

/** Linha do de-para contábil da receita (fonte pagadora, tipo de conta e de lançamento → conta). */
export interface ItemDePara {
  readonly empresa: number;
  readonly convenio: number | null;
  readonly tipoConta: string;
  readonly tipoLancamento: number | null;
  readonly tipoAto: number | null;
  readonly subtipoDiaria: number | null;
  readonly contaExportacao: number | null;
}

export interface PartidaRegistrada {
  readonly id: number;
  readonly lancamento: number;
  readonly ordem: number;
  readonly lado: LadoPartida;
  readonly conta: string;
  readonly valorCentavos: number;
  readonly centroCusto: number | null;
  readonly historico: string;
  readonly conciliacao: number | null;
}

export interface PeriodoRegistrado {
  readonly empresa: number;
  readonly competencia: string;
  readonly situacao: SituacaoPeriodo;
  readonly lancamentos: number;
  readonly debitos: number;
  readonly creditos: number;
  readonly observacao: string | null;
  readonly encerradoPor: string | null;
  readonly encerradoEm: string | null;
  readonly reabertoPor: string | null;
  readonly reabertoEm: string | null;
  readonly versao: number;
}

export interface PedidoSituacaoFato {
  readonly idFato: number;
  readonly situacao: SituacaoFato;
  readonly motivo: string | null;
  readonly regraId: number | null;
  /**
   * A situação lida antes do plano: a gravação só vale se o fato ainda estiver nela (o worker e a tela, ou o
   * reprocessamento, leem numa transação e gravam noutra). Sem ela, a gravação não confere a situação.
   */
  readonly situacaoLida?: SituacaoFato | null;
}

/** O lançamento automático já gravado de um fato (para não lançar de novo e para o estorno do fato). */
export interface LancamentoGravadoDoFato {
  readonly id: number;
  readonly idFato: number;
  readonly partidas: PartidaGerada[];
  readonly estornadoPor: number | null;
}

/** O que a contabilização dos fatos lê de uma vez (os candidatos, os fatos das linhas e os lançamentos deles). */
export interface LeituraParaContabilizar {
  readonly candidatos: readonly FatoRegistrado[];
  readonly registrados: readonly FatoRegistrado[];
  readonly lancamentos: ReadonlyMap<number, LancamentoGravadoDoFato>;
  readonly restam: boolean;
}
