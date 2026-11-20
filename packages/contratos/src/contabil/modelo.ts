// Forma do fato contábil e do lançamento como o motor (@sgh/dominio-contabil) os vê e como a leitura do banco
// (@sgh/legado, contabil/repositorios/fatos.ts) os entrega. Valores sempre em CENTAVOS inteiros (NUMERIC(15,2) do
// banco), nunca ponto flutuante. Nenhum campo de pessoa: só IDs, documento, competência, convênio e centro de custo.
import type { LadoPartida, OrigemLancamento, SituacaoFato, TipoFato } from './vocabulario.js';

export type ValorCampoFato = string | number | null;

/** Linha de fonte lida do banco, antes de virar fato (a impressão é calculada sobre `valores`). */
export interface LinhaFonte {
  readonly tabela: string;
  readonly id: number;
  /** Carimbo de última atualização (ISO), quando a fonte tem e a linha preencheu. */
  readonly carimbo: string | null;
  readonly valores: Readonly<Record<string, ValorCampoFato>>;
}

/** Fato contábil derivado de uma linha (uma linha pode gerar mais de um fato: glosa e recurso no mesmo item). */
export interface FatoContabil {
  readonly tabela: string;
  readonly id: number;
  readonly tipo: TipoFato;
  readonly origem: OrigemLancamento;
  readonly empresa: number;
  /** Data do fato (AAAA-MM-DD) e a competência contábil (AAAA-MM) que ela define. */
  readonly data: string;
  readonly competencia: string;
  readonly valorCentavos: number;
  readonly centroCusto: number | null;
  readonly documento: string;
  /** Campos que as condições e o de-para da regra podem usar (camelCase). */
  readonly campos: Readonly<Record<string, ValorCampoFato>>;
  /** Impressão do fato (tipo, valor, data, centro de custo e campos): muda só quando o efeito contábil muda. */
  readonly impressao: string;
  readonly carimbo: string | null;
  /**
   * Estorno de um fato anterior da mesma linha (conta reaberta, título alterado ou excluído): a regra inverte os lados.
   * Nunca se apaga fato nem lançamento (regra 4: glosa e recurso são ajuste; correção é lançamento novo).
   */
  readonly estorno: boolean;
  /** Impressão do fato estornado (quando `estorno`). */
  readonly referencia: string | null;
}

export interface PartidaGerada {
  readonly lado: LadoPartida;
  readonly conta: string;
  readonly valorCentavos: number;
  readonly historico: string;
  readonly centroCusto: number | null;
}

export interface LancamentoGerado {
  /** Chave idempotente: tabela, ID, tipo, impressão do fato e versão da regra. */
  readonly chave: string;
  readonly fato: Pick<FatoContabil, 'tabela' | 'id' | 'tipo' | 'impressao'>;
  readonly regra: { readonly nome: string; readonly versao: number };
  readonly empresa: number;
  readonly data: string;
  readonly competencia: string;
  readonly partidas: readonly PartidaGerada[];
}

export interface ResultadoContabilizacao {
  readonly situacao: SituacaoFato;
  readonly lancamento: LancamentoGerado | null;
  readonly motivo: string | null;
}
