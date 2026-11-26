// Tipos de negócio da porta da contabilidade (F2.2, lote 04-01): o que a porta lê e grava, em vocabulário neutro
// (id numérico, data ISO AAAA-MM-DD, competência AAAA-MM, valores em centavos, booleanos). A "empresa" das telas é o
// estabelecimento da sessão (estabelecimento.id): a contabilidade do modelo próprio é por estabelecimento.
// Melhoria: os pedidos de gravação não levam o código do hospital (o estabelecimento vem do contexto do núcleo).
import type {
  ContaPlano,
  ImpedimentoEncerramento,
  LadoPartida,
  OrigemLancamento,
  RegraContabil,
  SituacaoArquivoSped,
  SituacaoConciliacao,
  SituacaoFato,
  TipoArquivoSped,
  TipoFato,
  TipoLancamento,
} from '@sgh/contratos';
import type { gerarXlsx } from '../relatorio/public-api.js';

import type { PeriodoRegistrado } from '@sgh/persistencia-contabil';

// As formas que a persistência comum da contabilidade lê e grava (as mesmas do worker).
export type {
  ContaPlanoVersionada,
  FatoRegistrado,
  ItemDePara,
  LancamentoParaGravar,
  PartidaRegistrada,
  PedidoSituacaoFato,
  PeriodoRegistrado,
  RegraPublicada,
} from '@sgh/persistencia-contabil';

/** Linha de planilha exportada (a mesma do gerador de XLSX do relatório). */
export type LinhaRelatorio = Parameters<typeof gerarXlsx>[0]['linhas'][number];

export interface FiltroLancamentosPorta {
  readonly empresa: number;
  readonly competencia?: string;
  readonly tipo?: TipoLancamento;
  readonly conta?: string;
}

export interface FiltroSomasPorta {
  readonly empresa: number;
  /** Data inicial (inclusive); nula = desde o começo. */
  readonly de: string | null;
  /** Data final (inclusive). */
  readonly ate: string;
  readonly centroCusto?: number | null;
  /** Sem o lançamento de apuração e o estorno dele (a DRE). */
  readonly semApuracao?: boolean;
  /** Separa por centro de custo (a apuração zera conta por conta e centro por centro). */
  readonly porCentro?: boolean;
}

export interface ArquivoSpedRegistrado {
  readonly id: number;
  readonly empresa: number;
  readonly tipo: TipoArquivoSped;
  readonly exercicio: number;
  readonly numero: number;
  readonly situacao: SituacaoArquivoSped;
  readonly leiaute: string;
  readonly leiauteConferido: boolean;
  readonly substituta: boolean;
  readonly nomeArquivo: string;
  readonly tamanho: number;
  readonly linhas: number;
  readonly hash: string;
  readonly parametros: string;
  readonly geradoPor: string;
  readonly geradoEm: string;
  readonly recibo: string | null;
  readonly transmitidoEm: string | null;
  readonly motivo: string | null;
}

export interface FiltroRazaoPorta {
  readonly empresa: number;
  readonly conta: string;
  readonly de: string;
  readonly ate: string;
  readonly centroCusto?: number;
}

export interface LancamentoRegistrado {
  readonly id: number;
  readonly empresa: number;
  readonly chave: string;
  readonly tipo: TipoLancamento;
  readonly data: string;
  readonly competencia: string;
  readonly historico: string;
  readonly debitos: number;
  readonly creditos: number;
  readonly fatoId: number | null;
  readonly regraId: number | null;
  readonly regra: { readonly nome: string; readonly versao: number } | null;
  readonly estornaId: number | null;
  readonly estornadoPor: number | null;
  readonly justificativa: string | null;
  readonly criadoPor: string;
  readonly criadoEm: string;
  /** Do fato de origem (lançamento automático ou estorno de fato). */
  readonly fato: {
    readonly tabela: string;
    readonly tipo: TipoFato;
    readonly origem: OrigemLancamento;
    readonly documento: string;
    readonly data: string;
  } | null;
}

export interface ConciliacaoRegistrada {
  readonly id: number;
  readonly empresa: number;
  readonly conta: string;
  readonly situacao: SituacaoConciliacao;
  readonly partidas: number;
  readonly valorCentavos: number;
  readonly observacao: string | null;
  readonly criadaPor: string;
  readonly criadaEm: string;
  readonly desfeitaPor: string | null;
  readonly desfeitaEm: string | null;
}

export interface PartidaParaConciliacao {
  readonly id: number;
  readonly empresa: number;
  readonly conta: string;
  readonly lado: LadoPartida;
  readonly valorCentavos: number;
  readonly conciliacao: number | null;
}

export interface PedidoConciliacao {
  readonly empresa: number;
  readonly conta: string;
  readonly partidas: readonly number[];
  readonly observacao: string | null;
  readonly usuario: string;
  /** problemasDaConciliacao do domínio sobre as partidas lidas na transação: vazio = concilia. */
  readonly conferir: (achadas: readonly PartidaParaConciliacao[]) => readonly string[];
}

export interface DadosDoEncerramento {
  readonly periodo: PeriodoRegistrado;
  readonly fatos: Partial<Record<SituacaoFato, number>>;
  readonly lancamentos: number;
  readonly debitos: number;
  readonly creditos: number;
  /** A competência anterior aberta com movimento (lançamento ou fato), ou nula. */
  readonly anteriorAbertaComMovimento: string | null;
}

export interface PedidoDesfazerConciliacao {
  readonly empresa: number;
  readonly id: number;
  readonly justificativa: string;
  readonly usuario: string;
}

