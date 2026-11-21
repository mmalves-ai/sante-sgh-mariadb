// Porta da contabilidade (M54): o que as telas do plano de contas, das regras, dos fatos, dos lançamentos, das
// demonstrações e do SPED leem e gravam, independente de onde (a API não escreve SQL; fronteira Nx):
//   - `banco`: a porta própria sobre o banco do cliente (MariaDB, pelo @sgh/nucleo; porta-propria.ts), com as
//     gravações pelo Executor (trilha, outbox e idempotência na mesma transação);
//   - `memoria`: a sessão sintética de dev/ci (E2E), com plano, regras e fatos SINTÉTICOS;
//   - indisponível: fora de dev/ci sem o núcleo, 503 em tudo (falha fechada).
import type {
  ArquivoSpedRegistrado,
  DiarioPorta,
  EmpresaSped,
  FiltroSomasPorta,
  LancamentoDoDiario,
  NovoArquivoSped,
  PedidoSituacaoArquivoSped,
  SomaConta,
  PedidoAlteracaoConta,
  ConciliacaoRegistrada,
  PedidoConciliacao,
  DadosDoEncerramento,
  PedidoDesfazerConciliacao,
  PedidoEncerramento,
  FiltroLancamentosPorta,
  FiltroRazaoPorta,
  LancamentoRegistrado,
  LancamentoParaGravar,
  PartidaRegistrada,
  PartidaPendente,
  PeriodoRegistrado,
  PedidoReabertura,
  ContaPlanoVersionada,
  EstadoFonteFatos,
  FatoRegistrado,
  FiltroFatosPorta,
  FiltroRegrasPorta,
  PedidoInclusaoConta,
  ItemDePara,
  PedidoPublicacaoRegra,
  ReferenciasContabeis,
  RegraPublicada,
  ResumoFonteFatos,
  PedidoSituacaoFato,
} from './tipos.js';
import type { ContextoNucleo } from '@sgh/nucleo';
import type { TrilhaDaGravacao } from '../exames/public-api.js';
import type { PartidaGerada, SituacaoFato, TipoLancamento } from '@sgh/contratos';

export const PORTA_CONTABIL = Symbol('PORTA_CONTABIL');

/** O contexto do núcleo (cliente, estabelecimento, usuário e correlação por id) com a rede e o código da sessão. */
export interface ContextoContabil extends ContextoNucleo {
  readonly rede: string;
  readonly hospital: string;
  /** Idempotency-Key do pedido de gravação (com a ordem da gravação na requisição), quando a tela manda. */
  readonly chaveIdempotencia?: string;
  /** A sessão pode gravar no plano de contas compartilhado pela rede (permissão `contabil.plano.rede`). */
  readonly gravaPlanoDaRede?: boolean;
}

/** O pedido da tela que a gravação atende: a operação (`contabil.incluirConta` etc.) e o corpo, sem a senha. */
export interface PedidoDeGravacao {
  readonly operacao: string;
  readonly pedido: unknown;
}

type SemHospital<T> = Omit<T, 'hospital'>;

/** O que a gravação da contabilidade faz dentro da transação (com a trilha junto). */
export interface GravadorContabil {
  incluirConta(c: SemHospital<PedidoInclusaoConta>): Promise<{ id: number; versao: number }>;
  alterarConta(a: SemHospital<PedidoAlteracaoConta>): Promise<{ antes: ContaPlanoVersionada; versao: number }>;
  publicarRegra(p: SemHospital<PedidoPublicacaoRegra>): Promise<{ id: number; versao: number }>;
  marcarSituacao(s: SemHospital<PedidoSituacaoFato>): Promise<boolean>;
  // Etapa 2 (F2): lançamento (período travado), encerramento e reabertura, conciliação.
  gravarLancamento(l: LancamentoParaGravar, usuario: string): Promise<{ id: number; repetido: boolean }>;
  encerrarPeriodo(x: SemHospital<PedidoEncerramento>): Promise<DadosDoEncerramento>;
  reabrirPeriodo(x: SemHospital<PedidoReabertura>): Promise<PeriodoRegistrado>;
  conciliar(x: SemHospital<PedidoConciliacao>): Promise<{ id: number; valor: number }>;
  desfazerConciliacao(x: SemHospital<PedidoDesfazerConciliacao>): Promise<ConciliacaoRegistrada>;
  // Etapa 3 (F3): o arquivo do SPED (a apuração do resultado é um `gravarLancamento` do tipo `apuracao`).
  gravarArquivoSped(
    x: SemHospital<NovoArquivoSped>,
  ): Promise<{ id: number; numero: number; substituidos: number }>;
  situacaoArquivoSped(x: SemHospital<PedidoSituacaoArquivoSped>): Promise<ArquivoSpedRegistrado>;
}

