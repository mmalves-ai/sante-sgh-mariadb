// Tipos de negócio da porta do patrimônio (M54, etapa 6): o que a porta lê e grava, em vocabulário neutro (centavos,
// datas ISO, competência "AAAA-MM", ids numéricos, booleanos). O serviço os leva aos contratos da tela.
// Melhoria: os tipos são do módulo (nada de forma de tabela do sistema de origem); o centro de custo e o grupo vêm
// pelo id e pelo código do cadastro próprio.
import type { GrupoBemCadastro } from '@sgh/contratos';

export interface FiltroBens {
  readonly busca?: string | undefined;
  readonly centro?: number | undefined;
  readonly situacao?: string | undefined;
  readonly grupo?: string | undefined;
  readonly pagina: number;
  readonly tamanho: number;
}

export interface CentroDoBem {
  readonly id: number;
  readonly codigo: number | null;
  readonly nome: string;
}

export interface DominiosPatrimonio {
  readonly origens: { id: number; nome: string; depreciar: boolean }[];
  readonly tiposResponsavel: { id: number; nome: string }[];
  readonly coeficientes: { id: number; descricao: string; percentual: number }[];
  /** Os motivos de baixa do cadastro (ativos): a baixa grava o motivo pelo id, nunca em texto livre. */
  readonly motivosBaixa: { id: number; descricao: string; tipo: string; exigeLaudo: boolean }[];
  readonly centros: (CentroDoBem & { ativo: boolean })[];
  readonly empresas: { id: number; nome: string }[];
  readonly parametros: {
    empresa: number;
    depreciar: boolean;
    aplicarCoeficiente: boolean;
    considerarResidual: boolean;
  }[];
}

export type SituacaoBem = 'ativo' | 'emprestado' | 'baixado';

export interface BemRegistrado {
  readonly id: number;
  readonly plaqueta: string;
  readonly descricao: string;
  readonly grupo: string;
  readonly origem: { id: number; nome: string };
  readonly documento: 'nota' | 'termo';
  readonly nota: {
    id: number;
    idItem: number;
    numero: string | null;
    serie: string | null;
    data: string | null;
    fornecedor: string | null;
    item: number | null;
    itemNome: string | null;
  } | null;
  readonly termo: { numero: string; data: string; doador: string } | null;
  readonly empresa: number;
  readonly dataAquisicao: string;
  readonly valorCent: number;
  readonly residualCent: number;
  readonly vidaUtilMeses: number;
  readonly coeficiente: { id: number; descricao: string; percentual: number } | null;
  readonly inicioDepreciacao: string;
  readonly depreciavel: boolean;
  readonly centro: CentroDoBem;
  readonly localDetalhe: string | null;
  readonly tipoResponsavel: { id: number; nome: string } | null;
  readonly responsavel: string | null;
  readonly marca: string | null;
  readonly modelo: string | null;
  readonly numeroSerie: string | null;
  readonly situacao: SituacaoBem;
  readonly baixadoEm: string | null;
  readonly acumuladaCent: number;
  readonly cotas: number;
  readonly ultimaCompetencia: string | null;
  readonly movimentoPendente: { id: number; tipo: string } | null;
  readonly versao: number;
  readonly criadoPor: string;
  readonly criadoEm: string;
  readonly alteradoPor: string;
  readonly alteradoEm: string;
}

export interface NotaDeEntrada {
  readonly id: number;
  readonly ano: number;
  readonly mes: number;
  /** Número interno do recebimento. */
  readonly doc: number;
  readonly numero: string | null;
  readonly serie: string | null;
  readonly data: string | null;
  readonly fornecedor: string | null;
  readonly empresa: number | null;
  readonly totalCent: number;
  readonly itens: number;
}

export interface ItemDaNota {
  readonly id: number;
  /** Id da nota do item. */
  readonly nota: number;
  readonly seq: number | null;
  readonly item: number;
  readonly nome: string;
  readonly quantidade: number;
  readonly valorTotalCent: number;
  readonly jaCadastrados: number;
}

/** O marco do último ajuste vigente antes da competência. */
export interface MarcoDoAjuste {
  readonly ajuste: number;
  readonly competencia: string;
  readonly acumuladaCent: number;
  readonly baseCent: number;
  readonly residualCent: number;
  readonly vidaRestanteMeses: number;
}

export interface BemDaCompetencia {
  readonly id: number;
  readonly plaqueta: string;
  readonly descricao: string;
  readonly grupo: string;
  readonly centro: number;
  readonly valorCent: number;
  readonly residualCent: number;
  readonly vidaUtilMeses: number;
  readonly coeficiente: number | null;
  readonly inicioDepreciacao: string;
  readonly depreciavel: boolean;
  readonly situacao: SituacaoBem;
  readonly baixadoEm: string | null;
  readonly acumuladaCent: number;
  readonly temCotaNaCompetencia: boolean;
  readonly marco: MarcoDoAjuste | null;
}

