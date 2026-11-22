// Fonte do M12 na API (convênios, contratos, tabelas de preço, importação e motor de preços): onde as leituras
// e as gravações acontecem.
//   - `banco` (fonte-propria.ts): o banco do cliente pelo @sgh/nucleo; as gravações pelo Executor (trilha, outbox e
//     idempotência na mesma transação);
//   - `memoria`: a sessão sintética de dev/ci (E2E e testes HTTP): os mesmos contratos e as mesmas regras
//     puras (@sgh/dominio-preco) sobre dados sintéticos em memória (fonte-memoria.ts);
//   - `indisponivel`: fora de dev/ci sem o núcleo: 503 em tudo, nunca a memória.
import type { DesfazerReajusteEntrada, EstadoOperacao } from '@sgh/contratos';
import type { ContextoNucleo, ContextoOperacao, ResultadoOperacao } from '@sgh/nucleo';
import { ErroProblema } from '../../problema.filter.js';
import type { NomeOperacaoPreco } from './operacoes.js';
import type {
  AlteracaoPlano,
  AutoriaPreco,
  CabecalhoTabela,
  CargaImportacao,
  ConvenioPreco,
  FiltroConvenio,
  ImpactoSituacaoConvenio,
  IndiceConvenio,
  ItemDiariaPreco,
  ItemHonorarioPreco,
  ItemMatmedPreco,
  ItemParaReajuste,
  LinhaCargaImportacao,
  LinhaDoLote,
  LoteReajuste,
  NovaCarga,
  NovoPlano,
  Pagina,
  PaginaModificadores,
  PlanoConvenio,
  RegraDatada,
  TipoModificador,
  TissConvenio,
  VigenciaItem,
  VigenciaTabelaConvenio,
  VigenciaValor,
} from './tipos.js';

export const FONTE_PRECOS = Symbol('FONTE_PRECOS');

/** Contexto de leitura: o do núcleo (cliente, estabelecimento e usuário por id) e o código da sessão. */
export interface CtxPrecos extends ContextoNucleo {
  readonly rede: string;
  readonly hospital: string;
  readonly traceId: string;
}

/** Contexto de uma gravação: o da leitura, a chave de idempotência, a reautenticação e quem grava. */
export interface ContextoGravacaoPreco extends CtxPrecos, ContextoOperacao {
  readonly login: string;
  readonly estacao: string;
}

/** Dados da trilha de uma gravação direta da tela (o alvo vem da gravação). */
export interface TrilhaPreco {
  readonly rede: string;
  readonly hospital: string;
  readonly usuario: string;
  readonly evento: string;
  readonly recurso: string;
  readonly operacao: string;
  readonly chaveNaturalAlvo: string;
  readonly resultado: string;
  readonly estacao: string;
  readonly correlacao: string;
  /** Idempotency-Key do pedido (o reenvio devolve o mesmo resultado); ausente: chave nova a cada gravação. */
  readonly chaveIdempotencia?: string | null;
}

/** Mudança de situação de uma carga (pela versão lida). */
export interface MudancaCarga {
  readonly hospital: string;
  readonly id: number;
  readonly versao: number;
  readonly de: readonly string[];
  readonly para: 'publicada' | 'rejeitada';
  readonly aprovador: string;
  readonly lote: string | null;
  readonly motivo: string | null;
}

export interface FiltroPagina {
  readonly busca?: string;
  readonly pagina: number;
  readonly porPagina: number;
  readonly data: string;
}

