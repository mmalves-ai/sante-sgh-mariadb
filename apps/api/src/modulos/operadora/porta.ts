// Porta da operadora própria (M56, etapa F0; ficha, seção 4): o que a tela dos catálogos da ANS lê, independente de
// onde (a API não escreve SQL; fronteira Nx):
//   - `legado`: as leituras de @sgh/legado em transação READ ONLY no banco do estabelecimento (domínios da ANS; nenhum
//     dado de pessoa, nenhum registro fictício de beneficiário: regra 4);
//   - `memoria`: a sessão sintética de dev/ci (E2E), com catálogos SINTÉTICOS; nada vai à cópia;
//   - indisponível: fora de dev/ci sem o núcleo, 503 em tudo (falha fechada).
// F1 (M56.2): as leituras e as gravações de operadora, produto, contrato, beneficiário e carteirinha em SGH_OPE_*
// (`gravarSgh`: uma transação só SGH_ com a SGH_TRILHA junto; em dev sobre a cópia compartilhada, recusada). As fatias
// F2 a F8 acrescentam as delas.
import type {
  BeneficiarioOpeLido,
  BeneficiarioSgh,
  ClassificacaoAnsLida,
  ContratoOpeLido,
  ContratoSgh,
  DominiosBeneficiarioLidos,
  ElegibilidadeOpeLida,
  FiltroBeneficiariosSgh,
  FiltroContratosSgh,
  GrupoSipLido,
  LinhaTrilha,
  OperadoraOpeLida,
  OperadoraSgh,
  ProcedimentoSipLido,
  ProdutoOpeLido,
  ProdutoSgh,
  ViaCarteirinhaLida,
} from '@sgh/legado';

export const PORTA_OPERADORA = Symbol('PORTA_OPERADORA');

export interface ContextoOperadora {
  readonly rede: string;
  readonly hospital: string;
}

export interface ChaveSip {
  readonly procedimento: number;
  readonly grupo: number;
  readonly vigenciaInicial: string;
}

export interface FiltroSip {
  readonly grupo?: number;
  readonly procedimento?: number;
  readonly vigentesEm?: string;
  readonly apos?: ChaveSip;
}

export interface FiltroClassificacao {
  readonly apos?: number;
  /** Código exato (só números) ou trecho do nome. */
  readonly busca?: string;
}

/** As gravações da fatia F1 numa transação só SGH_ (o estabelecimento vem do contexto). */
export interface GravadorOperadora {
  gravarOperadora(x: {
    id: number | null;
    versao: number | null;
    dados: OperadoraSgh;
    por: string;
  }): Promise<{
    id: number;
  }>;
  gravarProduto(x: { id: number | null; versao: number | null; dados: ProdutoSgh; por: string }): Promise<{
    id: number;
  }>;
  gravarContrato(x: {
    operadora: number;
    id: number | null;
    versao: number | null;
    dados: ContratoSgh;
    por: string;
  }): Promise<{ id: number }>;
  proximaSequenciaCarteirinha(): Promise<number>;
  incluirBeneficiario(x: {
    operadora: number;
    dados: BeneficiarioSgh;
    carteirinha: string;
    validade: string;
    por: string;
  }): Promise<{ id: number }>;
  alterarBeneficiario(x: { id: number; versao: number; dados: BeneficiarioSgh; por: string }): Promise<{
    id: number;
  }>;
  baixarBeneficiario(x: {
    id: number;
    versao: number;
    motivo: number;
    data: string;
    por: string;
  }): Promise<{ id: number; dependentes: number }>;
  reativarBeneficiario(x: { id: number; versao: number; por: string }): Promise<{ id: number }>;
  emitirVia(x: { id: number; versao: number; motivo: number; validade: string; por: string }): Promise<{
    id: number;
    via: number;
  }>;
}

export interface PortaOperadora {
  readonly destino: 'legado' | 'memoria';
  gruposSip(c: ContextoOperadora): Promise<GrupoSipLido[]>;
  procedimentosSip(
    c: ContextoOperadora,
    f: FiltroSip,
  ): Promise<{ itens: ProcedimentoSipLido[]; proxima: ChaveSip | null }>;
  classificacoesAns(
    c: ContextoOperadora,
    f: FiltroClassificacao,
  ): Promise<{ itens: ClassificacaoAnsLida[]; proxima: number | null }>;
  // F1 (M56.2): leituras SGH_OPE_* (e os domínios do outro sistema; a regra 8 só pela contagem do ID).
  operadoras(c: ContextoOperadora): Promise<OperadoraOpeLida[]>;
  operadora(c: ContextoOperadora, id: number): Promise<OperadoraOpeLida | null>;
  produtos(c: ContextoOperadora, operadora?: number): Promise<ProdutoOpeLido[]>;
  produto(c: ContextoOperadora, id: number): Promise<ProdutoOpeLido | null>;
  contratos(
    c: ContextoOperadora,
    f: FiltroContratosSgh,
  ): Promise<{ itens: ContratoOpeLido[]; proxima: number | null }>;
  contrato(c: ContextoOperadora, id: number): Promise<ContratoOpeLido | null>;
  beneficiarios(
    c: ContextoOperadora,
    f: FiltroBeneficiariosSgh,
  ): Promise<{ itens: BeneficiarioOpeLido[]; proxima: number | null }>;
  beneficiario(c: ContextoOperadora, id: number): Promise<BeneficiarioOpeLido | null>;
  dependentes(c: ContextoOperadora, titular: number): Promise<BeneficiarioOpeLido[]>;
  vias(c: ContextoOperadora, beneficiario: number): Promise<ViaCarteirinhaLida[]>;
  elegibilidade(c: ContextoOperadora, carteirinha: string): Promise<ElegibilidadeOpeLida | null>;
  contagensDoContrato(
    c: ContextoOperadora,
    x: { contrato: number; cpf: string | null; exceto: number | null },
  ): Promise<{ titularesAtivos: number; cpfNoContrato: number }>;
  /** D-BAIXA-56: beneficiários não excluídos do contrato e contratos não encerrados do produto (0 sem o ID). */
  contagensDeUso(
    c: ContextoOperadora,
    x: { contrato: number | null; produto: number | null },
  ): Promise<{ beneficiariosVinculados: number; contratosEmUso: number }>;
  dominiosBeneficiario(c: ContextoOperadora): Promise<DominiosBeneficiarioLidos>;
  pacienteExiste(c: ContextoOperadora, id: number): Promise<boolean>;
  gravarSgh<T>(
    c: ContextoOperadora,
    trilha: LinhaTrilha | ((r: T) => LinhaTrilha),
    fn: (g: GravadorOperadora) => Promise<T>,
  ): Promise<T>;
}

export const METODOS_PORTA_OPERADORA: ReadonlySet<string> = new Set([
  'gruposSip',
  'procedimentosSip',
  'classificacoesAns',
  'operadoras',
  'operadora',
  'produtos',
  'produto',
  'contratos',
  'contrato',
  'beneficiarios',
  'beneficiario',
  'dependentes',
  'vias',
  'elegibilidade',
  'contagensDoContrato',
  'contagensDeUso',
  'dominiosBeneficiario',
  'pacienteExiste',
  'gravarSgh',
]);
