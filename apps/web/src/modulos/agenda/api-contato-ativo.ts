// Contato ativo com o paciente antes da consulta (02-REC linha 39): a fila da central, os resultados padronizados, o
// histórico por paciente e as gravações (registrar a tentativa, programar e cancelar o programado).
import { z } from 'zod';
import { tokenCsrf } from '../../api.js';
import { erroDaResposta } from '../../casca/erros/problem-details.js';

const P = '/api/agenda/contato-ativo';

export const CANAIS = ['telefone', 'whatsapp', 'sms', 'email', 'presencial', 'outro'] as const;
export type Canal = (typeof CANAIS)[number];

export const esquemaResultado = z.object({
  id: z.number(),
  codigo: z.string(),
  descricao: z.string(),
  sucesso: z.boolean(),
  encerraTentativas: z.boolean(),
  efeitoMarcacao: z.enum(['confirmar', 'cancelar']).nullable(),
});
export type ResultadoContato = z.infer<typeof esquemaResultado>;

export const esquemaContato = z.object({
  id: z.number(),
  paciente: z.number(),
  nome: z.string(),
  marcacao: z.number().nullable(),
  canal: z.string(),
  motivo: z.string(),
  situacao: z.string(),
  resultado: z.string().nullable(),
  programadoPara: z.string().nullable(),
  contatoEm: z.string().nullable(),
  informante: z.string().nullable(),
  descricao: z.string().nullable(),
  anterior: z.number().nullable(),
});
export type ContatoLido = z.infer<typeof esquemaContato>;

export const esquemaItemFila = z.object({
  marcacao: z.number(),
  paciente: z.number(),
  nome: z.string(),
  prontuario: z.number().nullable(),
  telefone: z.string().nullable(),
  agenda: z.string(),
  inicioEm: z.string(),
  respostaNegativa: z.boolean(),
  tentativas: z.number(),
  contatoPendente: z.number().nullable(),
  programadoPara: z.string().nullable(),
});
export type ItemFila = z.infer<typeof esquemaItemFila>;
const esquemaFila = z.object({ itens: z.array(esquemaItemFila), programados: z.array(esquemaContato) });

const esquemaGravacao = z
  .object({
    ok: z.boolean(),
    mensagem: z.string().optional(),
    resultado: z
      .object({
        contato: z.number(),
        efeito: z.string().nullable().optional(),
        novaTentativa: z.number().nullable().optional(),
        alertas: z.array(z.string()).optional(),
      })
      .passthrough(),
  })
  .passthrough();

async function json<T>(r: Response, e: z.ZodType<T>): Promise<T> {
  if (!r.ok) throw await erroDaResposta(r);
  return e.parse(await r.json());
}
const ler = <T>(url: string, e: z.ZodType<T>) =>
  fetch(url, { headers: { accept: 'application/json' } }).then((r) => json(r, e));
const enviar = (url: string, corpo: unknown, chave: string) =>
  fetch(url, {
    method: 'POST',
    headers: {
      accept: 'application/json',
      'content-type': 'application/json',
      'x-csrf': tokenCsrf(),
      'idempotency-key': chave,
    },
    body: JSON.stringify(corpo),
  }).then((r) => json(r, esquemaGravacao));

export const lerFilaContato = (dias: number) => ler(`${P}/fila?dias=${dias}`, esquemaFila);
export const lerResultadosContato = () => ler(`${P}/resultados`, z.array(esquemaResultado));
export const lerHistoricoContato = (paciente: number) =>
  ler(`${P}/pacientes/${paciente}`, z.array(esquemaContato));

export interface EntradaRegistro {
  paciente: number;
  marcacao: number | null;
  pendente: number | null;
  canal: Canal;
  motivo: string;
  resultado: string;
  contatoEm: string;
  informante: string | null;
  descricao: string | null;
}
export const registrarContato = (e: EntradaRegistro, chave: string) => enviar(P, e, chave);
export const cancelarContatoProgramado = (id: number, motivo: string, chave: string) =>
  enviar(`${P}/${id}/cancelar`, { motivo }, chave);