/** Tudo o que as telas do M12 leem e gravam (as duas fontes implementam). */
export interface FontePrecos {
  readonly destino: 'banco' | 'memoria';
  /** Gravação permitida nesta fonte e ambiente (falso: o motivo vai para a tela). */
  readonly gravacao: { readonly permitida: boolean; readonly motivo: string | null };
  /** Estado da operação nesta fonte (null: não disponível). */
  estado(operacao: string, hospital: string): EstadoOperacao | null;
  /** Grava pela operação (a entrada conferida pelo Zod da operação; idempotente pela chave do contexto). */
  executar(
    operacao: NomeOperacaoPreco,
    c: CtxPrecos,
    entrada: unknown,
    ctx: ContextoGravacaoPreco,
  ): Promise<{ resultado: ResultadoOperacao; repetida: boolean }>;
  hoje(c: CtxPrecos): Promise<string>;
  convenios(c: CtxPrecos): Promise<ConvenioPreco[]>;
  convenio(c: CtxPrecos, cod: number): Promise<ConvenioPreco | null>;
  valoresContrato(
    c: CtxPrecos,
    cod: number,
  ): Promise<Readonly<Record<string, string | number | null>> | null>;
  opcoesClassificacao(c: CtxPrecos): Promise<{ valor: string; rotulo: string }[]>;
  vigenciasTabelas(c: CtxPrecos, cod: number): Promise<VigenciaTabelaConvenio[]>;
  indicesConvenio(c: CtxPrecos, cod: number): Promise<IndiceConvenio[]>;
  tiss(c: CtxPrecos, cod: number): Promise<TissConvenio>;
  historico(
    c: CtxPrecos,
    cod: number,
  ): Promise<{ quando: string; nome: string; classificacao: number | null }[]>;
  planos(c: CtxPrecos, cod: number): Promise<PlanoConvenio[] | null>;
  modificadores(
    c: CtxPrecos,
    tipo: TipoModificador,
    cod: number,
    pagina: number,
    porPagina: number,
  ): Promise<PaginaModificadores>;
  impactoSituacao(c: CtxPrecos, cod: number): Promise<ImpactoSituacaoConvenio>;
  cabecalhos(c: CtxPrecos, tipo: 'honorarios' | 'diarias' | 'matmed'): Promise<CabecalhoTabela[]>;
  perfisHonorario(c: CtxPrecos): Promise<Map<number, { itens: number; comCh: number; comPorte: number }>>;
  itensHonorario(
    c: CtxPrecos,
    tab: number,
    f: FiltroPagina,
  ): Promise<{ itens: ItemHonorarioPreco[]; total: number }>;
  itemHonorario(c: CtxPrecos, tab: number, cod: number, data: string): Promise<ItemHonorarioPreco | null>;
  itensParaReajuste(
    c: CtxPrecos,
    tab: number,
    codigos: readonly number[] | null,
    data: string,
    teto: number,
  ): Promise<ItemParaReajuste[]>;
  vigenciasDoItem(c: CtxPrecos, tab: number, cod: number): Promise<VigenciaItem[]>;
  autoriaDoItem(c: CtxPrecos, tab: number, cod: number): Promise<AutoriaPreco[] | null>;
  lotes(c: CtxPrecos, tab: number | null): Promise<LoteReajuste[] | null>;
  linhasDoLote(c: CtxPrecos, lote: string): Promise<LinhaDoLote[]>;
  itensDiaria(
    c: CtxPrecos,
    tab: number,
    f: FiltroPagina,
  ): Promise<{ itens: ItemDiariaPreco[]; total: number }>;
  itemDiaria(c: CtxPrecos, tab: number, ope: number, data: string): Promise<ItemDiariaPreco | null>;
  itensMatmed(
    c: CtxPrecos,
    tab: number,
    f: FiltroPagina,
  ): Promise<{ itens: ItemMatmedPreco[]; total: number }>;
  itemMatmed(c: CtxPrecos, tab: number, cod: number, data: string): Promise<ItemMatmedPreco | null>;
  vigenciasDiaria(c: CtxPrecos, tab: number, ope: number): Promise<VigenciaValor[]>;
  vigenciasMatmed(c: CtxPrecos, tab: number, cod: number): Promise<VigenciaValor[]>;
  edicoes(c: CtxPrecos): Promise<{ id: number; versao: number }[]>;
  indicesNaData(c: CtxPrecos, conv: number, data: string): Promise<Map<number, number>>;
  porteNaData(c: CtxPrecos, conv: number, porte: string, data: string): Promise<number | null>;
  /**
   * `conv`: um convênio, a lista do escopo da sessão (vazia = nenhum) ou null = todos (só sem restrição).
   * `profissional`: registro no conselho (dígitos) ou trecho do nome, sem acento.
   */
  credenciamento(
    c: CtxPrecos,
    conv: FiltroConvenio,
    pagina: number,
    porPagina: number,
    bancario: boolean,
    profissional?: string | null,
  ): Promise<Pagina>;
  credenciamentoAtos(c: CtxPrecos, conv: FiltroConvenio, bancario: boolean): Promise<Pagina>;
  credenciamentoComplementar(
    c: CtxPrecos,
    conv: FiltroConvenio,
    profissional?: string | null,
  ): Promise<{ unimed: Pagina; auditoras: Pagina }>;
  codigosPrestador(c: CtxPrecos, conv: FiltroConvenio, pagina: number, porPagina: number): Promise<Pagina>;
  dePara(
    c: CtxPrecos,
    conv: FiltroConvenio,
    exame: string | null,
    pagina: number,
    porPagina: number,
  ): Promise<Pagina>;
  portes(c: CtxPrecos, tab: number | null, pagina: number, porPagina: number): Promise<Pagina>;
  terceiros(c: CtxPrecos, tab: number, busca: string, pagina: number, porPagina: number): Promise<Pagina>;
  tabelasTerceiros(c: CtxPrecos): Promise<{ tabela: number; itens: number; ultima: string | null }[]>;
  unimed(c: CtxPrecos, busca: string, pagina: number, porPagina: number): Promise<Pagina>;
  saneamento(c: CtxPrecos): Promise<RegraDatada[]>;
  cargas(c: CtxPrecos, catalogo: string): Promise<CargaImportacao[] | null>;
  carga(c: CtxPrecos, id: number): Promise<CargaImportacao | null>;
  linhasDaCarga(
    c: CtxPrecos,
    id: number,
    pagina: number,
    porPagina: number,
    comparacao: string | null,
  ): Promise<{ itens: LinhaCargaImportacao[]; total: number }>;
  gravarCarga(c: CtxPrecos, nova: NovaCarga, trilha: TrilhaPreco): Promise<{ id: number }>;
  mudarSituacaoCarga(c: CtxPrecos, m: MudancaCarga, trilha: TrilhaPreco): Promise<void>;
  gravarPlano(c: CtxPrecos, p: NovoPlano, trilha: TrilhaPreco): Promise<{ id: number }>;
  /** Pré-conferência (só leitura) de todas as partes do desfazer, antes da primeira exclusão. */
  preConferirDesfazer(c: CtxPrecos, partes: readonly DesfazerReajusteEntrada[]): Promise<void>;
  alterarPlano(c: CtxPrecos, a: AlteracaoPlano, trilha: TrilhaPreco): Promise<{ id: number; versao: number }>;
}

