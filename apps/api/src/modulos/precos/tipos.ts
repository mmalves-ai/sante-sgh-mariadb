// Tipos de negócio do M12 (convênios, contratos, tabelas de preço, importação e motor de preços): o que a fonte lê e
// grava, independente de onde (banco do cliente ou memória sintética). Sem nome de tabela ou coluna de origem.
export interface ConvenioPreco {
  readonly codigo: number;
  readonly nome: string;
  readonly situacao: string | null;
  readonly classificacao: number | null;
  readonly classificacaoNome: string | null;
  readonly registroAns: number | null;
  readonly honorariosInternacao: number | null;
  readonly honorariosExterna: number | null;
  readonly diarias: number | null;
  readonly matmed: number | null;
  readonly porte: number | null;
}

export interface VigenciaTabelaConvenio {
  readonly tipo: 'honorariosInternacao' | 'honorariosExterna' | 'diarias' | 'matmed';
  readonly tabela: number;
  readonly inicio: string;
  /** Nulo enquanto vigente. */
  readonly fim: string | null;
}

export interface IndiceConvenio {
  readonly tipo: 'indice' | 'indiceProcedimento' | 'porte';
  readonly chave: string;
  readonly data: string;
  readonly valor: number;
}

export interface TissConvenio {
  readonly configurado: boolean;
  readonly valores: Readonly<Record<string, string | number | null>>;
  readonly parametros: readonly { codigo: number; nome: string; padrao: string | null }[];
}

export interface PaginaModificadores {
  readonly itens: readonly Record<string, string | number | null>[];
  readonly total: number;
}

export interface ImpactoSituacaoConvenio {
  readonly agendasConsulta: number;
  readonly agendasExame: number;
  readonly agendamentosFuturos: number;
  readonly contasAbertas: number;
  readonly profissionais: number;
  /** Diária de acompanhante apontada (tipo e subtipo) para a pré-checagem da situação. */
  readonly diariaAcompanhante: { readonly tipo: number | null; readonly subtipo: number | null } | null;
}

export type TipoModificador =
  | 'honorarios'
  | 'matmed'
  | 'referencia'
  | 'referenciaItem'
  | 'planos'
  | 'formulas'
  | 'horarios'
  | 'subgrupos'
  | 'pacotes'
  | 'entregas';
/** Modificadores por convênio (ou globais): as colunas da tela, com o rótulo; paginados no servidor. */
export const MODIFICADORES: Readonly<
  Record<TipoModificador, { readonly colunas: readonly (readonly [string, string])[] }>
> = {
  honorarios: {
    colunas: [
      ['tabela', 'Tabela'],
      ['procedimento', 'Procedimento'],
      ['data', 'Vigência'],
      ['tipoPaciente', 'Tipo de paciente'],
      ['percCh', '% CH'],
      ['percCusto', '% custo operacional'],
      ['percAnestesia', '% anestesia'],
      ['percFilme', '% filme'],
      ['percForaHorario', '% fora do horário'],
      ['percNaoCredenciado', '% não credenciado'],
    ],
  },
  matmed: {
    colunas: [
      ['item', 'Item mat/med'],
      ['tabela', 'Tabela'],
      ['data', 'Vigência'],
      ['tipoConta', 'Tipo de conta'],
      ['percentual', '%'],
      ['valorFixo', 'Valor fixo'],
      ['quantidadeFixa', 'Quantidade fixa'],
    ],
  },
  referencia: {
    colunas: [
      ['classificacao', 'Classe'],
      ['descontoCodigo', 'Código/descrição'],
      ['referenciaCodigo', 'Usa código da referência'],
      ['referenciaDescricao', 'Usa descrição da referência'],
      ['referenciaValor', 'Usa valor da referência'],
      ['pf', 'Preço de fábrica'],
      ['pmc', 'Preço máximo ao consumidor'],
    ],
  },
  referenciaItem: {
    colunas: [
      ['item', 'Item mat/med'],
      ['pf', 'Preço de fábrica'],
      ['pmc', 'Preço máximo ao consumidor'],
    ],
  },
  pacotes: {
    colunas: [
      ['pacote', 'Pacote (procedimento)'],
      ['contas', 'Contas'],
      ['tipo', 'Tipo'],
      ['tabela', 'Tabela'],
      ['procedimento', 'Item incluso'],
      ['nome', 'Descrição'],
      ['quantidade', 'Quantidade'],
      ['ato', 'Ato'],
    ],
  },
  entregas: {
    colunas: [
      ['entrega', 'Entrega das contas'],
      ['pagamento', 'Pagamento previsto'],
    ],
  },
  planos: {
    colunas: [
      ['plano', 'Tipo de plano'],
      ['diaria', 'Diária do plano'],
      ['local', 'Local'],
    ],
  },
  formulas: {
    colunas: [
      ['codigo', 'Código'],
      ['nome', 'Fórmula'],
      ['percentual', '%'],
      ['considerar', 'Considera (3 todos, 2 só C.O.)'],
      ['ativo', 'Ativo'],
    ],
  },
  horarios: { colunas: [['tabela', 'Janela']] },
  subgrupos: {
    colunas: [
      ['grupo', 'Grupo'],
      ['subgrupo', 'Subgrupo'],
      ['nome', 'Nome'],
      ['contabil', 'Conta contábil'],
      ['desconto', 'Desconto'],
    ],
  },
};

