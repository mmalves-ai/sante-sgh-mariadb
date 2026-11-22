// Tipos de negócio das portas da operadora própria (F2.2, lote 02-09): ANS, atendimento ao beneficiário e portal do
// prestador, autorização prévia, cobrança e contas médicas. São a forma que os serviços, as portas em memória e as
// portas próprias trocam entre si; o vocabulário é neutro (booleano, data ISO AAAA-MM-DD, id numérico, número de
// negócio) e nenhum campo carrega código, sentinela ou nome de coluna do sistema de origem. O estabelecimento e o
// usuário de cada gravação vêm do contexto da sessão (ContextoNucleo), nunca da entrada.
// Melhoria: os domínios das telas de autorização deixam de citar tabelas do sistema de origem (são nomeados pelo uso).
import type { PortaOperadora } from './porta.js';
interface AcaoAutorizacao {
  readonly id: number;
  readonly versao: number;
  readonly usuario: string;
}

export const ANEXOS_COMPLEMENTO_MAX = 5;

export interface DadosAcessoPortalParaEntrada extends DadosAcessoPortalPrestador {
  readonly senhaResumo: string | null;
  readonly segundoFator: string | null;
}

export interface DadosAcessoPortalPrestador {
  readonly id: number;
  readonly operadora: number;
  readonly prestador: number;
  readonly prestadorNome: string;
  readonly login: string;
  readonly nome: string;
  readonly funcoes: string;
  readonly tipoAtendimento: number;
  readonly situacao: 'pendente' | 'ativo' | 'encerrado';
  readonly ativacaoValidaAte: string | null;
  readonly tentativas: number;
  readonly bloqueadoAte: string | null;
  readonly ultimoAcessoEm: string | null;
  readonly motivoEncerramento: string | null;
  readonly versao: number;
}

export interface DadosAnexoComplemento {
  readonly id: number;
  readonly evento: number;
  readonly prestador: number;
  readonly acesso: number;
  readonly ordem: number;
  readonly nome: string;
  readonly tipo: string;
  readonly tamanho: number;
  readonly sha256: string;
  readonly em: string;
  readonly por: string;
}

export interface EntradaArquivoEnvio {
  readonly nome: string;
  readonly bytes: number;
  readonly sha256: string;
  readonly base64: string;
}

export interface DadosAtivos {
  readonly produto: number;
  readonly nome: string;
  readonly registroAns: string | null;
  readonly segmentacao: string | null;
  readonly tipoContratacao: number;
  readonly quantidade: number;
}

export interface DadosAuditor {
  readonly id: number;
  readonly operadora: number;
  readonly login: string;
  readonly nome: string;
  readonly categoria: 'medico' | 'enfermeiro';
  readonly conselho: string;
  readonly numero: string;
  readonly uf: string;
  readonly inicio: string;
  readonly fim: string | null;
  readonly situacao: 'ativo' | 'encerrado';
  readonly motivoEncerramento: string | null;
  readonly versao: number;
  readonly emAnalise: number;
}

export interface DadosAutorizacaoDaSenha {
  readonly id: number;
  readonly protocolo: string;
  readonly senha: string;
  readonly situacao: string;
  readonly beneficiario: number;
  readonly prestadores: readonly number[];
  readonly validade: string | null;
  readonly itens: readonly {
    readonly tabela: number;
    readonly codigo: string;
    readonly autorizada: number | null;
  }[];
}

export interface DadosAutorizacao extends DadosAutorizacaoResumo {
  readonly beneficiarioNascimento: string;
  readonly beneficiarioSexo: string;
  readonly produtoNome: string;
  readonly produtoNatureza: 'plano' | 'cartaoDesconto';
  readonly segmentacao: string | null;
  readonly executante: number | null;
  readonly executanteNome: string | null;
  readonly guiaPrincipal: number | null;
  readonly guiaPrincipalProtocolo: string | null;
  readonly altaComplexidade: boolean;
  readonly origem: number;
  readonly prazoTipo: 'imediato' | 'padrao' | 'complexo';
  readonly cid: string | null;
  readonly indicacaoClinica: string;
  readonly profissional: { nome: string; conselho: string; numero: string; uf: string };
  readonly internacao: {
    tipo: number;
    diarias: number;
    diariasAutorizadas: number | null;
    admissaoPrevista: string;
  } | null;
  readonly complementoPedido: string | null;
  readonly complementoResposta: string | null;
  readonly junta: {
    divergencia: string;
    desempatador: string;
    crm: string;
    uf: string;
    notificadosEm: string;
    parecer: string | null;
  } | null;
  readonly auditor: number | null;
  readonly auditorNome: string | null;
  readonly decididaEm: string | null;
  readonly decididaPor: string | null;
  readonly critica: number | null;
  readonly fundamento: string | null;
  readonly parecer: string | null;
  readonly senhaValidade: string | null;
  readonly motivoCancelamento: string | null;
}

