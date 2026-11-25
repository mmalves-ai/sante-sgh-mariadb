// Cliente do SAME: protocolo em lote entre setores e solicitação/empréstimo de prontuário (F3.9, 04-HOT L127 e L128).
// As gravações vão com o CSRF e a Idempotency-Key (enviar); as recusas do servidor viram ErroApi.
import { z } from 'zod';
import { enviar, ler, qs } from '../exames/api-exames.js';

const T = '/api/same/tramite';
let seq = 0;
const chave = (r: string) => `f395t.${r}.${Date.now().toString(36)}.${(seq++).toString(36)}`;

const qualquer = z.record(z.string(), z.unknown());
const item = z.object({
  id: z.number(),
  sequencia: z.number(),
  tipo: z.string(),
  alvo: z.number().nullable(),
  descricao: z.string().nullable(),
  recebido: z.boolean(),
  recusado: z.boolean(),
  motivoRecusa: z.string().nullable(),
});
export const esquemaProtocolo = z.object({
  id: z.number(),
  numero: z.number(),
  conteudo: z.string(),
  remetente: z.object({ id: z.number(), descricao: z.string() }),
  destinatario: z.object({ id: z.number(), descricao: z.string() }),
  prioridade: z.string(),
  situacao: z.string(),
  emitidoEm: z.string(),
  versao: z.number(),
  itens: z.array(item),
});
export type ProtocoloTela = z.infer<typeof esquemaProtocolo>;
export const esquemaEmprestimo = z.object({
  /** Nulo na saída por empréstimo feita na guarda, ainda sem documento (cobra-se pelo movimento). */
  id: z.number().nullable(),
  movimento: z.number().nullable(),
  origem: z.enum(['tramite', 'guarda']),
  numero: z.string(),
  volume: z.object({ id: z.number(), matricula: z.string().nullable(), paciente: z.number() }),
  destino: z.string(),
  motivo: z.string().nullable(),
  emprestadoEm: z.string(),
  prazo: z.string(),
  devolvidoEm: z.string().nullable(),
  situacao: z.string(),
  diasAtraso: z.number(),
  cobrancas: z.number(),
  versao: z.number(),
});
export type EmprestimoTela = z.infer<typeof esquemaEmprestimo>;
const esquemaApoio = z.object({
  setoresTramite: z.array(z.object({ id: z.number(), descricao: z.string(), tipo: z.string() })),
  motivos: z.array(
    z.object({
      id: z.number(),
      descricao: z.string(),
      prazoDias: z.number().nullable(),
      exigeAutorizacao: z.boolean().default(false),
    }),
  ),
  setores: z.array(z.object({ id: z.number(), nome: z.string() })),
  arquivos: z.array(z.object({ id: z.number(), caminho: z.string() })),
  prazoPadraoDias: z.number(),
});
export type ApoioTramite = z.infer<typeof esquemaApoio>;

export const lerApoioTramite = () => ler(`${T}/apoio`, esquemaApoio);
export const lerProtocolos = (setor: number | null, sentido: 'entrada' | 'saida') =>
  ler(`${T}/protocolos${qs({ setor, sentido })}`, z.object({ itens: z.array(esquemaProtocolo) }));
export const emitirProtocolo = (corpo: unknown) =>
  enviar(`${T}/protocolos`, corpo, qualquer, chave('emitir'));
export const receberProtocolo = (id: number, corpo: unknown) =>
  enviar(`${T}/protocolos/${id}/receber`, corpo, qualquer, chave('receber'));
export const cancelarProtocolo = (id: number, corpo: unknown) =>
  enviar(`${T}/protocolos/${id}/cancelar`, corpo, qualquer, chave('cancelar'));
export const lerEmprestimos = (paciente: number | null, atrasados: boolean) =>
  ler(`${T}/emprestimos${qs({ paciente, atrasados })}`, z.object({ itens: z.array(esquemaEmprestimo) }));
export const emprestar = (corpo: unknown) => enviar(`${T}/emprestimos`, corpo, qualquer, chave('emprestar'));
export const devolver = (id: number, versao: number) =>
  enviar(`${T}/emprestimos/${id}/devolver`, { versao }, qualquer, chave('devolver'));
export const cobrar = (id: number, versao: number) =>
  enviar(`${T}/emprestimos/${id}/cobrar`, { versao }, qualquer, chave('cobrar'));
export const solicitar = (corpo: unknown) => enviar(`${T}/solicitacoes`, corpo, qualquer, chave('solicitar'));
export const esquemaItemSolicitacao = z.object({
  id: z.number(),
  sequencia: z.number(),
  paciente: z.number(),
  volume: z.number().nullable(),
  matricula: z.string().nullable(),
  situacao: z.string(),
  observacao: z.string().nullable(),
  atendidoEm: z.string().nullable(),
});
export const lerItensSolicitacao = (id: number) =>
  ler(`${T}/solicitacoes/${id}/itens`, z.object({ itens: z.array(esquemaItemSolicitacao) }));
export const cancelarSolicitacao = (id: number, motivo: string, versao: number) =>
  enviar(`${T}/solicitacoes/${id}/cancelar`, { motivo, versao }, qualquer, chave('cancelarSolicitacao'));
export const naoLocalizado = (id: number, item: number, motivo: string, versao: number) =>
  enviar(
    `${T}/solicitacoes/${id}/nao-localizado`,
    { item, motivo, versao },
    qualquer,
    chave('naoLocalizado'),
  );
export const cobrarSaidaGuarda = (movimento: number) =>
  enviar(`${T}/saidas-guarda/${movimento}/cobrar`, {}, qualquer, chave('cobrarSaidaGuarda'));

export const esquemaSolicitacao = z.object({
  id: z.number(),
  numero: z.number(),
  situacao: z.string(),
  /** Nula quando o motivo não exige autorização. */
  autorizacao: z.enum(['aguardando', 'autorizada', 'negada']).nullable(),
  solicitante: z.number(),
  motivo: z.string(),
  urgente: z.boolean(),
  destino: z.string().nullable(),
  solicitadaEm: z.string().nullable(),
  desejadaPara: z.string().nullable(),
  itens: z.number(),
  versao: z.number(),
});
export type SolicitacaoTela = z.infer<typeof esquemaSolicitacao>;
export const lerSolicitacoes = () =>
  ler(`${T}/solicitacoes`, z.object({ itens: z.array(esquemaSolicitacao) }));
export const decidirAutorizacao = (
  id: number,
  decisao: 'autorizar' | 'negar',
  justificativa: string | null,
  versao: number,
) =>
  enviar(
    `${T}/solicitacoes/${id}/autorizar`,
    { decisao, justificativa, versao },
    qualquer,
    chave('autorizar'),
  );
