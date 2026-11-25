// Cliente da tela do encontro de contas (F8, 07-FIN linha 69): os parceiros com saldo a pagar e a receber (mesmo CNPJ
// ou CPF), as parcelas em aberto dos dois lados, os encontros do estabelecimento e as gravações (propor, efetivar por
// outra pessoa, cancelar o pendente e estornar o efetivado, com motivo). A regra e a alçada ficam no servidor.
import type { ResultadoFinanceiro } from '@sgh/contratos';
import { z } from 'zod';
import { enviar, ler, qs } from '../exames/api-exames.js';

const P = '/api/financeiro/compensacao';

export interface ParceiroEncontro {
  readonly id: number;
  readonly nome: string;
  /** Saldo em aberto a pagar ao parceiro. */
  readonly pagar: number;
  /** Saldo em aberto a receber do parceiro (devedor com o mesmo CNPJ ou CPF). */
  readonly receber: number;
}
export interface ParcelaEncontroTela {
  readonly id: number;
  readonly titulo: string;
  readonly documento: string;
  readonly parcela: number;
  readonly vencimento: string;
  readonly saldo: number;
  readonly emOutroEncontro: boolean;
  /** Lado a receber: quem deve (o cliente financeiro ou a fonte pagadora com o mesmo CNPJ). */
  readonly devedor?: string;
  readonly tipoDevedor?: 'cliente' | 'fonte_pagadora';
}
export interface ParcelasDoParceiro {
  readonly pagar: readonly ParcelaEncontroTela[];
  readonly receber: readonly ParcelaEncontroTela[];
}
export type SituacaoEncontro = 'rascunho' | 'aguardando_aprovacao' | 'aprovado' | 'efetivado' | 'cancelado';
export interface EncontroContas {
  readonly id: number;
  readonly numero: string;
  readonly data: string;
  readonly situacao: SituacaoEncontro;
  readonly parceiro: string;
  readonly totalPagar: number;
  readonly totalReceber: number;
  readonly saldoLiquido: number;
  readonly compensado: number;
  readonly propostoPor: number | null;
  readonly motivo: string | null;
}
export interface PropostaEncontro {
  readonly fornecedor: number;
  readonly data: string;
  readonly parcelasPagar: readonly number[];
  readonly parcelasReceber: readonly number[];
  readonly observacao?: string;
}

const confiar = <X>() => z.custom<X>((v) => v !== null && typeof v === 'object');
const resultado = confiar<ResultadoFinanceiro>();

export const lerParceirosEncontro = (): Promise<ParceiroEncontro[]> =>
  ler(`${P}/parceiros`, z.array(confiar<ParceiroEncontro>()));
export const lerParcelasDoParceiro = (fornecedor: number): Promise<ParcelasDoParceiro> =>
  ler(`${P}/parcelas${qs({ fornecedor })}`, confiar<ParcelasDoParceiro>());
export const lerEncontros = (): Promise<EncontroContas[]> =>
  ler(`${P}/encontros`, z.array(confiar<EncontroContas>()));

export const proporEncontro = (p: PropostaEncontro, chave: string): Promise<ResultadoFinanceiro> =>
  enviar(`${P}/encontros`, p, resultado, chave);
/** Aprova e efetiva (outra pessoa que não quem propôs, com a alçada dos títulos a pagar cumprida). */
export const efetivarEncontro = (encontro: number, chave: string): Promise<ResultadoFinanceiro> =>
  enviar(`${P}/encontros/efetivar`, { encontro }, resultado, chave);
export const cancelarEncontro = (
  encontro: number,
  motivo: string,
  chave: string,
): Promise<ResultadoFinanceiro> => enviar(`${P}/encontros/cancelar`, { encontro, motivo }, resultado, chave);
export const estornarEncontro = (
  encontro: number,
  motivo: string,
  chave: string,
): Promise<ResultadoFinanceiro> => enviar(`${P}/encontros/estornar`, { encontro, motivo }, resultado, chave);

/** O que a marcação dá, na hora (o servidor confere de novo pela regra do domínio). */
export function resumoMarcacao(
  pagar: readonly ParcelaEncontroTela[],
  receber: readonly ParcelaEncontroTela[],
): { totalPagar: number; totalReceber: number; compensado: number; saldoLiquido: number } {
  const c = (v: number) => Math.round(v * 100) / 100;
  const totalPagar = c(pagar.reduce((s, p) => s + p.saldo, 0));
  const totalReceber = c(receber.reduce((s, p) => s + p.saldo, 0));
  return {
    totalPagar,
    totalReceber,
    compensado: Math.min(totalPagar, totalReceber),
    saldoLiquido: c(totalReceber - totalPagar),
  };
}