export interface DadosAutorizacaoResumo {
  readonly id: number;
  readonly operadora: number;
  readonly protocolo: string;
  readonly beneficiario: number;
  readonly beneficiarioNome: string;
  readonly carteirinha: string;
  readonly prestador: number;
  readonly prestadorNome: string;
  readonly tipoGuia: number;
  readonly carater: 'E' | 'U';
  readonly situacao: SituacaoAutorizacaoPorta;
  readonly solicitadaEm: string;
  readonly prazoEm: string;
  readonly vencida: boolean;
  readonly senha: string | null;
  readonly versao: number;
}

export interface DadosBaseMensalidade extends DadosContratoCobranca {
  readonly beneficiarios: readonly DadosBeneficiarioBase[];
  readonly reajustes: readonly { competencia: string; percentual: number }[];
  readonly jaGerada: boolean;
}

export interface DadosBeneficiarioBase {
  readonly id: number;
  readonly titular: number | null;
  readonly nome: string;
  readonly nascimento: string;
  readonly inclusao: string;
  readonly situacao: string;
  readonly exclusao: string | null;
}

export interface DadosBeneficiarioDaOperadora {
  readonly id: number;
  readonly operadora: number;
  readonly carteirinha: string;
  readonly nome: string;
}

export interface DadosBeneficiarioRessarcimento {
  readonly identificacao: string;
  readonly id: number;
  readonly carteirinha: string;
  readonly situacao: 'ativo' | 'suspenso' | 'excluido';
  readonly inclusao: string;
  readonly contrato: { readonly situacao: string; readonly inicio: string; readonly fim: string | null };
  readonly produto: {
    readonly situacao: string;
    readonly natureza: 'plano' | 'cartaoDesconto';
    readonly carencias: string;
    readonly segmentacao: string | null;
  };
  readonly coberturaParcial: boolean;
}

export interface DadosBeneficiarioSib {
  readonly id: number;
  readonly operadora: number;
  readonly carteirinha: string;
  readonly nome: string;
  readonly nascimento: string;
  readonly sexo: 'F' | 'M' | 'I';
  readonly cpf: string | null;
  readonly cns: string | null;
  readonly nomeMae: string;
  readonly vinculo: number;
  readonly titular: { readonly id: number; readonly carteirinha: string; readonly cco: string | null } | null;
  readonly inclusao: string;
  readonly situacao: 'ativo' | 'suspenso' | 'excluido';
  readonly exclusao: string | null;
  readonly produto: {
    readonly id: number;
    readonly natureza: 'plano' | 'cartaoDesconto';
    readonly registroAns: string | null;
    readonly segmentacao: string | null;
  };
  readonly contrato: {
    readonly id: number;
    readonly numero: string;
    readonly tipo: number;
    readonly contratanteDoc: string;
  };
  readonly complemento: DadosComplementoSib | null;
}

export interface DadosCobrancaDiops {
  readonly tipo: number;
  readonly competencia: string;
  readonly valor: number;
  readonly situacao: 'aberta' | 'paga' | 'cancelada' | 'renegociada';
  readonly vencimento: string;
  readonly pagoEm: string | null;
  readonly valorPago: number | null;
}

export interface DadosCobranca {
  readonly id: number;
  readonly operadora: number;
  readonly contrato: number;
  readonly contratoNumero: string;
  readonly tipoContrato: number;
  readonly tipoContratacao: number;
  readonly beneficiario: number | null;
  readonly pagadorNome: string;
  readonly pagadorDocumento: string;
  readonly tipo: number;
  readonly competencia: string;
  readonly descricao: string;
  readonly valor: number;
  readonly vencimento: string;
  readonly situacao: 'aberta' | 'paga' | 'cancelada' | 'renegociada';
  readonly situacaoEm: string;
  readonly pagoEm: string | null;
  readonly valorPago: number | null;
  readonly multa: number | null;
  readonly juros: number | null;
  readonly dispensaMotivo: string | null;
  readonly motivo: string | null;
  readonly acordoOrigem: number | null;
  readonly parcela: number | null;
  readonly parcelas: number | null;
  readonly acordoDestino: number | null;
  readonly notificadoEm: string | null;
  readonly notificacaoMeio: string | null;
  readonly notificacaoReferencia: string | null;
  readonly versao: number;
  readonly emitidaEm: string;
  readonly criadoEm: string;
  readonly criadoPor: string;
  readonly alteradoEm: string;
  readonly alteradoPor: string;
}

