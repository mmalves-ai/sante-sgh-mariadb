// Cliente da nota fiscal que documenta a fatura do convênio ou a conta do particular (F3.7, 06-FAT linha 36). A regra
// vem de @sgh/dominio-faturamento (a mesma da API), para a validação aparecer enquanto se digita; o servidor confere
// de novo.
import { z } from 'zod';
import { enviar, ler } from '../exames/api-exames.js';

const F = '/api/faturamento';
const qualquer = z.record(z.string(), z.unknown());

const esquemaDocumentacao = z.object({
  alvo: z.object({
    tipo: z.enum(['fatura', 'conta']),
    id: z.number(),
    numero: z.string(),
    situacao: z.string(),
    fontePagadoraId: z.number().nullable(),
    valorDocumentavel: z.number(),
    valorDocumentado: z.number(),
    saldo: z.number(),
    documentacao: z.enum(['sem_nota', 'parcial', 'documentada']),
  }),
  ligadas: z.array(
    z.object({
      id: z.number(),
      versao: z.number(),
      notaServicoId: z.number(),
      numeroNota: z.string().nullable(),
      rps: z.string(),
      situacaoNota: z.string(),
      documenta: z.boolean(),
      emitidaEm: z.string().nullable(),
      valorServicos: z.number(),
      valorApropriado: z.number(),
      valorDesconto: z.number(),
      valorAcrescimo: z.number(),
    }),
  ),
  candidatas: z.array(
    z.object({
      id: z.number(),
      numeroNota: z.string().nullable(),
      rps: z.string(),
      situacao: z.string(),
      emitidaEm: z.string().nullable(),
      emitidaParaEste: z.boolean(),
      valorServicos: z.number(),
      saldoNota: z.number(),
      sugerido: z.number(),
    }),
  ),
  historico: z.array(
    z.object({
      id: z.number(),
      vinculoId: z.number(),
      notaServicoId: z.number(),
      acao: z.enum(['ligado', 'ajustado', 'desligado', 'religado']),
      valorAnterior: z.number().nullable(),
      valor: z.number().nullable(),
      situacaoNota: z.string(),
      motivo: z.string().nullable(),
      em: z.string().nullable(),
      por: z.number().nullable(),
    }),
  ),
});
export type DocumentacaoFiscal = z.infer<typeof esquemaDocumentacao>;
export type TipoAlvo = 'fatura' | 'conta';

export const lerDocumentacaoFiscal = (tipo: TipoAlvo, id: number) =>
  ler(`${F}/${tipo === 'fatura' ? 'faturas' : 'contas'}/${id}/notas-fiscais`, esquemaDocumentacao);
export const vincularNota = (
  p: { tipo: TipoAlvo; alvoId: number; notaServicoId: number; valorApropriado: number },
  chave: string,
) => enviar(`${F}/notas-fiscais/vinculos`, p, qualquer, chave);
export const desvincularNota = (id: number, versao: number, motivo: string, chave: string) =>
  enviar(`${F}/notas-fiscais/vinculos/${id}/desligamento`, { versao, motivo }, qualquer, chave);
