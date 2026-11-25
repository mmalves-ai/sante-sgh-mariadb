// Cliente da liberação da OPME acima do limite do procedimento (06-FAT linha 25). A regra dos quatro olhos vem de
// @sgh/dominio-faturamento (a mesma da API), para a recusa aparecer antes de enviar; o servidor confere de novo.
import { z } from 'zod';
import { enviar, ler } from '../exames/api-exames.js';

const U = '/api/tiss/opme-liberacao';
const textoN = z.string().nullable();

const esquemaPedido = z.object({
  id: z.number(),
  versao: z.number(),
  situacao: z.string(),
  valor: z.number(),
  nivelAtual: z.number(),
  numero: textoN,
  solicitacao: z.number(),
  situacaoPedido: z.string(),
  paciente: textoN,
  fonte: textoN,
  solicitante: textoN,
  meu: z.boolean(),
  solicitadoEm: z.string(),
  motivoConclusao: textoN,
  limiteValor: z.number().nullable(),
  limiteQuantidade: z.number().nullable(),
  motivos: z.array(z.string()),
  justificativa: textoN,
  decisoes: z.array(
    z.object({
      nivel: z.number(),
      decisao: z.string(),
      justificativa: textoN,
      aprovador: textoN,
      em: textoN,
    }),
  ),
});
export type PedidoLiberacaoOpme = z.infer<typeof esquemaPedido>;
const esquemaPainel = z.object({ pedidos: z.array(esquemaPedido) });
const esquemaDecisao = z.object({ id: z.number(), situacao: z.string(), faltam: z.array(z.number()) });

export const lerLiberacoesOpme = () => ler(U, esquemaPainel);

export const decidirLiberacaoOpme = (
  id: number,
  corpo: { versao: number; decisao: 'aprovar' | 'recusar' | 'cancelar'; justificativa: string | null },
  chave: string,
) => enviar(`${U}/${id}/decisao`, corpo, esquemaDecisao, chave);