export interface EntradaCobranca {
  readonly operadora: number;
  readonly contrato: number;
  readonly beneficiario: number | null;
  readonly tipo: number;
  readonly competencia: string;
  readonly descricao: string;
  readonly valor: number;
  readonly vencimento: string;
  readonly acordoOrigem: number | null;
  readonly parcela: number | null;
  readonly parcelas: number | null;
  readonly itens: readonly EntradaItemCobranca[];
  readonly reajustes?: readonly { readonly competencia: string; readonly percentual: number }[];
}

export interface DadosComplementoSib {
  readonly beneficiario: number;
  readonly versao: number;
  readonly logradouro: string | null;
  readonly numero: string | null;
  readonly complemento: string | null;
  readonly bairro: string | null;
  readonly municipio: number | null;
  readonly cep: string | null;
  readonly resideExterior: boolean;
  readonly dnv: string | null;
  readonly coberturaParcial: boolean;
  readonly itensExcluidos: boolean;
  readonly cco: string | null;
  readonly motivoCancelamento: number | null;
  readonly aceito: string | null;
  readonly aceitoEm: string | null;
}

export interface EntradaComplementoSib {
  readonly beneficiario: number;
  readonly versao: number;
  readonly logradouro: string | null;
  readonly numero: string | null;
  readonly complemento: string | null;
  readonly bairro: string | null;
  readonly municipio: number | null;
  readonly cep: string | null;
  readonly resideExterior: boolean;
  readonly dnv: string | null;
  readonly coberturaParcial: boolean;
  readonly itensExcluidos: boolean;
  readonly cco: string | null;
  readonly motivoCancelamento: number | null;
  readonly usuario: string;
}

export interface DadosConsultaElegibilidade {
  readonly id: number;
  readonly carteirinha: string;
  readonly data: string;
  readonly elegivel: boolean;
  readonly motivos: string[];
  readonly beneficiario: number | null;
  readonly em: string;
  readonly por: string;
}

export interface EntradaConsultaElegibilidade {
  readonly operadora: number;
  readonly prestador: number;
  readonly acesso: number;
  readonly carteirinha: string;
  readonly data: string;
  readonly elegivel: boolean;
  readonly motivos: readonly string[];
  readonly beneficiario: number | null;
  readonly usuario: string;
}

export interface DadosConsultaProtocolo {
  readonly tipo: 'atendimento' | 'autorizacao';
  readonly id: number;
  readonly protocolo: string;
  readonly situacao: string;
  readonly abertoEm: string;
  readonly prazoEm: string;
  readonly vencido: boolean;
  readonly prestador: number | null;
}

export interface DadosConta extends DadosContaResumo {
  readonly operadoraNome: string;
  readonly registroAns: string;
  readonly operadoraCnpj: string;
  readonly prestadorDocumento: string;
  readonly prestadorPessoa: 'F' | 'J';
  readonly prestadorCnes: string | null;
  readonly arquivo: {
    readonly nome: string | null;
    readonly bytes: number;
    readonly sha256: string;
    readonly hashEpilogo: string;
    readonly versaoTiss: string;
  };
  readonly auditor: number | null;
  readonly analisadaEm: string | null;
  readonly analisadaPor: string | null;
  readonly observacao: string | null;
  readonly motivoDevolucao: string | null;
}

export interface DadosContaResumo {
  readonly id: number;
  readonly operadora: number;
  readonly prestador: number;
  readonly prestadorNome: string;
  readonly protocolo: string;
  readonly numeroLote: string;
  readonly tipoGuia: DadosTipoGuiaConta;
  readonly competencia: string;
  readonly guias: number;
  readonly recebidaEm: string;
  readonly prazoPagamento: string;
  readonly vencida: boolean;
  readonly situacao: SituacaoContaPorta;
  readonly apresentado: number;
  readonly glosado: number;
  readonly acatado: number;
  readonly pago: number;
  readonly recursosPendentes: number;
  readonly versao: number;
}

export interface DadosContratoCobranca {
  readonly id: number;
  readonly operadora: number;
  readonly numero: string;
  readonly tipo: number;
  readonly tipoContratacao: number;
  readonly situacao: string;
  readonly inicio: string;
  readonly fim: string | null;
  readonly diaVencimento: number | null;
  readonly mesReajuste: number;
  readonly contratanteNome: string;
  readonly contratanteDocumento: string;
  readonly produto: number;
  readonly produtoNome: string;
  readonly natureza: string;
  readonly coparticipacao: { readonly tipo: number; readonly valor: number | null };
  readonly precos: readonly number[] | null;
}

