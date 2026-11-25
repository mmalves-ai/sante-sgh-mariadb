// Respostas das telas do financeiro (M32; ficha, seção 7): o que a API devolve às telas. Documento do credor e do
// devedor e dados bancários saem mascarados (o "mostrar" é rota própria, auditada); credencial bancária nunca sai.
import type { SituacaoTituloPagar } from './regras/situacao-titulo.js';

export interface ResultadoFinanceiro {
  readonly mensagem: string;
  readonly repetida: boolean;
  readonly ids: Readonly<Record<string, number | string>>;
  readonly avisos: readonly string[];
}

export interface GravacaoFinanceiro {
  readonly funcionalidades: Readonly<Record<string, { ligada: boolean; motivo: string | null }>>;
  readonly operacoes: Readonly<Record<string, { ligada: boolean; motivo: string | null }>>;
  readonly ambiente: string;
  /** Para onde vão remessa, NFS-e e declarações: o simulador fora de produção. */
  readonly destinoExterno: 'simulador' | 'real';
}

export interface ContaBancariaResposta {
  readonly id: number;
  readonly banco: number;
  readonly agencia: number;
  readonly codigo: number;
  readonly descricao: string;
  readonly situacao: string;
  readonly saldo: number;
  readonly saldoFechadoEm: string | null;
  readonly saldoApuradoOutroSistema: number | null;
}

export interface ApoioFinanceiro {
  readonly hoje: string;
  readonly contas: readonly ContaBancariaResposta[];
  readonly classificacoes: readonly { grupo: number; subgrupo: number; item: number; nome: string }[];
  readonly retencoes: readonly { codigo: number; descricao: string; tipo: number }[];
  readonly formasPagamento: readonly { codigo: number; nome: string }[];
  readonly tiposCredor: readonly { codigo: string; rotulo: string }[];
}

export interface TituloPagarResposta {
  readonly id: number;
  readonly credor: number;
  readonly credorNome: string;
  readonly credorEncontrado: boolean;
  readonly documento: number;
  readonly parcela: number;
  readonly tipo: string;
  readonly serie: string;
  readonly origem: string;
  readonly emissao: string | null;
  readonly vencimento: string | null;
  readonly valor: number;
  readonly valorDocumento: number;
  readonly pago: number;
  /** Saldo em aberto da parcela (F3.8, 07-FIN linha 63: a baixa parcial deixa saldo). */
  readonly saldo?: number;
  readonly dataPagamento: string | null;
  readonly bordero: number;
  readonly status: number | null;
  readonly situacao: SituacaoTituloPagar;
  readonly lancadoPor: string;
  readonly referente: string;
  readonly aprovacoes: number;
  readonly versao: string;
}

export interface ListaTitulosPagar {
  readonly itens: readonly TituloPagarResposta[];
  readonly pagina: number;
  readonly mais: boolean;
}

export interface DetalheTituloPagarResposta extends TituloPagarResposta {
  readonly parcelas: readonly {
    id: number;
    parcela: number;
    vencimento: string | null;
    valor: number;
    /** Saldo em aberto da parcela (a baixa parcial deixa saldo). */
    saldo?: number;
    situacao: string;
  }[];
  readonly classificacao: {
    grupo: number;
    subgrupo: number;
    item: number;
    nome: string;
    valor: number;
  } | null;
  readonly retencoes: readonly { codigo: number; descricao: string; tipo: number; valor: number }[];
  readonly profissional: number | null;
  readonly rateio: readonly { centroCusto: number; percentual: number; valor: number }[];
  readonly aprovacoesFeitas: readonly { aprovador: string; ordem: number; em: string }[];
  readonly documentoCredor: string;
  /** A faixa de alçada que vale e quantas aprovações faltam. */
  readonly alcada: { faixa: number | null; exigidas: number; feitas: number; aprovado: boolean } | null;
  readonly legendaStatus: string;
}

