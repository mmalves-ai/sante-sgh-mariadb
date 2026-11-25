// F7, 07-FIN linha 78: cliente da tela da cobrança bancária com boleto (cobranca-bancaria.controller.ts): carteiras,
// parcelas que podem ganhar boleto, boletos (emissão em lote, cancelamento e impressão), remessas CNAB 240 e retornos.
import type { ResultadoFinanceiro } from '@sgh/contratos';
import { z } from 'zod';
import { enviar, ler, qs } from '../exames/api-exames.js';

const P = '/api/financeiro/cobranca-bancaria';
const confiar = <X>() => z.custom<X>((v) => v !== null && typeof v === 'object');
const lista = <X>() => z.array(confiar<X>());
const resultado = confiar<ResultadoFinanceiro>();

export interface CarteiraCobrancaTela {
  readonly id: number;
  readonly descricao: string;
  readonly carteira: string;
  readonly beneficiario: string;
  readonly conta: number;
  readonly contaNome: string;
  readonly ativo: boolean;
  readonly faixa: string;
  readonly disponiveis: number;
  readonly diasCompensacao: number;
  readonly tarifa: number | null;
  readonly aguardandoRemessa: number;
  readonly emAberto: number;
}
export interface ParcelaParaBoletoTela {
  readonly parcela: number;
  readonly titulo: string;
  readonly sequencia: number;
  readonly vencimento: string | null;
  readonly saldo: number;
  readonly devedor: string;
  readonly pagador: string;
  readonly temDocumento: boolean;
  readonly temBoleto: boolean;
}
export type SituacaoBoleto =
  'emitido' | 'registrado' | 'rejeitado' | 'pago' | 'baixado' | 'cancelado' | 'protestado';
export interface BoletoTela {
  readonly id: number;
  readonly carteira: number;
  readonly nossoNumero: string;
  readonly documento: string;
  readonly linhaDigitavel: string;
  readonly pagador: string;
  readonly emissao: string | null;
  readonly vencimento: string | null;
  readonly valor: number;
  readonly valorPago: number | null;
  readonly dataPagamento: string | null;
  readonly situacao: SituacaoBoleto;
  readonly enviado: boolean;
  readonly motivoCancelamento: string | null;
}
export interface BoletoImpressao {
  readonly id: number;
  readonly banco: string;
  readonly bancoNome: string;
  readonly beneficiario: string;
  readonly beneficiarioDocumento: string;
  readonly agenciaCodigo: string;
  readonly carteira: string;
  readonly localPagamento: string;
  readonly nossoNumero: string;
  readonly documento: string;
  readonly pagador: string;
  readonly pagadorDocumento: string;
  readonly emissao: string | null;
  readonly vencimento: string | null;
  readonly valor: number;
  readonly linhaDigitavel: string;
  readonly codigoBarras: string;
  readonly situacao: string;
  readonly instrucoes: readonly string[];
}
export interface RemessaCobrancaTela {
  readonly id: number;
  readonly numero: string;
  readonly sequencial: number;
  readonly geradaEm: string | null;
  readonly por: string;
  readonly titulos: number;
  readonly valor: number;
  readonly situacao: string;
  readonly mensagem: string | null;
  readonly rejeitados: number;
}
export interface ItemRetornoCobrancaTela {
  readonly sequencia: number;
  readonly ocorrencia: string;
  readonly descricao: string;
  readonly nossoNumero: string;
  readonly pagador: string;
  readonly situacao: string;
  readonly valorTitulo: number | null;
  readonly valorPago: number;
  readonly tarifa: number;
  readonly dataPagamento: string | null;
  readonly motivo: string | null;
}
export interface RetornoCobrancaTela {
  readonly id: number;
  readonly arquivo: string;
  readonly importadoEm: string | null;
  readonly por: string;
  readonly situacao: string;
  readonly registros: number;
  readonly liquidados: number;
  readonly rejeitados: number;
  readonly total: number;
  readonly tarifas: number;
  readonly itens: readonly ItemRetornoCobrancaTela[];
}
export interface DadosCarteira {
  readonly conta: number;
  readonly descricao: string;
  readonly codigoCarteira: string;
  readonly variacaoCarteira: string | null;
  readonly codigoBeneficiario: string;
  readonly convenio: string | null;
  readonly nossoNumeroInicial: number;
  readonly nossoNumeroFinal: number;
  readonly diasCompensacao: number;
  readonly valorTarifa: number | null;
  readonly localPagamento: string | null;
}
export type ManterCarteira =
  ({ readonly acao: 'incluir' } & DadosCarteira) | { readonly acao: 'desativar'; readonly carteira: number };
export interface ArquivoTexto {
  readonly nomeArquivo: string;
  readonly conteudo: string;
}

export const lerCarteirasCobranca = () => ler(`${P}/carteiras`, lista<CarteiraCobrancaTela>());
export const manterCarteiraCobranca = (corpo: ManterCarteira, chave: string) =>
  enviar(`${P}/carteiras`, corpo, resultado, chave);
export const lerParcelasParaBoleto = (busca: string) =>
  ler(`${P}/parcelas${qs({ busca })}`, lista<ParcelaParaBoletoTela>());
export const lerBoletos = (f: { carteira?: number | null; situacao?: string | null; busca?: string }) =>
  ler(
    `${P}/boletos${qs({ carteira: f.carteira, situacao: f.situacao, busca: f.busca })}`,
    lista<BoletoTela>(),
  );
export const emitirBoletos = (
  corpo: {
    carteira: number;
    parcelas: number[];
    pagadorDocumento: string | null;
    pagadorNome: string | null;
  },
  chave: string,
) => enviar(`${P}/boletos`, corpo, resultado, chave);
export const cancelarBoleto = (corpo: { boleto: number; motivo: string }, chave: string) =>
  enviar(`${P}/boletos/cancelar`, corpo, resultado, chave);
export const lerBoletoImpressao = (boleto: number) =>
  ler(`${P}/boletos/impressao${qs({ boleto })}`, confiar<BoletoImpressao>());
export const lerRemessasCobranca = (carteira: number) =>
  ler(`${P}/remessas${qs({ carteira })}`, lista<RemessaCobrancaTela>());
export const gerarRemessaCobranca = (corpo: { carteira: number; mensagem: string | null }, chave: string) =>
  enviar(`${P}/remessas`, corpo, resultado, chave);
export const lerArquivoRemessa = (remessa: number) =>
  ler(`${P}/remessas/arquivo${qs({ remessa })}`, confiar<ArquivoTexto & { conferido: boolean }>());
export const lerRetornosCobranca = (carteira: number) =>
  ler(`${P}/retornos${qs({ carteira })}`, lista<RetornoCobrancaTela>());
export const processarRetornoCobranca = (
  corpo: { carteira: number; nomeArquivo: string; conteudo: string },
  chave: string,
) => enviar(`${P}/retornos`, corpo, resultado, chave);
export const lerRetornoCobrancaSimulado = (carteira: number) =>
  ler(`${P}/retorno-simulado${qs({ carteira })}`, confiar<ArquivoTexto>());