/** O que a contabilização dos fatos lê de uma vez (os candidatos, os fatos das linhas e os lançamentos deles). */
export interface LeituraParaContabilizar {
  readonly candidatos: readonly FatoRegistrado[];
  readonly registrados: readonly FatoRegistrado[];
  readonly lancamentos: ReadonlyMap<
    number,
    { id: number; idFato: number; partidas: PartidaGerada[]; estornadoPor: number | null }
  >;
  readonly restam: boolean;
}

/** O razão lido (saldo anterior, totais, a soma antes da página e os movimentos da página até o teto + 1). */
export interface RazaoLido {
  readonly anterior: { readonly debitos: number; readonly creditos: number };
  readonly totais: { readonly debitos: number; readonly creditos: number };
  readonly antesDaPagina: { readonly debitos: number; readonly creditos: number };
  readonly movimentos: readonly {
    lancamento: number;
    partida: number;
    data: string;
    tipo: TipoLancamento;
    historico: string;
    centroCusto: number | null;
    lado: 'D' | 'C';
    valorCentavos: number;
    conciliado: boolean;
  }[];
}

export interface PortaContabil {
  readonly destino: 'banco' | 'memoria';
  /** A data de hoje no relógio do banco (AAAA-MM-DD). */
  hoje(c: ContextoContabil): Promise<string>;
  referencias(c: ContextoContabil): Promise<ReferenciasContabeis>;
  dePara(c: ContextoContabil, empresa: number): Promise<ItemDePara[]>;
  empresas(c: ContextoContabil): Promise<number[]>;
  /** Centros de custo do estabelecimento (filtro do balancete). */
  centrosCusto(c: ContextoContabil): Promise<{ codigo: number; nome: string; ativo: boolean }[]>;
  plano(c: ContextoContabil, empresa: number): Promise<ContaPlanoVersionada[]>;
  regras(c: ContextoContabil, empresa: number, f: FiltroRegrasPorta): Promise<RegraPublicada[]>;
  fontes(c: ContextoContabil): Promise<EstadoFonteFatos[]>;
  resumoFatos(c: ContextoContabil): Promise<ResumoFonteFatos[]>;
  fatos(
    c: ContextoContabil,
    f: FiltroFatosPorta,
    pagina: number,
    tamanho: number,
  ): Promise<{ itens: FatoRegistrado[]; total: number }>;
  fatosDaCompetencia(
    c: ContextoContabil,
    empresa: number,
    competencia: string,
    teto: number,
  ): Promise<FatoRegistrado[]>;
  // Etapa 2 (F2)
  periodos(c: ContextoContabil, empresa: number): Promise<PeriodoRegistrado[]>;
  movimentoPorCompetencia(
    c: ContextoContabil,
    empresa: number,
  ): Promise<{ competencia: string; lancamentos: number; debitos: number; creditos: number }[]>;
  totaisDoPeriodo(
    c: ContextoContabil,
    empresa: number,
    competencia: string,
  ): Promise<{ tipo: TipoLancamento; lancamentos: number; debitos: number; creditos: number }[]>;
  fatosDoPeriodo(
    c: ContextoContabil,
    empresa: number,
    competencia: string,
  ): Promise<Partial<Record<SituacaoFato, number>>>;
  lancamentos(
    c: ContextoContabil,
    f: FiltroLancamentosPorta,
    pagina: number,
    tamanho: number,
  ): Promise<{ itens: LancamentoRegistrado[]; total: number }>;
  lancamento(c: ContextoContabil, id: number): Promise<(LancamentoRegistrado & { partidas: PartidaRegistrada[] }) | null>;
  /** As partidas dos lançamentos gravados dos fatos (o reprocessamento compara a derivação com elas). */
  lancamentosDosFatos(
    c: ContextoContabil,
    idsFato: readonly number[],
  ): Promise<ReadonlyMap<number, { readonly partidas: readonly PartidaGerada[] }>>;
  razao(c: ContextoContabil, f: FiltroRazaoPorta, teto: number, pagina?: number): Promise<RazaoLido>;
  pendentesConciliacao(
    c: ContextoContabil,
    empresa: number,
    conta: string,
    ate: string | null,
    teto: number,
  ): Promise<PartidaPendente[]>;
  conciliacoes(c: ContextoContabil, empresa: number, conta: string, teto: number): Promise<ConciliacaoRegistrada[]>;
  paraContabilizar(
    c: ContextoContabil,
    empresa: number,
    situacoes: readonly SituacaoFato[],
    competencia: string | null,
    lote: number,
  ): Promise<LeituraParaContabilizar>;
  // Etapa 3 (F3): demonstrações, apuração e SPED.
  somas(
    c: ContextoContabil,
    f: FiltroSomasPorta,
    teto: number,
  ): Promise<{ itens: SomaConta[]; parcial: boolean }>;
  apuracoes(
    c: ContextoContabil,
    empresa: number,
    exercicio: number,
  ): Promise<{ ativa: number | null; quantidade: number }>;
  diario(
    c: ContextoContabil,
    empresa: number,
    de: string,
    ate: string,
    teto: number,
    pagina: number,
  ): Promise<DiarioPorta>;
  lancamentosDoExercicio(
    c: ContextoContabil,
    empresa: number,
    exercicio: number,
    tetoPartidas: number,
  ): Promise<{ lancamentos: LancamentoDoDiario[]; parcial: boolean }>;
  /** Os dados cadastrais da empresa (só da empresa) para o SPED. */
  empresaSped(c: ContextoContabil, empresa: number): Promise<EmpresaSped | null>;
  arquivosSped(c: ContextoContabil, empresa: number, teto: number): Promise<ArquivoSpedRegistrado[]>;
  conteudoSped(
    c: ContextoContabil,
    empresa: number,
    id: number,
  ): Promise<(ArquivoSpedRegistrado & { conteudoCifrado: string }) | null>;
  /**
   * Grava pela operação `pedido.operacao`: a mesma Idempotency-Key com o mesmo pedido devolve o resultado anterior;
   * com outro pedido, recusa (idempotencia-divergente).
   */
  gravar<T>(
    c: ContextoContabil,
    pedido: PedidoDeGravacao,
    trilha: TrilhaDaGravacao | ((r: T) => TrilhaDaGravacao),
    fn: (g: GravadorContabil) => Promise<T>,
  ): Promise<T>;
}

export const METODOS_PORTA_CONTABIL: ReadonlySet<string> = new Set([
  'hoje',
  'referencias',
  'dePara',
  'empresas',
  'centrosCusto',
  'plano',
  'regras',
  'fontes',
  'resumoFatos',
  'fatos',
  'fatosDaCompetencia',
  'periodos',
  'movimentoPorCompetencia',
  'totaisDoPeriodo',
  'fatosDoPeriodo',
  'lancamentos',
  'lancamento',
  'lancamentosDosFatos',
  'razao',
  'pendentesConciliacao',
  'conciliacoes',
  'paraContabilizar',
  'somas',
  'apuracoes',
  'diario',
  'lancamentosDoExercicio',
  'empresaSped',
  'arquivosSped',
  'conteudoSped',
  'gravar',
]);
