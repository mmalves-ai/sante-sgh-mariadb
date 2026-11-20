// M58-F4: a porta da fachada da API de integração da Hal-AI. As leituras das rotas servidas (READ ONLY pelo
// @sgh/legado), o estado das operações equivalentes no catálogo e a gravação da ação de situação do convênio pela
// receita `convenio.alterarSituacao` do executor, assinada pelo usuário de integração (hal-ai).
import type {
  DiariaAcompanhante,
  ImpactoConvenio,
  LinhaConvenioFachada,
  RetratoConvenio,
} from '@sgh/dominio-integracao';

export const PORTA_FACHADA = Symbol('PORTA_FACHADA');

export interface ContextoFachada {
  readonly rede: string;
  readonly hospital: string;
}

export interface SaudeBancoFachada {
  readonly banco: string | null;
  readonly colunaObs: string | null;
  readonly efetivo: string;
}

export interface GravacaoSituacaoFachada {
  readonly cod: number;
  readonly operacao: 'suspender' | 'reativar';
  readonly justificativa: string;
  /** A chave de idempotência (o identificador da proposta). */
  readonly chave: string;
}

export interface PortaFachada {
  readonly destino: 'legado' | 'memoria';
  /** O estado da operação no catálogo do estabelecimento (null: fora do catálogo). */
  estado(operacao: string, hospital: string): string | null;
  convenios(c: ContextoFachada): Promise<LinhaConvenioFachada[]>;
  convenio(c: ContextoFachada, cod: number): Promise<LinhaConvenioFachada | null>;
  saudeBanco(c: ContextoFachada): Promise<SaudeBancoFachada>;
  retratoConvenio(c: ContextoFachada, cod: number): Promise<RetratoConvenio>;
  diariaConvenio(c: ContextoFachada, cod: number): Promise<DiariaAcompanhante>;
  impactoConvenio(c: ContextoFachada, cod: number): Promise<ImpactoConvenio>;
  /**
   * Grava pela receita (executor; SGH_TRILHA e autoria na mesma transação) e devolve a situação relida. As recusas
   * do executor chegam já no contrato de erro da fachada (ErroHttpFachada), sem texto do banco.
   */
  gravarSituacaoConvenio(c: ContextoFachada, g: GravacaoSituacaoFachada): Promise<string | null>;
}

export const METODOS_PORTA_FACHADA: ReadonlySet<string> = new Set([
  'estado',
  'convenios',
  'convenio',
  'saudeBanco',
  'retratoConvenio',
  'diariaConvenio',
  'impactoConvenio',
  'gravarSituacaoConvenio',
]);