export interface EntradaCriacaoAcessoPortal {
  readonly operadora: number;
  readonly prestador: number;
  readonly login: string;
  readonly nome: string;
  readonly funcoes: string;
  readonly tipoAtendimento: number;
  readonly ativacaoResumo: string;
  readonly ativacaoValidade: string;
  readonly usuario: string;
}

export interface EntradaDecisaoItem {
  readonly item: number;
  readonly valorAcatado: number;
  readonly parecer: string;
}

export type DecisaoRecursoItem = 'acatado' | 'parcial' | 'mantido';

export interface EntradaDecisao extends AcaoAutorizacao {
  readonly situacao: 'autorizada' | 'parcial' | 'negada';
  readonly itens: readonly { readonly id: number; readonly quantidade: number; readonly situacao: string }[];
  readonly diarias: number | null;
  readonly auditor: number;
  readonly critica: number | null;
  readonly fundamento: string | null;
  readonly parecer: string;
  readonly senha: string | null;
  readonly senhaValidade: string | null;
  readonly parecerJunta?: string | null;
}

export interface EntradaDesignacao {
  readonly operadora: number;
  readonly login: string;
  readonly nome: string;
  readonly categoria: 'medico' | 'enfermeiro';
  readonly conselho: string;
  readonly numero: string;
  readonly uf: string;
  readonly inicio: string;
  readonly usuario: string;
}

export type DominioAutorizacao = 'tipoGuia' | 'origem' | 'critica' | 'situacaoGuia';

/** A elegibilidade do beneficiário é a da porta da F1 (beneficiários): a mesma forma que ela devolve. */
export type DadosElegibilidadeBeneficiario = NonNullable<
  Awaited<ReturnType<PortaOperadora['elegibilidade']>>
>;

export interface DadosEnvioAns extends DadosEnvioAnsResumo {
  readonly quadros: string | null;
  readonly retornoResumo: string | null;
}

export interface DadosEnvioAnsResumo {
  readonly id: number;
  readonly versao: number;
  readonly operadora: { readonly id: number; readonly nome: string; readonly registroAns: string };
  readonly obrigacao: DadosObrigacao;
  readonly competencia: string;
  readonly sequencial: number;
  readonly retificador: boolean;
  readonly destino: 'simulador' | 'ans';
  readonly leiaute: string;
  readonly situacao: SituacaoEnvioPorta;
  readonly registros: number;
  readonly valorTotal: number | null;
  readonly arquivoNome: string | null;
  readonly arquivoBytes: number | null;
  readonly hash: string | null;
  readonly recibo: string | null;
  readonly criadoEm: string;
  readonly criadoPor: string;
  readonly enviadoEm: string | null;
  readonly retornoEm: string | null;
  readonly aviso: string | null;
  readonly recebidoEm: string | null;
  readonly prazo: string | null;
  readonly gru: string | null;
  readonly pagoEm: string | null;
  readonly valorPago: number | null;
}

export interface DadosEnvioExistente {
  readonly id: number;
  readonly obrigacao: DadosObrigacao;
  readonly competencia: string;
  readonly sequencial: number;
  readonly situacao: SituacaoEnvioPorta;
}

export interface DadosEventoAutorizacao {
  readonly id: number;
  readonly evento:
    | 'registro'
    | 'complemento-pedido'
    | 'complemento-resposta'
    | 'junta-aberta'
    | 'junta-concluida'
    | 'decisao'
    | 'cancelamento';
  readonly situacao: SituacaoAutorizacaoPorta;
  readonly texto: string | null;
  readonly em: string;
  readonly por: string;
}

export interface DadosEventoConta {
  readonly id: number;
  readonly evento: EntradaEventoConta;
  readonly situacao: SituacaoContaPorta;
  readonly guia: number | null;
  readonly valor: number | null;
  readonly pagoEm: string | null;
  readonly documento: string | null;
  readonly texto: string | null;
  readonly em: string;
  readonly por: string;
}

export type EntradaEventoConta =
  | 'recebimento'
  | 'glosa'
  | 'glosa-desfeita'
  | 'analise'
  | 'devolucao'
  | 'recurso'
  | 'recurso-decidido'
  | 'pagamento';

export interface DadosEventoEnvioAns {
  readonly evento: string;
  readonly situacao: SituacaoEnvioPorta;
  readonly texto: string | null;
  readonly por: string;
  readonly em: string;
}

export interface DadosEventoProtocolo {
  readonly id: number;
  readonly evento: string;
  readonly situacao: SituacaoProtocoloPorta;
  readonly texto: string | null;
  readonly em: string;
  readonly por: string;
}

export interface FiltroAutorizacoesPorta {
  readonly busca?: string;
  readonly situacao?: SituacaoAutorizacaoPorta;
  readonly vencidas?: boolean;
  readonly prestador?: number;
  readonly apos?: number;
  readonly limite?: number;
}

