// Porta do orçamento empresarial (M54, etapa 7): lê os cadastros de apoio (centros de custo, itens gerenciais, os
// parâmetros do orçamento), as versões e as linhas (SGH_ORC_*) e o realizado do ano (MFLANGSI e GEKONCDC, agregado, só
// leitura); grava só SGH_ORC_* numa transação SGH_, com a SGH_TRILHA junto.
//   - `legado`: @sgh/legado (READ ONLY nas tabelas do outro sistema; SGH_ORC_ORCAMENTO e SGH_ORC_LINHA);
//   - `memoria`: a sessão sintética de dev/ci (E2E), centros, itens e realizado sintéticos;
//   - indisponível: fora de dev/ci sem o núcleo: 503 (falha fechada).
import type {
  CentroOrcamento,
  ItemGerencialOrcamento,
  LinhaOrcamento,
  OrcamentoVersao,
  ParametrosOrcamentoLidos,
} from '@sgh/contratos';
import type {
  GravacaoLinhasOrcamento,
  LinhaTrilha,
  RealizadoAnoLido,
  VersaoOrcamentoParaCriar,
} from '@sgh/legado';

export const PORTA_ORCAMENTO = Symbol('PORTA_ORCAMENTO');

export interface ContextoOrcamento {
  readonly rede: string;
  readonly hospital: string;
}

export interface ApoioOrcamentoLido {
  readonly centros: CentroOrcamento[];
  readonly itens: ItemGerencialOrcamento[];
  /** Os códigos das empresas do estabelecimento (TBEMPHOS.COD): a versão só se cria para uma delas. */
  readonly empresas: number[];
  readonly parametros: ParametrosOrcamentoLidos;
}

export interface PortaOrcamento {
  readonly destino: 'legado' | 'memoria' | 'indisponivel';
  apoio(c: ContextoOrcamento): Promise<ApoioOrcamentoLido>;
  versoes(c: ContextoOrcamento, ano: number | null): Promise<OrcamentoVersao[]>;
  versao(c: ContextoOrcamento, id: number): Promise<OrcamentoVersao | null>;
  linhas(c: ContextoOrcamento, id: number): Promise<LinhaOrcamento[]>;
  realizado(c: ContextoOrcamento, empresa: number, ano: number): Promise<RealizadoAnoLido>;
  criar(
    c: ContextoOrcamento,
    x: VersaoOrcamentoParaCriar,
    por: string,
    trilha: LinhaTrilha,
  ): Promise<{ id: number; numero: number; linhas: number }>;
  gravarLinhas(
    c: ContextoOrcamento,
    id: number,
    versao: number,
    g: GravacaoLinhasOrcamento,
    por: string,
    trilha: LinhaTrilha,
  ): Promise<{ versao: number }>;
  aprovar(
    c: ContextoOrcamento,
    x: { readonly id: number; readonly versao: number; readonly empresa: number; readonly ano: number },
    observacao: string | null,
    por: string,
    trilha: LinhaTrilha,
  ): Promise<{ substituida: number | null }>;
  descartar(
    c: ContextoOrcamento,
    id: number,
    versao: number,
    motivo: string,
    por: string,
    trilha: LinhaTrilha,
  ): Promise<void>;
}
