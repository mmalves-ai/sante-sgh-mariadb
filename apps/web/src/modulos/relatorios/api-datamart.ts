// Cliente da tela das cargas do data mart (01-REL L113): a lista, o detalhe com as etapas e o pedido manual da carga
// (CSRF e Idempotency-Key). Problem Details viram ErroApi com o código da recusa (409 carga-em-andamento).
import { z } from 'zod';
import { enviar, ler, novaChave } from '../exames/api-exames.js';

const R = '/api/relatorios/datamart/cargas';

export const SITUACOES_CARGA = [
  'aguardando',
  'em_execucao',
  'interrompida',
  'concluida',
  'concluida_com_rejeicao',
  'falhou',
  'cancelada',
] as const;

const esquemaCarga = z.object({
  id: z.number().int(),
  disparo: z.enum(['agendado', 'manual']),
  tipoCarga: z.string(),
  situacao: z.enum(SITUACOES_CARGA),
  ocorridoEm: z.string(),
  concluidoEm: z.string().nullable(),
  duracaoMs: z.number().nullable(),
  linhasLidas: z.number().nullable(),
  linhasGravadas: z.number().nullable(),
  linhasRejeitadas: z.number().nullable(),
  mensagemErro: z.string().nullable(),
  pedidoPor: z.string().nullable(),
  etapas: z.number().int(),
});
export type CargaDataMart = z.infer<typeof esquemaCarga>;

const esquemaDetalhe = esquemaCarga.extend({
  itens: z.array(
    z.object({
      sequencia: z.number().int(),
      tipoObjeto: z.string(),
      objeto: z.string(),
      linhas: z.number().nullable(),
      duracaoMs: z.number().nullable(),
      situacao: z.string(),
    }),
  ),
});
export type DetalheCargaDataMart = z.infer<typeof esquemaDetalhe>;

export const lerCargasDataMart = () => ler(R, z.object({ itens: z.array(esquemaCarga) }));
export const lerCargaDataMart = (id: number) => ler(`${R}/${id}`, esquemaDetalhe);
export const pedirCargaDataMart = () =>
  enviar(
    R,
    {},
    z.object({ id: z.number().int(), situacao: z.literal('aguardando') }),
    novaChave('datamart.pedir'),
  );
