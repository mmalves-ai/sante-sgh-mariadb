// Porta do repasse médico (M33): o que as telas de regras, apuração, lançamentos, RPA e o extrato leem e gravam,
// independente de onde (a API não escreve SQL; fronteira Nx):
//   - `legado`: leituras READ ONLY dos repositórios de @sgh/legado; gravações pelo EXECUTOR do M04 (receitas
//     repasse.*, com a trilha na mesma transação); as só do novo (versão de regra, apuração e memória de cálculo) em
//     transação SGH_ com a SGH_TRILHA junto;
//   - `memoria`: a sessão sintética de dev/ci (E2E): regras, produção, lançamentos e RPAs SINTÉTICOS em memória, com
//     as mesmas validações (Zod dos contratos) e as mesmas recusas;
//   - indisponível: fora de dev/ci sem o núcleo: 503 em tudo (falha fechada).
import type { ItemProducao, RegraRepasse } from '@sgh/contratos';
import type {
  ApuracaoLida,
  LancamentoRepasseLido,
  MemoriaLida,
  MemoriaParaGravar,
  PrestadorRepasseLido,
  RpaDetalheLido,
  RpaLido,
  TotaisParaGravar,
  VersaoRegraLida,
} from '@sgh/legado';
import type { ContextoPortaM18, PortaGravacaoM18 } from '../exames/public-api.js';

export const PORTA_REPASSE = Symbol('PORTA_REPASSE');

export type ContextoRepasse = ContextoPortaM18;

export interface OpcaoPorta {
  readonly codigo: number;
  readonly rotulo: string;
}

/** O filtro das regras vigentes (ficha §4: por convênio, procedimento e profissional; keyset por ID). */
export interface FiltroRegrasPorta {
  readonly convenio: number;
  readonly data: string;
  readonly depoisDe: number;
  readonly procedimento?: number | null;
  readonly profissional?: number | null;
  readonly teto?: number;
}

export interface BasesIndicadoresRepassePorta {
  readonly repasse: number;
  readonly honorarios: number;
  readonly linhas: number;
  readonly estornos: number;
  readonly valorEstornos: number;
  readonly rpas: number;
  readonly rpasPagos: number;
  readonly diasAtePagamento: number;
}

/** As gravações só do novo (SGH_) que a porta faz na transação com a trilha. */
export interface GravadorSghRepasse {
  proporVersao(d: {
    substitui: number | null;
    proposta: string;
    justificativa: string;
    autor: string;
  }): Promise<{ versao: number }>;
  marcarSimulada(d: { versao: number }): Promise<{ versao: number }>;
  decidirVersao(d: {
    versao: number;
    para: 'aprovada' | 'recusada';
    por: string;
    justificativa: string;
  }): Promise<{ versao: number; estado: string }>;
  gravarApuracao(d: {
    empresa: number;
    competencia: string;
    apuradoPor: string;
    simulacao: boolean;
    totais: TotaisParaGravar;
    memorias: readonly MemoriaParaGravar[];
  }): Promise<{ apuracao: number; recalculada: boolean }>;
  transicionarApuracao(d: {
    apuracao: number;
    de: string;
    para: string;
    por: string;
    justificativa?: string;
  }): Promise<{ apuracao: number; estado: string }>;
}

export interface PortaRepasse extends PortaGravacaoM18<GravadorSghRepasse> {
  hoje(c: ContextoRepasse): Promise<string>;
  opcoes(c: ContextoRepasse): Promise<{ eventos: OpcaoPorta[]; convenios: OpcaoPorta[] }>;
  regras(c: ContextoRepasse, f: FiltroRegrasPorta): Promise<RegraRepasse[]>;
  todasRegras(c: ContextoRepasse, f: { convenio: number; data: string }): Promise<RegraRepasse[]>;
  regrasUsadas(c: ContextoRepasse, ids: readonly number[]): Promise<Set<number>>;
  versoes(c: ContextoRepasse): Promise<VersaoRegraLida[]>;
  versao(c: ContextoRepasse, id: number): Promise<VersaoRegraLida | null>;
  producao(
    c: ContextoRepasse,
    competencia: string,
    depoisDe: number,
  ): Promise<{ itens: ItemProducao[]; ultimo: number | null }>;
  jaIntegrados(c: ContextoRepasse, itens: readonly number[]): Promise<Set<number>>;
  estadoPeriodo(
    c: ContextoRepasse,
    empresa: number,
    competencia: string,
  ): Promise<{ lancamentos: number; daApuracao: number }>;
  apuracaoDoPeriodo(c: ContextoRepasse, empresa: number, competencia: string): Promise<ApuracaoLida | null>;
  apuracao(c: ContextoRepasse, id: number): Promise<ApuracaoLida | null>;
  memorias(c: ContextoRepasse, apuracao: number, prestador: number | null): Promise<MemoriaLida[]>;
  lancamentos(
    c: ContextoRepasse,
    f: { empresa: number; competencia: string; prestador?: number },
  ): Promise<LancamentoRepasseLido[]>;
  estornos(c: ContextoRepasse, lancamentos: readonly number[]): Promise<Map<number, number>>;
  rpas(c: ContextoRepasse, f: { empresa: number; competencia: string }): Promise<RpaLido[]>;
  rpaDetalhe(c: ContextoRepasse, id: number): Promise<RpaDetalheLido | null>;
  buscarPrestadores(c: ContextoRepasse, termo: string): Promise<PrestadorRepasseLido[]>;
  jaEmRpa(c: ContextoRepasse, lancamentos: readonly number[]): Promise<Set<number>>;
  prestadoresDoUsuario(c: ContextoRepasse, login: string): Promise<number[]>;
  registroDoPrestador(c: ContextoRepasse, prestador: number): Promise<number | null>;
  lancamentosDosPrestadores(
    c: ContextoRepasse,
    prestadores: readonly number[],
    desde: string,
    ate?: string | null,
  ): Promise<LancamentoRepasseLido[]>;
  rpasDosPrestadores(
    c: ContextoRepasse,
    prestadores: readonly number[],
    desde: string,
    ate?: string | null,
  ): Promise<(RpaLido & { valor: number; titulo: number | null })[]>;
  adiantamentos(c: ContextoRepasse, prestadores: readonly number[]): Promise<number>;
  basesIndicadores(c: ContextoRepasse, de: string, ate: string): Promise<BasesIndicadoresRepassePorta>;
}

export const METODOS_PORTA_REPASSE: ReadonlySet<string> = new Set([
  'podeGravar',
  'executar',
  'gravarSgh',
  'hoje',
  'opcoes',
  'regras',
  'todasRegras',
  'regrasUsadas',
  'versoes',
  'versao',
  'producao',
  'jaIntegrados',
  'estadoPeriodo',
  'apuracaoDoPeriodo',
  'apuracao',
  'memorias',
  'lancamentos',
  'estornos',
  'rpas',
  'rpaDetalhe',
  'buscarPrestadores',
  'jaEmRpa',
  'prestadoresDoUsuario',
  'registroDoPrestador',
  'lancamentosDosPrestadores',
  'rpasDosPrestadores',
  'adiantamentos',
  'basesIndicadores',
]);