export type TipoAjusteBem = 'revisao-estimativa' | 'impairment' | 'reavaliacao';

export interface AjusteDoBem {
  readonly id: number;
  readonly bem: number;
  readonly empresa: number;
  readonly tipo: TipoAjusteBem;
  readonly competenciaMarco: string;
  readonly data: string;
  readonly centro: number;
  readonly grupo: string;
  readonly plaqueta: string;
  readonly valorContabilAntesCent: number;
  readonly valorContabilDepoisCent: number;
  readonly acumuladaMarcoCent: number;
  readonly perdaCent: number;
  readonly residualCent: number;
  readonly vidaRestanteMeses: number;
  readonly valorJustoCent: number | null;
  readonly laudo: number | null;
  readonly motivo: string;
  readonly origem: string;
  readonly registradoPor: string;
  readonly registradoEm: string;
  readonly estorno: {
    readonly data: string;
    readonly motivo: string;
    readonly origem: string;
    readonly estornadoPor: string;
    readonly estornadoEm: string;
  } | null;
}

export interface LaudoDoBem {
  readonly id: number;
  readonly bem: number;
  readonly nome: string;
  readonly descricao: string;
  readonly chave: string;
  readonly sha256: string;
  readonly tamanho: number;
  readonly enviadoPor: string;
  readonly enviadoEm: string;
}

export interface CalculoRegistrado {
  readonly id: number;
  readonly empresa: number;
  readonly competencia: string;
  readonly bens: number;
  readonly ignorados: number;
  readonly totalCent: number;
  readonly calculadoPor: string;
  readonly calculadoEm: string;
  /** 1 no primeiro cálculo da competência; N + 1 depois de N estornos. */
  readonly rodada: number;
}

export interface EstornoDeCalculo {
  readonly id: number;
  readonly calculo: number;
  readonly empresa: number;
  readonly competencia: string;
  readonly bens: number;
  readonly totalCent: number;
  readonly motivo: string;
  readonly origem: string;
  readonly estornadoPor: string;
  readonly estornadoEm: string;
}

export interface CotaRegistrada {
  readonly bem: number;
  readonly plaqueta: string;
  readonly descricao: string;
  readonly grupo: string;
  readonly centro: number;
  readonly baseCent: number;
  readonly residualCent: number;
  readonly vidaUtilMeses: number;
  readonly coeficiente: number;
  readonly acumuladaAntesCent: number;
  readonly valorCent: number;
  readonly inicioDepreciacao: string;
}

export interface MovimentoRegistrado {
  readonly id: number;
  readonly bem: { id: number; plaqueta: string; descricao: string };
  readonly tipo: string;
  readonly situacao: string;
  readonly data: string;
  readonly origem: CentroDoBem;
  readonly destino: CentroDoBem | null;
  readonly destinoResponsavel: string | null;
  readonly terceiro: string | null;
  readonly retornoPrevisto: string | null;
  readonly termoNumero: string | null;
  readonly motivo: string;
  readonly valorVendaCent: number | null;
  readonly referencia: number | null;
  readonly solicitadoPor: string;
  readonly solicitadoEm: string;
  readonly decididoPor: string | null;
  readonly decididoEm: string | null;
  readonly decisaoMotivo: string | null;
  readonly versao: number;
}

export interface InventarioRegistrado {
  readonly id: number;
  readonly descricao: string;
  readonly centro: CentroDoBem | null;
  readonly situacao: 'aberto' | 'encerrado' | 'cancelado';
  readonly esperados: number | null;
  readonly resumo: string | null;
  readonly abertoPor: string;
  readonly abertoEm: string;
  readonly encerradoPor: string | null;
  readonly encerradoEm: string | null;
  readonly canceladoPor: string | null;
  readonly canceladoEm: string | null;
  readonly motivoCancelamento: string | null;
}

export interface LeituraRegistrada {
  readonly id: number;
  readonly codigo: string;
  readonly bem: { id: number; plaqueta: string; descricao: string; centro: number } | null;
  readonly centroLido: number;
  readonly resultado: string;
  readonly observacao: string | null;
  readonly lidoPor: string;
  readonly lidoEm: string;
}

export interface BemEsperado {
  readonly id: number;
  readonly plaqueta: string;
  readonly descricao: string;
  readonly centro: number;
  readonly situacao: SituacaoBem;
}

export interface BemNovo {
  readonly empresa: number;
  /** null: numerado pela sequência (gerarPlaqueta). */
  readonly plaqueta: string | null;
  readonly descricao: string;
  readonly grupo: string;
  readonly origem: number;
  readonly documento: 'nota' | 'termo';
  readonly nota: number | null;
  readonly itemNota: number | null;
  readonly item: number | null;
  readonly termo: { readonly numero: string; readonly data: string; readonly doador: string } | null;
  readonly dataAquisicao: string;
  readonly valorCent: number;
  readonly residualCent: number;
  readonly vidaUtilMeses: number;
  readonly coeficiente: number | null;
  readonly inicioDepreciacao: string;
  readonly depreciavel: boolean;
  readonly centro: number;
  readonly localDetalhe: string | null;
  readonly tipoResponsavel: number | null;
  readonly responsavel: string | null;
  readonly marca: string | null;
  readonly modelo: string | null;
  readonly numeroSerie: string | null;
}

