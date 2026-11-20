// Entradas comuns dos arquivos das obrigações (M53-F7): a empresa (parâmetros das obrigações + os do eSocial vigentes
// e o CNPJ), o trabalhador (com CPF, NIS e nome: só aqui, nunca em resposta) e a remuneração dele no período, somada
// dos processamentos da folha. Valores em centavos.
import type { FichaEsocialVinculo, ModalidadeRescisao, ParametrosObrigacoes } from '@sgh/contratos';

export interface EmpresaObrigacao {
  readonly cnpj: string;
  readonly parametros: Omit<ParametrosObrigacoes, 'regimes' | 'empresa' | 'inicio'>;
  /** Dos parâmetros do eSocial vigentes: CNAE (7), FPAS (3), terceiros (4), RAT (1 a 3) e FAP (décimos de milésimo). */
  readonly cnae: string;
  readonly fpas: string;
  readonly codTerceiros: string;
  readonly aliqRat: number;
  readonly fap: number;
}

export interface TrabalhadorObrigacao {
  readonly vinculo: number;
  readonly matricula: string | null;
  readonly cpf: string | null;
  readonly nome: string;
  readonly admissao: string;
  readonly desligamento: string | null;
  readonly cargaSemanal: number;
  /** O salário contratual vigente no fim do período (centavos); null sem vigência. */
  readonly salario: number | null;
  readonly ficha: FichaEsocialVinculo | null;
  /** A modalidade da rescisão calculada (o código de desligamento dos leiautes); null sem rescisão. */
  readonly modalidadeRescisao: ModalidadeRescisao | null;
}

export interface RemuneracaoObrigacao {
  readonly vinculo: number;
  /** A base do FGTS sem o 13º (a remuneração do mês, das férias e da rescisão). */
  readonly remuneracao: number;
  /** A base do FGTS do 13º (as duas parcelas). */
  readonly remuneracaoDecimo: number;
  readonly fgts: number;
  readonly rescisorio: number;
  /** As remunerações por mês (AAAA-MM → centavos; a RAIS usa os 12 meses). */
  readonly porMes?: Readonly<Record<string, number>>;
  /** O 13º por parcela (a RAIS informa o adiantamento e a final com o mês). */
  readonly decimoAdiantamento?: { readonly valor: number; readonly mes: number } | null;
  readonly decimoFinal?: { readonly valor: number; readonly mes: number } | null;
}

/** Os códigos dos catálogos oficiais lidos do banco (a geração confere cada código usado). */
export interface CatalogosObrigacoes {
  readonly categoriasSefip: ReadonlySet<string>;
  readonly movimentacoesSefip: ReadonlySet<string>;
  readonly desligamentosCaged: ReadonlySet<string>;
  readonly admissoesCaged: ReadonlySet<string>;
  readonly vinculosRais: ReadonlySet<string>;
  readonly desligamentosRais: ReadonlySet<string>;
  readonly admissoesRais: ReadonlySet<string>;
}

export interface ArquivoObrigacao {
  readonly nomeArquivo: string;
  readonly conteudo: string;
  readonly linhas: number;
}
