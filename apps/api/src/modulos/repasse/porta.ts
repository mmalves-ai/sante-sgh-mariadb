// Porta do repasse médico (M33): o que as telas de regras, apuração, lançamentos, RPA e o extrato leem e gravam,
// independente de onde (a API não escreve SQL; fronteira Nx):
//   - `banco`: a porta própria sobre o banco do cliente (porta-propria.ts), pelo @sgh/nucleo: as operações de tela
//     (lançamento, RPA, inclusão de regra e integração) e as gravações diretas (versão de regra, apuração e memória de
//     cálculo) com a trilha, o outbox e a idempotência na mesma transação;
//   - `memoria`: a sessão sintética de dev/ci (E2E): regras, produção, lançamentos e RPAs SINTÉTICOS em memória, com
//     as mesmas validações (Zod dos contratos) e as mesmas recusas;
//   - indisponível: fora de dev/ci sem o núcleo: 503 em tudo (falha fechada).
import type { ItemProducao, RegraRepasse } from '@sgh/contratos';
import type { RegraRepasseParticularIntegral } from '@sgh/dominio-repasse';
import type {
  ApuracaoRepasseRegistrada,
  LancamentoRepasseRegistrado,
  MemoriaCalculoParaGravar,
  MemoriaCalculoRegistrada,
  PrestadorRepasse,
  RpaDetalhe,
  RpaRegistrado,
  TotaisApuracao,
  VersaoRegraRegistrada,
} from './tipos.js';
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

/** As gravações diretas da porta, numa operação do executor (trilha na mesma transação). */
export interface GravadorRepasse {
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
    totais: TotaisApuracao;
    memorias: readonly MemoriaCalculoParaGravar[];
  }): Promise<{ apuracao: number; recalculada: boolean }>;
  transicionarApuracao(d: {
    apuracao: number;
    de: string;
    para: string;
    por: string;
    justificativa?: string;
  }): Promise<{ apuracao: number; estado: string }>;
}

export interface PortaRepasse extends PortaGravacaoM18<GravadorRepasse> {
  hoje(c: ContextoRepasse): Promise<string>;
  opcoes(c: ContextoRepasse): Promise<{ eventos: OpcaoPorta[]; convenios: OpcaoPorta[] }>;
  regras(c: ContextoRepasse, f: FiltroRegrasPorta): Promise<RegraRepasse[]>;
  todasRegras(c: ContextoRepasse, f: { convenio: number; data: string }): Promise<RegraRepasse[]>;
  /**
   * ADR 0009: as regras de repasse integral da consulta particular vigentes na data (fora de `todasRegras`) e o grupo de
   * faturamento de cada procedimento que elas alcançam. O procedimento é o CÓDIGO de negócio, como em ItemProducao.
   */
  integraisParticular(c: ContextoRepasse, data: string): Promise<IntegraisParticular>;
  regrasUsadas(c: ContextoRepasse, ids: readonly number[]): Promise<Set<number>>;
  versoes(c: ContextoRepasse): Promise<VersaoRegraRegistrada[]>;
  versao(c: ContextoRepasse, id: number): Promise<VersaoRegraRegistrada | null>;
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
  apuracaoDoPeriodo(
    c: ContextoRepasse,
    empresa: number,
    competencia: string,
  ): Promise<ApuracaoRepasseRegistrada | null>;
  apuracao(c: ContextoRepasse, id: number): Promise<ApuracaoRepasseRegistrada | null>;
  memorias(
    c: ContextoRepasse,
    apuracao: number,
    prestador: number | null,
  ): Promise<MemoriaCalculoRegistrada[]>;
  lancamentos(
    c: ContextoRepasse,
    f: { empresa: number; competencia: string; prestador?: number },
  ): Promise<LancamentoRepasseRegistrado[]>;
  estornos(c: ContextoRepasse, lancamentos: readonly number[]): Promise<Map<number, number>>;
  rpas(c: ContextoRepasse, f: { empresa: number; competencia: string }): Promise<RpaRegistrado[]>;
  rpaDetalhe(c: ContextoRepasse, id: number): Promise<RpaDetalhe | null>;
  buscarPrestadores(c: ContextoRepasse, termo: string): Promise<PrestadorRepasse[]>;
  jaEmRpa(c: ContextoRepasse, lancamentos: readonly number[]): Promise<Set<number>>;
  prestadoresDoUsuario(c: ContextoRepasse, login: string): Promise<number[]>;
  registroDoPrestador(c: ContextoRepasse, prestador: number): Promise<number | null>;
  lancamentosDosPrestadores(
    c: ContextoRepasse,
    prestadores: readonly number[],
    desde: string,
    ate?: string | null,
  ): Promise<LancamentoRepasseRegistrado[]>;
  rpasDosPrestadores(
    c: ContextoRepasse,
    prestadores: readonly number[],
    desde: string,
    ate?: string | null,
  ): Promise<(RpaRegistrado & { valor: number; titulo: number | null })[]>;
  adiantamentos(c: ContextoRepasse, prestadores: readonly number[]): Promise<number>;
  basesIndicadores(c: ContextoRepasse, de: string, ate: string): Promise<BasesIndicadoresRepassePorta>;
}

/** As regras integrais e o grupo de faturamento por código de procedimento (o que o motor recebe em OpcoesCalculo). */
export interface IntegraisParticular {
  readonly integrais: readonly RegraRepasseParticularIntegral[];
  readonly grupoDoProcedimento: ReadonlyMap<number, number>;
}

export const METODOS_PORTA_REPASSE: ReadonlySet<string> = new Set([
  'podeGravar',
  'executar',
  'gravarSgh',
  'hoje',
  'opcoes',
  'regras',
  'todasRegras',
  'integraisParticular',
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