export interface ItemFilaAprovacao extends TituloPagarResposta {
  readonly faixa: number | null;
  readonly exigidas: number;
  readonly feitas: number;
  readonly permissaoDaFaixa: string | null;
}

export interface FaixaAlcadaResposta {
  readonly id: number;
  readonly centroCusto: number | null;
  readonly tipoCredor: string | null;
  readonly valorDe: number;
  readonly valorAte: number | null;
  readonly aprovacoes: number;
  readonly permissao: string;
  readonly vigenciaInicio: string;
  readonly vigenciaFim: string | null;
  readonly ativa: boolean;
}

export interface BorderoResposta {
  readonly id: number;
  readonly numero: number;
  readonly data: string | null;
  readonly valor: number;
  readonly conta: number;
  readonly usuario: string;
  readonly titulos: number;
}

/** Credor achado pela busca (nome, documento ou código): fornecedor ou profissional, pelo tipo pedido. */
export interface CredorEncontrado {
  readonly id: number;
  readonly nome: string;
  /** CNPJ ou CPF do fornecedor; do profissional não sai documento pessoal (só o nome e o código). */
  readonly documento: string | null;
}

export interface AdiantamentoResposta {
  readonly id: number;
  readonly credor: number;
  /** Nome do credor no cadastro (vazio quando o cadastro não o tem). */
  readonly credorNome: string;
  readonly tipoCredor: 'fornecedor' | 'profissional';
  /** Número de negócio do adiantamento (AD-...). */
  readonly numero: string;
  readonly documento: number;
  readonly emissao: string | null;
  readonly prazo: string | null;
  readonly referente: string;
  readonly situacao: string;
  readonly valor: number;
  readonly compensado: number;
  readonly saldo: number;
  /** Conta de saída escolhida no pedido. */
  readonly conta: number | null;
  /** Aprovações registradas na alçada e quantas a faixa exige (o pedido só é pago com todas). */
  readonly aprovacoes: number;
  readonly exigidas: number;
}

export interface TituloReceberResposta {
  readonly id: number;
  readonly devedor: string;
  readonly codigo: number;
  readonly convenio: number;
  readonly documento: number;
  readonly apresentacao: string | null;
  readonly vencimento: string | null;
  readonly valor: number;
  readonly recebido: number;
  readonly dataRecebimento: string | null;
  readonly origem: string;
  readonly origemBaixa: string;
  readonly nome: string;
  readonly contas: number;
  readonly glosaAceita: number;
  readonly situacao: 'aberto' | 'vencido' | 'recebido' | 'recebido-parcial';
  readonly versao: string;
}

export interface ListaTitulosReceber {
  readonly itens: readonly TituloReceberResposta[];
  readonly pagina: number;
  readonly mais: boolean;
}

export interface DetalheTituloReceberResposta extends TituloReceberResposta {
  readonly contasLigadas: readonly { id: number; tipo: string; competencia: string; total: number }[];
  readonly glosa: {
    readonly itens: number;
    readonly baixados: number;
    readonly cobradoBaixado: number;
    readonly pagoBaixado: number;
    readonly glosado: number;
    readonly pagoAMaior: number;
    readonly taxa: number;
  };
  readonly glosas: readonly {
    id: number;
    item: number | null;
    situacao: string;
    valor: number;
    motivo: string;
    em: string;
  }[];
  /** O saldo mostrado (valor − recebido − glosa aceita) e o recebível do recurso deferido. */
  readonly saldo: number;
  readonly recebivelRecurso: number;
}

export interface ContaSemTituloResposta {
  readonly id: number;
  readonly convenio: number;
  readonly tipo: string;
  readonly competencia: string;
  readonly fechada: string;
  readonly total: number;
  readonly apresentacao: string | null;
  readonly versao: string;
}

export interface MovimentoResposta {
  readonly id: number;
  readonly data: string | null;
  readonly documento: number;
  readonly tipo: string;
  readonly rotuloTipo: string;
  readonly valor: number;
  readonly historico: string;
  readonly contaCredito: number | null;
  readonly contaDebito: number | null;
  readonly classificacao: string;
  readonly usuario: string;
}