/** Fora de dev/ci sem o núcleo: falha fechada (503). */
export class ErroPrecosIndisponivel extends ErroProblema {
  constructor() {
    super(
      'indisponivel',
      503,
      'Banco do estabelecimento indisponível',
      'O banco do estabelecimento não está configurado: nada foi lido nem gravado.',
    );
  }
}

/** Os métodos de leitura e gravação da fonte (para a fonte indisponível responder 503 em todos). */
const METODOS: readonly (keyof FontePrecos)[] = [
  'hoje',
  'convenios',
  'convenio',
  'valoresContrato',
  'opcoesClassificacao',
  'vigenciasTabelas',
  'indicesConvenio',
  'tiss',
  'historico',
  'planos',
  'modificadores',
  'impactoSituacao',
  'cabecalhos',
  'perfisHonorario',
  'itensHonorario',
  'itemHonorario',
  'itensParaReajuste',
  'vigenciasDoItem',
  'autoriaDoItem',
  'lotes',
  'linhasDoLote',
  'itensDiaria',
  'itemDiaria',
  'itensMatmed',
  'itemMatmed',
  'vigenciasDiaria',
  'vigenciasMatmed',
  'edicoes',
  'indicesNaData',
  'porteNaData',
  'credenciamento',
  'credenciamentoAtos',
  'credenciamentoComplementar',
  'codigosPrestador',
  'dePara',
  'portes',
  'terceiros',
  'tabelasTerceiros',
  'unimed',
  'saneamento',
  'cargas',
  'carga',
  'linhasDaCarga',
  'gravarCarga',
  'mudarSituacaoCarga',
  'gravarPlano',
  'alterarPlano',
  'preConferirDesfazer',
];

/** Fora de dev/ci sem o núcleo: toda chamada responde 503 (falha fechada; nunca a memória). */
export function fontePrecosIndisponivel(): FontePrecos {
  const recusar = () => Promise.reject(new ErroPrecosIndisponivel());
  return {
    destino: 'banco',
    gravacao: { permitida: false, motivo: 'Banco do estabelecimento indisponível.' },
    estado: () => null,
    executar: recusar,
    ...Object.fromEntries(METODOS.map((m) => [m, recusar])),
  } as unknown as FontePrecos;
}