export interface PartidaDoDiario {
  readonly lancamento: number;
  readonly lado: LadoPartida;
  readonly conta: string;
  readonly valorCentavos: number;
  readonly centroCusto: number | null;
  readonly historico: string;
}

export interface LancamentoDoDiario {
  readonly id: number;
  readonly data: string;
  readonly tipo: TipoLancamento;
  readonly historico: string;
  readonly debitos: number;
  readonly creditos: number;
  readonly estornaId: number | null;
  /** O lançamento é de encerramento: a apuração ou o estorno de uma apuração. */
  readonly encerramento: boolean;
  readonly partidas: PartidaDoDiario[];
}

export interface DiarioPorta {
  readonly lancamentos: LancamentoDoDiario[];
  readonly porTipo: { tipo: TipoLancamento; lancamentos: number; debitos: number; creditos: number }[];
  readonly parcial: boolean;
}

export interface EmpresaSped {
  readonly codigo: number;
  readonly nome: string;
  readonly cnpj: string | null;
  readonly uf: string | null;
  readonly inscricaoEstadual: string | null;
  readonly codigoMunicipio: string | null;
  readonly municipio: string | null;
  readonly inscricaoMunicipal: string | null;
  readonly nire: string | null;
  readonly dataNire: string | null;
  readonly endereco: string | null;
  readonly numero: string | null;
  readonly complemento: string | null;
  readonly bairro: string | null;
  readonly cep: string | null;
  readonly telefone: string | null;
  readonly email: string | null;
  readonly cnae: string | null;
  /** Natureza jurídica (ECF 0030), só os dígitos. */
  readonly naturezaJuridica?: string | null;
}

export interface PedidoEncerramento {
  readonly empresa: number;
  readonly competencia: string;
  readonly observacao: string | null;
  readonly usuario: string;
  /** As regras do domínio (impedimentosDoEncerramento): vazio = encerra. */
  readonly conferir: (d: DadosDoEncerramento) => readonly ImpedimentoEncerramento[];
}

/** Estado de uma fonte de fatos (a entidade de origem que publica fatos contábeis). */
export interface EstadoFonteFatos {
  readonly tabela: string;
  readonly marca: number;
  readonly varredura: number;
  readonly ultimaLeitura: string | null;
  readonly lidosNovos: number;
  readonly lidosAlterados: number;
  readonly fatosGravados: number;
  readonly versao: number;
}

export interface FiltroFatosPorta {
  readonly empresa?: number;
  readonly competencia?: string;
  readonly origem?: OrigemLancamento;
  readonly tipoFato?: TipoFato;
  readonly situacao?: SituacaoFato;
}

export interface NovoArquivoSped {
  readonly empresa: number;
  readonly tipo: TipoArquivoSped;
  readonly exercicio: number;
  readonly leiaute: string;
  readonly substituta: boolean;
  readonly nomeArquivo: string;
  readonly conteudoCifrado: string;
  readonly tamanho: number;
  readonly linhas: number;
  readonly hash: string;
  /** JSON dos parâmetros da geração, sem dado de pessoa. */
  readonly parametros: string;
  readonly usuario: string;
}

export interface PartidaPendente {
  readonly id: number;
  readonly lancamento: number;
  readonly data: string;
  readonly lado: LadoPartida;
  readonly valorCentavos: number;
  readonly historico: string;
  readonly centroCusto: number | null;
}

export interface PedidoReabertura {
  readonly empresa: number;
  readonly competencia: string;
  readonly justificativa: string;
  readonly usuario: string;
  /** recusaDaReabertura do domínio sobre os períodos lidos na transação: nula = reabre. */
  readonly conferir: (periodos: readonly PeriodoRegistrado[]) => string | null;
}

export interface ReferenciasContabeis {
  readonly origens: { readonly id: number; readonly descricao: string }[];
  readonly tiposPlanoReferencial: {
    readonly id: number;
    readonly codigo: string;
    readonly descricao: string;
    readonly ecf: boolean;
  }[];
}

export interface ResumoFonteFatos {
  readonly tabela: string;
  readonly porSituacao: Readonly<Partial<Record<SituacaoFato, number>>>;
}

export interface PedidoSituacaoArquivoSped {
  readonly empresa: number;
  readonly id: number;
  readonly acao: 'recibo' | 'cancelar';
  readonly recibo: string | null;
  readonly transmitidoEm: string | null;
  readonly motivo: string | null;
  readonly usuario: string;
}

export interface SomaConta {
  readonly conta: string;
  readonly centroCusto: number | null;
  readonly debitos: number;
  readonly creditos: number;
}

export interface PedidoAlteracaoConta {
  readonly empresa: number;
  readonly codigo: string;
  readonly versao: number;
  /** A conta inteira depois da alteração (o código, o grupo, o tipo e a natureza não mudam: vêm da conta lida). */
  readonly depois: ContaPlano;
  readonly usuario: string;
}

export interface FiltroRegrasPorta {
  readonly origem?: OrigemLancamento;
  readonly tipoFato?: TipoFato;
}

export interface PedidoInclusaoConta {
  readonly conta: ContaPlano;
  readonly usuario: string;
}

export interface PedidoPublicacaoRegra {
  readonly regra: RegraContabil;
  /** A forma canônica (`conteudoCanonicoRegra`) e o SHA-256 dela, calculados na API. */
  readonly conteudo: string;
  readonly impressao: string;
  readonly justificativa: string;
  readonly usuario: string;
}
