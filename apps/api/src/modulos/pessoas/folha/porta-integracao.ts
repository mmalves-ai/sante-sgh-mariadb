// Porta da integração da folha com o financeiro e o contábil, fatia F8 (M53.9; ficha do M53, seções 4 a 8): o cadastro
// de rotinas (FPINTROTINA) e o aviso de títulos manuais lidos do outro sistema; o de-para, o retorno conferido, os
// lançamentos e o custo de pessoal em SGH_; o lançamento dos títulos pelo EXECUTOR (`financeiro.criarTituloPagar`,
// ação `incluir-folha`, com o registro SGH_ na mesma transação); a vigência do de-para em transação só SGH_ com a trilha.
import type {
  ApuracaoFolha,
  ClassificacaoFolha,
  CredorFolha,
  CustoPessoalCentro,
  DestinoIntegracaoFolha,
  IntegracaoFolhaLida,
  OrigemLancamentoFolha,
  RotinaIntegracaoFolha,
} from '@sgh/contratos';
import type { LancamentoFolhaLido, RetornoParaTitulosLido, TituloFolhaLancadoLido } from '@sgh/legado';
import type { ContextoPortaM18, PortaGravacaoM18 } from '../../exames/public-api.js';

export const PORTA_INTEGRACAO_FOLHA = Symbol('PORTA_INTEGRACAO_FOLHA');

export type ContextoIntegracaoFolha = ContextoPortaM18;

/** A gravação só SGH_ da integração (a vigência do de-para), com a releitura dentro da transação. */
export interface GravadorIntegracaoFolha {
  integracoes(empresa: number): Promise<IntegracaoFolhaLida[]>;
  incluirIntegracao(x: {
    readonly empresa: number;
    readonly inicio: string;
    readonly destinos: readonly DestinoIntegracaoFolha[];
    readonly por: string;
  }): Promise<number>;
}

export interface FiltroTitulosManuais {
  readonly empresa: number;
  readonly credor: number;
  readonly grupo: number;
  readonly subgrupo: number;
  readonly item: number;
  readonly de: string;
  readonly ate: string;
}

export interface PortaIntegracaoFolha extends PortaGravacaoM18<GravadorIntegracaoFolha> {
  rotinas(c: ContextoIntegracaoFolha): Promise<RotinaIntegracaoFolha[]>;
  integracoes(c: ContextoIntegracaoFolha, empresa: number): Promise<IntegracaoFolhaLida[]>;
  retorno(c: ContextoIntegracaoFolha, id: number): Promise<RetornoParaTitulosLido | null>;
  lancamentos(c: ContextoIntegracaoFolha, empresa: number, ano: number): Promise<LancamentoFolhaLido[]>;
  lancamento(c: ContextoIntegracaoFolha, id: number): Promise<LancamentoFolhaLido | null>;
  lancamentoDaOrigem(
    c: ContextoIntegracaoFolha,
    origem: OrigemLancamentoFolha,
    id: number,
  ): Promise<LancamentoFolhaLido | null>;
  titulosDoLancamento(c: ContextoIntegracaoFolha, lancamento: number): Promise<TituloFolhaLancadoLido[]>;
  chavesLancadas(
    c: ContextoIntegracaoFolha,
    empresa: number,
    apuracao: ApuracaoFolha,
    periodo: string,
  ): Promise<string[]>;
  custoPessoal(
    c: ContextoIntegracaoFolha,
    empresa: number,
    periodo: string,
  ): Promise<{ centros: CustoPessoalCentro[]; lancamentos: number }>;
  titulosManuais(c: ContextoIntegracaoFolha, f: FiltroTitulosManuais): Promise<number>;
  classificacoes(c: ContextoIntegracaoFolha): Promise<ClassificacaoFolha[]>;
  credores(
    c: ContextoIntegracaoFolha,
    f: { readonly termo?: string; readonly codigos?: readonly number[] },
  ): Promise<CredorFolha[]>;
}

export const METODOS_PORTA_INTEGRACAO_FOLHA: ReadonlySet<string> = new Set<keyof PortaIntegracaoFolha>([
  'podeGravar',
  'executar',
  'gravarSgh',
  'rotinas',
  'integracoes',
  'retorno',
  'lancamentos',
  'lancamento',
  'lancamentoDaOrigem',
  'titulosDoLancamento',
  'chavesLancadas',
  'custoPessoal',
  'titulosManuais',
  'classificacoes',
  'credores',
]);