export interface FiltroCobrancasPorta {
  readonly operadora: number;
  readonly competencia?: string;
  readonly situacao?: string;
  readonly tipo?: number;
  readonly contrato?: number;
  readonly vencidasAntesDe?: string;
  readonly numero?: string;
  readonly apos?: number;
}

export interface FiltroContasPorta {
  readonly busca?: string;
  readonly prestador?: number;
  readonly competencia?: string;
  readonly situacao?: SituacaoContaPorta;
  readonly vencidas?: boolean;
  readonly recursos?: boolean;
  readonly apos?: number;
  readonly limite?: number;
}

export interface FiltroEnviosPorta {
  readonly operadora?: number | undefined;
  readonly obrigacao?: DadosObrigacao | undefined;
  readonly competencia?: string | undefined;
  readonly situacao?: SituacaoEnvioPorta | undefined;
  readonly apos?: number | undefined;
  readonly limite?: number | undefined;
}

export interface FiltroPagamentosPorta {
  readonly prestador?: number;
  readonly competencia?: string;
  readonly estado: 'a-pagar' | 'pagas' | 'todas';
  readonly apos?: number;
  readonly limite?: number;
}

export interface FiltroProtocolosPorta {
  readonly busca?: string;
  readonly situacao?: SituacaoProtocoloPorta;
  readonly instancia?: string;
  readonly natureza?: string;
  readonly vencidos?: boolean;
  readonly apos?: number;
  readonly limite?: number;
}

export interface EntradaGeracaoEnvio {
  readonly operadora: number;
  readonly obrigacao: string;
  readonly competencia: string;
  readonly sequencial: number;
  readonly retificador: boolean;
  readonly destino: 'simulador' | 'ans';
  readonly leiaute: string;
  readonly registros: number;
  readonly valorTotal: number | null;
  readonly quadros: string;
  readonly arquivo: EntradaArquivoEnvio | null;
  readonly aviso?: { readonly numero: string; readonly recebidoEm: string; readonly prazo: string } | null;
  readonly substituir: readonly number[];
  readonly itens: readonly EntradaItemEnvio[];
  readonly usuario: string;
}

export interface EntradaGlosaItem {
  readonly item: number;
  readonly valorGlosado: number;
  readonly motivo: number | null;
  readonly justificativa: string | null;
}

export interface DadosGuiaConta {
  readonly id: number;
  readonly ordem: number;
  readonly numeroGuiaPrestador: string;
  readonly numeroGuiaOperadora: string | null;
  readonly senha: string | null;
  readonly carteirinha: string;
  readonly beneficiario: { readonly id: number; readonly nome: string } | null;
  readonly autorizacao: { readonly id: number; readonly protocolo: string } | null;
  readonly carater: string | null;
  readonly inicio: string;
  readonly fim: string;
  readonly criticas: readonly string[];
  readonly apresentado: number;
  readonly glosado: number;
  readonly acatado: number;
  readonly recurso: {
    readonly situacao: 'pendente' | 'acatado' | 'parcial' | 'mantido';
    readonly valor: number;
    readonly justificativa: string;
    readonly registradoEm: string;
    readonly registradoPor: string;
    readonly parecer: string | null;
    readonly decididoEm: string | null;
    readonly decididoPor: string | null;
  } | null;
}

export interface DadosGuiaMonitoramento {
  readonly id: number;
  readonly protocolo: string;
  readonly prestadorDocumento: string;
  readonly prestadorCnes: string | null;
  readonly numeroGuiaPrestador: string;
  readonly numeroGuiaOperadora: string | null;
  readonly tipoGuia: string;
  readonly carater: string | null;
  readonly inicio: string;
  readonly fim: string;
  readonly carteirinhaApresentada: string;
  readonly beneficiario: {
    readonly id: number;
    readonly carteirinha: string;
    readonly cns: string | null;
    readonly sexo: string | null;
    readonly nascimento: string | null;
    readonly municipio: number | null;
    readonly cco: string | null;
  } | null;
  readonly itens: {
    tabela: string;
    codigo: string;
    quantidade: number;
    informado: number;
    glosado: number;
  }[];
}

export interface EntradaGuiaRecebida {
  readonly ordem: number;
  readonly numeroGuiaPrestador: string;
  readonly numeroGuiaOperadora: string | null;
  readonly senha: string | null;
  readonly carteirinha: string;
  readonly beneficiario: number | null;
  readonly autorizacao: number | null;
  readonly carater: '1' | '2' | null;
  readonly inicio: string;
  readonly fim: string;
  readonly criticas: readonly string[];
  readonly apresentado: number;
  readonly itens: readonly EntradaItemRecebido[];
}