export interface PlanoConvenio {
  readonly id: number;
  readonly nome: string;
  readonly planoLegado: number | null;
  readonly inicio: string;
  readonly fim: string | null;
  readonly ativo: boolean;
  readonly criadoPor: string;
  /** Controle otimista da correção e do encerramento (1 na primeira gravação). */
  readonly versao: number;
}

export interface NovoPlano {
  readonly hospital: string;
  readonly convenio: number;
  readonly nome: string;
  readonly planoLegado: number | null;
  readonly inicio: string;
  readonly fim: string | null;
  readonly justificativa: string;
  readonly autor: string;
}

/**
 * Correção ou encerramento do plano (nunca apagar: encerrar é gravar FIM; desativar é ATIVO = 'N'). Só os
 * campos informados mudam; a versão lida é conferida com a linha travada (WITH LOCK); a justificativa e o
 * autor da mudança ficam na linha (ATUALIZADO_POR) e na SGH_TRILHA da mesma transação.
 */
export interface AlteracaoPlano {
  readonly hospital: string;
  readonly convenio: number;
  readonly id: number;
  readonly versao: number;
  readonly nome?: string;
  readonly fim?: string | null;
  readonly ativo?: boolean;
  readonly justificativa: string;
  readonly autor: string;
}

export class ErroPlano extends Error {
  override readonly name = 'ErroPlano';
  readonly codigo: 'nao-encontrado' | 'conflito-concorrente' | 'vigencia-invalida';
  constructor(codigo: 'nao-encontrado' | 'conflito-concorrente' | 'vigencia-invalida', mensagem: string) {
    super(mensagem);
    this.codigo = codigo;
  }
}

export interface CabecalhoTabela {
  readonly codigo: number;
  readonly nome: string;
  readonly situacao: string | null;
  /** Modo da tabela de honorários (H, V, I). */
  readonly modo?: string | null;
}

export interface ItemHonorarioPreco {
  readonly codigo: number;
  readonly nome: string;
  readonly situacao: string | null;
  readonly ch: number;
  readonly porte: string | null;
  readonly fracaoPorte: number | null;
  readonly cope: number | null;
  readonly filmeM2: number | null;
  readonly ato: number | null;
  /** Item cobrável do item da tabela (índice do procedimento no acordo). */
  readonly itemFaturavel?: number | null;
  /** Porte anestésico do procedimento (0 a 8), quando houver. */
  readonly porteAnestesico?: string | null;
  readonly vigencia: string | null;
  readonly valores: Componentes | null;
  readonly vigencias: number;
  /** Maior DATA de qualquer vigência do item (futura quando > data-base). */
  readonly ultimaData: string | null;
}

export interface ItemDiariaPreco {
  readonly id: number;
  readonly codigo: string | null;
  readonly operacao: number;
  readonly nome: string;
  readonly tipo: number | null;
  readonly subtipo: number | null;
  readonly situacao: string | null;
  readonly vigencia: string | null;
  readonly valor: number | null;
  readonly vigencias: number;
}

export interface ItemMatmedPreco {
  readonly id: number;
  readonly codigo: number;
  readonly nome: string;
  readonly classificacao: number | null;
  readonly unidade: string | null;
  readonly referencia: string | null;
  readonly situacao: string | null;
  readonly vigencia: string | null;
  readonly valor: number | null;
  readonly pmc: number | null;
  readonly pf: number | null;
  readonly edicao: number | null;
}

export interface ItemParaReajuste extends ItemHonorarioPreco {
  /** Já existe linha na data pedida. */
  readonly temNaData: boolean;
}

export interface VigenciaItem {
  readonly data: string;
  readonly valores: Componentes;
}

