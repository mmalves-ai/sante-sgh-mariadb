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

// ── Comunicações de internação e alta recebidas (04-INT linha 80, C1-108) ─────────────────────────────

export const esquemaComunicacaoRecebida = z.object({
  id: z.number(),
  versao: z.number(),
  prestador: z.string().nullable(),
  numeroTransacao: z.string().nullable(),
  numeroCarteira: z.string(),
  beneficiario: z.number().nullable(),
  matricula: z.string().nullable(),
  recemNascido: z.boolean(),
  tipoEvento: z.enum(['internacao', 'alta']),
  eventoEm: z.string().nullable(),
  tipoInternacao: z.string().nullable(),
  motivoEncerramento: z.string().nullable(),
  recebidoEm: z.string(),
  situacao: z.enum(['recebida', 'aceita', 'recusada']),
  motivoRecusa: z.object({ id: z.number(), codigo: z.string(), descricao: z.string() }).nullable(),
  respondidoEm: z.string().nullable(),
});
export type ComunicacaoRecebida = z.infer<typeof esquemaComunicacaoRecebida>;
export type SituacaoComunicacao = ComunicacaoRecebida['situacao'];
const esquemaMotivo = z.object({ id: z.number(), codigo: z.string(), descricao: z.string() });
export type MotivoRecusa = z.infer<typeof esquemaMotivo>;

export async function lerComunicacoes(situacao: SituacaoComunicacao | null) {
  const q = situacao ? `?situacao=${situacao}` : '';
  return (await ler(`${C}/comunicacoes${q}`, z.object({ itens: z.array(esquemaComunicacaoRecebida) }))).itens;
}

export async function lerMotivosRecusa() {
  return (await ler(`${C}/comunicacoes/motivos-recusa`, z.object({ itens: z.array(esquemaMotivo) }))).itens;
}

export const identificarCarteira = (id: number, versao: number, carteira: string) =>
  enviar(
    `${C}/comunicacoes/${id}/carteira`,
    { versao, carteira },
    z.object({ id: z.number(), versao: z.number(), beneficiario: z.number() }),
    novaChave('comunicacao-carteira'),
  );

export const responderComunicacao = (
  id: number,
  versao: number,
  r: { acao: 'aceitar' } | { acao: 'recusar'; motivoRecusa: number | null },
) =>
  enviar(
    `${C}/comunicacoes/${id}/resposta`,
    { versao, ...r },
    z.object({ id: z.number(), versao: z.number(), situacao: z.enum(['aceita', 'recusada']) }),
    novaChave('comunicacao-resposta'),
  );
