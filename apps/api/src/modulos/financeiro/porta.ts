// Porta do financeiro e fiscal (M32): o que as telas de contas a pagar e a receber, tesouraria, gerencial e fiscal leem
// e gravam, independente de onde (a API não escreve SQL; fronteira Nx):
//   - `banco` (porta-propria.ts): o banco do cliente pelo @sgh/nucleo; gravações pelo Executor (operações
//     financeiro.*, com a trilha, o outbox e a idempotência na mesma transação) e as gravações diretas (alçada,
//     aprovação, glosa no título, extrato, conciliação, crédito pendente, remessa, lote contábil) também pelo Executor;
//   - `memoria`: a sessão sintética de dev/ci (E2E): títulos, contas bancárias, contas do faturamento e extrato
//     SINTÉTICOS em memória, com as mesmas validações (Zod dos contratos e regras do domínio) e as mesmas recusas;
//   - indisponível: fora de dev/ci sem o núcleo: 503 em tudo (falha fechada).
import type {
  AdiantamentoResposta,
  AtribuirCreditoEntrada,
  BorderoResposta,
  ConciliarEntrada,
  ContaBancariaResposta,
  ContaSemTituloResposta,
  CreditoPendenteResposta,
  DetalheTituloPagarResposta,
  DetalheTituloReceberResposta,
  EscrituracaoResposta,
  FaixaAlcadaEntrada,
  LinhaExtratoResposta,
  ListaApropriacoes,
  ListaTitulosPagar,
  ListaTitulosReceber,
  MovimentoResposta,
  RegistrarGlosaTituloEntrada,
  RegistroFiscalResposta,
  TituloPagarResposta,
} from '@sgh/contratos';
import type { FaixaAlcada } from '@sgh/contratos/regras-financeiro';
import type { ContextoPortaM18, PortaGravacaoM18 } from '../exames/public-api.js';

export const PORTA_FINANCEIRO = Symbol('PORTA_FINANCEIRO');

export type ContextoFinanceiro = ContextoPortaM18;

export interface FiltroPagar {
  readonly situacao: TituloPagarResposta['situacao'] | null;
  readonly vencimentoDe: string | null;
  readonly vencimentoAte: string | null;
  readonly credor: number | null;
  readonly tipo: string | null;
  readonly pagina: number;
  readonly hoje: string;
}

export interface FiltroReceber {
  readonly devedor: string | null;
  readonly convenio: number | null;
  readonly aberto: boolean | null;
  readonly vencimentoDe: string | null;
  readonly vencimentoAte: string | null;
  readonly pagina: number;
  readonly hoje: string;
}

export interface LancamentoFluxoPorta {
  readonly data: string;
  readonly valor: number;
  readonly sentido: 'entrada' | 'saida';
  readonly origem: 'movimento' | 'pagar' | 'receber';
  readonly realizado: boolean;
  readonly convenio?: number;
}

export interface BasesDrePorta {
  readonly receitas: readonly { competencia: number; valor: number; glosaAceita: number }[];
  readonly despesas: readonly { competencia: number; valor: number; grupo: number }[];
  readonly caixa: readonly { data: string; valor: number; natureza: 'receita' | 'despesa'; grupo: number }[];
}

export interface BasesIndicadoresPorta {
  readonly pagos: number;
  readonly aprovados: number;
  readonly pagosPeloNovo: number;
  readonly contas: number;
  readonly contasComTitulo: number;
  readonly titulos: number;
  readonly orfaos: number;
}

export interface RetencaoReinfPorta {
  readonly cnpjPrestador: string;
  readonly documento: number;
  readonly dataEmissao: string;
  readonly valorBruto: number;
  readonly inss: number;
  readonly ir: number;
  readonly csll: number;
  readonly pis: number;
  readonly cofins: number;
}

