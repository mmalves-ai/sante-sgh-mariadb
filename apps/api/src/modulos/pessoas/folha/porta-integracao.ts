// Porta da integração da folha com o financeiro e o contábil (M53.9): o catálogo de rotinas, o de-para por vigência,
// o retorno conferido da folha externa, os lançamentos dos títulos no contas a pagar, o custo de pessoal por centro,
// o aviso de títulos manuais, as classificações gerenciais e os credores. Duas implementações: a própria, sobre o
// MariaDB do cliente (porta-integracao-propria.ts), e a de memória (dev/ci e testes).
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
import type { ContextoPortaM18, PortaGravacaoM18 } from '../../exames/public-api.js';
import { type LancamentoTitulosFolha, type TituloFolhaLancado } from './apoio-folha.js';
import { type RetornoParaTitulos } from './tipos-folha.js';

export const PORTA_INTEGRACAO_FOLHA = Symbol('PORTA_INTEGRACAO_FOLHA');

export type ContextoIntegracaoFolha = ContextoPortaM18;

/** A gravação direta da integração (a vigência do de-para), com a releitura dentro da transação. */
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
  retorno(c: ContextoIntegracaoFolha, id: number): Promise<RetornoParaTitulos | null>;
  lancamentos(c: ContextoIntegracaoFolha, empresa: number, ano: number): Promise<LancamentoTitulosFolha[]>;
  lancamento(c: ContextoIntegracaoFolha, id: number): Promise<LancamentoTitulosFolha | null>;
  lancamentoDaOrigem(
    c: ContextoIntegracaoFolha,
    origem: OrigemLancamentoFolha,
    id: number,
  ): Promise<LancamentoTitulosFolha | null>;
  titulosDoLancamento(c: ContextoIntegracaoFolha, lancamento: number): Promise<TituloFolhaLancado[]>;
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
