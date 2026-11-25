// Cliente da API das notas e lembretes livres sobre o paciente (03-PEP L102):
// GET  /api/pep/notas/paciente/:paciente   notas que quem lê pode ver, alertas em vigor, tipos e textos prontos
// POST /api/pep/notas                      registrar, encerrar, cancelar (só o autor, com motivo), prorrogar
// Toda gravação leva a chave de idempotência e o x-csrf (como as demais do prontuário).
import { z } from 'zod';
import { tokenCsrf } from '../../api.js';
import { erroDaResposta } from '../../casca/erros/problem-details.js';
import { novaChave } from './api-registro.js';

const P = '/api/pep/notas';
const JSON_ACEITO = { accept: 'application/json' };

const esquemaNota = z.object({
  id: z.number(),
  versao: z.number(),
  tipo: z.object({ id: z.number(), descricao: z.string() }),
  texto: z.string(),
  visibilidade: z.string(),
  registradaEm: z.string().nullable(),
  validaAte: z.string().nullable(),
  situacao: z.string(),
  alerta: z.boolean(),
  autor: z.string().nullable(),
  doAutor: z.boolean(),
  motivoCancelamento: z.string().nullable(),
});
export type NotaTela = z.infer<typeof esquemaNota>;

export const esquemaNotas = z.object({
  notas: z.array(esquemaNota),
  alertas: z.array(esquemaNota),
  tipos: z.array(z.object({ id: z.number(), descricao: z.string(), alerta: z.boolean() })),
  textosProntos: z.array(z.object({ id: z.number(), titulo: z.string(), texto: z.string() })),
  podeEscrever: z.boolean(),
});
export type NotasTela = z.infer<typeof esquemaNotas>;

export async function lerNotasPaciente(paciente: number, buscar: typeof fetch = fetch): Promise<NotasTela> {
  const r = await buscar(`${P}/paciente/${paciente}`, { headers: JSON_ACEITO });
  if (!r.ok) throw await erroDaResposta(r);
  return esquemaNotas.parse(await r.json());
}

export async function gravarNotaPaciente(corpo: Record<string, unknown>, buscar: typeof fetch = fetch) {
  const r = await buscar(P, {
    method: 'POST',
    headers: {
      ...JSON_ACEITO,
      'content-type': 'application/json',
      'x-csrf': tokenCsrf(),
      'idempotency-key': novaChave('pep.notaPaciente'),
    },
    body: JSON.stringify(corpo),
  });
  if (!r.ok) throw await erroDaResposta(r);
  return z
    .object({ ok: z.boolean() })
    .passthrough()
    .parse(await r.json());
}