export interface CadastroDeBens {
  readonly bens: readonly BemNovo[];
  /**
   * Do item da nota: as unidades que viram bem e os bens já cadastrados que a tela viu (o valor de cada unidade depende
   * deles; outra pessoa cadastrou no meio: `desatualizado`).
   */
  readonly item: { readonly id: number; readonly unidades: number; readonly jaCadastrados: number } | null;
}

export interface AlteracaoDoBem {
  readonly id: number;
  readonly versao: number;
  readonly descricao: string;
  readonly grupo: string;
  readonly localDetalhe: string | null;
  readonly tipoResponsavel: number | null;
  readonly responsavel: string | null;
  readonly marca: string | null;
  readonly modelo: string | null;
  readonly numeroSerie: string | null;
  readonly vidaUtilMeses: number;
  readonly residualCent: number;
  readonly coeficiente: number | null;
  readonly inicioDepreciacao: string;
  readonly depreciavel: boolean;
}

export interface MovimentoNovo {
  readonly bem: number;
  /** A versão do bem lida (o registro sobe a versão do bem: dois pedidos ao mesmo tempo não passam). */
  readonly versaoBem: number;
  readonly tipo: 'transferencia' | 'emprestimo' | 'comodato' | 'devolucao' | 'baixa';
  readonly situacao: 'pendente' | 'concluido';
  readonly data: string;
  readonly origem: number;
  readonly destino: number | null;
  readonly destinoResponsavel: string | null;
  readonly terceiro: string | null;
  readonly retornoPrevisto: string | null;
  readonly termoNumero: string | null;
  readonly motivo: string;
  /** Só na baixa: o motivo de baixa do cadastro (motivo_baixa_bem); o `motivo` fica como a justificativa em texto. */
  readonly motivoBaixa: number | null;
  readonly valorVendaCent: number | null;
  readonly referencia: number | null;
  /** O efeito no bem agora (null: nada além da versão, até o aceite). */
  readonly efeito: { readonly situacao: SituacaoBem; readonly baixadoEm: string | null } | null;
}

export interface CotaNova {
  readonly bem: number;
  readonly plaqueta: string;
  readonly grupo: string;
  readonly centro: number;
  readonly baseCent: number;
  readonly residualCent: number;
  readonly vidaUtilMeses: number;
  readonly coeficiente: number;
  readonly acumuladaAntesCent: number;
  readonly valorCent: number;
}

export interface PlanoDepreciacao {
  readonly impedimentos: readonly string[];
  readonly cotas: readonly CotaNova[];
  readonly ignorados: number;
  readonly totalCent: number;
  readonly resumo: string;
}

export interface SituacaoParaEstorno {
  readonly daCompetencia: CalculoRegistrado | null;
  readonly ultimo: CalculoRegistrado | null;
  readonly lotesExportados: readonly { readonly periodo: string; readonly exportadoEm: string }[];
  readonly bensBaixados: readonly string[];
}

export interface SituacaoParaAjuste {
  readonly bem: BemRegistrado;
  readonly marco: MarcoDoAjuste | null;
  /** A última competência com cálculo vigente da empresa do bem. */
  readonly ultimaCalculada: string | null;
  /** Há regra contábil vigente na data para a perda por recuperabilidade (as contas da perda). */
  readonly contasConfiguradas: boolean;
  readonly lotesExportados: readonly { readonly periodo: string }[];
}

export interface AjusteNovo {
  readonly tipo: TipoAjusteBem;
  readonly competenciaMarco: string;
  readonly data: string;
  readonly valorContabilAntesCent: number;
  readonly valorContabilDepoisCent: number;
  readonly acumuladaMarcoCent: number;
  readonly perdaCent: number;
  readonly residualCent: number;
  readonly vidaRestanteMeses: number;
  readonly valorJustoCent: number | null;
  readonly laudo: number | null;
  readonly origem: string;
}

export interface SituacaoParaEstornoAjuste {
  readonly ajuste: AjusteDoBem;
  readonly ultimoComMarco: { readonly id: number } | null;
  readonly cotasPosteriores: readonly string[];
  readonly lotesExportados: readonly { readonly periodo: string }[];
}

export interface LeituraNova {
  readonly inventario: number;
  readonly codigo: string;
  readonly bem: number | null;
  readonly centroLido: number;
  readonly resultado: string;
  readonly observacao: string | null;
}

export type GrupoDoBem = GrupoBemCadastro & { readonly id: number | null };

export interface GrupoBemNovo {
  readonly codigo: string;
  readonly nome: string;
  readonly vidaUtilMeses: number;
  readonly conta: string | null;
}
