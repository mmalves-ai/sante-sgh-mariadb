// C2-074 (08-SGO L113): cliente da API interna da operadora para o portal do prestador — a fila dos pedidos web do
// prestador (analisar, aprovar, recusar com motivo), os avisos à rede (publicar e retirar; nunca apagados) e as regras
// de documento por tipo de prestador (incluir e inativar). Sessão interna; Problem Details viram ErroApi.
import { SITUACOES_PEDIDO_WEB_PRESTADOR, TIPOS_AVISO_PORTAL } from '@sgh/dominio-operadora';
import { z } from 'zod';
import { enviar, ler, novaChave, qs } from '../exames/api-exames.js';

const P = '/api/operadora/portal-prestador';

export const esquemaPedidoWeb = z.object({
  id: z.number().int(),
  numero: z.string(),
  tipo: z.string(),
  prestador: z.number().int().nullable(),
  prestadorNome: z.string().nullable(),
  pessoa: z.string(),
  nome: z.string(),
  situacao: z.enum(SITUACOES_PEDIDO_WEB_PRESTADOR),
  recebidoEm: z.string(),
  analisadoEm: z.string().nullable(),
  motivoRecusa: z.string().nullable(),
  versao: z.number().int(),
});
export type PedidoWebPrestador = z.infer<typeof esquemaPedidoWeb>;

export const esquemaAvisoPortal = z.object({
  id: z.number().int(),
  ativo: z.boolean(),
  tipo: z.string(),
  titulo: z.string(),
  conteudo: z.string(),
  link: z.string().nullable(),
  tipoPrestador: z.number().int().nullable(),
  prestador: z.number().int().nullable(),
  exibirDe: z.string(),
  exibirAte: z.string().nullable(),
  destaque: z.boolean(),
  versao: z.number().int(),
});
export type AvisoPortal = z.infer<typeof esquemaAvisoPortal>;

export const esquemaRegraArquivo = z.object({
  id: z.number().int(),
  operadora: z.number().int(),
  descricao: z.string(),
  tipoPrestador: z.number().int().nullable(),
  natureza: z.enum(['fisica', 'juridica']).nullable(),
  obrigatorio: z.boolean(),
  extensoes: z.string().nullable(),
  tamanhoMaximoKb: z.number().int().nullable(),
  ativo: z.boolean(),
  versao: z.number().int(),
});
export type RegraArquivo = z.infer<typeof esquemaRegraArquivo>;

const itens = <T extends z.ZodTypeAny>(e: T) => z.object({ itens: z.array(e) });
const esquemaGravado = z.object({ id: z.number().int(), versao: z.number().int() }).passthrough();
export type Gravado = z.infer<typeof esquemaGravado>;

export type AcaoDecisao = 'analisar' | 'aprovar' | 'recusar';
export type TipoAviso = (typeof TIPOS_AVISO_PORTAL)[number];

export const lerPedidosPortal = (situacao: string | null) =>
  ler(`${P}/pedidos${qs({ situacao })}`, itens(esquemaPedidoWeb)).then((r) => r.itens);
export const decidirPedidoPortal = (id: number, versao: number, acao: AcaoDecisao, motivo: string | null) =>
  enviar(`${P}/pedidos/${id}/decisao`, { versao, acao, motivo }, esquemaGravado, novaChave('pp-decidir'));

export const lerAvisosPortal = () => ler(`${P}/avisos`, itens(esquemaAvisoPortal)).then((r) => r.itens);
export interface NovoAviso {
  readonly tipo: TipoAviso;
  readonly titulo: string;
  readonly conteudo: string;
  readonly link: string | null;
  readonly exibirDe: string;
  readonly exibirAte: string | null;
  readonly tipoPrestador: number | null;
  readonly prestador: number | null;
  readonly destaque: boolean;
}
export const publicarAvisoPortal = (a: NovoAviso) =>
  enviar(`${P}/avisos`, a, esquemaGravado, novaChave('pp-aviso'));
export const retirarAvisoPortal = (id: number, versao: number) =>
  enviar(`${P}/avisos/${id}/retirar`, { versao }, esquemaGravado, novaChave('pp-retirar'));

export const lerRegrasArquivo = (operadora: number) =>
  ler(`${P}/regras-arquivo${qs({ operadora })}`, itens(esquemaRegraArquivo)).then((r) => r.itens);
export interface NovaRegra {
  readonly operadora: number;
  readonly tipoPrestador: number | null;
  readonly natureza: 'fisica' | 'juridica' | null;
  readonly descricao: string;
  readonly obrigatorio: boolean;
  readonly extensoes: string | null;
  readonly tamanhoMaximoKb: number | null;
}
export const incluirRegraArquivo = (r: NovaRegra) =>
  enviar(`${P}/regras-arquivo`, r, esquemaGravado, novaChave('pp-regra'));
export const inativarRegraArquivo = (id: number, versao: number) =>
  enviar(`${P}/regras-arquivo/${id}/inativar`, { versao }, esquemaGravado, novaChave('pp-inativar'));
