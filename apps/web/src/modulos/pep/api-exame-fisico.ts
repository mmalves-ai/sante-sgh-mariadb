// Cliente da API do exame físico estruturado por sistema e região do corpo (03-PEP L97):
// GET  /api/pep/exame-fisico/catalogo             sistemas, regiões com o desenho do mapa e achados padronizados
// GET  /api/pep/exame-fisico/paciente/:paciente   registros recentes com os achados e o resumo por sistema
// POST /api/pep/exame-fisico                      acrescentar achados a um registro (só o autor, registro em vigor)
// Toda gravação leva a chave de idempotência e o x-csrf (como as demais do prontuário).
import { z } from 'zod';
import { tokenCsrf } from '../../api.js';
import { erroDaResposta } from '../../casca/erros/problem-details.js';
import { novaChave } from './api-registro.js';

const P = '/api/pep/exame-fisico';
const JSON_ACEITO = { accept: 'application/json' };
const ref = z.object({ id: z.number(), descricao: z.string() }).nullable();

export const esquemaCatalogoExame = z.object({
  sistemas: z.array(
    z.object({ id: z.number(), codigo: z.string(), descricao: z.string(), sigla: z.string().nullable() }),
  ),
  regioes: z.array(
    z.object({
      id: z.number(),
      codigo: z.string(),
      descricao: z.string(),
      nivel: z.string(),
      superior: z.number().nullable(),
      admiteLateralidade: z.boolean(),
      desenho: z.string().nullable(),
    }),
  ),
  padroes: z.array(
    z.object({
      id: z.number(),
      codigo: z.string(),
      descricao: z.string(),
      sistema: z.number().nullable(),
      regiao: z.number().nullable(),
      normal: z.boolean(),
      publicoAlvo: z.string(),
    }),
  ),
});
export type CatalogoExameTela = z.infer<typeof esquemaCatalogoExame>;

const esquemaRegistro = z.object({
  registro: z.number(),
  dataHoraClinica: z.string().nullable(),
  titulo: z.string(),
  situacao: z.string(),
  autor: z.string().nullable(),
  podeAcrescentar: z.boolean(),
  achados: z.array(
    z.object({
      id: z.number(),
      sequencia: z.number(),
      sistema: ref,
      regiao: ref,
      padrao: ref,
      lateralidade: z.string(),
      normal: z.boolean().nullable(),
      descricao: z.string().nullable(),
      texto: z.string(),
      /** Lançamento do achado: o complemento é datado. */
      lancadoEm: z.string().nullable().optional(),
    }),
  ),
  resumo: z.array(
    z.object({
      sistema: z.string().nullable(),
      examinados: z.number(),
      normais: z.number(),
      alterados: z.number(),
    }),
  ),
});
export type RegistroExameTela = z.infer<typeof esquemaRegistro>;
export const esquemaExamePaciente = z.object({
  faixa: z.string().nullable(),
  registros: z.array(esquemaRegistro),
});
export type ExamePacienteTela = z.infer<typeof esquemaExamePaciente>;

export async function lerCatalogoExame(buscar: typeof fetch = fetch): Promise<CatalogoExameTela> {
  const r = await buscar(`${P}/catalogo`, { headers: JSON_ACEITO });
  if (!r.ok) throw await erroDaResposta(r);
  return esquemaCatalogoExame.parse(await r.json());
}

export async function lerExamePaciente(
  paciente: number,
  buscar: typeof fetch = fetch,
): Promise<ExamePacienteTela> {
  const r = await buscar(`${P}/paciente/${paciente}`, { headers: JSON_ACEITO });
  if (!r.ok) throw await erroDaResposta(r);
  return esquemaExamePaciente.parse(await r.json());
}

export async function gravarExameFisico(corpo: Record<string, unknown>, buscar: typeof fetch = fetch) {
  const r = await buscar(P, {
    method: 'POST',
    headers: {
      ...JSON_ACEITO,
      'content-type': 'application/json',
      'x-csrf': tokenCsrf(),
      'idempotency-key': novaChave('pep.exameFisico'),
    },
    body: JSON.stringify(corpo),
  });
  if (!r.ok) throw await erroDaResposta(r);
  return z
    .object({ ok: z.boolean() })
    .passthrough()
    .parse(await r.json());
}
