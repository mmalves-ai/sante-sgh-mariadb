// Cliente da autorização prévia à operadora (C2-081, 06-FAT L27): visão por paciente (coberturas e pedidos com itens,
// diagnósticos, respostas e consultas de andamento), o pedido, o envio, a transmissão com o canal real, a resposta por
// item, a consulta do andamento, a ligação aos itens da conta e o cancelamento (/api/tiss/autorizacoes).
import { z } from 'zod';
import { enviar, ler } from '../exames/api-exames.js';

const A = '/api/tiss/autorizacoes';
let seq = 0;
const chave = (r: string) => `c2081.${r}.${Date.now().toString(36)}.${(seq++).toString(36)}`;

const esquemaPedido = z.object({
  id: z.number(),
  numero: z.string(),
  tipo: z.string(),
  situacao: z.string(),
  canal: z.string(),
  fontePagadora: z.string(),
  carteira: z.string(),
  conta: z.number().nullable(),
  solicitadaEm: z.string().nullable(),
  enviadaEm: z.string().nullable(),
  observacao: z.string().nullable(),
  xmlGuardado: z.boolean(),
  transmissaoModo: z.string().nullable().default(null),
  protocoloTransmissao: z.string().nullable().default(null),
  falhaTransmissao: z.string().nullable().default(null),
  versao: z.number(),
  itensDaContaCobertos: z.number().default(0),
  diagnosticos: z
    .array(
      z.object({ sequencia: z.number(), principal: z.boolean(), cid: z.string(), descricao: z.string() }),
    )
    .default([]),
  itens: z.array(
    z.object({
      sequencia: z.number(),
      codigoTabela: z.string(),
      codigoProcedimento: z.string(),
      descricao: z.string(),
      quantidade: z.number(),
      quantidadeAutorizada: z.number().nullable(),
      opme: z.boolean(),
    }),
  ),
  respostas: z.array(
    z.object({
      id: z.number(),
      situacao: z.string(),
      recebidaEm: z.string().nullable(),
      senha: z.string().nullable(),
      numeroGuiaOperadora: z.string().nullable(),
    }),
  ),
  consultas: z.array(
    z.object({ tentativa: z.number(), situacao: z.string(), consultadaEm: z.string().nullable() }),
  ),
});
export type PedidoAutorizacaoTela = z.infer<typeof esquemaPedido>;

const esquemaPaciente = z.object({
  coberturas: z.array(
    z.object({
      id: z.number(),
      fontePagadora: z.string(),
      carteira: z.string().nullable(),
      validade: z.string().nullable(),
    }),
  ),
  pedidos: z.array(esquemaPedido),
});
export type AutorizacoesDoPaciente = z.infer<typeof esquemaPaciente>;

const criado = z.object({ id: z.number(), numero: z.string() }).passthrough();
const mudou = z.object({ situacao: z.string().optional() }).passthrough();
const ligou = z.object({ ligados: z.number(), semCobertura: z.number() }).passthrough();

export const lerAutorizacoesDoPaciente = (paciente: number) =>
  ler(`${A}/pacientes/${paciente}`, esquemaPaciente);
export const criarPedidoAutorizacao = (corpo: unknown) => enviar(A, corpo, criado, chave('criar'));
export const enviarPedidoAutorizacao = (id: number, versao: number) =>
  enviar(`${A}/${id}/envio`, { versao }, mudou, chave('envio'));
export const registrarTransmissaoAutorizacao = (id: number, versao: number, canal: string) =>
  enviar(`${A}/${id}/transmissao`, { versao, canal }, mudou, chave('transmissao'));
const transmitiu = z
  .object({
    situacao: z.string(),
    modo: z.string(),
    protocolo: z.string().nullable(),
    falha: z.string().nullable(),
  })
  .passthrough();
/** Transmissão automática ao webservice da operadora pela central de integrações externas (simulador ou real). */
export const transmitirAutorizacaoWebservice = (id: number, versao: number) =>
  enviar(`${A}/${id}/transmissao-webservice`, { versao }, transmitiu, chave('transmissao-webservice'));
export const responderPedidoAutorizacao = (id: number, corpo: unknown) =>
  enviar(`${A}/${id}/resposta`, corpo, mudou, chave('resposta'));
export const consultarAndamentoAutorizacao = (id: number) =>
  enviar(`${A}/${id}/andamento`, {}, mudou, chave('andamento'));
export const ligarAutorizacaoNaConta = (id: number) => enviar(`${A}/${id}/conta`, {}, ligou, chave('conta'));
export const cancelarPedidoAutorizacao = (id: number, versao: number, motivo: string) =>
  enviar(`${A}/${id}/cancelamento`, { versao, motivo }, mudou, chave('cancelar'));