/** Gravações diretas da porta, numa transação com a trilha junto (o estabelecimento e o usuário vêm do contexto). */
export interface GravadorSghFinanceiro {
  salvarFaixa(d: FaixaAlcadaEntrada & { usuario: string }): Promise<{ id: number }>;
  aprovarTitulo(d: {
    titulo: number;
    observacao: string;
    usuario: string;
    temPermissao: (p: string) => boolean;
  }): Promise<{ id: number; ordem: number; aprovado: boolean; faltam: number }>;
  registrarGlosaTitulo(
    d: RegistrarGlosaTituloEntrada & { usuario: string; origem: 'tela' | 'evento'; chaveEvento?: string },
  ): Promise<{ id: number; repetida: boolean }>;
  importarExtrato(d: {
    usuario: string;
    conta: number;
    origem: 'ofx' | 'csv' | 'api';
    hashArquivo: string;
    arquivo: ArquivoGuardadoFinanceiro | null;
    linhas: readonly { data: string; valor: number; historico: string; documento: string }[];
  }): Promise<{ id: number; linhas: number; repetido: boolean }>;
  /** `contasEscopo`: as contas do escopo do usuário (regra 15); a linha ou o crédito de outra conta é recusado (403). */
  conciliar(
    d: ConciliarEntrada & { usuario: string; contasEscopo: readonly number[] },
  ): Promise<{ id: number }>;
  atribuirCredito(
    d: AtribuirCreditoEntrada & { usuario: string; contasEscopo: readonly number[] },
  ): Promise<{ id: number }>;
  registrarRemessa(d: {
    usuario: string;
    conta: number;
    leiaute: 'cnab240' | 'api';
    titulos: number;
    valorTotal: number;
    hashArquivo: string;
    arquivo: ArquivoGuardadoFinanceiro | null;
    destino: 'simulador' | 'banco';
    situacao: 'gerada' | 'retornada';
    hashRetorno: string | null;
    ocorrencias: string | null;
  }): Promise<{ id: number; sequencial: number }>;
  registrarNfse(d: {
    usuario: string;
    tituloReceber: number | null;
    conta: number | null;
    momento: string;
    classificacao: string;
    itemServico: string;
    valorServicos: number;
    aliquotaIss: number;
    valorIss: number;
    issRetido: boolean;
    valorIbs: number;
    valorCbs: number;
    retencoes: number;
    valorLiquido: number;
    destino: 'simulador' | 'prefeitura';
    situacao: 'simulada' | 'autorizada' | 'rejeitada';
    numero: string | null;
    hashXml: string;
    arquivo: ArquivoGuardadoFinanceiro | null;
  }): Promise<{ id: number }>;
  registrarDeclaracao(d: {
    usuario: string;
    tipo: 'dmed' | 'reinf-r2000' | 'reinf-r4000';
    periodo: string;
    leiaute: string;
    registros: number;
    valorTotal: number;
    hashArquivo: string;
    arquivo: ArquivoGuardadoFinanceiro | null;
  }): Promise<{ id: number }>;
  registrarLoteContabil(d: {
    usuario: string;
    periodo: string;
    regua: 'competencia' | 'caixa';
    lancamentos: number;
    somaDebitos: number;
    somaCreditos: number;
    semDePara: number;
    hashArquivo: string;
    arquivo: ArquivoGuardadoFinanceiro | null;
  }): Promise<{ id: number }>;
}

/**
 * O arquivo que o serviço já guardou no disco (ADR 0004): a gravação o registra em `arquivo` na mesma transação da
 * tabela dona (hash, tamanho, tipo, imutável e guarda legal de 5 anos), e é contra esse registro que o vigia confere.
 */
export interface ArquivoGuardadoFinanceiro {
  readonly chave: string;
  readonly tamanhoBytes: number;
  readonly tipoMime: string;
}

