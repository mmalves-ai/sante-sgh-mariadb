// Porta da contabilidade, etapa 1 (M54-F1): o que as telas do plano de contas, das regras e dos fatos leem e gravam,
// independente de onde (a API não escreve SQL; fronteira Nx):
//   - `legado`: as leituras de @sgh/legado em transação READ ONLY (domínios, de-para da exportação e as SGH_CTB_*) e
//     as gravações SGH_CTB_* numa transação SGH_ com a SGH_TRILHA junto (`somenteSgh` recusa escrita fora de SGH_); em
//     dev sobre a cópia compartilhada, as gravações são recusadas (`sghSoLeitura`), como nos outros módulos;
//   - `memoria`: a sessão sintética de dev/ci (E2E), com plano, regras e fatos SINTÉTICOS; nada vai à cópia;
//   - indisponível: fora de dev/ci sem o núcleo, 503 em tudo (falha fechada).
// Nenhuma tabela do banco anterior é escrita (regra 1: a contabilização só lê os fatos).
import type {
  ArquivoSpedLido,
  DiarioLido,
  EmpresaSpedLida,
  FiltroSomasSgh,
  LancamentoDiarioLido,
  NovoArquivoSpedSgh,
  SituacaoArquivoSpedSgh,
  SomaContaLida,
  AlteracaoContaSgh,
  ConciliacaoLida,
  ConciliacaoSgh,
  DadosDoEncerramento,
  DesfazerConciliacaoSgh,
  EncerramentoSgh,
  FiltroLancamentosSgh,
  FiltroRazaoSgh,
  LancamentoLido,
  LancamentoSgh,
  PartidaLida,
  PartidaPendenteLida,
  PeriodoLido,
  ReaberturaSgh,
  ContaPlanoLida,
  EstadoFonteLido,
  FatoRegistradoLido,
  FiltroFatosSgh,
  FiltroRegrasSgh,
  InclusaoContaSgh,
  ItemDeParaLido,
  LinhaTrilha,
  PublicacaoRegraSgh,
  ReferenciaContabilLida,
  RegraPublicadaLida,
  ResumoFonteFatosLido,
  SituacaoFatoSgh,
} from '@sgh/legado';
import type { PartidaGerada, SituacaoFato, TipoLancamento } from '@sgh/contratos';

export const PORTA_CONTABIL = Symbol('PORTA_CONTABIL');

export interface ContextoContabil {
  readonly rede: string;
  readonly hospital: string;
}

type SemHospital<T> = Omit<T, 'hospital'>;

/** O que a gravação SGH_ da contabilidade faz dentro da transação (com a trilha junto). */
export interface GravadorContabil {
  incluirConta(c: SemHospital<InclusaoContaSgh>): Promise<{ versao: number }>;
  alterarConta(a: SemHospital<AlteracaoContaSgh>): Promise<{ antes: ContaPlanoLida; versao: number }>;
  publicarRegra(p: SemHospital<PublicacaoRegraSgh>): Promise<{ id: number; versao: number }>;
  marcarSituacao(s: SemHospital<SituacaoFatoSgh>): Promise<boolean>;
  // Etapa 2 (F2): lançamento (período travado), encerramento e reabertura, conciliação.
  gravarLancamento(l: LancamentoSgh, usuario: string): Promise<{ id: number; repetido: boolean }>;
  encerrarPeriodo(x: SemHospital<EncerramentoSgh>): Promise<DadosDoEncerramento>;
  reabrirPeriodo(x: SemHospital<ReaberturaSgh>): Promise<PeriodoLido>;
  conciliar(x: SemHospital<ConciliacaoSgh>): Promise<{ id: number; valor: number }>;
  desfazerConciliacao(x: SemHospital<DesfazerConciliacaoSgh>): Promise<ConciliacaoLida>;
  // Etapa 3 (F3): o arquivo do SPED (a apuração do resultado é um `gravarLancamento` do tipo `apuracao`).
  gravarArquivoSped(
    x: SemHospital<NovoArquivoSpedSgh>,
  ): Promise<{ id: number; numero: number; substituidos: number }>;
  situacaoArquivoSped(x: SemHospital<SituacaoArquivoSpedSgh>): Promise<ArquivoSpedLido>;
}

