// Cliente da tela do portador do título e das operações de desconto e cessão de recebíveis (F8, 07-FIN linha 79): os
// portadores com a condição vigente e o limite já tomado, as operações com os itens, a ficha do título com o portador
// de cada parcela e as gravações (manter portador, contratar, dar desfecho ao item, cancelar a operação). A regra
// (deságio, coobrigação, limite, parcela vencida ou já cedida) é a do domínio: a tela a mostra na hora e o servidor
// confere de novo na gravação.
import type { ResultadoFinanceiro } from '@sgh/contratos';
import { z } from 'zod';
import { enviar, ler, qs } from '../exames/api-exames.js';

const P = '/api/financeiro/nota-cessao';

export type TipoPortador =
  | 'carteira_propria'
  | 'cobranca_simples'
  | 'cobranca_descontada'
  | 'cobranca_caucionada'
  | 'cessao'
  | 'cartorio'
  | 'juridico';
export const TIPOS_PORTADOR: readonly TipoPortador[] = [
  'carteira_propria',
  'cobranca_simples',
  'cobranca_descontada',
  'cobranca_caucionada',
  'cessao',
  'cartorio',
  'juridico',
];
/** O portador bancário exige a conta de cobrança; o cessionário exige a pessoa jurídica (a mesma regra do servidor). */
export const TIPOS_COM_CONTA: readonly TipoPortador[] = [
  'cobranca_simples',
  'cobranca_descontada',
  'cobranca_caucionada',
];
export type TipoOperacao = 'desconto_duplicata' | 'cessao' | 'fomento';
/** Que portador faz cada tipo de operação (a mesma tabela do servidor). */
export const PORTADOR_DA_OPERACAO: Record<TipoOperacao, readonly TipoPortador[]> = {
  desconto_duplicata: ['cobranca_descontada', 'cobranca_caucionada'],
  cessao: ['cessao'],
  fomento: ['cessao'],
};

export interface OpcaoCessao {
  readonly id: number;
  readonly rotulo: string;
}
export interface ApoiosCessao {
  readonly contas: readonly OpcaoCessao[];
  readonly pessoas: readonly OpcaoCessao[];
}
export interface Portador {
  readonly portador: number;
  readonly codigo: string;
  readonly descricao: string;
  readonly tipo: TipoPortador;
  readonly ativo: boolean;
  readonly contaBancaria: number | null;
  readonly pessoaJuridica: number | null;
  readonly taxaDesconto: number | null;
  readonly prazoDias: number | null;
  readonly limiteCredito: number | null;
  readonly valorTarifa: number | null;
  readonly vigenciaInicio: string | null;
  readonly utilizado: number;
}
export interface ItemOperacao {
  readonly item: number;
  readonly parcela: number;
  readonly documento: string;
  readonly vencimento: string;
  readonly valorFace: number;
  readonly valorDesagio: number;
  readonly situacao: 'cedida' | 'liquidada' | 'recomprada' | 'devolvida' | string;
}
export interface OperacaoCessao {
  readonly operacao: number;
  readonly numero: number;
  readonly tipo: TipoOperacao;
  readonly dataOperacao: string;
  readonly taxaMensal: number;
  readonly comCoobrigacao: boolean;
  readonly valorFace: number;
  readonly valorDesagio: number;
  readonly valorTarifas: number;
  readonly valorIof: number;
  readonly valorLiquido: number;
  readonly situacao: 'rascunho' | 'contratada' | 'liquidada' | 'cancelada' | string;
  readonly portador: string | null;
  readonly itens: readonly ItemOperacao[];
}
export interface ParcelaReceberCessao {
  readonly parcela: number;
  readonly sequencia: number;
  readonly vencimento: string;
  readonly saldo: number;
  readonly situacao: string;
  readonly titulo: number;
  readonly numero: string;
  readonly documento: string;
  readonly contraparte: string | null;
  readonly portador: string | null;
}
export interface ParcelaDoTitulo {
  readonly parcela: number;
  readonly sequencia: number;
  readonly vencimento: string;
  readonly saldo: number;
  readonly situacao: string;
  readonly portador: string | null;
  readonly tipoPortador: TipoPortador | null;
  readonly operacao: {
    readonly numero: number;
    readonly tipo: TipoOperacao;
    readonly comCoobrigacao: boolean;
    readonly situacao: string;
    readonly situacaoItem: string;
  } | null;
}
export interface PortadorEntrada {
  readonly id: number | null;
  readonly codigo: string;
  readonly descricao: string;
  readonly tipo: TipoPortador;
  readonly contaBancaria: number | null;
  readonly pessoaJuridica: number | null;
  readonly taxaDesconto: number;
  readonly prazoDias: number | null;
  readonly limiteCredito: number | null;
  readonly valorTarifa: number | null;
  readonly vigenciaInicio: string;
  readonly ativo: boolean;
}
export interface ContratoEntrada {
  readonly portador: number;
  readonly tipo: TipoOperacao;
  readonly comCoobrigacao: boolean;
  readonly dataOperacao: string;
  readonly taxaMensal: number;
  readonly valorTarifas: number;
  readonly valorIof: number;
  readonly numeroContrato?: string;
  readonly parcelas: readonly number[];
  readonly observacao?: string;
}

const confiar = <X>() => z.custom<X>((v) => v !== null && typeof v === 'object');
const resultado = confiar<ResultadoFinanceiro>();

export const lerApoiosCessao = (): Promise<ApoiosCessao> => ler(`${P}/apoios`, confiar<ApoiosCessao>());
export const lerPortadores = (dataRef: string | null): Promise<Portador[]> =>
  ler(`${P}/portadores${qs({ data: dataRef })}`, z.array(confiar<Portador>()));
export const lerOperacoesCessao = (): Promise<OperacaoCessao[]> =>
  ler(`${P}/operacoes`, z.array(confiar<OperacaoCessao>()));
export const lerParcelasCessao = (busca: string): Promise<ParcelaReceberCessao[]> =>
  ler(
    `${P}/parcelas${qs({ lado: 'receber', busca: busca.trim() || null })}`,
    z.array(confiar<ParcelaReceberCessao>()),
  );
export const lerPortadorDoTitulo = (titulo: number): Promise<ParcelaDoTitulo[]> =>
  ler(`${P}/titulos/${titulo}`, z.array(confiar<ParcelaDoTitulo>()));

export const gravarPortador = (e: PortadorEntrada, chave: string): Promise<ResultadoFinanceiro> =>
  enviar(`${P}/portadores`, e, resultado, chave);
export const contratarOperacao = (e: ContratoEntrada, chave: string): Promise<ResultadoFinanceiro> =>
  enviar(`${P}/operacoes`, e, resultado, chave);
export const desfechoItem = (
  item: number,
  acao: 'liquidar' | 'recomprar',
  dataDesfecho: string,
  valorRecompra: number | null,
  chave: string,
): Promise<ResultadoFinanceiro> =>
  enviar(
    `${P}/operacoes/desfecho`,
    { item, acao, data: dataDesfecho, ...(valorRecompra !== null ? { valorRecompra } : {}) },
    resultado,
    chave,
  );
export const cancelarOperacao = (
  operacao: number,
  motivo: string,
  chave: string,
): Promise<ResultadoFinanceiro> => enviar(`${P}/operacoes/cancelar`, { operacao, motivo }, resultado, chave);