export interface DadosItemAutorizacao {
  readonly id: number;
  readonly ordem: number;
  readonly tabela: number;
  readonly codigo: string;
  readonly descricao: string;
  readonly quantidadeSolicitada: number;
  readonly quantidadeAutorizada: number | null;
  readonly situacao: 'pendente' | 'autorizado' | 'parcial' | 'negado';
}

export interface DadosItemCobranca extends EntradaItemCobranca {
  readonly beneficiarioNome: string | null;
}

export interface EntradaItemCobranca {
  readonly beneficiario: number | null;
  readonly descricao: string;
  readonly idade: number | null;
  readonly faixa: number | null;
  readonly valorBase: number | null;
  readonly valor: number;
}

export interface DadosItemConta {
  readonly id: number;
  readonly guia: number;
  readonly ordem: number;
  readonly sequencial: number;
  readonly grupo: 'procedimento' | 'despesa';
  readonly codigoDespesa: string | null;
  readonly tabela: string;
  readonly codigo: string;
  readonly descricao: string;
  readonly data: string;
  readonly quantidade: number;
  readonly fator: number;
  readonly valorUnitario: number;
  readonly apresentado: number;
  readonly glosado: number;
  readonly motivo: number | null;
  readonly justificativa: string | null;
  readonly origem: 'automatica' | 'auditor' | null;
  readonly critica: string | null;
}

export interface DadosItemDominioAutorizacao {
  readonly codigo: number;
  readonly rotulo: string;
  readonly extraContrato?: boolean;
}

export interface DadosItemDominio {
  readonly id: number;
  readonly rotulo: string;
}

export interface DadosItemEnvioAns {
  readonly id: number;
  readonly ordem: number;
  readonly tipo: string;
  readonly referencia: string;
  readonly descricao: string;
  readonly beneficiario: number | null;
  readonly valor: number | null;
  readonly dados: string | null;
  readonly resultado: 'enviado' | 'aceito' | 'rejeitado';
  readonly erro: string | null;
  readonly cco: string | null;
  readonly sugestao: string | null;
  readonly decisao: 'pendente' | 'impugnar' | 'aceitar' | null;
  readonly motivo: string | null;
  readonly justificativa: string | null;
  readonly decididoEm: string | null;
  readonly decididoPor: string | null;
}

export interface EntradaItemEnvio {
  readonly ordem: number;
  readonly tipo: string;
  readonly referencia: string;
  readonly descricao: string;
  readonly beneficiario: number | null;
  readonly valor: number | null;
  readonly dados: string | null;
  readonly sugestao?: string | null;
  readonly decisao?: 'pendente' | 'impugnar' | 'aceitar' | null;
}

export interface EntradaItemRecebido {
  readonly ordem: number;
  readonly sequencial: number;
  readonly grupo: 'procedimento' | 'despesa';
  readonly codigoDespesa: string | null;
  readonly tabela: string;
  readonly codigo: string;
  readonly descricao: string;
  readonly data: string;
  readonly quantidade: number;
  readonly fator: number;
  readonly valorUnitario: number;
  readonly apresentado: number;
  readonly glosado: number;
  readonly motivo: number | null;
  readonly justificativa: string | null;
  readonly critica: string | null;
}

export interface EntradaItemRecorrido {
  readonly item: number;
  readonly valor: number;
  readonly justificativa: string;
}

export interface EntradaItemRegistro {
  readonly tabela: number;
  readonly codigo: string;
  readonly descricao: string;
  readonly quantidade: number;
}

export interface DadosItemSip {
  readonly id: number;
  readonly beneficiario: number | null;
  readonly segmentacao: string | null;
  readonly municipio: number | null;
  readonly dataExecucao: string;
  readonly tabela: string;
  readonly codigo: string;
  readonly quantidade: number;
  readonly apresentado: number;
  readonly glosado: number;
}

export const LIMITE_BUSCA_TUSS = 20;

export const LIMITE_CONTRATOS_GERACAO = 20;

export const LIMITE_PAGINA_AUTORIZACOES = 50;

export const LIMITE_PAGINA_COBRANCA = 100;

export const LIMITE_PAGINA_CONTAS = 50;

export const LIMITE_PAGINA_ENVIOS = 50;

export const LIMITE_PAGINA_PROTOCOLOS = 50;

export const LIMITE_PAGINA_SIB = 1000;

export type DadosObrigacao = 'SIB' | 'SIP' | 'DIOPS' | 'TPS' | 'MONITORAMENTO_TISS' | 'RESSARCIMENTO_SUS';

export interface DadosOperadora extends EntradaOperadora {
  readonly id: number;
  readonly versao: number;
  readonly alteradoEm: string;
}

