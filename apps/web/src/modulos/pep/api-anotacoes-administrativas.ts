// Cliente da API da anotação administrativa do caso (03-PEP L147):
// GET  /api/pep/anotacoes-administrativas/paciente/:paciente  as anotações que quem lê pode ver, atendimentos e categorias
// GET  /api/pep/anotacoes-administrativas/pendentes           a fila de leitura de quem recebeu
// GET  /api/pep/anotacoes-administrativas/usuarios?termo=     contas para escolher como destinatário
// GET  /api/pep/anotacoes-administrativas/pacientes?termo=    busca do paciente (aberta a quem lê as anotações)
// GET  /api/pep/anotacoes-administrativas/reserva/:reserva    o paciente da reserva de leito do NIR
// POST /api/pep/anotacoes-administrativas                     registrar, cancelar (só o autor, com motivo)
// POST /api/pep/anotacoes-administrativas/:id/lida            leitura confirmada pelo destinatário (basta ler)
// Toda gravação leva a chave de idempotência e o x-csrf (como as demais do prontuário).
import { esquemaResultadoBuscaPaciente, type ResultadoBuscaPaciente } from '@sgh/contratos';
import { z } from 'zod';
import { tokenCsrf } from '../../api.js';
import { erroDaResposta } from '../../casca/erros/problem-details.js';
import { novaChave } from './api-registro.js';

const P = '/api/pep/anotacoes-administrativas';
const JSON_ACEITO = { accept: 'application/json' };

const esquemaAnotacao = z.object({
  id: z.number(),
  versao: z.number(),
  atendimento: z.object({ id: z.number(), numero: z.string() }),
  categoria: z.object({ id: z.number(), descricao: z.string() }),
  texto: z.string(),
  acesso: z.string(),
  finalizaAcao: z.boolean(),
  automatica: z.boolean(),
  reserva: z.number().nullable(),
  registradaEm: z.string().nullable(),
  autor: z.string().nullable(),
  doAutor: z.boolean(),
  destinatarios: z.array(z.object({ usuario: z.number(), nome: z.string(), lidaEm: z.string().nullable() })),
  pendenteParaMim: z.boolean(),
  situacao: z.enum(['ativa', 'cancelada']),
  canceladaEm: z.string().nullable(),
  motivoCancelamento: z.string().nullable(),
});
export type AnotacaoTela = z.infer<typeof esquemaAnotacao>;

export const esquemaAnotacoes = z.object({
  anotacoes: z.array(esquemaAnotacao),
  atendimentos: z.array(z.object({ id: z.number(), numero: z.string(), entradaEm: z.string().nullable() })),
  categorias: z.array(z.object({ id: z.number(), descricao: z.string() })),
  pendentesParaMim: z.number(),
  podeEscrever: z.boolean(),
});
export type AnotacoesTela = z.infer<typeof esquemaAnotacoes>;

export const esquemaPendente = z.object({
  anotacao: z.number(),
  paciente: z.number(),
  prontuario: z.string().nullable(),
  atendimento: z.string(),
  categoria: z.string(),
  registradaEm: z.string().nullable(),
  autor: z.string().nullable(),
});
export type PendenteTela = z.infer<typeof esquemaPendente>;

async function ler<T>(url: string, esquema: z.ZodType<T>, buscar: typeof fetch): Promise<T> {
  const r = await buscar(url, { headers: JSON_ACEITO });
  if (!r.ok) throw await erroDaResposta(r);
  return esquema.parse(await r.json());
}

export const lerAnotacoesPaciente = (paciente: number, buscar: typeof fetch = fetch) =>
  ler(`${P}/paciente/${paciente}`, esquemaAnotacoes, buscar);

export const lerAnotacoesPendentes = (buscar: typeof fetch = fetch) =>
  ler(`${P}/pendentes`, z.array(esquemaPendente), buscar);

export const buscarDestinatarios = (termo: string, buscar: typeof fetch = fetch) =>
  ler(
    `${P}/usuarios?termo=${encodeURIComponent(termo)}`,
    z.array(z.object({ id: z.number(), nome: z.string() })),
    buscar,
  );

export const buscarPacientesAnotacoes = (
  termo: string,
  buscar: typeof fetch = fetch,
): Promise<ResultadoBuscaPaciente> =>
  ler(`${P}/pacientes?termo=${encodeURIComponent(termo)}&tipo=auto`, esquemaResultadoBuscaPaciente, buscar);

export const lerPacienteDaReserva = (reserva: number, buscar: typeof fetch = fetch) =>
  ler(`${P}/reserva/${reserva}`, z.object({ reserva: z.number(), paciente: z.number() }), buscar);

export const marcarAnotacaoLida = (anotacao: number, buscar: typeof fetch = fetch) =>
  enviar(`${P}/${anotacao}/lida`, {}, buscar);

export const gravarAnotacao = (corpo: Record<string, unknown>, buscar: typeof fetch = fetch) =>
  enviar(P, corpo, buscar);

async function enviar(url: string, corpo: Record<string, unknown>, buscar: typeof fetch) {
  const r = await buscar(url, {
    method: 'POST',
    headers: {
      ...JSON_ACEITO,
      'content-type': 'application/json',
      'x-csrf': tokenCsrf(),
      'idempotency-key': novaChave('pep.anotacaoAdministrativa'),
    },
    body: JSON.stringify(corpo),
  });
  if (!r.ok) throw await erroDaResposta(r);
  return z
    .object({ ok: z.boolean() })
    .passthrough()
    .parse(await r.json());
}