/** O que a contabilização dos fatos lê de uma vez (os candidatos, os fatos das linhas e os lançamentos deles). */
export interface LeituraParaContabilizar {
  readonly candidatos: readonly FatoRegistradoLido[];
  readonly registrados: readonly FatoRegistradoLido[];
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
  readonly destino: 'legado' | 'memoria';
  /** A data de hoje no relógio do banco (AAAA-MM-DD). */
  hoje(c: ContextoContabil): Promise<string>;
  referencias(c: ContextoContabil): Promise<ReferenciaContabilLida>;
  dePara(c: ContextoContabil, empresa: number): Promise<ItemDeParaLido[]>;
  empresas(c: ContextoContabil): Promise<number[]>;
  /** Centros de custo do estabelecimento (filtro do balancete). */
  centrosCusto(c: ContextoContabil): Promise<{ codigo: number; nome: string; ativo: boolean }[]>;
  plano(c: ContextoContabil, empresa: number): Promise<ContaPlanoLida[]>;
  regras(c: ContextoContabil, empresa: number, f: FiltroRegrasSgh): Promise<RegraPublicadaLida[]>;
  fontes(c: ContextoContabil): Promise<EstadoFonteLido[]>;
  resumoFatos(c: ContextoContabil): Promise<ResumoFonteFatosLido[]>;
  fatos(
    c: ContextoContabil,
    f: FiltroFatosSgh,
    pagina: number,
    tamanho: number,
  ): Promise<{ itens: FatoRegistradoLido[]; total: number }>;
  fatosDaCompetencia(
    c: ContextoContabil,
    empresa: number,
    competencia: string,
    teto: number,
  ): Promise<FatoRegistradoLido[]>;
  // Etapa 2 (F2)
  periodos(c: ContextoContabil, empresa: number): Promise<PeriodoLido[]>;
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
    f: FiltroLancamentosSgh,
    pagina: number,
    tamanho: number,
  ): Promise<{ itens: LancamentoLido[]; total: number }>;
  lancamento(c: ContextoContabil, id: number): Promise<(LancamentoLido & { partidas: PartidaLida[] }) | null>;
  /** As partidas dos lançamentos gravados dos fatos (o reprocessamento compara a derivação com elas). */
  lancamentosDosFatos(
    c: ContextoContabil,
    idsFato: readonly number[],
  ): Promise<ReadonlyMap<number, { readonly partidas: readonly PartidaGerada[] }>>;
  razao(c: ContextoContabil, f: FiltroRazaoSgh, teto: number, pagina?: number): Promise<RazaoLido>;
  pendentesConciliacao(
    c: ContextoContabil,
    empresa: number,
    conta: string,
    ate: string | null,
    teto: number,
  ): Promise<PartidaPendenteLida[]>;
  conciliacoes(c: ContextoContabil, empresa: number, conta: string, teto: number): Promise<ConciliacaoLida[]>;
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
    f: FiltroSomasSgh,
    teto: number,
  ): Promise<{ itens: SomaContaLida[]; parcial: boolean }>;
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
  ): Promise<DiarioLido>;
  lancamentosDoExercicio(
    c: ContextoContabil,
    empresa: number,
    exercicio: number,
    tetoPartidas: number,
  ): Promise<{ lancamentos: LancamentoDiarioLido[]; parcial: boolean }>;
  /** Os dados cadastrais da empresa (só da empresa) para o SPED. */
  empresaSped(c: ContextoContabil, empresa: number): Promise<EmpresaSpedLida | null>;
  arquivosSped(c: ContextoContabil, empresa: number, teto: number): Promise<ArquivoSpedLido[]>;
  conteudoSped(
    c: ContextoContabil,
    empresa: number,
    id: number,
  ): Promise<(ArquivoSpedLido & { conteudoCifrado: string }) | null>;
  gravarSgh<T>(
    c: ContextoContabil,
    trilha: LinhaTrilha | ((r: T) => LinhaTrilha),
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
  'gravarSgh',
]);
