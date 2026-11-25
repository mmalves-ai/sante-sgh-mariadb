// Cancelamento de guia enviada e envio de documentos anexos pelo TISS 04.03.00 (06-FAT linha 28): cliente das rotas
// /api/tiss/cancelamento-documentos. A visão é pela conta (a lista de guias mostra a conta). Os documentos vão em base64
// com o tipo do corpo com anexos, que tem teto próprio (o JSON padrão aceita 1 MB).
import { TIPO_CORPO_ANEXOS_PORTAL } from '@sgh/contratos';
import { z } from 'zod';
import { tokenCsrf } from '../../api.js';
import { enviar, ler, lerJson } from '../exames/api-exames.js';
import { novaChave } from './api-tiss.js';

const C = '/api/tiss/cancelamento-documentos';

const esquemaCancelamento = z.object({
  id: z.number(),
  situacao: z.string(),
  motivo: z.string(),
  solicitadoEm: z.string().nullable(),
  enviadoEm: z.string().nullable(),
  retornoEm: z.string().nullable(),
  protocolo: z.string().nullable(),
  observacao: z.string().nullable(),
  versao: z.number(),
  item: z.number(),
  situacaoGuia: z.string(),
  status: z.string().nullable(),
  statusDescricao: z.string().nullable(),
  guias: z.number(),
});
const esquemaDocumento = z.object({
  item: z.number(),
  sequencia: z.number(),
  tipoDocumento: z.string().nullable(),
  formato: z.string().nullable(),
  situacao: z.string(),
  protocolo: z.string().nullable(),
  observacao: z.string().nullable(),
  nome: z.string(),
  tamanho: z.number(),
});
const esquemaEnvio = z.object({
  id: z.number(),
  numero: z.string(),
  situacao: z.string(),
  enviadoEm: z.string().nullable(),
  retornoEm: z.string().nullable(),
  protocolo: z.string().nullable(),
  observacao: z.string().nullable(),
  versao: z.number(),
  documentos: z.array(esquemaDocumento),
});
const esquemaVisaoGuia = z.object({
  guia: z.object({
    id: z.number(),
    numeroGuiaPrestador: z.string(),
    numeroGuiaOperadora: z.string().nullable(),
    situacao: z.string(),
    tipo: z.string(),
  }),
  cancelamentos: z.array(esquemaCancelamento),
  envios: z.array(esquemaEnvio),
});
const esquemaVisaoConta = z.object({ conta: z.number(), guias: z.array(esquemaVisaoGuia) });

export type CancelamentoGuiaLido = z.infer<typeof esquemaCancelamento>;
export type EnvioDocumentosLido = z.infer<typeof esquemaEnvio>;
export type VisaoGuiaCancelamento = z.infer<typeof esquemaVisaoGuia>;

export interface DocumentoParaEnviar {
  nome: string;
  tipoMime: string;
  conteudoBase64: string;
  tipoDocumento: string;
  observacao: string | null;
}

const situacao = z.object({ id: z.number(), situacao: z.string() });
const versao = (v: number) => ({ versao: v });

export const lerCancelamentoDaConta = (conta: number) => ler(`${C}/contas/${conta}`, esquemaVisaoConta);

export const pedirCancelamento = (corpo: { guias: number[]; motivo: string }) =>
  enviar(
    `${C}/cancelamentos`,
    corpo,
    z.object({ id: z.number(), guias: z.number() }),
    novaChave('tiss.cancelar'),
  );
export const enviarCancelamento = (id: number, v: number) =>
  enviar(
    `${C}/cancelamentos/${id}/envio`,
    versao(v),
    situacao.extend({ xml: z.string() }),
    novaChave('tiss.cancelar.envio'),
  );
export const descartarCancelamento = (id: number, v: number) =>
  enviar(`${C}/cancelamentos/${id}/descarte`, versao(v), z.unknown(), novaChave('tiss.cancelar.descarte'));
export const registrarReciboCancelamento = (
  id: number,
  corpo: {
    versao: number;
    protocolo: string | null;
    observacao: string | null;
    erro: { codigo: string; descricao: string | null } | null;
    guias: { item: number; status: string }[];
  },
) =>
  enviar(
    `${C}/cancelamentos/${id}/recibo`,
    corpo,
    situacao.extend({ canceladas: z.number() }),
    novaChave('tiss.cancelar.recibo'),
  );

/** O registro dos documentos vai com o tipo do corpo com anexos (base64 de até 10 MB por documento). */
export const registrarDocumentos = async (corpo: {
  guia: number;
  observacao: string | null;
  documentos: DocumentoParaEnviar[];
}) =>
  lerJson(
    await fetch(`${C}/envios`, {
      method: 'POST',
      headers: {
        accept: 'application/json',
        'content-type': TIPO_CORPO_ANEXOS_PORTAL,
        'x-csrf': tokenCsrf(),
        'idempotency-key': novaChave('tiss.documentos'),
      },
      body: JSON.stringify(corpo),
    }),
    z.object({ id: z.number(), numero: z.string(), documentos: z.number() }),
  );
export const enviarDocumentos = (id: number, v: number) =>
  enviar(
    `${C}/envios/${id}/envio`,
    versao(v),
    situacao.extend({ mensagens: z.array(z.object({ item: z.number(), xml: z.string() })) }),
    novaChave('tiss.documentos.envio'),
  );
export const cancelarEnvioDocumentos = (id: number, v: number) =>
  enviar(`${C}/envios/${id}/cancelamento`, versao(v), z.unknown(), novaChave('tiss.documentos.cancelar'));
export const registrarReciboDocumentos = (
  id: number,
  corpo: {
    versao: number;
    protocolo: string | null;
    documentos: { item: number; protocolo: string | null; erro: string | null }[];
  },
) => enviar(`${C}/envios/${id}/recibo`, corpo, situacao, novaChave('tiss.documentos.recibo'));

/** Baixa o XML montado (a transmissão é do faturista, pelo canal da operadora). */
export function baixarXml(nome: string, xml: string): void {
  const url = URL.createObjectURL(new Blob([xml], { type: 'application/xml' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = nome;
  a.click();
  URL.revokeObjectURL(url);
}

/** Lê o arquivo escolhido em base64 (sem o prefixo do data URL). */
export const arquivoEmBase64 = (arquivo: File): Promise<string> =>
  new Promise((resolve, reject) => {
    const leitor = new FileReader();
    leitor.onload = () => resolve(String(leitor.result).replace(/^data:[^,]*,/, ''));
    leitor.onerror = () => reject(leitor.error ?? new Error('Falha ao ler o arquivo'));
    leitor.readAsDataURL(arquivo);
  });
