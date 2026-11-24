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
  id: z.number(),
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
  motivos: z.array(z.object({ id: z.number(), descricao: z.string(), prazoDias: z.number().nullable() })),
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
