// Cliente da API da farmacovigilância no paciente (03-PEP L103) e da lista de uso contínuo (03-PEP L104):
// GET  /api/pep/farmacovigilancia/paciente/:paciente   reações com o histórico, uso contínuo e apoio da tela
// POST /api/pep/farmacovigilancia/reacoes              registrar, avaliar, notificar, encerrar, reabrir, inativar, evoluir
// POST /api/pep/farmacovigilancia/uso-continuo         incluir, suspender, reconciliar
// Toda gravação leva a chave de idempotência e o x-csrf (como as demais do prontuário).
import { z } from 'zod';
import { tokenCsrf } from '../../api.js';
import { erroDaResposta } from '../../casca/erros/problem-details.js';
import { novaChave } from './api-registro.js';

const P = '/api/pep/farmacovigilancia';
const JSON_ACEITO = { accept: 'application/json' };

const esquemaReacao = z.object({
  id: z.number(),
  versao: z.number(),
  medicamento: z.string(),
  descricao: z.string(),
  inicio: z.string().nullable(),
  fim: z.string().nullable(),
  gravidade: z.object({ id: z.number(), descricao: z.string(), nivel: z.number() }),
  causalidade: z.string().nullable(),
  conduta: z.string().nullable(),
  desfecho: z.string().nullable(),
  situacao: z.string(),
  notificadaEm: z.string().nullable(),
  exigeNotificacao: z.boolean(),
  eventos: z.array(z.object({ etapa: z.string() }).passthrough()),
});
export type ReacaoTela = z.infer<typeof esquemaReacao>;

const esquemaUso = z.object({
  id: z.number(),
  versao: z.number(),
  medicamento: z.string(),
  posologia: z.string().nullable(),
  fonte: z.string(),
  conduta: z.string().nullable(),
  suspenso: z.boolean(),
  justificativaSuspensao: z.string().nullable(),
});
export type UsoContinuoTela = z.infer<typeof esquemaUso>;

export const esquemaFarmacovigilancia = z.object({
  reacoes: z.array(esquemaReacao),
  usoContinuo: z.array(esquemaUso),
  itensPrescritos: z.array(
    z.object({ id: z.number(), descricao: z.string(), prescritoEm: z.string().nullable() }),
  ),
  gravidades: z.array(z.object({ id: z.number(), descricao: z.string(), nivel: z.number() })),
  causalidades: z.array(z.object({ id: z.number(), descricao: z.string() })),
  nivelGrave: z.number(),
});
export type FarmacovigilanciaTela = z.infer<typeof esquemaFarmacovigilancia>;

const esquemaGravado = z.object({ ok: z.boolean() }).passthrough();

export async function lerFarmacovigilancia(paciente: number, buscar: typeof fetch = fetch) {
  const r = await buscar(`${P}/paciente/${paciente}`, { headers: JSON_ACEITO });
  if (!r.ok) throw await erroDaResposta(r);
  return esquemaFarmacovigilancia.parse(await r.json());
}

async function enviar(url: string, corpo: unknown, rotulo: string, buscar: typeof fetch = fetch) {
  const r = await buscar(url, {
    method: 'POST',
    headers: {
      ...JSON_ACEITO,
      'content-type': 'application/json',
      'x-csrf': tokenCsrf(),
      'idempotency-key': novaChave(rotulo),
    },
    body: JSON.stringify(corpo),
  });
  if (!r.ok) throw await erroDaResposta(r);
  return esquemaGravado.parse(await r.json());
}

export const gravarReacao = (corpo: Record<string, unknown>, buscar?: typeof fetch) =>
  enviar(`${P}/reacoes`, corpo, 'pep.reacao', buscar);
export const gravarUsoContinuo = (corpo: Record<string, unknown>, buscar?: typeof fetch) =>
  enviar(`${P}/uso-continuo`, corpo, 'pep.usoContinuo', buscar);
