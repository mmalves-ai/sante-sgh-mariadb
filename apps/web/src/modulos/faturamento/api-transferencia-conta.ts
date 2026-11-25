// Cliente da transferência da conta inteira, por lote e do estorno (F3.7, 06-FAT linha 14). As regras vêm de
// @sgh/dominio-faturamento (as mesmas da API), para a validação aparecer enquanto se escolhe; o servidor confere de novo.
import { z } from 'zod';
import { enviar, ler } from '../exames/api-exames.js';

const F = '/api/faturamento';
const qualquer = z.record(z.string(), z.unknown());

const esquemaPainel = z.object({
  contaId: z.number(),
  numero: z.string(),
  situacao: z.string(),
  editavel: z.boolean(),
  fontePagadoraId: z.number(),
  planoId: z.number().nullable(),
  fontes: z.array(z.object({ id: z.number(), nome: z.string() })),
  planos: z.array(z.object({ id: z.number(), fonteId: z.number(), descricao: z.string() })),
  outrasContas: z.array(
    z.object({
      id: z.number(),
      numero: z.string(),
      fonte: z.string(),
      aberta: z.boolean(),
      transferiveis: z.number(),
    }),
  ),
  transferiveis: z.number(),
  sugestao: z
    .object({
      fontePagadora: z.number(),
      plano: z.number().nullable(),
      desde: z.string(),
      itens: z.array(z.number()),
      fonte: z.string(),
    })
    .nullable(),
  transferencias: z.array(
    z.object({
      id: z.number(),
      numero: z.string(),
      tipo: z.string(),
      situacao: z.string(),
      saiu: z.boolean(),
      origem: z.string(),
      destino: z.string(),
      em: z.string(),
      motivo: z.string(),
      motivoEstorno: z.string().nullable(),
    }),
  ),
  previa: z.array(
    z.object({
      id: z.number(),
      precoNoDestino: z.boolean(),
      valorDestino: z.number().nullable(),
      valorOrigem: z.number(),
      realizado: z.string().nullable(),
    }),
  ),
});
export type PainelTransferencia = z.infer<typeof esquemaPainel>;

export interface DestinoEscolhido {
  fontePagadoraId: number;
  planoId: number | null;
  desde: string | null;
}

export function lerPainelTransferencia(conta: number, d: DestinoEscolhido | null) {
  const q = new URLSearchParams();
  if (d && d.fontePagadoraId > 0) {
    q.set('fontePagadoraId', String(d.fontePagadoraId));
    if (d.planoId) q.set('planoId', String(d.planoId));
    if (d.desde) q.set('desde', d.desde);
  }
  const s = q.toString();
  return ler(`${F}/contas/${conta}/transferencia-painel${s ? `?${s}` : ''}`, esquemaPainel);
}

export interface PedidoTransferenciaConta {
  destinoNovo: { fontePagadoraId: number; planoId: number | null };
  desde: string | null;
  motivo: string;
  aceitarSemCobertura: boolean;
  justificativaCobertura: string | null;
}
export const transferirConta = (conta: number, corpo: PedidoTransferenciaConta, chave: string) =>
  enviar(`${F}/contas/${conta}/transferencia-conta`, corpo, qualquer, chave);

export const transferirLote = (
  corpo: PedidoTransferenciaConta & { contas: { contaOrigemId: number }[] },
  chave: string,
) => enviar(`${F}/transferencias/lote`, corpo, qualquer, chave);

export const estornarTransferencia = (id: number, motivo: string, chave: string) =>
  enviar(`${F}/transferencias/${id}/estorno`, { motivo }, qualquer, chave);