export interface PortaFinanceiro extends PortaGravacaoM18<GravadorSghFinanceiro> {
  hoje(c: ContextoFinanceiro): Promise<string>;
  contas(c: ContextoFinanceiro, usuario: string | null): Promise<ContaBancariaResposta[]>;
  classificacoes(
    c: ContextoFinanceiro,
  ): Promise<{ grupo: number; subgrupo: number; item: number; nome: string }[]>;
  retencoes(c: ContextoFinanceiro): Promise<{ codigo: number; descricao: string; tipo: number }[]>;
  formasPagamento(c: ContextoFinanceiro): Promise<{ codigo: number; nome: string }[]>;
  titulosPagar(c: ContextoFinanceiro, f: FiltroPagar): Promise<ListaTitulosPagar>;
  tituloPagar(
    c: ContextoFinanceiro,
    id: number,
    hoje: string,
  ): Promise<Omit<DetalheTituloPagarResposta, 'alcada' | 'legendaStatus'> | null>;
  documentoCredor(c: ContextoFinanceiro, titulo: number): Promise<string | null>;
  filaAprovacao(c: ContextoFinanceiro, hoje: string, ate: string): Promise<TituloPagarResposta[]>;
  faixas(c: ContextoFinanceiro): Promise<FaixaAlcada[]>;
  aprovacoesDosTitulos(
    c: ContextoFinanceiro,
    ids: readonly number[],
  ): Promise<Map<number, { aprovador: string; faixa: number }[]>>;
  borderos(c: ContextoFinanceiro, de: string, ate: string): Promise<BorderoResposta[]>;
  adiantamentos(c: ContextoFinanceiro): Promise<AdiantamentoResposta[]>;
  titulosReceber(c: ContextoFinanceiro, f: FiltroReceber): Promise<ListaTitulosReceber>;
  tituloReceber(
    c: ContextoFinanceiro,
    id: number,
    hoje: string,
  ): Promise<
    | (Omit<DetalheTituloReceberResposta, 'saldo' | 'recebivelRecurso'> & {
        /** Recurso deferido somado no título (banco); ausente quando vem da lista das glosas. */
        readonly recursoDeferido?: number;
      })
    | null
  >;
  tituloDoItem(c: ContextoFinanceiro, item: number): Promise<number | null>;
  contasSemTitulo(
    c: ContextoFinanceiro,
    f: { convenio: number | null; ano: number; mes: number | null },
  ): Promise<ContaSemTituloResposta[]>;
  contaCorrenteConvenios(c: ContextoFinanceiro): Promise<
    {
      id: number;
      data: string | null;
      documento: number;
      valor: number;
      devedor: string;
      codigo: number;
      historico: string;
      conta: number | null;
    }[]
  >;
  renegociacoes(
    c: ContextoFinanceiro,
  ): Promise<{ id: number; em: string; responsavel: string; titulos: number }[]>;
  movimento(
    c: ContextoFinanceiro,
    conta: number,
    de: string,
    ate: string,
  ): Promise<Omit<MovimentoResposta, 'rotuloTipo'>[]>;
  linhasExtrato(
    c: ContextoFinanceiro,
    conta: number,
    situacao: string | null,
  ): Promise<LinhaExtratoResposta[]>;
  creditosPendentes(c: ContextoFinanceiro, desde: string): Promise<CreditoPendenteResposta[]>;
  lancamentosFluxo(c: ContextoFinanceiro, de: string, ate: string): Promise<LancamentoFluxoPorta[]>;
  historicosConvenio(
    c: ContextoFinanceiro,
    desde: string,
  ): Promise<{ convenio: number; taxaGlosa: number; atrasoMedioDias: number }[]>;
  basesDre(c: ContextoFinanceiro, de: number, ate: number): Promise<BasesDrePorta>;
  apropriacoes(
    c: ContextoFinanceiro,
    f: { de: string; ate: string; grupo: number | null; pagina: number },
  ): Promise<ListaApropriacoes>;
  basesIndicadores(c: ContextoFinanceiro, de: string, ate: string): Promise<BasesIndicadoresPorta>;
  escrituracao(c: ContextoFinanceiro, ano: number, mes: number): Promise<EscrituracaoResposta[]>;
  deParaContabil(c: ContextoFinanceiro): Promise<
    {
      convenio: number;
      tipoConta: string;
      tipoLancamento: number;
      grupo: number;
      subgrupo: number;
      item: number;
      conta: number | null;
    }[]
  >;
  retencoesDaCompetencia(c: ContextoFinanceiro, ano: number, mes: number): Promise<RetencaoReinfPorta[]>;
  registrosFiscais(
    c: ContextoFinanceiro,
    tipo: 'nfse' | 'declaracao' | 'lote' | 'remessa',
  ): Promise<RegistroFiscalResposta[]>;
}

export const METODOS_PORTA_FINANCEIRO: ReadonlySet<string> = new Set([
  'executar',
  'gravarSgh',
  'podeGravar',
  'hoje',
  'contas',
  'classificacoes',
  'retencoes',
  'formasPagamento',
  'titulosPagar',
  'tituloPagar',
  'documentoCredor',
  'filaAprovacao',
  'faixas',
  'aprovacoesDosTitulos',
  'borderos',
  'adiantamentos',
  'titulosReceber',
  'tituloReceber',
  'tituloDoItem',
  'contasSemTitulo',
  'contaCorrenteConvenios',
  'renegociacoes',
  'movimento',
  'linhasExtrato',
  'creditosPendentes',
  'lancamentosFluxo',
  'historicosConvenio',
  'basesDre',
  'apropriacoes',
  'basesIndicadores',
  'escrituracao',
  'deParaContabil',
  'retencoesDaCompetencia',
  'registrosFiscais',
]);