export interface LinhaExtratoResposta {
  readonly id: number;
  readonly data: string;
  readonly valor: number;
  readonly historico: string;
  readonly documento: string;
  readonly situacao: string;
}

export interface SugestaoConciliacaoResposta {
  readonly linha: number;
  readonly tipo: 'movimento' | 'titulo-pagar' | 'titulo-receber';
  readonly id: number;
  readonly data: string;
  readonly valor: number;
  readonly regra: 'valor-data' | 'valor-janela' | 'documento';
}

export interface ConciliacaoResposta {
  readonly conta: number;
  readonly linhas: readonly LinhaExtratoResposta[];
  readonly sugestoes: readonly SugestaoConciliacaoResposta[];
  readonly creditosSemCasamento: readonly number[];
}

export interface CreditoPendenteResposta {
  readonly id: number;
  readonly conta: number;
  readonly data: string;
  readonly valor: number;
  readonly situacao: string;
  readonly tituloReceber: number | null;
  readonly origem: 'extrato' | 'movimento';
}

export interface FluxoCaixaResposta {
  readonly agrupamento: 'dia' | 'semana' | 'mes';
  readonly de: string;
  readonly ate: string;
  readonly saldoInicial: number;
  readonly linhas: readonly {
    periodo: string;
    entradasRealizadas: number;
    saidasRealizadas: number;
    entradasProjetadas: number;
    saidasProjetadas: number;
    saldo: number;
  }[];
  /** Como o projetado foi feito (glosa histórica e atraso médio por convênio). */
  readonly premissas: readonly { convenio: number; taxaGlosa: number; atrasoMedioDias: number }[];
}

/** A apropriação gerencial do documento a pagar (na parcela 1) com o rateio por centro de custo. */
export interface ApropriacaoGerencialResposta {
  readonly titulo: number | null;
  readonly credor: number;
  readonly documento: number;
  readonly tipo: string;
  readonly serie: string;
  readonly data: string | null;
  readonly grupo: number;
  readonly subgrupo: number;
  readonly item: number;
  readonly nome: string;
  readonly valor: number;
  /** Quantos centros de custo o documento tem no rateio do novo (SGH_FIN_RATEIO); 0 = sem rateio. */
  readonly centrosCusto: number;
}

export interface ListaApropriacoes {
  readonly itens: readonly ApropriacaoGerencialResposta[];
  readonly pagina: number;
  readonly mais: boolean;
}

export interface DreResposta {
  readonly regua: 'competencia' | 'caixa';
  readonly linhas: readonly {
    mes: string;
    receitaCompetencia: number;
    glosaAceita: number;
    receitaLiquidaCompetencia: number;
    receitaCaixa: number;
    despesaCompetencia: number;
    despesaCaixa: number;
    resultadoCompetencia: number;
    resultadoCaixa: number;
    divergenciaReceita: number | null;
  }[];
  readonly aberturaDespesas: readonly { grupo: number; valor: number }[];
}

export interface IndicadorResposta {
  readonly codigo: string;
  readonly titulo: string;
  readonly valor: number;
  readonly unidade: '%' | 'titulos' | 'contas';
  readonly parcelas: readonly { rotulo: string; valor: number }[];
}

export interface EscrituracaoResposta {
  readonly nota: number;
  readonly numero: string;
  readonly emissao: string | null;
  readonly fornecedor: number;
  readonly cfop: number | null;
  readonly tipoDocumento: number | null;
  readonly chaveNfe: string;
  readonly itens: number;
  readonly itensComCfop: number;
}

export interface RegistroFiscalResposta {
  readonly [coluna: string]: string | number | null;
}

export interface WorklistFinanceiro {
  readonly cartoes: readonly {
    codigo: string;
    titulo: string;
    quantidade: number;
    rota: string;
    prazo: string;
  }[];
}