export interface EntradaOperadora {
  readonly registroAns: string;
  readonly cnpj: string;
  readonly razaoSocial: string;
  readonly nomeFantasia: string | null;
  readonly modalidade: string;
  readonly situacao: string;
}

export interface DadosPrestadorParaAutorizacao {
  readonly id: number;
  readonly nome: string;
  readonly tipo: number;
  readonly regime: number | null;
  readonly municipioIbge: number;
  readonly uf: string;
}

export interface DadosProcedimentoTuss {
  readonly codigo: string;
  readonly nome: string;
  readonly vigente: boolean;
}

export interface DadosProtocolo extends DadosProtocoloResumo {
  readonly origem: number;
  readonly solicitante: string;
  readonly solicitanteNome: string | null;
  readonly autorizacao: { id: number; protocolo: string; situacao: string } | null;
  readonly origemProtocolo: { id: number; protocolo: string } | null;
  readonly numeroNip: string | null;
  readonly urgente: boolean;
  readonly altaComplexidade: boolean;
  readonly relato: string;
  readonly prazoTipo: string;
  readonly prorrogacaoMotivo: string | null;
  readonly resposta: string | null;
  readonly fundamento: string | null;
  readonly meio: string | null;
  readonly respondidoEm: string | null;
  readonly respondidoPor: string | null;
  readonly escritaPedidaEm: string | null;
  readonly escritaPrazoEm: string | null;
  readonly escritaMeio: string | null;
  readonly encerradoEm: string | null;
  readonly motivoCancelamento: string | null;
}

export interface DadosProtocoloResumo {
  readonly id: number;
  readonly operadora: number;
  readonly protocolo: string;
  readonly instancia: string;
  readonly natureza: string;
  readonly classe: string;
  readonly canal: string;
  readonly beneficiario: number | null;
  readonly beneficiarioNome: string | null;
  readonly carteirinha: string | null;
  readonly prestador: number | null;
  readonly assunto: string;
  readonly situacao: SituacaoProtocoloPorta;
  readonly abertoEm: string;
  readonly prazoEm: string;
  readonly prorrogadoAte: string | null;
  readonly vencido: boolean;
  readonly escritaPedida: boolean;
  readonly escritaEnviadaEm: string | null;
  readonly escritaVencida: boolean;
  readonly conclusao: string | null;
  readonly versao: number;
}

export interface DadosReajuste extends EntradaReajuste {
  readonly id: number;
  readonly contratoNumero: string;
  readonly tipoContratacao: number;
  readonly situacao: 'vigente' | 'cancelado';
  readonly canceladoMotivo: string | null;
  readonly registradoEm: string;
  readonly registradoPor: string;
  /** A versão do registro (trava otimista do cancelamento); ausente onde a porta não versiona. */
  readonly versao?: number;
}

export interface EntradaReajuste {
  readonly operadora: number;
  readonly contrato: number;
  readonly competencia: string;
  readonly percentual: number;
  readonly tetoAns: number | null;
  readonly oficioAns: string | null;
  readonly vidas: number;
  readonly motivo: string;
}

export interface DadosReanalise {
  readonly id: number;
  readonly protocolo: string;
  readonly situacao: SituacaoProtocoloPorta;
}

export interface EntradaRecebimentoConta {
  readonly operadora: number;
  readonly prestador: number;
  readonly protocolo: string;
  readonly numeroLote: string;
  readonly tipoGuia: 'consulta' | 'sp-sadt' | 'resumo-internacao' | 'honorario';
  readonly competencia: string;
  readonly prazoPagamento: string;
  readonly arquivo: {
    readonly nome: string | null;
    readonly bytes: number;
    readonly sha256: string;
    readonly base64: string;
    readonly hashEpilogo: string;
  };
  readonly apresentado: number;
  readonly guias: readonly EntradaGuiaRecebida[];
  readonly texto: string;
  readonly usuario: string;
}

export interface DadosRecursoItem {
  readonly id: number;
  readonly guia: number;
  readonly item: number;
  readonly valor: number;
  readonly justificativa: string;
  readonly em: string;
  readonly por: string;
  readonly decisao: {
    readonly decisao: DecisaoRecursoItem;
    readonly valorAcatado: number;
    readonly parecer: string;
    readonly em: string;
    readonly por: string;
  } | null;
}