/** Vigência de um valor simples (diária ou taxa; mat/med com a referência). */
export interface VigenciaValor {
  readonly data: string;
  readonly valor: number | null;
  readonly pmc?: number | null;
  readonly pf?: number | null;
  readonly edicao?: number | null;
}

export interface Componentes {
  readonly ch: number;
  readonly co: number;
  readonly filme: number;
  readonly anes: number;
  readonly outros: number;
}

export interface AutoriaPreco {
  readonly data: string;
  readonly autor: string;
  readonly quando: string;
  readonly origem: string;
  readonly lote: string | null;
}

export interface LoteReajuste {
  readonly lote: string;
  readonly tabela: number;
  readonly data: string;
  readonly origem: string;
  readonly itens: number;
  readonly autor: string;
  readonly quando: string;
  readonly justificativa: string;
  /** Itens do lote já desfeitos (por TAB, DATA e COD); `desfeito` = todos. Entre 0 e o total: em parte. */
  readonly desfeitos: number;
  readonly desfeito: boolean;
}

export interface LinhaDoLote {
  readonly tabela: number;
  readonly codigo: number;
  readonly data: string;
  readonly valores: Componentes;
}

export interface CargaImportacao {
  readonly id: number;
  readonly catalogo: string;
  readonly tabela: number | null;
  readonly arquivo: string;
  readonly sha256: string;
  readonly bytes: number;
  readonly situacao: 'preparada' | 'validada' | 'comparada' | 'publicada' | 'rejeitada';
  readonly responsavel: string;
  readonly aprovador: string | null;
  readonly criadaEm: string;
  readonly totais: {
    readonly linhas: number;
    readonly validas: number;
    readonly erros: number;
    readonly novos: number;
    readonly removidos: number;
    readonly alterados: number;
    readonly iguais: number;
  };
  readonly lote: string | null;
  readonly motivo: string | null;
  readonly versao: number;
}

export interface LinhaCargaImportacao {
  readonly linha: number;
  readonly codigo: number | null;
  readonly valores: Readonly<Record<string, number>> | null;
  /** Vigentes antes da importação (null quando a carga não guardou). */
  readonly anteriores: Readonly<Record<string, number>> | null;
  readonly nome: string | null;
  readonly resultado: string;
  readonly comparacao: string | null;
  readonly motivo: string | null;
}

export interface NovaCarga {
  readonly hospital: string;
  readonly catalogo: string;
  readonly tabela: number | null;
  readonly arquivo: string;
  readonly sha256: string;
  readonly bytes: number;
  readonly situacao: 'preparada' | 'comparada' | 'rejeitada';
  readonly responsavel: string;
  readonly motivo: string | null;
  readonly totais: {
    readonly linhas: number;
    readonly validas: number;
    readonly erros: number;
    readonly novos: number;
    readonly removidos: number;
    readonly alterados: number;
    readonly iguais: number;
  };
  readonly linhas: readonly LinhaPreparada[];
}

export class ErroCarga extends Error {
  override readonly name = 'ErroCarga';
  readonly codigo: 'conflito-concorrente' | 'situacao-invalida';
  constructor(codigo: 'conflito-concorrente' | 'situacao-invalida', mensagem: string) {
    super(mensagem);
    this.codigo = codigo;
  }
}

export interface LinhaPreparada {
  readonly linha: number;
  readonly codigo: number | null;
  /** Valores do arquivo (ou os vigentes, no item removido). */
  readonly valores: Readonly<Record<string, number>> | null;
  /** Valores vigentes antes da importação (itens alterados, iguais e removidos). */
  readonly anteriores?: Readonly<Record<string, number>> | null;
  /** Nome do item na tabela para a comparação na tela. */
  readonly nome?: string | null;
  readonly resultado: 'valida' | 'erro';
  readonly comparacao: 'novo' | 'removido' | 'alterado' | 'igual' | null;
  readonly motivo: string | null;
}

/**
 * Convênio do filtro: um código, a lista do escopo da sessão (lista vazia = nenhum) ou
 * null/undefined = todos (só quando a sessão não tem restrição de escopo).
 */
export type FiltroConvenio = number | readonly number[] | null | undefined;
export interface Pagina {
  readonly colunas: readonly { readonly campo: string; readonly rotulo: string }[];
  readonly itens: readonly Record<string, string | number | null>[];
  readonly total: number;
}

export interface RegraDatada {
  readonly origem: 'percentual-matmed' | 'indice' | 'percentual-honorario';
  readonly chave: string;
  readonly data: string | null;
}

/** Componentes de valor zerados. */
export const COMPONENTES_ZERO: Componentes = { ch: 0, co: 0, filme: 0, anes: 0, outros: 0 };
