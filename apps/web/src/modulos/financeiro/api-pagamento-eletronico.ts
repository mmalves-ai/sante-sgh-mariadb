// F3.8, 07-FIN linha 66: cliente da tela do pagamento eletrônico (pagamento-eletronico.controller.ts): retorno do
// banco, dados bancários e chave Pix do credor e remessa por Pix.
import type { ResultadoFinanceiro } from '@sgh/contratos';
import { z } from 'zod';
import { enviar, ler, qs } from '../exames/api-exames.js';

const P = '/api/financeiro/pagamento-eletronico';
const confiar = <X>() => z.custom<X>((v) => v !== null && typeof v === 'object');

export interface RemessaComPendencia {
  readonly id: number;
  readonly numero: string;
  readonly sequencial: number;
  readonly situacao: string;
  readonly meio: 'pix' | 'transferencia';
  readonly conta: number;
  readonly contaNome: string;
  readonly valor: number;
  readonly geradaEm: string | null;
  readonly dataPagamento: string | null;
  readonly parcelas: number;
  readonly pendentes: number;
  readonly retornos: number;
}
export interface ItemRetornoTela {
  readonly sequencia: number;
  readonly parcela: number | null;
  readonly documento: string;
  readonly credor: string;
  readonly ocorrencia: string;
  readonly descricao: string;
  readonly complementares: string;
  readonly situacao: 'liquidado' | 'agendado' | 'rejeitado' | 'informativo' | 'nao_localizado';
  readonly dataPagamento: string | null;
  readonly valorEnviado: number | null;
  readonly valorEfetivado: number | null;
}
export interface RetornoLidoTela {
  readonly id: number;
  readonly arquivo: string;
  readonly importadoEm: string | null;
  readonly por: string;
  readonly situacao: string;
  readonly registros: number;
  readonly baixados: number;
  readonly rejeitados: number;
  readonly totalBaixado: number;
  readonly itens: readonly ItemRetornoTela[];
}
export interface ContaCredorTela {
  readonly id: number;
  readonly versao: number;
  readonly banco: number | null;
  readonly bancoNome: string;
  readonly tipoConta: string;
  readonly agencia: string | null;
  readonly conta: string | null;
  readonly tipoChavePix: string | null;
  readonly chavePix: string | null;
  readonly titularNome: string;
  readonly titularDocumento: string | null;
  readonly preferencial: boolean;
  readonly ativo: boolean;
  readonly chavesNoHistorico: number;
}
export interface ParcelaPixTela {
  readonly id: number;
  readonly documento: string;
  readonly parcela: number;
  readonly credor: number;
  readonly credorNome: string;
  readonly vencimento: string | null;
  readonly valor: number;
  readonly temChavePix: boolean;
}
export interface DadosContaCredor {
  readonly titularNome: string;
  readonly titularDocumento: string;
  readonly tipoConta: 'corrente' | 'poupanca' | 'pagamento' | 'salario';
  readonly banco: number | null;
  readonly agencia: string;
  readonly digitoAgencia: string;
  readonly conta: string;
  readonly digitoConta: string;
  readonly tipoChavePix: 'cpf' | 'cnpj' | 'email' | 'telefone' | 'aleatoria' | null;
  readonly chavePix: string;
  readonly preferencial: boolean;
}
export type ManterContaCredor =
  | ({ readonly acao: 'incluir'; readonly fornecedor: number } & DadosContaCredor)
  | ({ readonly acao: 'alterar'; readonly contaCredor: number; readonly versao: number } & DadosContaCredor)
  | { readonly acao: 'desativar'; readonly contaCredor: number; readonly versao: number };

const lista = <X>() => z.array(confiar<X>());
const resultado = confiar<ResultadoFinanceiro>();

export const lerRemessasComPendencia = () => ler(`${P}/remessas`, lista<RemessaComPendencia>());
export const lerRetornos = (remessa: number) =>
  ler(`${P}/retornos${qs({ remessa })}`, lista<RetornoLidoTela>());
export const processarRetorno = (
  corpo: { remessa: number; nomeArquivo: string; conteudo: string },
  chave: string,
) => enviar(`${P}/retornos`, corpo, resultado, chave);
export const lerRetornoSimulado = (remessa: number) =>
  ler(`${P}/retorno-simulado${qs({ remessa })}`, confiar<{ nomeArquivo: string; conteudo: string }>());
export const lerContasDoCredor = (fornecedor: number) =>
  ler(`${P}/credores/contas${qs({ fornecedor })}`, lista<ContaCredorTela>());
export const lerBancos = () => ler(`${P}/bancos`, lista<{ id: number; nome: string }>());
export const manterContaCredor = (corpo: ManterContaCredor, chave: string) =>
  enviar(`${P}/credores/contas`, corpo, resultado, chave);
export const lerParcelasPix = () => ler(`${P}/pix/parcelas`, lista<ParcelaPixTela>());
export const gerarRemessaPix = (
  corpo: { conta: number; parcelas: number[]; dataPagamento: string },
  chave: string,
) => enviar(`${P}/pix/remessas`, corpo, resultado, chave);
