// C2-074 (08-SGO L113): cliente da API do portal do prestador para os avisos, os documentos exigidos e os pedidos de
// alteração do próprio cadastro. Sessão pelo cookie HttpOnly do portal e CSRF por token duplo, como o resto do portal;
// quem é o prestador sai da sessão, no servidor.
import { CABECALHO_CSRF_PORTAL_PRESTADOR, COOKIE_CSRF_PORTAL_PRESTADOR } from '@sgh/contratos';
import { z } from 'zod';
import { lerJson } from '../exames/api-exames.js';

const P = '/api/portal-prestador';
const JSON_ACEITO = { accept: 'application/json' };

function csrfPortal(): string {
  try {
    for (const par of document.cookie.split(';')) {
      const i = par.indexOf('=');
      if (i !== -1 && par.slice(0, i).trim() === COOKIE_CSRF_PORTAL_PRESTADOR) return par.slice(i + 1).trim();
    }
  } catch {
    /* sem document.cookie */
  }
  return '';
}
const ler = async <T>(url: string, esquema: z.ZodType<T>): Promise<T> =>
  lerJson(await fetch(url, { headers: JSON_ACEITO, credentials: 'same-origin' }), esquema);
const postar = async <T>(url: string, corpo: unknown, esquema: z.ZodType<T>): Promise<T> =>
  lerJson(
    await fetch(url, {
      method: 'POST',
      credentials: 'same-origin',
      headers: {
        ...JSON_ACEITO,
        'content-type': 'application/json',
        [CABECALHO_CSRF_PORTAL_PRESTADOR]: csrfPortal(),
      },
      body: JSON.stringify(corpo ?? {}),
    }),
    esquema,
  );

const esquemaAvisos = z.object({
  itens: z.array(
    z.object({
      id: z.number(),
      tipo: z.string(),
      titulo: z.string(),
      conteudo: z.string(),
      link: z.string().nullable(),
      exibirDe: z.string(),
      destaque: z.boolean(),
    }),
  ),
});
const esquemaDocumentos = z.object({
  itens: z.array(
    z.object({
      id: z.number(),
      descricao: z.string(),
      obrigatorio: z.boolean(),
      extensoes: z.string().nullable(),
      tamanhoMaximoKb: z.number().nullable(),
    }),
  ),
});
const esquemaPedido = z.object({
  id: z.number(),
  numero: z.string(),
  tipo: z.string(),
  situacao: z.string(),
  recebidoEm: z.string(),
  analisadoEm: z.string().nullable(),
  motivoRecusa: z.string().nullable(),
  versao: z.number(),
});
const esquemaPedidos = z.object({ itens: z.array(esquemaPedido) });
const esquemaEnviado = z.object({
  id: z.number(),
  versao: z.number(),
  numero: z.string(),
  mensagem: z.string(),
});
const esquemaDecidido = z.object({ id: z.number(), versao: z.number(), situacao: z.string() });

export type AvisoDoPortal = z.infer<typeof esquemaAvisos>['itens'][number];
export type DocumentoExigido = z.infer<typeof esquemaDocumentos>['itens'][number];
export type PedidoDoPortal = z.infer<typeof esquemaPedido>;
export type TipoPedidoPortal = 'alteracao_cadastral' | 'endereco' | 'especialidade' | 'qualificacao';
export interface PedidoCadastroEntrada {
  readonly tipo: TipoPedidoPortal;
  readonly nome: string;
  readonly email: string | null;
  readonly telefone: string | null;
  readonly cep: string | null;
  readonly cnes: string | null;
  readonly cnpj: string | null;
  readonly cpf: string | null;
  readonly detalhes: Record<string, unknown> | null;
}

export const avisosPortalPrestador = async (): Promise<AvisoDoPortal[]> =>
  (await ler(`${P}/avisos`, esquemaAvisos)).itens;
export const documentosExigidosPortal = async (): Promise<DocumentoExigido[]> =>
  (await ler(`${P}/documentos-exigidos`, esquemaDocumentos)).itens;
export const pedidosCadastroPortal = async (): Promise<PedidoDoPortal[]> =>
  (await ler(`${P}/pedidos-cadastro`, esquemaPedidos)).itens;
export const enviarPedidoCadastroPortal = (e: PedidoCadastroEntrada) =>
  postar(`${P}/pedidos-cadastro`, e, esquemaEnviado);
export const cancelarPedidoCadastroPortal = (id: number, versao: number) =>
  postar(`${P}/pedidos-cadastro/${id}/cancelar`, { versao }, esquemaDecidido);
