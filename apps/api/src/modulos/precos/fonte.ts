// Fonte do M12 na API (convênios, contratos, tabelas de preço, importação e motor de preços): onde as leituras
// e as gravações acontecem.
//   - `legado`: o núcleo do legado (READ ONLY nas leituras; gravação no legado só pelo EXECUTOR do M04, com
//     as receitas do M12; SGH_ de carga e plano pela transação SGH_ do núcleo, com a trilha junto);
//   - `memoria`: a sessão sintética de dev/ci (E2E e testes HTTP): os mesmos contratos e as mesmas regras
//     puras (@sgh/dominio-preco) sobre dados sintéticos em memória (fonte-memoria.ts). Nada vai à cópia;
//   - `indisponivel`: fora de dev/ci sem o núcleo: 503 em tudo, nunca a memória.
// Em dev com ACESSO_FONTE_DEV=copia (o dono, com os usuários reais do SPDATA), a leitura é da cópia e a
// GRAVAÇÃO fica recusada com o motivo na tela: gravar com COMMIT na cópia compartilhada fora da trava (e da
// conferência no SPDATA) não é caminho de tela (ADR 0021, decisão 20; D15 e D29 do M08).
import type { DesfazerReajusteEntrada, EstadoOperacao } from '@sgh/contratos';
import {
  type AlteracaoPlano,
  alterarPlanoConvenio,
  autoriaDoItem,
  type AutoriaLida,
  type CabecalhoTabela,
  type CargaLida,
  codigosPrestador,
  credenciamento,
  credenciamentoAtos,
  credenciamentoComplementar,
  deParaExames,
  edicoesBrasindice,
  type Executor,
  type FiltroConvenio,
  preConferirDesfazer,
  type VigenciaValorLida,
  vigenciasDiaria,
  vigenciasMatmed,
  type FonteCatalogo,
  gravarCarga,
  gravarPlanoConvenio,
  hojeNoBanco,
  type ImpactoSituacaoLido,
  type IndiceLido,
  indicesNaData,
  type ItemDiariaLido,
  type ItemHonorarioLido,
  type ItemMatmedLido,
  type ItemParaReajusteLido,
  itemDiariaNaData,
  itemHonorarioNaData,
  itemMatmedNaData,
  itensDiaria,
  itensHonorario,
  itensMatmed,
  itensParaReajuste,
  lerCarga,
  lerConvenio,
  lerHistoricoConvenio,
  lerImpactoSituacao,
  lerIndicesConvenio,
  lerModificadores,
  lerOpcoesClassificacao,
  lerPlanosConvenio,
  lerTissConvenio,
  lerValoresContrato,
  lerVigenciasTabelas,
  type LinhaCargaLida,
  type LinhaDoLote,
  linhasDaCarga,
  linhasDoLote,
  listarCabecalhos,
  listarCargas,
  listarConvenios,
  type Leitor,
  type LinhaTrilha,
  type LoteLido,
  lotesDeReajuste,
  type MetricasExecutor,
  mudarSituacaoCarga,
  type NovaCarga,
  type NovoPlano,
  type NucleoLegado,
  type Pagina,
  type PaginaLida,
  type PlanoLido,
  perfisDasTabelasHonorario,
  porteNaData,
  portesAnestesicos,
  procedimentosUnimed,
  referenciaTerceiros,
  regrasComDataSuspeita,
  type RegraDatadaLida,
  tabelasDeTerceiros,
  type TipoModificador,
  type TissLido,
  type ConvenioLido,
  type VigenciaLida,
  type VigenciaTabelaLida,
  vigenciasDoItem,
} from '@sgh/legado';
import { ErroProblema } from '../../problema.filter.js';

export const FONTE_PRECOS = Symbol('FONTE_PRECOS');

export interface CtxPrecos {
  readonly rede: string;
  readonly hospital: string;
  readonly traceId: string;
}

export interface FiltroPagina {
  readonly busca?: string;
  readonly pagina: number;
  readonly porPagina: number;
  readonly data: string;
}

