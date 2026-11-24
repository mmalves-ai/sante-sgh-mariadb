// Cliente da gestão do pedido de compra emitido (F3.6, 05-SUP linha 20): a leitura da tela (itens com a agenda de
// entregas, contatos com o fornecedor e motivos) e as gravações (agenda, contato, cancelamento e motivo).
import {
  esquemaResultadoSuprimentos,
  type GestaoPedidoCompra,
  type ResultadoSuprimentos,
} from '@sgh/contratos';
import { z } from 'zod';
import { enviar, ler } from '../exames/api-exames.js';

const P = (ano: number, doc: number) => `/api/suprimentos/pedidos/${ano}/${doc}`;

export const lerGestaoPedido = (ano: number, doc: number): Promise<GestaoPedidoCompra> =>
  ler(
    `${P(ano, doc)}/gestao`,
    z.custom<GestaoPedidoCompra>((v) => typeof v === 'object' && v !== null),
  );
export const programarEntregas = (
  ano: number,
  doc: number,
  e: unknown,
  chave: string,
): Promise<ResultadoSuprimentos> => enviar(`${P(ano, doc)}/entregas`, e, esquemaResultadoSuprimentos, chave);
export const acompanharPedido = (
  ano: number,
  doc: number,
  e: unknown,
  chave: string,
): Promise<ResultadoSuprimentos> =>
  enviar(`${P(ano, doc)}/acompanhamentos`, e, esquemaResultadoSuprimentos, chave);
export const cancelarCompra = (
  ano: number,
  doc: number,
  e: unknown,
  chave: string,
): Promise<ResultadoSuprimentos> =>
  enviar(`${P(ano, doc)}/cancelamento`, e, esquemaResultadoSuprimentos, chave);
export const gravarMotivoCancelamento = (e: unknown, chave: string): Promise<ResultadoSuprimentos> =>
  enviar('/api/suprimentos/motivos-cancelamento-compra', e, esquemaResultadoSuprimentos, chave);
