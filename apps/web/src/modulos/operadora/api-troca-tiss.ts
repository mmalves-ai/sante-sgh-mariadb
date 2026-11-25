// Cliente da troca TISS na visão da operadora (08-SGO linha 107, C2-061; F7): a lista das trocas recebidas e enviadas
// (filtro de tipo e direção) e o envio da mensagem TISS 4.03 recebida do prestador em arquivo (os bytes em base64: o XML é
// ISO-8859-1 e o hash do epílogo depende deles). A recusa do arquivo (versão, XSD, hash, destino, prestador, sequencial)
// vem como Problem Details (ErroApi); a mensagem que não vira pedido volta como troca rejeitada, com o motivo.
import { z } from 'zod';
import { enviar, ler, novaChave } from '../exames/api-exames.js';

const C = '/api/operadora/troca-tiss';

/** Os tipos de troca TISS (os mesmos códigos do domínio da operadora). */
export const TIPOS_TROCA = [
  'envio_lote_guias',
  'solicitacao_procedimento',
  'solicitacao_status_autorizacao',
  'solicitacao_status_protocolo',
  'verificacao_elegibilidade',
  'cancelamento_guia',
  'demonstrativo_pagamento',
  'demonstrativo_analise_conta',
  'recurso_glosa',
  'envio_documentos',
  'envio_anexo',
  'comunicacao_internacao',
] as const;
export type TipoTroca = (typeof TIPOS_TROCA)[number];
export type DirecaoTroca = 'recebida' | 'enviada';

export const esquemaTrocaResumo = z.object({
  id: z.number(),
  direcao: z.enum(['recebida', 'enviada']),
  tipo: z.string(),
  canal: z.string(),
  prestador: z.string().nullable(),
  sequencial: z.string().nullable(),
  protocolo: z.string().nullable(),
  registradaEm: z.string(),
  situacao: z.string(),
  mensagemErro: z.string().nullable(),
});
export type TrocaResumo = z.infer<typeof esquemaTrocaResumo>;
const esquemaLista = z.object({ itens: z.array(esquemaTrocaResumo) });

export const esquemaResultadoTroca = z.object({
  troca: z.number().nullable(),
  tipo: z.string(),
  situacao: z.enum(['processada', 'rejeitada']),
  protocolo: z.string().nullable(),
  motivos: z.array(z.string()),
  guias: z
    .array(
      z.object({
        numeroGuiaPrestador: z.string(),
        resultado: z.string(),
        observacao: z.string().nullable(),
      }),
    )
    .optional(),
  comunicacao: z.object({ situacao: z.string(), beneficiarioIdentificado: z.boolean() }).optional(),
});
export type ResultadoTroca = z.infer<typeof esquemaResultadoTroca>;

/** O teto da mensagem (o mesmo do servidor). */
export const MAXIMO_BYTES_TROCA = 2_000_000;

export async function lerTrocas(f: { tipo?: TipoTroca | null; direcao?: DirecaoTroca | null }) {
  const q = new URLSearchParams();
  if (f.tipo) q.set('tipo', f.tipo);
  if (f.direcao) q.set('direcao', f.direcao);
  const s = q.toString();
  return (await ler(`${C}${s ? `?${s}` : ''}`, esquemaLista)).itens;
}

export const receberMensagem = (arquivo: string): Promise<ResultadoTroca> =>
  enviar(`${C}/mensagens`, { arquivo, canal: 'arquivo' }, esquemaResultadoTroca, novaChave('troca-tiss'));
