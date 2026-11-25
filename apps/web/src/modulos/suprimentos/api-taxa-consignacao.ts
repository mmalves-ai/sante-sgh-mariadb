// Cliente da taxa de comercialização do consignado por faixa de valor (05-SUP linha 24): a leitura da tabela vigente e
// do histórico e a gravação da tabela nova (CSRF e Idempotency-Key; o reenvio do mesmo pedido não grava duas vezes).
import type { FaixaTaxaConsignacao, FaixaTaxaConsignacaoEntrada } from '@sgh/dominio-suprimentos';
import { tokenCsrf } from '../../api.js';
import { erroDaResposta } from '../../casca/erros/problem-details.js';
import { novaChaveM464 } from './api-consignado.js';

const T = '/api/suprimentos/consignados/taxas';

export interface TabelasTaxaConsignacao {
  readonly hoje: string;
  readonly fornecedor: number | null;
  readonly vigentes: FaixaTaxaConsignacao[];
  readonly origem: 'fornecedor' | 'geral' | 'sem-tabela';
  readonly historico: FaixaTaxaConsignacao[];
}

export async function lerTabelasTaxaConsignacao(fornecedor: number | null): Promise<TabelasTaxaConsignacao> {
  const r = await fetch(`${T}${fornecedor ? `?fornecedor=${fornecedor}` : ''}`, {
    headers: { accept: 'application/json' },
  });
  if (!r.ok) throw await erroDaResposta(r);
  return (await r.json()) as TabelasTaxaConsignacao;
}

export async function gravarTabelaTaxaConsignacao(
  corpo: { fornecedor: number | null; inicio: string; faixas: FaixaTaxaConsignacaoEntrada[] },
  chave: string = novaChaveM464('taxa'),
): Promise<{ ids: number[] }> {
  const r = await fetch(T, {
    method: 'POST',
    headers: {
      accept: 'application/json',
      'content-type': 'application/json',
      'x-csrf': tokenCsrf(),
      'idempotency-key': chave,
    },
    body: JSON.stringify(corpo),
  });
  if (!r.ok) throw await erroDaResposta(r);
  return (await r.json()) as { ids: number[] };
}
