// Porta do orçamento empresarial (M54, etapa 7): lê os cadastros de apoio (centros de custo, itens do plano gerencial,
// parâmetros), as versões e as linhas e o realizado do ano (títulos a pagar e a receber com o rateio por centro, e o
// consumo valorizado por centro), e grava as versões e as linhas com a trilha na mesma transação.
//   - própria (`banco`): o MariaDB do cliente pelo @sgh/nucleo (porta-propria.ts);
//   - `memoria`: a sessão sintética de dev/ci (E2E) e os testes da API;
//   - indisponível: fora de dev/ci sem o núcleo: 503 (falha fechada).
// Melhoria: o contexto é o do núcleo (cliente, estabelecimento e usuário por id) e a gravação leva a chave de
// idempotência e a linha da trilha da tela; a base da versão é estruturada (vazia, cópia de versão, realizado com
// ajuste), não um texto.
import type {
  CentroOrcamento,
  ItemGerencialOrcamento,
  LinhaOrcamento,
  NaturezaOrcamento,
  OrcamentoVersao,
  ParametrosOrcamentoLidos,
} from '@sgh/contratos';
import type { DocumentoRateadoBruto, LinhaParaGravar, RealizadoBruto } from '@sgh/dominio-financeiro';
import { ErroProblema } from '../../problema.filter.js';
import type { ContextoPorta } from '../cadastro/porta.js';
import type { DestinoPorta, RegistroTrilhaTela } from '../cadastro/tipos.js';

export const PORTA_ORCAMENTO = Symbol('PORTA_ORCAMENTO');

/** O contexto da sessão: o do núcleo (cliente, estabelecimento e usuário por id), com a rede e o código do estabelecimento. */
export type ContextoOrcamento = ContextoPorta;

/** O que acompanha cada gravação: quem grava (login, para exibição), a chave de idempotência e a linha da trilha. */
export interface GravacaoOrcamento {
  readonly login: string;
  readonly chaveIdempotencia: string;
  readonly trilha: RegistroTrilhaTela;
}

export interface ApoioOrcamentoDados {
  readonly centros: CentroOrcamento[];
  readonly itens: ItemGerencialOrcamento[];
  /** As empresas em que a versão pode ser criada (o orçamento é do estabelecimento: uma só, a 1). */
  readonly empresas: number[];
  readonly parametros: ParametrosOrcamentoLidos;
}

/** Como a versão nasce. */
export type BaseVersaoOrcamento =
  | { readonly tipo: 'vazio' }
  | { readonly tipo: 'versao'; readonly id: number }
  | { readonly tipo: 'realizado'; readonly ajusteCentesimos: number };

/** A chave e os meses de uma linha a gravar (centavos). */
export type LinhaOrcamentoParaGravar = LinhaParaGravar;

export interface VersaoOrcamentoNova {
  readonly empresa: number;
  readonly ano: number;
  readonly descricao: string;
  readonly base: BaseVersaoOrcamento;
  readonly linhas: readonly LinhaOrcamentoParaGravar[];
}

export interface PlanoLinhasOrcamento {
  readonly incluir: readonly LinhaOrcamentoParaGravar[];
  readonly alterar: readonly LinhaOrcamentoParaGravar[];
  readonly remover: readonly Omit<LinhaOrcamentoParaGravar, 'meses' | 'observacao'>[];
}

/**
 * O realizado do ano: o agregado por item, centro (pelo id; null: sem centro) e mês, e os documentos com rateio a
 * repartir pelo percentual (a porta própria já traz o rateio apropriado por centro no agregado: lista vazia).
 */
export interface RealizadoAno {
  readonly agregado: RealizadoBruto[];
  readonly rateados: DocumentoRateadoBruto[];
  /** Último dia com movimento lido, para o aviso de realizado incompleto. */
  readonly ultimoMovimento: string | null;
  readonly ultimoMesConsumo: number | null;
}

/** O texto curto da base de uma versão (mostrado na tela). */
export function rotuloBaseOrcamento(
  tipo: 'vazio' | 'copia_versao' | 'realizado',
  ano: number,
  copia: { ano: number; numero: number } | null,
  ajusteCentesimos: number,
): string {
  if (tipo === 'copia_versao' && copia) return `cópia de ${copia.ano} v${copia.numero}`;
  if (tipo === 'realizado') {
    const sinal = ajusteCentesimos >= 0 ? '+' : '-';
    return `realizado de ${ano - 1} ${sinal}${(Math.abs(ajusteCentesimos) / 100).toFixed(2).replace('.', ',')}%`;
  }
  return 'vazio';
}

export const naturezaDoItem = (n: string): NaturezaOrcamento | null =>
  n === 'despesa' || n === 'receita' || n === 'consumo' ? n : null;

export interface PortaOrcamento {
  readonly destino: DestinoPorta | 'indisponivel';
  /**
   * O banco guarda o orçamento de consumo por centro (o total valorizado, sem item de estoque)? A porta própria guarda
   * (a migração 14_FIN/11 retirou a exigência do insumo); a porta que não guardar deixa o consumo da versão gerada do
   * realizado de fora, contado nas descartadas e avisado, em vez de recusar a versão inteira.
   */
  readonly gravaConsumoPorCentro: boolean;
  apoio(c: ContextoOrcamento): Promise<ApoioOrcamentoDados>;
  versoes(c: ContextoOrcamento, ano: number | null): Promise<OrcamentoVersao[]>;
  versao(c: ContextoOrcamento, id: number): Promise<OrcamentoVersao | null>;
  linhas(c: ContextoOrcamento, id: number): Promise<LinhaOrcamento[]>;
  realizado(c: ContextoOrcamento, empresa: number, ano: number): Promise<RealizadoAno>;
  criar(
    c: ContextoOrcamento,
    x: VersaoOrcamentoNova,
    g: GravacaoOrcamento,
  ): Promise<{ id: number; numero: number; linhas: number }>;
  gravarLinhas(
    c: ContextoOrcamento,
    id: number,
    versao: number,
    plano: PlanoLinhasOrcamento,
    g: GravacaoOrcamento,
  ): Promise<{ versao: number }>;
  aprovar(
    c: ContextoOrcamento,
    x: { readonly id: number; readonly versao: number; readonly empresa: number; readonly ano: number },
    observacao: string | null,
    g: GravacaoOrcamento,
  ): Promise<{ substituida: number | null }>;
  descartar(
    c: ContextoOrcamento,
    id: number,
    versao: number,
    motivo: string,
    g: GravacaoOrcamento,
  ): Promise<void>;
}

export function portaOrcamentoIndisponivel(): PortaOrcamento {
  const recusa = (): Promise<never> =>
    Promise.reject(
      new ErroProblema(
        'indisponivel',
        503,
        'Banco do estabelecimento indisponível',
        'O banco do estabelecimento não está configurado: nada foi lido nem gravado.',
      ),
    );
  return {
    destino: 'indisponivel',
    gravaConsumoPorCentro: false,
    apoio: recusa,
    versoes: recusa,
    versao: recusa,
    linhas: recusa,
    realizado: recusa,
    criar: recusa,
    gravarLinhas: recusa,
    aprovar: recusa,
    descartar: recusa,
  };
}
