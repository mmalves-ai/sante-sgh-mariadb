// Cliente da API das curvas de crescimento do paciente (03-PEP L141):
// GET  /api/pep/crescimento/paciente/:paciente   medidas com escore Z, percentil e classificação; gráficos das curvas
// POST /api/pep/crescimento/medidas              registra a medida de crescimento (peso, estatura, perímetro cefálico)
// Toda gravação leva a chave de idempotência e o x-csrf (como as demais do prontuário).
import { z } from 'zod';
import { tokenCsrf } from '../../api.js';
import { erroDaResposta } from '../../casca/erros/problem-details.js';
import { novaChave } from './api-registro.js';

const P = '/api/pep/crescimento';
const JSON_ACEITO = { accept: 'application/json' };

const esquemaReferencia = z
  .object({
    publicacao: z.enum(['oms2006', 'oms2007', 'intergrowth']),
    x: z.number(),
    idadeMeses: z.number(),
    corrigida: z.boolean().optional(),
  })
  .nullable();
const esquemaAvaliacao = z.object({
  z: z.number(),
  percentil: z.number(),
  classificacao: z.object({ codigo: z.string(), nivel: z.string() }),
  plausivel: z.boolean(),
});
const esquemaMedida = z.object({
  afericao: z.number().nullable(),
  origem: z.enum(['afericao', 'nascimento']),
  medidoEm: z.string(),
  pesoKg: z.number().nullable(),
  estaturaCm: z.number().nullable(),
  perimetroCefalicoCm: z.number().nullable(),
  imc: z.number().nullable(),
  referencia: esquemaReferencia,
  avaliacoes: z.record(z.string(), esquemaAvaliacao),
});
export type MedidaCrescimentoTela = z.infer<typeof esquemaMedida>;
const esquemaGrafico = z.object({
  indicador: z.enum(['peso', 'estatura', 'perimetro_cefalico', 'imc']),
  publicacao: z.enum(['oms2006', 'oms2007', 'intergrowth']),
  codigo: z.string(),
  descricao: z.string(),
  eixo: z.string(),
  unidade: z.string(),
  versaoFonte: z.string(),
  linhas: z.array(z.object({ x: z.number(), valores: z.array(z.number()) })),
  pontos: z.array(
    z.object({
      x: z.number(),
      y: z.number(),
      z: z.number(),
      percentil: z.number(),
      nivel: z.string(),
      medidoEm: z.string(),
    }),
  ),
});
export type GraficoCrescimentoTela = z.infer<typeof esquemaGrafico>;
export const esquemaCrescimento = z.object({
  paciente: z.object({
    nascimento: z.string().nullable(),
    sexo: z.enum(['masculino', 'feminino']).nullable(),
    igSemanas: z.number().nullable(),
    igDias: z.number().nullable(),
  }),
  referenciaAtual: esquemaReferencia,
  medidas: z.array(esquemaMedida),
  graficos: z.array(esquemaGrafico),
  semCurvas: z.boolean(),
});
export type CrescimentoTela = z.infer<typeof esquemaCrescimento>;

export async function lerCrescimento(
  paciente: number,
  buscar: typeof fetch = fetch,
): Promise<CrescimentoTela> {
  const r = await buscar(`${P}/paciente/${paciente}`, { headers: JSON_ACEITO });
  if (!r.ok) throw await erroDaResposta(r);
  return esquemaCrescimento.parse(await r.json());
}

export async function registrarMedidaCrescimento(
  corpo: Record<string, unknown>,
  buscar: typeof fetch = fetch,
) {
  const r = await buscar(`${P}/medidas`, {
    method: 'POST',
    headers: {
      ...JSON_ACEITO,
      'content-type': 'application/json',
      'x-csrf': tokenCsrf(),
      'idempotency-key': novaChave('pep.medidaCrescimento'),
    },
    body: JSON.stringify(corpo),
  });
  if (!r.ok) throw await erroDaResposta(r);
  return z
    .object({ ok: z.boolean() })
    .passthrough()
    .parse(await r.json());
}
