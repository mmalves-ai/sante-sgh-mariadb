// Cliente da API do plano de cuidado e da estratificação de risco do paciente (03-PEP L142):
// GET  /api/pep/plano-cuidado/paciente/:paciente   planos do paciente com os itens
// POST /api/pep/plano-cuidado                      criar, não criar (com justificativa), estratificar, ativar, fechar,
//                                                  cancelar (com motivo), incluir item e passo do item
// Toda gravação leva a chave de idempotência e o x-csrf (como as demais do prontuário).
import { z } from 'zod';
import { tokenCsrf } from '../../api.js';
import { erroDaResposta } from '../../casca/erros/problem-details.js';
import { novaChave } from './api-registro.js';

const P = '/api/pep/plano-cuidado';
const JSON_ACEITO = { accept: 'application/json' };

const esquemaItem = z.object({
  id: z.number(),
  versao: z.number(),
  sequencia: z.number(),
  superior: z.number().nullable(),
  tipo: z.string(),
  descricao: z.string(),
  prazo: z.string().nullable(),
  situacao: z.string(),
  concluidaEm: z.string().nullable(),
  justificativaDesvio: z.string().nullable(),
});
export type ItemPlanoTela = z.infer<typeof esquemaItem>;

const esquemaPlano = z.object({
  id: z.number(),
  versao: z.number(),
  situacao: z.string(),
  risco: z.string().nullable(),
  inicio: z.string().nullable(),
  fimPrevisto: z.string().nullable(),
  metas: z.string().nullable(),
  observacao: z.string().nullable(),
  justificativaNaoCriacao: z.string().nullable(),
  responsavel: z.string().nullable(),
  ativadoEm: z.string().nullable(),
  fechadoEm: z.string().nullable(),
  criadoEm: z.string().nullable(),
  itens: z.array(esquemaItem),
});
export type PlanoTela = z.infer<typeof esquemaPlano>;

export const esquemaPlanos = z.object({ planos: z.array(esquemaPlano), podeEscrever: z.boolean() });
export type PlanosTela = z.infer<typeof esquemaPlanos>;

export async function lerPlanosCuidado(paciente: number, buscar: typeof fetch = fetch): Promise<PlanosTela> {
  const r = await buscar(`${P}/paciente/${paciente}`, { headers: JSON_ACEITO });
  if (!r.ok) throw await erroDaResposta(r);
  return esquemaPlanos.parse(await r.json());
}

export async function gravarPlanoCuidado(corpo: Record<string, unknown>, buscar: typeof fetch = fetch) {
  const r = await buscar(P, {
    method: 'POST',
    headers: {
      ...JSON_ACEITO,
      'content-type': 'application/json',
      'x-csrf': tokenCsrf(),
      'idempotency-key': novaChave('pep.planoCuidado'),
    },
    body: JSON.stringify(corpo),
  });
  if (!r.ok) throw await erroDaResposta(r);
  return z
    .object({ ok: z.boolean(), resultado: z.object({ avisar: z.boolean().optional() }).passthrough() })
    .passthrough()
    .parse(await r.json());
}
