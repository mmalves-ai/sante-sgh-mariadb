// Cliente das rotas da fila com o ERP corporativo (F8, 08-INTG L136): /api/integracoes/erp (fila-erp.controller.ts).
// Gravações com CSRF e Idempotency-Key.
import { z } from 'zod';
import { enviar, ler, novaChave } from '../exames/api-exames.js';

const B = '/api/integracoes/erp';

export const TIPOS_FILA_ERP = ['pagar', 'receber', 'estoque', 'compras', 'faturamento'] as const;
export type TipoFilaErp = (typeof TIPOS_FILA_ERP)[number];

export const esquemaLoteErp = z.object({
  id: z.number(),
  numero: z.string(),
  tipo: z.string().nullable(),
  situacao: z.string(),
  sistema: z.string(),
  sistemaNome: z.string(),
  inicio: z.string().nullable(),
  fim: z.string().nullable(),
  quantidade: z.number(),
  erros: z.number(),
  valorTotal: z.number().nullable(),
  protocolo: z.string().nullable(),
  geradoEm: z.string().nullable(),
  enviadoEm: z.string().nullable(),
  processadoEm: z.string().nullable(),
  conciliadoEm: z.string().nullable(),
  observacao: z.string().nullable(),
  versao: z.number(),
});
export type LoteErp = z.infer<typeof esquemaLoteErp>;

export const esquemaItemErp = z.object({
  id: z.number(),
  sequencia: z.number(),
  entidade: z.string(),
  entidadeId: z.number().nullable(),
  documento: z.string().nullable(),
  data: z.string().nullable(),
  valor: z.number().nullable(),
  situacao: z.string(),
  chaveExterna: z.string().nullable(),
  mensagem: z.string().nullable(),
});
export type ItemErp = z.infer<typeof esquemaItemErp>;

const esquemaSistema = z.object({ codigo: z.string(), nome: z.string(), ativo: z.boolean() });

export const lerSistemasErp = async () =>
  (await ler(`${B}/sistemas`, z.object({ itens: z.array(esquemaSistema) }))).itens;

export const lerLotesErp = async (tipo: string | null, situacao: string | null) => {
  const q = new URLSearchParams();
  if (tipo) q.set('tipo', tipo);
  if (situacao) q.set('situacao', situacao);
  return (await ler(`${B}/lotes?${q.toString()}`, z.object({ itens: z.array(esquemaLoteErp) }))).itens;
};

export const lerLoteErp = (id: number) =>
  ler(`${B}/lotes/${id}`, z.object({ lote: esquemaLoteErp, itens: z.array(esquemaItemErp) }));

const comId = z.object({ id: z.number() }).passthrough();

export const gerarLoteErp = (d: { tipo: TipoFilaErp; sistema: string; inicio: string; fim: string }) =>
  enviar(`${B}/lotes`, d, comId, novaChave('fila-erp'));

export const enviarLoteErp = (id: number, versao: number) =>
  enviar(`${B}/lotes/${id}/enviar`, { versao }, comId, novaChave('fila-erp'));

export const conciliarLoteErp = (
  id: number,
  versao: number,
  valorInformado: number | null,
  observacao: string | null,
) =>
  enviar(`${B}/lotes/${id}/conciliar`, { versao, valorInformado, observacao }, comId, novaChave('fila-erp'));

export const cancelarLoteErp = (id: number, versao: number, motivo: string) =>
  enviar(`${B}/lotes/${id}/cancelar`, { versao, motivo }, comId, novaChave('fila-erp'));