export interface EntradaRegistroAutorizacao {
  readonly operadora: number;
  readonly beneficiario: number;
  readonly carteirinha: string;
  readonly prestador: number;
  readonly executante: number | null;
  readonly guiaPrincipal: number | null;
  readonly tipoGuia: number;
  readonly carater: 'E' | 'U';
  readonly altaComplexidade: boolean;
  readonly origem: number;
  readonly protocolo: string;
  readonly solicitadaEm: string;
  readonly prazoTipo: 'imediato' | 'padrao' | 'complexo';
  readonly prazoEm: string;
  readonly cid: string | null;
  readonly indicacaoClinica: string;
  readonly profissional: {
    readonly nome: string;
    readonly conselho: string;
    readonly numero: string;
    readonly uf: string;
  };
  readonly internacao: {
    readonly tipo: number;
    readonly diarias: number;
    readonly admissaoPrevista: string;
  } | null;
  readonly itens: readonly EntradaItemRegistro[];
  readonly usuario: string;
}

export interface EntradaRegistroProtocolo {
  readonly operadora: number;
  readonly protocolo: string;
  readonly instancia: string;
  readonly natureza: string;
  readonly classe: string;
  readonly canal: string;
  readonly origem: number;
  readonly solicitante: string;
  readonly solicitanteNome: string | null;
  readonly beneficiario: number | null;
  readonly carteirinha: string | null;
  readonly prestador: number | null;
  readonly autorizacao: number | null;
  readonly origemProtocolo: number | null;
  readonly numeroNip: string | null;
  readonly urgente: boolean;
  readonly altaComplexidade: boolean;
  readonly assunto: string;
  readonly relato: string;
  readonly abertoEm: string;
  readonly prazoTipo: string;
  readonly prazoEm: string;
  readonly escritaPedida: boolean;
  readonly usuario: string;
}

export interface DadosRespostaPrestador {
  readonly id: number;
  readonly interacao: number;
  readonly evento: number;
  readonly prestador: number;
  readonly acesso: number;
  readonly texto: string;
  readonly anexo: {
    readonly nome: string;
    readonly tipo: string;
    readonly tamanho: number;
    readonly sha256: string;
  } | null;
  readonly em: string;
  readonly por: string;
}

export interface EntradaResultadoItem {
  readonly id: number;
  readonly aceito: boolean;
  readonly cco: string | null;
  readonly erro: string | null;
}

export const SITUACOES_RESPOSTA_PRESTADOR = ['aberto', 'em-analise', 'respondido'] as const;

export type SituacaoAutorizacaoPorta =
  'em-analise' | 'pendente' | 'em-junta' | 'autorizada' | 'parcial' | 'negada' | 'cancelada';

export type SituacaoContaPorta = 'recebida' | 'analisada' | 'paga' | 'devolvida';

export type SituacaoEnvioPorta =
  'gerado' | 'enviado' | 'aceito' | 'aceitoParcial' | 'rejeitado' | 'substituido';

export type SituacaoProtocoloPorta = 'aberto' | 'em-analise' | 'respondido' | 'encerrado' | 'cancelado';

export type DadosTipoGuiaConta = 'consulta' | 'sp-sadt' | 'resumo-internacao' | 'honorario';

export interface TotaisAutorizacoes {
  readonly emAnalise: number;
  readonly pendentes: number;
  readonly emJunta: number;
  readonly vencidas: number;
  readonly decididasHoje: number;
}

export interface TotaisCobranca {
  readonly abertas: number;
  readonly valorAberto: number;
  readonly vencidas: number;
  readonly valorVencido: number;
  readonly pagasNoMes: number;
  readonly valorPagoNoMes: number;
}

export interface TotaisContas {
  readonly emAnalise: number;
  readonly aPagar: number;
  readonly vencidas: number;
  readonly recursosPendentes: number;
  readonly valorEmAnalise: number;
  readonly valorAPagar: number;
}

export interface TotaisEnvios {
  readonly gerados: number;
  readonly aguardandoRetorno: number;
  readonly rejeitados: number;
  readonly ressarcimentosEmPrazo: number;
}

export interface TotaisProtocolos {
  readonly abertos: number;
  readonly emAnalise: number;
  readonly vencidos: number;
  readonly escritaPendente: number;
  readonly respondidosHoje: number;
}

export interface DadosVigenciaSip {
  readonly procedimento: number;
  readonly grupo: number;
  readonly inicio: string;
  readonly fim: string | null;
}

/** Os campos do cadastro de beneficiários da ANS que a alteração cadastral informa (leiaute do SIB). */
export const CAMPOS_SIB = [
  'Carteirinha',
  'Nome',
  'Data de nascimento',
  'Sexo',
  'CPF',
  'Nome da mãe',
  'Declaração de nascido vivo',
  'Cartão Nacional de Saúde',
  'Titular',
  'Logradouro',
  'Número',
  'Complemento',
  'Bairro',
  'Município',
  'CEP',
  'Reside no exterior',
  'Data de adesão',
  'Relação de dependência',
  'CAEPF',
].map((nome, k) => ({ codigo: k + 1, nome }));