/** Tudo o que as telas do M12 leem e gravam (as duas fontes implementam). */
export interface FontePrecos {
  readonly destino: 'legado' | 'memoria';
  /** Gravação permitida nesta fonte e ambiente (falso: o motivo vai para a tela). */
  readonly gravacao: { readonly permitida: boolean; readonly motivo: string | null };
  estado(operacao: string, hospital: string): EstadoOperacao | null;
  readonly executor: Executor;
  hoje(c: CtxPrecos): Promise<string>;
  convenios(c: CtxPrecos): Promise<ConvenioLido[]>;
  convenio(c: CtxPrecos, cod: number): Promise<ConvenioLido | null>;
  valoresContrato(
    c: CtxPrecos,
    cod: number,
  ): Promise<Readonly<Record<string, string | number | null>> | null>;
  opcoesClassificacao(c: CtxPrecos): Promise<{ valor: string; rotulo: string }[]>;
  vigenciasTabelas(c: CtxPrecos, cod: number): Promise<VigenciaTabelaLida[]>;
  indicesConvenio(c: CtxPrecos, cod: number): Promise<IndiceLido[]>;
  tiss(c: CtxPrecos, cod: number): Promise<TissLido>;
  historico(
    c: CtxPrecos,
    cod: number,
  ): Promise<{ quando: string; nome: string; classificacao: number | null }[]>;
  planos(c: CtxPrecos, cod: number): Promise<PlanoLido[] | null>;
  modificadores(
    c: CtxPrecos,
    tipo: TipoModificador,
    cod: number,
    pagina: number,
    porPagina: number,
  ): Promise<PaginaLida>;
  impactoSituacao(c: CtxPrecos, cod: number): Promise<ImpactoSituacaoLido>;
  cabecalhos(c: CtxPrecos, tipo: 'honorarios' | 'diarias' | 'matmed'): Promise<CabecalhoTabela[]>;
  perfisHonorario(c: CtxPrecos): Promise<Map<number, { itens: number; comCh: number; comPorte: number }>>;
  itensHonorario(
    c: CtxPrecos,
    tab: number,
    f: FiltroPagina,
  ): Promise<{ itens: ItemHonorarioLido[]; total: number }>;
  itemHonorario(c: CtxPrecos, tab: number, cod: number, data: string): Promise<ItemHonorarioLido | null>;
  itensParaReajuste(
    c: CtxPrecos,
    tab: number,
    codigos: readonly number[] | null,
    data: string,
    teto: number,
  ): Promise<ItemParaReajusteLido[]>;
  vigenciasDoItem(c: CtxPrecos, tab: number, cod: number): Promise<VigenciaLida[]>;
  autoriaDoItem(c: CtxPrecos, tab: number, cod: number): Promise<AutoriaLida[] | null>;
  lotes(c: CtxPrecos, tab: number | null): Promise<LoteLido[] | null>;
  linhasDoLote(c: CtxPrecos, lote: string): Promise<LinhaDoLote[]>;
  itensDiaria(
    c: CtxPrecos,
    tab: number,
    f: FiltroPagina,
  ): Promise<{ itens: ItemDiariaLido[]; total: number }>;
  itemDiaria(c: CtxPrecos, tab: number, ope: number, data: string): Promise<ItemDiariaLido | null>;
  itensMatmed(
    c: CtxPrecos,
    tab: number,
    f: FiltroPagina,
  ): Promise<{ itens: ItemMatmedLido[]; total: number }>;
  itemMatmed(c: CtxPrecos, tab: number, cod: number, data: string): Promise<ItemMatmedLido | null>;
  vigenciasDiaria(c: CtxPrecos, tab: number, ope: number): Promise<VigenciaValorLida[]>;
  vigenciasMatmed(c: CtxPrecos, tab: number, cod: number): Promise<VigenciaValorLida[]>;
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
  saneamento(c: CtxPrecos): Promise<RegraDatadaLida[]>;
  cargas(c: CtxPrecos, catalogo: string): Promise<CargaLida[] | null>;
  carga(c: CtxPrecos, id: number): Promise<CargaLida | null>;
  linhasDaCarga(
    c: CtxPrecos,
    id: number,
    pagina: number,
    porPagina: number,
    comparacao: string | null,
  ): Promise<{ itens: LinhaCargaLida[]; total: number }>;
  gravarCarga(
    c: CtxPrecos,
    nova: NovaCarga,
    trilha: Omit<LinhaTrilha, 'tabelaAlvo' | 'idAlvo'>,
  ): Promise<{ id: number }>;
  mudarSituacaoCarga(
    c: CtxPrecos,
    m: Parameters<typeof mudarSituacaoCarga>[1],
    trilha: Omit<LinhaTrilha, 'tabelaAlvo' | 'idAlvo'>,
  ): Promise<void>;
  gravarPlano(
    c: CtxPrecos,
    p: NovoPlano,
    trilha: Omit<LinhaTrilha, 'tabelaAlvo' | 'idAlvo'>,
  ): Promise<{ id: number }>;
  /** Pré-conferência (só leitura) de todas as partes do desfazer, antes da primeira exclusão. */
  preConferirDesfazer(c: CtxPrecos, partes: readonly DesfazerReajusteEntrada[]): Promise<void>;
  alterarPlano(
    c: CtxPrecos,
    a: AlteracaoPlano,
    trilha: Omit<LinhaTrilha, 'tabelaAlvo' | 'idAlvo'>,
  ): Promise<{ id: number; versao: number }>;
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

export function fontePrecosLegado(
  nucleo: NucleoLegado,
  catalogo: FonteCatalogo,
  opcoes: {
    readonly metricas?: MetricasExecutor;
    readonly gravacaoPermitida: boolean;
    readonly motivoSemGravacao?: string;
  },
): FontePrecos {
  const executor = nucleo.criarExecutor({
    catalogo,
    ...(opcoes.metricas ? { metricas: opcoes.metricas } : {}),
  });
  const ler = <T>(c: CtxPrecos, fn: (l: Leitor) => Promise<T>): Promise<T> => nucleo.lerSomente(c, fn);
  const recusarSemGravacao = () => {
    if (!opcoes.gravacaoPermitida)
      throw new ErroProblema(
        'operacao-bloqueada',
        409,
        'Gravação desligada',
        opcoes.motivoSemGravacao ?? undefined,
      );
  };
  return {
    destino: 'legado',
    gravacao: {
      permitida: opcoes.gravacaoPermitida,
      motivo: opcoes.gravacaoPermitida ? null : (opcoes.motivoSemGravacao ?? null),
    },
    estado: (op, h) => catalogo.estado(op, h),
    executor,
    hoje: (c) => ler(c, (l) => hojeNoBanco(l)),
    convenios: (c) => ler(c, (l) => listarConvenios(l)),
    convenio: (c, cod) => ler(c, (l) => lerConvenio(l, cod)),
    valoresContrato: (c, cod) => ler(c, (l) => lerValoresContrato(l, cod)),
    opcoesClassificacao: (c) => ler(c, (l) => lerOpcoesClassificacao(l)),
    vigenciasTabelas: (c, cod) => ler(c, (l) => lerVigenciasTabelas(l, cod)),
    indicesConvenio: (c, cod) => ler(c, (l) => lerIndicesConvenio(l, cod)),
    tiss: (c, cod) => ler(c, (l) => lerTissConvenio(l, cod)),
    historico: (c, cod) => ler(c, (l) => lerHistoricoConvenio(l, cod)),
    planos: (c, cod) => ler(c, (l) => lerPlanosConvenio(l, c.hospital, cod)),
    modificadores: (c, tipo, cod, p, n) => ler(c, (l) => lerModificadores(l, tipo, cod, p, n)),
    impactoSituacao: (c, cod) => ler(c, (l) => lerImpactoSituacao(l, cod)),
    cabecalhos: (c, tipo) => ler(c, (l) => listarCabecalhos(l, tipo)),
    perfisHonorario: (c) => ler(c, (l) => perfisDasTabelasHonorario(l)),
    itensHonorario: (c, tab, f) => ler(c, (l) => itensHonorario(l, tab, f)),
    itemHonorario: (c, tab, cod, d) => ler(c, (l) => itemHonorarioNaData(l, tab, cod, d)),
    itensParaReajuste: (c, tab, cods, d, teto) => ler(c, (l) => itensParaReajuste(l, tab, cods, d, teto)),
    vigenciasDoItem: (c, tab, cod) => ler(c, (l) => vigenciasDoItem(l, tab, cod)),
    autoriaDoItem: (c, tab, cod) => ler(c, (l) => autoriaDoItem(l, c.hospital, tab, cod)),
    lotes: (c, tab) => ler(c, (l) => lotesDeReajuste(l, c.hospital, tab)),
    linhasDoLote: (c, lote) => ler(c, (l) => linhasDoLote(l, c.hospital, lote)),
    itensDiaria: (c, tab, f) => ler(c, (l) => itensDiaria(l, tab, f)),
    itemDiaria: (c, tab, ope, d) => ler(c, (l) => itemDiariaNaData(l, tab, ope, d)),
    itensMatmed: (c, tab, f) => ler(c, (l) => itensMatmed(l, tab, f)),
    itemMatmed: (c, tab, cod, d) => ler(c, (l) => itemMatmedNaData(l, tab, cod, d)),
    vigenciasDiaria: (c, tab, ope) => ler(c, (l) => vigenciasDiaria(l, tab, ope)),
    vigenciasMatmed: (c, tab, cod) => ler(c, (l) => vigenciasMatmed(l, tab, cod)),
    edicoes: (c) => ler(c, (l) => edicoesBrasindice(l)),
    indicesNaData: (c, conv, d) => ler(c, (l) => indicesNaData(l, conv, d)),
    porteNaData: (c, conv, porte, d) => ler(c, (l) => porteNaData(l, conv, porte, d)),
    credenciamento: (c, conv, p, n, b, prof) =>
      ler(c, (l) =>
        credenciamento(l, {
          convenio: conv,
          pagina: p,
          porPagina: n,
          bancario: b,
          profissional: prof ?? null,
        }),
      ),
    credenciamentoAtos: (c, conv, b) =>
      ler(c, (l) => credenciamentoAtos(l, { convenio: conv, pagina: 0, porPagina: 500, bancario: b })),
    credenciamentoComplementar: (c, conv, prof) =>
      ler(c, (l) => credenciamentoComplementar(l, conv, prof ?? null)),
    codigosPrestador: (c, conv, p, n) =>
      ler(c, (l) => codigosPrestador(l, { convenio: conv, pagina: p, porPagina: n })),
    dePara: (c, conv, ex, p, n) =>
      ler(c, (l) => deParaExames(l, { convenio: conv, exame: ex, pagina: p, porPagina: n })),
    portes: (c, tab, p, n) => ler(c, (l) => portesAnestesicos(l, { tabela: tab, pagina: p, porPagina: n })),
    terceiros: (c, tab, b, p, n) =>
      ler(c, (l) => referenciaTerceiros(l, { tabela: tab, busca: b, pagina: p, porPagina: n })),
    tabelasTerceiros: (c) => ler(c, (l) => tabelasDeTerceiros(l)),
    unimed: (c, b, p, n) => ler(c, (l) => procedimentosUnimed(l, { busca: b, pagina: p, porPagina: n })),
    saneamento: (c) => ler(c, (l) => regrasComDataSuspeita(l)),
    cargas: (c, cat) => ler(c, (l) => listarCargas(l, c.hospital, cat)),
    carga: (c, id) => ler(c, (l) => lerCarga(l, c.hospital, id)),
    linhasDaCarga: (c, id, p, n, cmp) =>
      ler(c, (l) => linhasDaCarga(l, id, { pagina: p, porPagina: n, comparacao: cmp })),
    async gravarCarga(c, nova, trilha) {
      recusarSemGravacao();
      return nucleo.gravarSgh(c, (e) => gravarCarga(e, nova, trilha));
    },
    async mudarSituacaoCarga(c, m, trilha) {
      recusarSemGravacao();
      await nucleo.gravarSgh(c, (e) => mudarSituacaoCarga(e, m, trilha));
    },
    async gravarPlano(c, p, trilha) {
      recusarSemGravacao();
      return nucleo.gravarSgh(c, (e) => gravarPlanoConvenio(e, p, trilha));
    },
    preConferirDesfazer: (c, partes) => ler(c, (l) => preConferirDesfazer(l, c.hospital, partes)),
    async alterarPlano(c, a, trilha) {
      recusarSemGravacao();
      return nucleo.gravarSgh(c, (e) => alterarPlanoConvenio(e, a, trilha));
    },
  };
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
    destino: 'legado',
    gravacao: { permitida: false, motivo: 'Banco do estabelecimento indisponível.' },
    estado: () => null,
    executor: { executar: recusar } as unknown as Executor,
    ...Object.fromEntries(METODOS.map((m) => [m, recusar])),
  } as unknown as FontePrecos;
}
